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

export default class ChimeMeetingManager {
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
      const clientRequestToken = crypto.randomUUID();
      const resp = await chime.send(
        new CreateMeetingCommand({
          ClientRequestToken: clientRequestToken,
          MediaRegion: process.env.AWS_REGION,
          ExternalMeetingId: title, // <- Make sure title is NOT undefined
        })
      );

      const meetingId = resp?.Meeting?.MeetingId;
      if (!meetingId) throw new Error("Chime SDK failed to create meeting");

      const item = {
        MeetingId: meetingId,
        Title: title,
        CreatedAt: new Date().toISOString(),
        CreatorUserId: creatorUserId,
        IsOpen: isOpen,
        MeetingPIN: defaultPIN,
        MeetingType: type,
        ScheduledAt: scheduledAt,
        BookingId: linkedBookingId,
        ChatEnabled: chatEnabled,
        RecordingEnabled: recordingEnabled,
        BlockedAttendeeIds: [],
        Revenue: [],
        RecordingS3Url: null,
      };

      await ScyllaDb.putItem(MEETINGS_TABLE, item);
      logEvent("createMeeting", item);
      return item;
    } catch (err) {
      console.log("error", err);
      logError(err, { method: "createMeeting" });
      throw err;
    }
  }

  static async getMeeting(meetingId) {
    try {
      if (redis) {
        const cached = await redis.get(`meeting:${meetingId}`);
        if (cached) return JSON.parse(cached);
      }

      const item = await ScyllaDb.getItem(MEETINGS_TABLE, {
        MeetingId: meetingId,
      });
      if (redis && item)
        await redis.set(`meeting:${meetingId}`, JSON.stringify(item), "EX", 60);
      logEvent("getMeeting", { meetingId });
      return item;
    } catch (err) {
      logError(err, { method: "getMeeting", meetingId });
      throw err;
    }
  }

  static async canJoinMeeting(meetingId, userId) {
    try {
      const meeting = await this.getMeeting(meetingId);
      if (!meeting) throw new Error("Meeting does not exist");

      if (meeting.BlockedAttendeeIds.includes(userId)) {
        throw new Error("Permission Denied – user blocked from joining");
      }

      const attendees = await ScyllaDb.query(
        ATTENDEES_TABLE,
        "MeetingId = :m",
        { ":m": meetingId }
      );
      if (
        attendees.find((a) => a.UserId === userId && a.LeftAt === undefined)
      ) {
        throw new Error("User already joined");
      }

      return attendees.length < MAX_ATTENDEES;
    } catch (err) {
      logError(err, { method: "canJoinMeeting", meetingId, userId });
      throw err;
    }
  }

  static async addAttendee(meetingId, userId, isModerator = false) {
    try {
      const allowed = await this.canJoinMeeting(meetingId, userId);
      if (!allowed) throw new Error("User not allowed to join");

      const resp = await chime.send(
        new CreateAttendeeCommand({
          MeetingId: meetingId,
          ExternalUserId: userId,
        })
      );

      const attendeeId = resp.Attendee.AttendeeId;
      const record = {
        MeetingId: meetingId,
        AttendeeId: attendeeId,
        UserId: userId,
        IsModerator: isModerator,
        JoinedAt: new Date().toISOString(),
      };

      await ScyllaDb.putItem(ATTENDEES_TABLE, record);
      logEvent("addAttendee", record);
      return record;
    } catch (err) {
      logError(err, { method: "addAttendee", meetingId, userId });
      throw err;
    }
  }

  static async deleteAttendee(meetingId, attendeeId) {
    try {
      await chime.send(
        new DeleteAttendeeCommand({
          MeetingId: meetingId,
          AttendeeId: attendeeId,
        })
      );
      await ScyllaDb.deleteItem(ATTENDEES_TABLE, {
        MeetingId: meetingId,
        AttendeeId,
      });
      logEvent("deleteAttendee", { meetingId, attendeeId });
    } catch (err) {
      logError(err, { method: "deleteAttendee", meetingId, attendeeId });
      throw err;
    }
  }

  static async blockAttendee(meetingId, userId) {
    try {
      const meeting = await this.getMeeting(meetingId);
      const blocked = new Set(meeting.BlockedAttendeeIds || []);
      blocked.add(userId);

      // Add custom system-level block as needed here
      await ScyllaDb.updateItem(
        MEETINGS_TABLE,
        { MeetingId: meetingId },
        {
          BlockedAttendeeIds: Array.from(blocked),
        }
      );
      logEvent("blockAttendee", { meetingId, userId });
    } catch (err) {
      logError(err, { method: "blockAttendee", meetingId, userId });
      throw err;
    }
  }

  static async userJoinedMeeting(meetingId, attendeeId, userId) {
    const joinedAt = new Date().toISOString();
    await ScyllaDb.updateItem(
      ATTENDEES_TABLE,
      { MeetingId: meetingId, AttendeeId: attendeeId },
      { JoinedAt: joinedAt }
    );
    await ScyllaDb.putItem(JOIN_LOGS_TABLE, {
      UserId: userId,
      MeetingId: meetingId,
      JoinTimestamp: joinedAt,
      EventType: "join",
    });
    logEvent("userJoinedMeeting", { meetingId, userId, attendeeId });
  }

  static async userLeftMeeting(meetingId, attendeeId, userId) {
    const leftAt = new Date().toISOString();
    await ScyllaDb.updateItem(
      ATTENDEES_TABLE,
      { MeetingId: meetingId, AttendeeId: attendeeId },
      { LeftAt: leftAt }
    );
    await ScyllaDb.putItem(JOIN_LOGS_TABLE, {
      UserId: userId,
      MeetingId: meetingId,
      JoinTimestamp: leftAt,
      EventType: "leave",
    });
    logEvent("userLeftMeeting", { meetingId, userId, attendeeId });
  }

  static async submitFeedback({
    meetingId,
    userId,
    score,
    feedback,
    commentToSession,
    rating,
  }) {
    const record = {
      MeetingId: meetingId,
      UserId: userId,
      SubmittedAt: new Date().toISOString(),
      Score: score,
      Feedback: feedback,
      PrivateComment: commentToSession,
      Rating: rating,
    };
    await ScyllaDb.putItem(FEEDBACK_TABLE, record);
    logEvent("submitFeedback", record);
  }

  static async updateRevenue(meetingId, revenueEntry) {
    const meeting = await this.getMeeting(meetingId);
    const updatedRevenue = [...(meeting.Revenue || []), revenueEntry];
    await ScyllaDb.updateItem(
      MEETINGS_TABLE,
      { MeetingId: meetingId },
      {
        Revenue: updatedRevenue,
      }
    );
    logEvent("updateRevenue", { meetingId, revenueEntry });
  }

  static async getRecording(meetingId) {
    const meeting = await this.getMeeting(meetingId);
    return meeting?.RecordingS3Url || null;
  }

  static async hasRecording(meetingId) {
    const url = await this.getRecording(meetingId);
    return !!url;
  }

  static async getUserRingtone(userId) {
    const user = await ScyllaDb.getItem(USER_SETTINGS_TABLE, {
      UserId: userId,
    });
    return user?.Ringtone || "default";
  }

  static async getUserMeetingAvatar(userId) {
    const user = await ScyllaDb.getItem(USER_SETTINGS_TABLE, {
      UserId: userId,
    });
    return user?.AvatarUrl || null;
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
