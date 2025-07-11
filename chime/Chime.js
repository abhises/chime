const {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
} = require("@aws-sdk/client-chime-sdk-meetings");

const crypto = require("crypto");
const dotenv = require("dotenv");
const ScyllaDb = require("../ScyllaDb");
const redis = require("../redis/redisWrapper");
const SafeUtils = require("../utils/SafeUtils");
const ErrorHandler = require("../utils/ErrorHandler");

dotenv.config();
const chime = new ChimeSDKMeetingsClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Constants
const MAX_ATTENDEES = 250;
const MEETINGS_TABLE = "MeetingMeetings";
const ATTENDEES_TABLE = "MeetingAttendees";
const FEEDBACK_TABLE = "MeetingFeedback";
const JOIN_LOGS_TABLE = "MeetingJoinLogs";
const USER_SETTINGS_TABLE = "UserSettings";

function logEvent(event, data = {}) {
  console.log(
    `[${new Date().toISOString()}] EVENT: ${event}`,
    JSON.stringify(data)
  );
}

function logError(error, context = {}) {
  console.error(`[${new Date().toISOString()}] ERROR: ${error.message}`, {
    stack: error.stack,
    ...context,
  });
}

class Chime {
  static async createMeeting({
    title,
    type = "private_audio",
    isOpen = true,
    creatorUserId,
    defaultPIN = null,
    scheduledAt = null,
    linkedBookingId = null,
    chatEnabled = true,
    recordingEnabled = false,
  }) {
    try {
      // ✅ Step 1: Validate & Sanitize Inputs
      const params = SafeUtils.sanitizeValidate({
        title: { value: title, type: "string", required: true },
        type: {
          value: type,
          type: "string",
          required: false,
          default: "private_audio",
        },
        isOpen: {
          value: isOpen,
          type: "boolean",
          required: false,
          default: true,
        },
        creatorUserId: { value: creatorUserId, type: "string", required: true },
        defaultPIN: {
          value: defaultPIN,
          type: "string",
          required: false,
          default: null,
        },
        scheduledAt: {
          value: scheduledAt,
          type: "string",
          required: false,
          default: null,
        },
        linkedBookingId: {
          value: linkedBookingId,
          type: "string",
          required: false,
          default: null,
        },
        chatEnabled: {
          value: chatEnabled,
          type: "boolean",
          required: false,
          default: true,
        },
        recordingEnabled: {
          value: recordingEnabled,
          type: "boolean",
          required: false,
          default: false,
        },
      });

      const clientRequestToken = crypto.randomUUID();

      // ✅ Step 2: Call AWS SDK
      const resp = await chime.send(
        new CreateMeetingCommand({
          ClientRequestToken: clientRequestToken,
          MediaRegion: process.env.AWS_REGION,
          ExternalMeetingId: params.title,
        })
      );

      const meetingId = resp?.Meeting?.MeetingId;
      if (!meetingId) throw new Error("Chime SDK failed to create meeting");

      // ✅ Step 3: Build & Store Meeting
      const item = {
        MeetingId: meetingId,
        Title: params.title,
        CreatedAt: new Date().toISOString(),
        CreatorUserId: params.creatorUserId,
        IsOpen: params.isOpen,
        MeetingPIN: params.defaultPIN,
        MeetingType: params.type,
        ScheduledAt: params.scheduledAt,
        BookingId: params.linkedBookingId,
        ChatEnabled: params.chatEnabled,
        RecordingEnabled: params.recordingEnabled,
        BlockedAttendeeIds: [],
        Revenue: [],
        RecordingS3Url: null,
      };

      await ScyllaDb.putItem(MEETINGS_TABLE, item);
      logEvent("createMeeting", item);

      return item;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "createMeeting" });

      // logError(err, { method: "createMeeting" });
      // throw err;
    }
  }
  static async getMeeting(meetingId) {
    try {
      // Validate meetingId: required string
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
      });

      if (!params.meetingId) {
        throw new Error("Invalid meetingId parameter");
      }

      if (redis) {
        const cached = await redis.get(`meeting:${params.meetingId}`);
        if (cached) return JSON.parse(cached);
      }

      const item = await ScyllaDb.getItem(MEETINGS_TABLE, {
        MeetingId: params.meetingId,
      });

      if (redis && item) {
        await redis.set(
          `meeting:${params.meetingId}`,
          JSON.stringify(item),
          "EX",
          60
        );
      }

      logEvent("getMeeting", { meetingId: params.meetingId });
      return item;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "getMeeting", meetingId });
      // You can either:
      // 1) re-throw: throw err;
      // 2) or return null/fallback value
      return null;
    }
  }

  static async canJoinMeeting(meetingId, userId) {
    try {
      // 1. Sanitize and validate inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Load meeting
      const meeting = await this.getMeeting(params.meetingId);
      if (!meeting) throw new Error("Meeting does not exist");

      // 3. Blocked user check
      if (
        Array.isArray(meeting.BlockedAttendeeIds) &&
        meeting.BlockedAttendeeIds.includes(params.userId)
      ) {
        throw new Error("Permission Denied – user blocked from joining");
      }

      // 4. Get attendees from DB
      const attendees = await ScyllaDb.query(
        ATTENDEES_TABLE,
        "MeetingId = :m",
        { ":m": params.meetingId }
      );

      // 5. Check if user already joined
      const alreadyJoined = attendees.find(
        (a) => a.UserId === params.userId && a.LeftAt === undefined
      );
      if (alreadyJoined) {
        throw new Error("User already joined");
      }

      // 6. Check for max capacity
      return attendees.length < MAX_ATTENDEES;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "canJoinMeeting",
        meetingId,
        userId,
      });
      throw err; // or return false/null if preferred
    }
  }

  static async addAttendee(meetingId, userId, isModerator = false) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Check permission to join
      const allowed = await this.canJoinMeeting(
        params.meetingId,
        params.userId
      );
      if (!allowed) throw new Error("User not allowed to join");

      // 3. Create attendee in Chime
      const resp = await chime.send(
        new CreateAttendeeCommand({
          MeetingId: params.meetingId,
          ExternalUserId: params.userId,
        })
      );

      const attendeeId = resp.Attendee.AttendeeId;
      const record = {
        MeetingId: params.meetingId,
        AttendeeId: attendeeId,
        UserId: params.userId,
        IsModerator: isModerator,
        JoinedAt: new Date().toISOString(),
      };

      // 4. Store in DB
      await ScyllaDb.putItem(ATTENDEES_TABLE, record);

      // 5. Log and return
      logEvent("addAttendee", record);
      return record;
    } catch (err) {
      // 6. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "addAttendee",
        meetingId,
        userId,
      });
      logError(err, { method: "addAttendee", meetingId, userId });
      throw err;
    }
  }

  static async deleteAttendee(meetingId, attendeeId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        attendeeId: { value: attendeeId, type: "string", required: true },
      });

      // 2. Call Chime to delete attendee
      await chime.send(
        new DeleteAttendeeCommand({
          MeetingId: params.meetingId,
          AttendeeId: params.attendeeId,
        })
      );

      // 3. Delete from DB
      await ScyllaDb.deleteItem(ATTENDEES_TABLE, {
        MeetingId: params.meetingId,
        AttendeeId: params.attendeeId,
      });

      // 4. Log success
      logEvent("deleteAttendee", {
        meetingId: params.meetingId,
        attendeeId: params.attendeeId,
      });
    } catch (err) {
      // 5. Handle and log error
      ErrorHandler.add_error(err.message, {
        method: "deleteAttendee",
        meetingId,
        attendeeId,
      });
      logError(err, {
        method: "deleteAttendee",
        meetingId,
        attendeeId,
      });
      throw err;
    }
  }

  static async blockAttendee(meetingId, userId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Get the meeting record
      const meeting = await this.getMeeting(params.meetingId);
      if (!meeting) throw new Error("Meeting not found");

      // 3. Add user to blocked set
      const blocked = new Set(meeting.BlockedAttendeeIds || []);
      blocked.add(params.userId);

      // 4. Update the meeting in DB
      await ScyllaDb.updateItem(
        MEETINGS_TABLE,
        { MeetingId: params.meetingId },
        {
          BlockedAttendeeIds: Array.from(blocked),
        }
      );

      // 5. Log success
      logEvent("blockAttendee", {
        meetingId: params.meetingId,
        userId: params.userId,
      });
    } catch (err) {
      // 6. Handle and log error
      ErrorHandler.add_error(err.message, {
        method: "blockAttendee",
        meetingId,
        userId,
      });
      logError(err, {
        method: "blockAttendee",
        meetingId,
        userId,
      });
      throw err;
    }
  }

  static async userJoinedMeeting(meetingId, attendeeId, userId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        attendeeId: { value: attendeeId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Set join time
      const joinedAt = new Date().toISOString();

      // 3. Update attendee record
      await ScyllaDb.updateItem(
        ATTENDEES_TABLE,
        { MeetingId: params.meetingId, AttendeeId: params.attendeeId },
        { JoinedAt: joinedAt }
      );

      // 4. Insert join log
      await ScyllaDb.putItem(JOIN_LOGS_TABLE, {
        UserId: params.userId,
        MeetingId: params.meetingId,
        JoinTimestamp: joinedAt,
        EventType: "join",
      });

      // 5. Log success
      logEvent("userJoinedMeeting", {
        meetingId: params.meetingId,
        userId: params.userId,
        attendeeId: params.attendeeId,
      });
    } catch (err) {
      // 6. Handle and log error
      ErrorHandler.add_error(err.message, {
        method: "userJoinedMeeting",
        meetingId,
        userId,
        attendeeId,
      });
      logError(err, {
        method: "userJoinedMeeting",
        meetingId,
        userId,
        attendeeId,
      });
      throw err;
    }
  }

  static async userLeftMeeting(meetingId, attendeeId, userId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        attendeeId: { value: attendeeId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Set leave time
      const leftAt = new Date().toISOString();

      // 3. Update attendee record
      await ScyllaDb.updateItem(
        ATTENDEES_TABLE,
        { MeetingId: params.meetingId, AttendeeId: params.attendeeId },
        { LeftAt: leftAt }
      );

      // 4. Insert leave log
      await ScyllaDb.putItem(JOIN_LOGS_TABLE, {
        UserId: params.userId,
        MeetingId: params.meetingId,
        JoinTimestamp: leftAt,
        EventType: "leave",
      });

      // 5. Log success
      logEvent("userLeftMeeting", {
        meetingId: params.meetingId,
        userId: params.userId,
        attendeeId: params.attendeeId,
      });
    } catch (err) {
      // 6. Handle and log error
      ErrorHandler.add_error(err.message, {
        method: "userLeftMeeting",
        meetingId,
        userId,
        attendeeId,
      });
      logError(err, {
        method: "userLeftMeeting",
        meetingId,
        userId,
        attendeeId,
      });
      throw err;
    }
  }

  static async submitFeedback({
    meetingId,
    userId,
    score,
    feedback,
    commentToSession,
    rating,
  }) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
        score: { value: score, type: "numeric", required: true },
        feedback: { value: feedback, type: "string", required: false },
        commentToSession: {
          value: commentToSession,
          type: "string",
          required: false,
        },
        rating: { value: rating, type: "numeric", required: false },
      });

      // 2. Prepare record
      const record = {
        MeetingId: params.meetingId,
        UserId: params.userId,
        SubmittedAt: new Date().toISOString(),
        Score: params.score,
        Feedback: params.feedback,
        PrivateComment: params.commentToSession,
        Rating: params.rating,
      };

      // 3. Store in DB
      await ScyllaDb.putItem(FEEDBACK_TABLE, record);

      // 4. Log success event
      logEvent("submitFeedback", record);
    } catch (err) {
      // 5. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "submitFeedback",
        meetingId,
        userId,
        score,
        feedback,
        commentToSession,
        rating,
      });
      logError(err, {
        method: "submitFeedback",
        meetingId,
        userId,
        score,
        feedback,
        commentToSession,
        rating,
      });
      throw err;
    }
  }

  static async updateRevenue(meetingId, revenueEntry) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        revenueEntry: { value: revenueEntry, type: "object", required: true },
      });

      // Optional: further validate revenueEntry shape (type, amount, tokens, source)
      if (
        typeof params.revenueEntry.type !== "string" ||
        typeof params.revenueEntry.amount !== "number" ||
        typeof params.revenueEntry.tokens !== "number" ||
        typeof params.revenueEntry.source !== "string"
      ) {
        throw new Error("Invalid revenueEntry properties");
      }

      // 2. Fetch existing meeting
      const meeting = await this.getMeeting(params.meetingId);

      // 3. Append new revenue entry
      const updatedRevenue = [...(meeting.Revenue || []), params.revenueEntry];

      // 4. Update DB
      await ScyllaDb.updateItem(
        MEETINGS_TABLE,
        { MeetingId: params.meetingId },
        {
          Revenue: updatedRevenue,
        }
      );

      // 5. Log event
      logEvent("updateRevenue", {
        meetingId: params.meetingId,
        revenueEntry: params.revenueEntry,
      });
    } catch (err) {
      // 6. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "updateRevenue",
        meetingId,
        revenueEntry,
      });
      logError(err, {
        method: "updateRevenue",
        meetingId,
        revenueEntry,
      });
      throw err;
    }
  }

  static async getRecording(meetingId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
      });

      // 2. Fetch meeting
      const meeting = await this.getMeeting(params.meetingId);

      // 3. Return recording URL or null
      return meeting?.RecordingS3Url || null;
    } catch (err) {
      // 4. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "getRecording",
        meetingId,
      });
      logError(err, {
        method: "getRecording",
        meetingId,
      });
      throw err;
    }
  }

  static async hasRecording(meetingId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
      });

      // 2. Reuse getRecording to fetch URL
      const url = await this.getRecording(params.meetingId);

      // 3. Return boolean if URL exists
      return !!url;
    } catch (err) {
      // 4. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "hasRecording",
        meetingId,
      });
      logError(err, {
        method: "hasRecording",
        meetingId,
      });
      throw err;
    }
  }

  static async getUserRingtone(userId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Fetch user data from DB
      const user = await ScyllaDb.getItem(USER_SETTINGS_TABLE, {
        UserId: params.userId,
      });

      // 3. Return ringtone or default
      return user?.Ringtone || "default";
    } catch (err) {
      // 4. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "getUserRingtone",
        userId,
      });
      logError(err, {
        method: "getUserRingtone",
        userId,
      });
      throw err;
    }
  }

  static async getUserMeetingAvatar(userId) {
    try {
      // 1. Validate and sanitize inputs
      const params = SafeUtils.sanitizeValidate({
        userId: { value: userId, type: "string", required: true },
      });

      // 2. Fetch user data from DB
      const user = await ScyllaDb.getItem(USER_SETTINGS_TABLE, {
        UserId: params.userId,
      });

      // 3. Return avatar URL or null
      return user?.AvatarUrl || null;
    } catch (err) {
      // 4. Handle and log errors
      ErrorHandler.add_error(err.message, {
        method: "getUserMeetingAvatar",
        userId,
      });
      logError(err, {
        method: "getUserMeetingAvatar",
        userId,
      });
      throw err;
    }
  }

  static async getDefaultAvatars() {
    return [
      "https://cdn.example.com/avatars/1.png",
      "https://cdn.example.com/avatars/2.png",
      "https://cdn.example.com/avatars/3.png",
    ];
  }

  static async notifyMeetingStarted(meetingId) {
    // Implement SNS, WebSocket or Email notification
    logEvent("notifyMeetingStarted", { meetingId });
  }

  // Placeholders – chat handled externally
  static async createChannel() {
    logEvent("createChannel", { using: "custom-chat-system" });
    return null;
  }

  static async deleteChannel() {
    logEvent("deleteChannel", { using: "custom-chat-system" });
    return null;
  }
}

module.exports = Chime;
