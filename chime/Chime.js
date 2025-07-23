import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
} from "@aws-sdk/client-chime-sdk-meetings";

import crypto from "crypto";
import dotenv from "dotenv";
import ScyllaDb from "../ScyllaDb.js";
import redis from "../redis/redisWrapper.js";
import SafeUtils from "../utils/SafeUtils.js";
import ErrorHandler from "../utils/ErrorHandler.js";
import Logger from "../utils/UtilityLogger.js";

dotenv.config();

const chime = new ChimeSDKMeetingsClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

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
export default class Chime {
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
      console.log("checking response", resp);
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

      Logger.writeLog({
        flag: "CHIME_CREATE_MEETING",
        action: "createMeeting",
        message: `Meeting created successfully for user ${params.creatorUserId}`,
        data: item,
      });

      return item;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "createMeeting" });

      Logger.writeLog({
        flag: "CHIME_CREATE_ERROR",
        action: "createMeeting",
        message: err.message,
        data: { title, creatorUserId },
        critical: true,
      });

      return null;
    }
  }

  static async getMeeting(meetingId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
      });

      const cached = await redis.get(`meeting:${params.meetingId}`);
      if (cached) return JSON.parse(cached);

      const item = await ScyllaDb.getItem(MEETINGS_TABLE, {
        MeetingId: params.meetingId,
      });

      if (item) {
        await redis.set(
          `meeting:${params.meetingId}`,
          JSON.stringify(item),
          "EX",
          60
        );
      }

      Logger.writeLog({
        flag: "CHIME_GET_MEETING",
        action: "getMeeting",
        message: `Meeting retrieved successfully for ID ${params.meetingId}`,
        data: item,
      });

      return item;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "getMeeting", meetingId });

      Logger.writeLog({
        flag: "CHIME_GET_ERROR",
        action: "getMeeting",
        message: err.message,
        data: { meetingId },
        critical: true,
      });

      return null;
    }
  }

  static async canJoinMeeting(meetingId, userId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      const meeting = await this.getMeeting(params.meetingId);
      if (!meeting) throw new Error("Meeting does not exist");

      if (
        Array.isArray(meeting.BlockedAttendeeIds) &&
        meeting.BlockedAttendeeIds.includes(params.userId)
      ) {
        throw new Error("Permission Denied – user blocked from joining");
      }

      const attendees = await ScyllaDb.query(
        ATTENDEES_TABLE,
        "MeetingId = :m",
        { ":m": params.meetingId }
      );

      const alreadyJoined = attendees.find(
        (a) => a.UserId === params.userId && a.LeftAt === undefined
      );
      if (alreadyJoined) {
        throw new Error("User already joined");
      }

      const allowed = attendees.length < MAX_ATTENDEES;

      Logger.writeLog({
        flag: "CHIME_CAN_JOIN_MEETING",
        action: "canJoinMeeting",
        message: `Checked join permission for user ${params.userId}`,
        data: { meetingId: params.meetingId, allowed },
      });

      return allowed;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "canJoinMeeting",
        meetingId,
        userId,
      });

      Logger.writeLog({
        flag: "CHIME_CAN_JOIN_ERROR",
        action: "canJoinMeeting",
        message: err.message,
        data: { meetingId, userId },
        critical: true,
      });

      throw err;
    }
  }

  static async addAttendee(meetingId, userId, isModerator = false) {
    try {
      // Validate required parameters
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      // Authorization check
      const allowed = await this.canJoinMeeting(
        params.meetingId,
        params.userId
      );
      if (!allowed) {
        throw new Error(
          `User ${params.userId} not allowed to join meeting ${params.meetingId}`
        );
      }

      // Create attendee via AWS Chime
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

      // ✅ Add timestamp key to match logger template
      record.timestamp = record.JoinedAt;

      // Persist to DB
      await ScyllaDb.putItem(ATTENDEES_TABLE, record);

      // Emit custom event log
      logEvent("addAttendee", record);

      // Logger: success case
      Logger.writeLog({
        flag: "CHIME_ADD_ATTENDEE",
        action: "addAttendee",
        message: `User ${params.userId} joined meeting ${params.meetingId}`,
        data: record,
      });

      return record;
    } catch (err) {
      const context = {
        method: "addAttendee",
        meetingId,
        userId,
      };

      // Custom error handler
      ErrorHandler.add_error(err.message, context);

      // Logger: error case
      Logger.writeLog({
        flag: "CHIME_ADD_ATTENDEE_ERROR",
        action: "addAttendee",
        message: err.message,
        data: { ...context, stack: err.stack },
        critical: true,
      });

      // Local error logging
      logError(err, context);

      throw err;
    }
  }

  static async deleteAttendee(meetingId, attendeeId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        attendeeId: { value: attendeeId, type: "string", required: true },
      });

      await chime.send(
        new DeleteAttendeeCommand({
          MeetingId: params.meetingId,
          AttendeeId: params.attendeeId,
        })
      );

      await ScyllaDb.deleteItem(ATTENDEES_TABLE, {
        MeetingId: params.meetingId,
        AttendeeId: params.attendeeId,
      });

      logEvent("deleteAttendee", {
        meetingId: params.meetingId,
        attendeeId: params.attendeeId,
      });

      Logger.writeLog({
        flag: "CHIME_DELETE_ATTENDEE",
        action: "deleteAttendee",
        message: `Attendee ${params.attendeeId} removed from meeting ${params.meetingId}`,
        data: { meetingId: params.meetingId, attendeeId: params.attendeeId },
      });
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "deleteAttendee",
        meetingId,
        attendeeId,
      });

      Logger.writeLog({
        flag: "CHIME_DELETE_ATTENDEE_ERROR",
        action: "deleteAttendee",
        message: err.message,
        data: { meetingId, attendeeId },
        critical: true,
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
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      const meeting = await this.getMeeting(params.meetingId);
      if (!meeting) throw new Error("Meeting not found");

      const blocked = new Set(meeting.BlockedAttendeeIds || []);
      blocked.add(params.userId);

      await ScyllaDb.updateItem(
        MEETINGS_TABLE,
        { MeetingId: params.meetingId },
        {
          BlockedAttendeeIds: Array.from(blocked),
        }
      );

      logEvent("blockAttendee", {
        meetingId: params.meetingId,
        userId: params.userId,
      });

      Logger.writeLog({
        flag: "CHIME_BLOCK_ATTENDEE",
        action: "blockAttendee",
        message: `User ${params.userId} blocked from meeting ${params.meetingId}`,
        data: { meetingId: params.meetingId, userId: params.userId },
      });
    } catch (err) {
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
      Logger.writeLog({
        flag: "CHIME_BLOCK_ERROR",
        action: "blockAttendee",
        message: err.message,
        data: { meetingId, userId },
        critical: true,
      });
      throw err;
    }
  }

  static async userJoinedMeeting(meetingId, attendeeId, userId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        attendeeId: { value: attendeeId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      const joinedAt = new Date().toISOString();

      await ScyllaDb.updateItem(
        ATTENDEES_TABLE,
        { MeetingId: params.meetingId, AttendeeId: params.attendeeId },
        { JoinedAt: joinedAt }
      );

      await ScyllaDb.putItem(JOIN_LOGS_TABLE, {
        UserId: params.userId,
        MeetingId: params.meetingId,
        JoinTimestamp: joinedAt,
        EventType: "join",
      });

      logEvent("userJoinedMeeting", {
        meetingId: params.meetingId,
        userId: params.userId,
        attendeeId: params.attendeeId,
      });

      Logger.writeLog({
        flag: "CHIME_JOINED",
        action: "userJoinedMeeting",
        message: `User ${params.userId} joined meeting ${params.meetingId}`,
        data: { meetingId: params.meetingId, userId: params.userId },
      });
    } catch (err) {
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
      Logger.writeLog({
        flag: "CHIME_JOIN_ERROR",
        action: "userJoinedMeeting",
        message: err.message,
        data: { meetingId, userId, attendeeId },
        critical: true,
      });
      throw err;
    }
  }

  static async userLeftMeeting(meetingId, attendeeId, userId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        attendeeId: { value: attendeeId, type: "string", required: true },
        userId: { value: userId, type: "string", required: true },
      });

      const leftAt = new Date().toISOString();

      await ScyllaDb.updateItem(
        ATTENDEES_TABLE,
        { MeetingId: params.meetingId, AttendeeId: params.attendeeId },
        { LeftAt: leftAt }
      );

      await ScyllaDb.putItem(JOIN_LOGS_TABLE, {
        UserId: params.userId,
        MeetingId: params.meetingId,
        JoinTimestamp: leftAt,
        EventType: "leave",
      });

      logEvent("userLeftMeeting", {
        meetingId: params.meetingId,
        userId: params.userId,
        attendeeId: params.attendeeId,
      });

      Logger.writeLog({
        flag: "CHIME_LEFT",
        action: "userLeftMeeting",
        message: `User ${params.userId} left meeting ${params.meetingId}`,
        data: { meetingId: params.meetingId, userId: params.userId },
      });
    } catch (err) {
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
      Logger.writeLog({
        flag: "CHIME_LEAVE_ERROR",
        action: "userLeftMeeting",
        message: err.message,
        data: { meetingId, userId, attendeeId },
        critical: true,
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

      const record = {
        MeetingId: params.meetingId,
        UserId: params.userId,
        SubmittedAt: new Date().toISOString(),
        Score: params.score,
        Feedback: params.feedback,
        PrivateComment: params.commentToSession,
        Rating: params.rating,
      };

      await ScyllaDb.putItem(FEEDBACK_TABLE, record);

      logEvent("submitFeedback", record);

      Logger.writeLog({
        flag: "CHIME_FEEDBACK",
        action: "submitFeedback",
        message: `Feedback submitted by ${params.userId} for meeting ${params.meetingId}`,
        data: record,
      });
    } catch (err) {
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
      Logger.writeLog({
        flag: "CHIME_FEEDBACK_ERROR",
        action: "submitFeedback",
        message: err.message,
        data: {
          meetingId,
          userId,
          score,
          feedback,
          commentToSession,
          rating,
        },
        critical: true,
      });
      throw err;
    }
  }

  static async updateRevenue(meetingId, revenueEntry) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
        revenueEntry: { value: revenueEntry, type: "object", required: true },
      });

      if (
        typeof params.revenueEntry.type !== "string" ||
        typeof params.revenueEntry.amount !== "number" ||
        typeof params.revenueEntry.tokens !== "number" ||
        typeof params.revenueEntry.source !== "string"
      ) {
        throw new Error("Invalid revenueEntry properties");
      }

      const meeting = await this.getMeeting(params.meetingId);

      const updatedRevenue = [...(meeting.Revenue || []), params.revenueEntry];

      await ScyllaDb.updateItem(
        MEETINGS_TABLE,
        { MeetingId: params.meetingId },
        {
          Revenue: updatedRevenue,
        }
      );

      logEvent("updateRevenue", {
        meetingId: params.meetingId,
        revenueEntry: params.revenueEntry,
      });

      Logger.writeLog({
        flag: "CHIME_REVENUE",
        action: "updateRevenue",
        message: `Revenue updated for meeting ${params.meetingId}`,
        data: {
          meetingId: params.meetingId,
          revenueEntry: params.revenueEntry,
        },
      });
    } catch (err) {
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
      Logger.writeLog({
        flag: "CHIME_REVENUE_ERROR",
        action: "updateRevenue",
        message: err.message,
        data: { meetingId, revenueEntry },
        critical: true,
      });
      throw err;
    }
  }

  static async getRecording(meetingId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
      });

      const meeting = await this.getMeeting(params.meetingId);

      const recordingUrl = meeting?.RecordingS3Url || null;

      Logger.writeLog({
        flag: "CHIME_GET_RECORDING",
        action: "getRecording",
        message: `Recording URL retrieved for meeting ${params.meetingId}`,
        data: { meetingId: params.meetingId, recordingUrl },
      });

      return recordingUrl;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "getRecording",
        meetingId,
      });
      logError(err, {
        method: "getRecording",
        meetingId,
      });
      Logger.writeLog({
        flag: "CHIME_GET_RECORDING_ERROR",
        action: "getRecording",
        message: err.message,
        data: { meetingId },
        critical: true,
      });
      throw err;
    }
  }

  static async hasRecording(meetingId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        meetingId: { value: meetingId, type: "string", required: true },
      });

      const url = await this.getRecording(params.meetingId);

      Logger.writeLog({
        flag: "CHIME_HAS_RECORDING",
        action: "hasRecording",
        message: `Recording check completed for meeting ${params.meetingId}`,
        data: { meetingId: params.meetingId, hasRecording: !!url },
      });

      return !!url;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "hasRecording",
        meetingId,
      });
      logError(err, {
        method: "hasRecording",
        meetingId,
      });
      Logger.writeLog({
        flag: "CHIME_HAS_RECORDING_ERROR",
        action: "hasRecording",
        message: err.message,
        data: { meetingId },
        critical: true,
      });
      throw err;
    }
  }

  static async getUserRingtone(userId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        userId: { value: userId, type: "string", required: true },
      });

      const user = await ScyllaDb.getItem(USER_SETTINGS_TABLE, {
        UserId: params.userId,
      });

      const ringtone = user?.Ringtone || "default";

      Logger.writeLog({
        flag: "CHIME_GET_RINGTONE",
        action: "getUserRingtone",
        message: `Ringtone retrieved for user ${params.userId}`,
        data: { userId: params.userId, ringtone },
      });

      return ringtone;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "getUserRingtone",
        userId,
      });
      logError(err, {
        method: "getUserRingtone",
        userId,
      });
      Logger.writeLog({
        flag: "CHIME_GET_RINGTONE_ERROR",
        action: "getUserRingtone",
        message: err.message,
        data: { userId },
        critical: true,
      });
      throw err;
    }
  }

  static async getUserMeetingAvatar(userId) {
    try {
      const params = SafeUtils.sanitizeValidate({
        userId: { value: userId, type: "string", required: true },
      });

      const user = await ScyllaDb.getItem(USER_SETTINGS_TABLE, {
        UserId: params.userId,
      });

      const avatarUrl = user?.AvatarUrl || null;

      Logger.writeLog({
        flag: "CHIME_GET_AVATAR",
        action: "getUserMeetingAvatar",
        message: `Avatar URL retrieved for user ${params.userId}`,
        data: { userId: params.userId, avatarUrl },
      });

      return avatarUrl;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "getUserMeetingAvatar",
        userId,
      });
      logError(err, {
        method: "getUserMeetingAvatar",
        userId,
      });
      Logger.writeLog({
        flag: "CHIME_GET_AVATAR_ERROR",
        action: "getUserMeetingAvatar",
        message: err.message,
        data: { userId },
        critical: true,
      });
      throw err;
    }
  }

  static async getDefaultAvatars() {
    const avatars = [
      "https://cdn.example.com/avatars/1.png",
      "https://cdn.example.com/avatars/2.png",
      "https://cdn.example.com/avatars/3.png",
    ];

    Logger.writeLog({
      flag: "CHIME_GET_DEFAULT_AVATARS",
      action: "getDefaultAvatars",
      message: "Default avatars fetched successfully",
      data: { count: avatars.length },
    });

    return avatars;
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
