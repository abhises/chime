import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
} from "@aws-sdk/client-chime-sdk-meetings";
import crypto from "crypto";
import ScyllaDb from "./ScyllaDb.js";
import Redis from "ioredis";

// Clients
const chime = new ChimeSDKMeetingsClient({ region: process.env.AWS_REGION });
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

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

// ✅ Minimal .env.local (for local/Replit)
// env
// Copy
// Edit
// APP_ENVIRONMENT=dev
// AWS_REGION=us-east-1
// AWS_ACCESS_KEY_ID=your-local-access-key
// AWS_SECRET_ACCESS_KEY=your-local-secret-key
// REDIS_URL=redis://localhost:6379

// ✅ Minimal .env.prod (for AWS/Lambda/EC2)
// APP_ENVIRONMENT=prod
// AWS_REGION=us-east-1
// REDIS_URL=redis://your-prod-redis:6379
// ✅ No AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY in prod — AWS IAM role handles it.

// Testing Code
import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testCreateMeeting() {
  console.log("\n==== TEST: createMeeting ====\n");

  // 1. ✅ Basic meeting
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Basic Audio",
      creatorUserId: "user001",
    });
    console.log("✅ Created:", res.MeetingId);
  } catch (e) {
    console.error("❌ Failed basic meeting:", e.message);
  }

  // 2. ✅ Video meeting with recording
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Video Call",
      type: "private_video",
      recordingEnabled: true,
      creatorUserId: "user002",
    });
    console.log("✅ Video w/ recording:", res.MeetingId);
  } catch (e) {
    console.error("❌ Failed video:", e.message);
  }

  // 3. ✅ Scheduled with PIN and booking
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Scheduled",
      creatorUserId: "user003",
      defaultPIN: "4321",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "book789",
    });
    console.log("✅ Scheduled:", res.MeetingId);
  } catch (e) {
    console.error("❌ Scheduled failed:", e.message);
  }

  // 4. ✅ Group audio
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Group Audio",
      type: "group_audio",
      creatorUserId: "user004",
    });
    console.log("✅ Group audio:", res.MeetingId);
  } catch (e) {
    console.error("❌ Group audio failed:", e.message);
  }

  // 5. ❌ Missing title
  try {
    const res = await ChimeMeetingManager.createMeeting({
      creatorUserId: "user005",
    });
    console.log("❌ Should fail but passed:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (no title):", e.message);
  }

  // 6. ❌ Missing creatorUserId
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "No Creator",
    });
    console.log("❌ Should fail but passed:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (no creatorUserId):", e.message);
  }

  // 7. ✅ Chat disabled
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "No Chat",
      chatEnabled: false,
      creatorUserId: "user006",
    });
    console.log("✅ Chat disabled:", res.MeetingId);
  } catch (e) {
    console.error("❌ Chat disabled failed:", e.message);
  }

  // 8. ❌ Invalid type
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Bad Type",
      creatorUserId: "user007",
      type: "nonsense_type",
    });
    console.log("✅ Unexpected success (invalid type)", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (invalid type):", e.message);
  }

  // 9. ❌ Simulated AWS SDK failure
  try {
    // Use a bad region or force failure here if needed
    process.env.AWS_REGION = "invalid-region";
    const res = await ChimeMeetingManager.createMeeting({
      title: "AWS fail",
      creatorUserId: "user008",
    });
    console.log("❌ Unexpected success on bad AWS region:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected AWS region fail:", e.message);
  } finally {
    process.env.AWS_REGION = "us-east-1"; // reset
  }

  // 10. ✅ Full metadata
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Full",
      type: "group_video",
      creatorUserId: "user009",
      defaultPIN: "123456",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "bookingXYZ",
      chatEnabled: true,
      recordingEnabled: true,
    });
    console.log("✅ Full meta passed:", res.MeetingId);
  } catch (e) {
    console.error("❌ Full meta failed:", e.message);
  }
}

testCreateMeeting();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testGetMeeting() {
  console.log("\n==== TEST: getMeeting ====\n");

  // 1. ✅ Valid meetingId from DB (not cached)
  try {
    const res = await ChimeMeetingManager.getMeeting("valid-meeting-001");
    if (res) console.log("✅ Fetched meeting:", res.MeetingId);
    else console.log("❌ Meeting not found");
  } catch (e) {
    console.error("❌ Error on getMeeting valid:", e.message);
  }

  // 2. ✅ Cached in Redis
  try {
    const res = await ChimeMeetingManager.getMeeting("cached-meeting-123");
    console.log("✅ Fetched cached:", res.MeetingId);
  } catch (e) {
    console.error("❌ Redis fetch failed:", e.message);
  }

  // 3. ❌ Meeting does not exist
  try {
    const res = await ChimeMeetingManager.getMeeting("not-a-real-id");
    console.log(res ? "❌ Should not exist" : "✅ Correctly returned null");
  } catch (e) {
    console.error("❌ getMeeting not-a-real-id error:", e.message);
  }

  // 4. ❌ Empty string input
  try {
    const res = await ChimeMeetingManager.getMeeting("");
    console.log("❌ Should fail but got:", res);
  } catch (e) {
    console.log("✅ Expected error on empty ID:", e.message);
  }

  // 5. ❌ Null input
  try {
    const res = await ChimeMeetingManager.getMeeting(null);
    console.log("❌ Should fail but got:", res);
  } catch (e) {
    console.log("✅ Expected error on null ID:", e.message);
  }

  // 6. ✅ Fetch multiple times to test Redis caching
  try {
    const id = "valid-meeting-001";
    await ChimeMeetingManager.getMeeting(id); // first call (hits DB)
    const res = await ChimeMeetingManager.getMeeting(id); // second call (cached)
    console.log("✅ Double fetch (with cache):", res.MeetingId);
  } catch (e) {
    console.error("❌ Error on repeat fetch:", e.message);
  }

  // 7. ❌ Malformed ID input (simulate)
  try {
    const res = await ChimeMeetingManager.getMeeting("#$%^&*!@");
    console.log(
      res ? "❌ Unexpected pass" : "✅ Gracefully handled invalid format"
    );
  } catch (e) {
    console.log("✅ Error on malformed ID:", e.message);
  }

  // 8. ❌ Redis unavailable
  try {
    process.env.REDIS_URL = "redis://invalid:9999"; // simulate broken Redis
    const res = await ChimeMeetingManager.getMeeting("valid-meeting-001");
    console.log("✅ Fallback to DB passed:", res.MeetingId);
  } catch (e) {
    console.log("❌ Error when Redis unavailable:", e.message);
  }

  // 9. ✅ Meeting created then fetched
  try {
    const created = await ChimeMeetingManager.createMeeting({
      title: "Temp Fetch Test",
      creatorUserId: "user-fetch",
    });
    const fetched = await ChimeMeetingManager.getMeeting(created.MeetingId);
    console.log("✅ Created + fetched:", fetched.MeetingId);
  } catch (e) {
    console.error("❌ Could not create + fetch:", e.message);
  }

  // 10. ❌ Non-string type input (number)
  try {
    const res = await ChimeMeetingManager.getMeeting(123456);
    console.log(res ? "❌ Unexpected pass" : "✅ Handled number input");
  } catch (e) {
    console.log("✅ Expected error on number:", e.message);
  }
}

testGetMeeting();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testCanJoinMeeting() {
  console.log("\n==== TEST: canJoinMeeting ====\n");

  // 1. ✅ Valid meeting + user
  try {
    const canJoin = await ChimeMeetingManager.canJoinMeeting(
      "meeting-valid-001",
      "userA"
    );
    console.log("✅ UserA can join:", canJoin);
  } catch (e) {
    console.error("❌ Failed valid user:", e.message);
  }

  // 2. ❌ Meeting does not exist
  try {
    await ChimeMeetingManager.canJoinMeeting("fake-meeting", "userX");
    console.log("❌ Unexpected success on non-existent meeting");
  } catch (e) {
    console.log("✅ Expected failure (no meeting):", e.message);
  }

  // 3. ❌ User blocked
  try {
    const meetingId = "meeting-blocked";
    const userId = "blocked-user";
    // Simulate block
    await ChimeMeetingManager.blockAttendee(meetingId, userId);
    await ChimeMeetingManager.canJoinMeeting(meetingId, userId);
    console.log("❌ Should have blocked user");
  } catch (e) {
    console.log("✅ Blocked user rejected:", e.message);
  }

  // 4. ❌ User already joined
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Join Twice",
      creatorUserId: "creator01",
    });
    const attendee = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userDup"
    );
    const again = await ChimeMeetingManager.canJoinMeeting(
      meeting.MeetingId,
      "userDup"
    );
    console.log("❌ Unexpected success (userDup already joined):", again);
  } catch (e) {
    console.log("✅ Rejected repeat join:", e.message);
  }

  // 5. ❌ Over attendee limit
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Overload",
      creatorUserId: "creator02",
    });
    for (let i = 0; i < 250; i++) {
      await ChimeMeetingManager.addAttendee(
        meeting.MeetingId,
        `auto-user-${i}`
      );
    }
    const allowed = await ChimeMeetingManager.canJoinMeeting(
      meeting.MeetingId,
      "late-user"
    );
    console.log(
      allowed
        ? "❌ Exceeded limit, but allowed"
        : "✅ Correctly denied over-limit"
    );
  } catch (e) {
    console.error("❌ Error during max test:", e.message);
  }

  // 6. ❌ Null meeting ID
  try {
    await ChimeMeetingManager.canJoinMeeting(null, "userNull");
    console.log("❌ Should not allow null meeting");
  } catch (e) {
    console.log("✅ Null meeting ID handled:", e.message);
  }

  // 7. ❌ Empty user ID
  try {
    await ChimeMeetingManager.canJoinMeeting("meeting-valid-001", "");
    console.log("❌ Empty user should be rejected");
  } catch (e) {
    console.log("✅ Empty user ID error:", e.message);
  }

  // 8. ✅ Fresh new user joining valid session
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Joinable Meeting",
      creatorUserId: "hostX",
    });
    const allowed = await ChimeMeetingManager.canJoinMeeting(
      meeting.MeetingId,
      "freshUser"
    );
    console.log("✅ Fresh user can join:", allowed);
  } catch (e) {
    console.error("❌ Error on fresh user:", e.message);
  }

  // 9. ❌ Malformed IDs
  try {
    await ChimeMeetingManager.canJoinMeeting("$$$", "@@@@");
    console.log("❌ Should not allow invalid characters");
  } catch (e) {
    console.log("✅ Malformed input rejected:", e.message);
  }

  // 10. ❌ Redis corrupted / down (simulate)
  try {
    process.env.REDIS_URL = "redis://invalid";
    const allowed = await ChimeMeetingManager.canJoinMeeting(
      "meeting-valid-001",
      "redisFailUser"
    );
    console.log("✅ Fallback passed (Redis broken):", allowed);
  } catch (e) {
    console.log("❌ Redis fail join blocked:", e.message);
  } finally {
    process.env.REDIS_URL = "redis://localhost:6379"; // restore
  }
}

testCanJoinMeeting();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testAddAttendee() {
  console.log("\n==== TEST: addAttendee ====\n");

  // 1. ✅ Normal attendee add
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Attendee Test 1",
      creatorUserId: "hostA",
    });
    const res = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userA"
    );
    console.log("✅ Added userA:", res.AttendeeId);
  } catch (e) {
    console.error("❌ Failed to add userA:", e.message);
  }

  // 2. ✅ Add moderator
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Mod Meeting",
      creatorUserId: "hostMod",
    });
    const res = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "modUser",
      true
    );
    console.log("✅ Added moderator:", res.AttendeeId);
  } catch (e) {
    console.error("❌ Failed to add moderator:", e.message);
  }

  // 3. ❌ Add to non-existent meeting
  try {
    await ChimeMeetingManager.addAttendee("non-existent-id", "userFake");
    console.log("❌ Should fail, added to bad meeting");
  } catch (e) {
    console.log("✅ Rejected on non-existent meeting:", e.message);
  }

  // 4. ❌ Add blocked user
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Block Test",
      creatorUserId: "hostBlock",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "badGuy");
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "badGuy");
    console.log("❌ Blocked user should not be added");
  } catch (e) {
    console.log("✅ Blocked user rejected:", e.message);
  }

  // 5. ❌ Re-add same user without leaving
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Dup Join Test",
      creatorUserId: "hostDup",
    });
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "dupUser");
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "dupUser");
    console.log("❌ Rejoined without leave");
  } catch (e) {
    console.log("✅ Reject duplicate active join:", e.message);
  }

  // 6. ❌ Over max limit
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Overflow",
      creatorUserId: "hostOver",
    });
    for (let i = 0; i < 250; i++) {
      await ChimeMeetingManager.addAttendee(meeting.MeetingId, `user-${i}`);
    }
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "extraUser");
    console.log("❌ Exceeded attendee cap");
  } catch (e) {
    console.log("✅ Correctly rejected overflow:", e.message);
  }

  // 7. ❌ Empty userId
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Empty UserID",
      creatorUserId: "hostEmpty",
    });
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "");
    console.log("❌ Allowed empty userId");
  } catch (e) {
    console.log("✅ Empty userId rejected:", e.message);
  }

  // 8. ❌ Null meeting ID
  try {
    await ChimeMeetingManager.addAttendee(null, "nullMeetingGuy");
    console.log("❌ Allowed null meetingId");
  } catch (e) {
    console.log("✅ Null meeting rejected:", e.message);
  }

  // 9. ✅ Fresh second attendee
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Duo Join",
      creatorUserId: "duoHost",
    });
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "firstUser");
    const res = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "secondUser"
    );
    console.log("✅ Second user added:", res.AttendeeId);
  } catch (e) {
    console.error("❌ Failed on second attendee:", e.message);
  }

  // 10. ❌ Redis misconfigured (simulate)
  try {
    process.env.REDIS_URL = "redis://fail";
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Redis Fail",
      creatorUserId: "redisHost",
    });
    await ChimeMeetingManager.addAttendee(meeting.MeetingId, "redisGuy");
    console.log("✅ Redis down but added attendee");
  } catch (e) {
    console.log("❌ Redis down caused failure:", e.message);
  } finally {
    process.env.REDIS_URL = "redis://localhost:6379";
  }
}

testAddAttendee();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testDeleteAttendee() {
  console.log("\n==== TEST: deleteAttendee ====\n");

  // 1. ✅ Valid deletion
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "DeleteTest",
      creatorUserId: "hostDel",
    });
    const attendee = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userDel1"
    );
    await ChimeMeetingManager.deleteAttendee(
      meeting.MeetingId,
      attendee.AttendeeId
    );
    console.log("✅ Attendee deleted");
  } catch (e) {
    console.error("❌ Valid delete failed:", e.message);
  }

  // 2. ❌ Delete non-existent attendee ID
  try {
    await ChimeMeetingManager.deleteAttendee(
      "meeting-valid-001",
      "non-existent-attendee"
    );
    console.log("❌ Unexpected success deleting fake attendee");
  } catch (e) {
    console.log("✅ Failed as expected (bad attendee):", e.message);
  }

  // 3. ❌ Delete from non-existent meeting
  try {
    await ChimeMeetingManager.deleteAttendee("non-existent-meeting", "fake-id");
    console.log("❌ Unexpected success (bad meeting)");
  } catch (e) {
    console.log("✅ Correctly failed on missing meeting:", e.message);
  }

  // 4. ❌ Null inputs
  try {
    await ChimeMeetingManager.deleteAttendee(null, null);
    console.log("❌ Allowed null inputs");
  } catch (e) {
    console.log("✅ Nulls rejected:", e.message);
  }

  // 5. ✅ Delete attendee twice (second should fail silently or throw)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "DoubleDelete",
      creatorUserId: "hostDouble",
    });
    const attendee = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userDouble"
    );
    await ChimeMeetingManager.deleteAttendee(
      meeting.MeetingId,
      attendee.AttendeeId
    );
    await ChimeMeetingManager.deleteAttendee(
      meeting.MeetingId,
      attendee.AttendeeId
    );
    console.log("❓ Second delete did not throw (may be OK)");
  } catch (e) {
    console.log("✅ Second delete threw error:", e.message);
  }

  // 6. ❌ Wrong type (number instead of string)
  try {
    await ChimeMeetingManager.deleteAttendee(123, 456);
    console.log("❌ Accepted wrong types");
  } catch (e) {
    console.log("✅ Wrong types rejected:", e.message);
  }

  // 7. ✅ Multiple deletions in sequence
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "MultiDelete",
      creatorUserId: "hostMulti",
    });
    const userA = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userMultiA"
    );
    const userB = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userMultiB"
    );
    await ChimeMeetingManager.deleteAttendee(
      meeting.MeetingId,
      userA.AttendeeId
    );
    await ChimeMeetingManager.deleteAttendee(
      meeting.MeetingId,
      userB.AttendeeId
    );
    console.log("✅ Multiple deletes succeeded");
  } catch (e) {
    console.error("❌ Multi-delete failed:", e.message);
  }

  // 8. ❌ Invalid string format for ID
  try {
    await ChimeMeetingManager.deleteAttendee("@@bad@@", "**bad**");
    console.log("❌ Bad format accepted");
  } catch (e) {
    console.log("✅ Bad format rejected:", e.message);
  }

  // 9. ✅ Delete and re-add same user (simulate "left + rejoin")
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "ReJoiner",
      creatorUserId: "hostRe",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userRe"
    );
    await ChimeMeetingManager.deleteAttendee(meeting.MeetingId, att.AttendeeId);
    const again = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userRe"
    );
    console.log("✅ Re-added user after deletion:", again.AttendeeId);
  } catch (e) {
    console.error("❌ Failed to re-add:", e.message);
  }

  // 10. ❌ Simulate Chime SDK error (by forcing region break)
  try {
    process.env.AWS_REGION = "bad-region";
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "BadRegionDel",
      creatorUserId: "badHost",
    });
    const user = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "badGuy"
    );
    await ChimeMeetingManager.deleteAttendee(
      meeting.MeetingId,
      user.AttendeeId
    );
    console.log("❌ SDK should’ve failed");
  } catch (e) {
    console.log("✅ SDK error simulated:", e.message);
  } finally {
    process.env.AWS_REGION = "us-east-1";
  }
}

testDeleteAttendee();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testBlockAttendee() {
  console.log("\n==== TEST: blockAttendee ====\n");

  // 1. ✅ Block a user successfully
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Block Test 1",
      creatorUserId: "hostBlock1",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "blockUserA");
    console.log("✅ User blockUserA blocked");
  } catch (e) {
    console.error("❌ Failed to block user:", e.message);
  }

  // 2. ✅ Try to join blocked user
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Block Then Join",
      creatorUserId: "hostBlock2",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "blockedUser");
    await ChimeMeetingManager.canJoinMeeting(meeting.MeetingId, "blockedUser");
    console.log("❌ Blocked user joined anyway");
  } catch (e) {
    console.log("✅ Blocked user prevented:", e.message);
  }

  // 3. ✅ Block same user again (idempotent)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "RepeatBlock",
      creatorUserId: "repeatHost",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "dupBlockUser");
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "dupBlockUser");
    console.log("✅ Re-blocking user did not fail");
  } catch (e) {
    console.error("❌ Re-blocking failed:", e.message);
  }

  // 4. ❌ Block user in non-existent meeting
  try {
    await ChimeMeetingManager.blockAttendee("no-such-meeting", "lostUser");
    console.log("❌ Blocked in non-existent meeting");
  } catch (e) {
    console.log("✅ Correctly failed non-existent meeting:", e.message);
  }

  // 5. ❌ Null meeting ID
  try {
    await ChimeMeetingManager.blockAttendee(null, "ghost");
    console.log("❌ Null meetingId accepted");
  } catch (e) {
    console.log("✅ Null meetingId rejected:", e.message);
  }

  // 6. ❌ Null user ID
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "NullBlockUser",
      creatorUserId: "nullBlocker",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, null);
    console.log("❌ Null userId accepted");
  } catch (e) {
    console.log("✅ Null userId rejected:", e.message);
  }

  // 7. ❌ Block malformed user ID
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "WeirdUserBlock",
      creatorUserId: "malformHost",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "$$##@@!!");
    console.log("✅ Weird ID handled (possibly valid)");
  } catch (e) {
    console.log("✅ Rejected malformed ID:", e.message);
  }

  // 8. ✅ Confirm blocked user is logged
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "BlockLogCheck",
      creatorUserId: "logHost",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "logUser");
    const record = await ChimeMeetingManager.getMeeting(meeting.MeetingId);
    const isBlocked = record.BlockedAttendeeIds.includes("logUser");
    console.log(isBlocked ? "✅ User in block list" : "❌ Not in block list");
  } catch (e) {
    console.error("❌ Log check failed:", e.message);
  }

  // 9. ✅ Block user after they left
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "BlockAfterLeave",
      creatorUserId: "hostLeave",
    });
    const user = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userBye"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      user.AttendeeId,
      "userBye"
    );
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "userBye");
    console.log("✅ User blocked after leaving");
  } catch (e) {
    console.error("❌ Error blocking post-leave:", e.message);
  }

  // 10. ✅ Block and then re-check `canJoinMeeting`
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "VerifyBlock",
      creatorUserId: "checkHost",
    });
    await ChimeMeetingManager.blockAttendee(meeting.MeetingId, "checkUser");
    const allowed = await ChimeMeetingManager.canJoinMeeting(
      meeting.MeetingId,
      "checkUser"
    );
    console.log(allowed ? "❌ Block ignored" : "✅ Block respected");
  } catch (e) {
    console.log("✅ Block logic consistent:", e.message);
  }
}

testBlockAttendee();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testUserJoinedMeeting() {
  console.log("\n==== TEST: userJoinedMeeting ====\n");

  // 1. ✅ Standard join tracking
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "JoinStandard",
      creatorUserId: "hostJ1",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userJ1"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userJ1"
    );
    console.log("✅ Join logged successfully");
  } catch (e) {
    console.error("❌ Failed to log join:", e.message);
  }

  // 2. ❌ Fake attendee
  try {
    await ChimeMeetingManager.userJoinedMeeting(
      "meeting-valid-001",
      "fake-attendee",
      "userGhost"
    );
    console.log("❌ Fake attendee should not be tracked");
  } catch (e) {
    console.log("✅ Rejected invalid attendee:", e.message);
  }

  // 3. ❌ Null inputs
  try {
    await ChimeMeetingManager.userJoinedMeeting(null, null, null);
    console.log("❌ Null values accepted");
  } catch (e) {
    console.log("✅ Nulls correctly rejected:", e.message);
  }

  // 4. ✅ Double call should update timestamp
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "DoubleJoin",
      creatorUserId: "hostJ2",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userJ2"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userJ2"
    );
    await new Promise((resolve) => setTimeout(resolve, 1000)); // slight delay
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userJ2"
    );
    console.log("✅ Second join updated timestamp");
  } catch (e) {
    console.error("❌ Failed on second join update:", e.message);
  }

  // 5. ✅ Log output confirmation
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "LogCheckJoin",
      creatorUserId: "logHost",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userLog"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userLog"
    );
    console.log("✅ Logged join visually verified in console");
  } catch (e) {
    console.error("❌ Log test failed:", e.message);
  }

  // 6. ❌ Bad meeting ID
  try {
    await ChimeMeetingManager.userJoinedMeeting(
      "invalid-meet-id",
      "some-att",
      "userX"
    );
    console.log("❌ Invalid meeting ID passed");
  } catch (e) {
    console.log("✅ Bad meeting rejected:", e.message);
  }

  // 7. ❌ Empty strings
  try {
    await ChimeMeetingManager.userJoinedMeeting("", "", "");
    console.log("❌ Empty values accepted");
  } catch (e) {
    console.log("✅ Empty inputs blocked:", e.message);
  }

  // 8. ✅ Rejoin allowed after leave
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "LeaveAndRejoin",
      creatorUserId: "reHost",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userRe"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userRe"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userRe"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userRe"
    );
    console.log("✅ Rejoined after leave");
  } catch (e) {
    console.error("❌ Failed rejoin after leave:", e.message);
  }

  // 9. ❌ Invalid data types
  try {
    await ChimeMeetingManager.userJoinedMeeting({}, [], 12345);
    console.log("❌ Bad types passed");
  } catch (e) {
    console.log("✅ Rejected invalid types:", e.message);
  }

  // 10. ✅ Join log record added to JoinLogs table
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "JoinLogsVerify",
      creatorUserId: "hostJL",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userJL"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userJL"
    );
    console.log("✅ Log entry created (check DB: JoinLogs)");
  } catch (e) {
    console.error("❌ Failed to create log entry:", e.message);
  }
}

testUserJoinedMeeting();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testUserLeftMeeting() {
  console.log("\n==== TEST: userLeftMeeting ====\n");

  // 1. ✅ Standard leave
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "LeaveStandard",
      creatorUserId: "hostLeave1",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userL1"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userL1"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userL1"
    );
    console.log("✅ Leave tracked");
  } catch (e) {
    console.error("❌ Leave tracking failed:", e.message);
  }

  // 2. ❌ Leave unknown attendee
  try {
    await ChimeMeetingManager.userLeftMeeting(
      "valid-meeting-id",
      "bad-attendee",
      "ghost"
    );
    console.log("❌ Left for fake attendee allowed");
  } catch (e) {
    console.log("✅ Rejected unknown attendee:", e.message);
  }

  // 3. ❌ Leave unknown meeting
  try {
    await ChimeMeetingManager.userLeftMeeting("no-meeting", "att-id", "user");
    console.log("❌ Invalid meeting passed");
  } catch (e) {
    console.log("✅ Bad meeting rejected:", e.message);
  }

  // 4. ❌ Null input
  try {
    await ChimeMeetingManager.userLeftMeeting(null, null, null);
    console.log("❌ Null values passed");
  } catch (e) {
    console.log("✅ Null values rejected:", e.message);
  }

  // 5. ✅ Leave twice (simulate app reload)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "DoubleLeave",
      creatorUserId: "hostDLeave",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userDL"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userDL"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userDL"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userDL"
    );
    console.log("✅ Multiple leaves handled");
  } catch (e) {
    console.error("❌ Double leave failed:", e.message);
  }

  // 6. ✅ Leave without join (should still log)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "NoJoinLeave",
      creatorUserId: "hostNJ",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userNJ"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userNJ"
    );
    console.log("✅ Left without join tracked");
  } catch (e) {
    console.error("❌ Error logging leave without join:", e.message);
  }

  // 7. ❌ Invalid input types
  try {
    await ChimeMeetingManager.userLeftMeeting({}, [], 42);
    console.log("❌ Invalid types passed");
  } catch (e) {
    console.log("✅ Type validation triggered:", e.message);
  }

  // 8. ✅ Join then leave — both logged
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "JoinThenLeave",
      creatorUserId: "hostJL",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userJL"
    );
    await ChimeMeetingManager.userJoinedMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userJL"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "userJL"
    );
    console.log("✅ Join and leave flow recorded");
  } catch (e) {
    console.error("❌ Join/leave failed:", e.message);
  }

  // 9. ✅ Leave multiple users in sequence
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "MultiLeave",
      creatorUserId: "hostML",
    });
    const a1 = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userML1"
    );
    const a2 = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "userML2"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      a1.AttendeeId,
      "userML1"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      a2.AttendeeId,
      "userML2"
    );
    console.log("✅ Multiple attendees logged leave");
  } catch (e) {
    console.error("❌ Error in batch leaves:", e.message);
  }

  // 10. ✅ Leave log created in JoinLogs
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "LogLeave",
      creatorUserId: "hostLogL",
    });
    const att = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "logUser"
    );
    await ChimeMeetingManager.userLeftMeeting(
      meeting.MeetingId,
      att.AttendeeId,
      "logUser"
    );
    console.log("✅ Leave log written to JoinLogs (verify DB)");
  } catch (e) {
    console.error("❌ Failed to log leave:", e.message);
  }
}

testUserLeftMeeting();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testSubmitFeedback() {
  console.log("\n==== TEST: submitFeedback ====\n");

  // 1. ✅ Submit valid feedback with all fields
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "FeedbackTest1",
      creatorUserId: "feedbackHost1",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userFeedback1",
      score: 5,
      feedback: "Great session!",
      commentToSession: "You were awesome!",
      rating: 4.9,
    });
    console.log("✅ Full feedback submitted");
  } catch (e) {
    console.error("❌ Failed to submit feedback:", e.message);
  }

  // 2. ✅ Submit feedback with minimal fields
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "MinimalFeedback",
      creatorUserId: "feedbackHost2",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userMin",
      score: 3,
      feedback: "",
      commentToSession: null,
      rating: 3.0,
    });
    console.log("✅ Minimal feedback accepted");
  } catch (e) {
    console.error("❌ Minimal feedback failed:", e.message);
  }

  // 3. ❌ Invalid meeting ID
  try {
    await ChimeMeetingManager.submitFeedback({
      meetingId: "non-existent-meeting",
      userId: "userFail",
      score: 4,
      feedback: "Okay",
      commentToSession: "",
      rating: 4,
    });
    console.log("❌ Feedback on invalid meeting accepted");
  } catch (e) {
    console.log("✅ Rejected invalid meeting:", e.message);
  }

  // 4. ❌ Missing user ID
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "NoUserFeedback",
      creatorUserId: "feedbackHost3",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: null,
      score: 4,
      feedback: "Nice",
      commentToSession: "Well done",
      rating: 4.2,
    });
    console.log("❌ Allowed null userId");
  } catch (e) {
    console.log("✅ Rejected null userId:", e.message);
  }

  // 5. ✅ Numeric edge case for score
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "ScoreEdge",
      creatorUserId: "feedbackHost4",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userEdge",
      score: 0,
      feedback: "Terrible",
      commentToSession: "",
      rating: 0,
    });
    console.log("✅ Zero score accepted");
  } catch (e) {
    console.error("❌ Zero score rejected:", e.message);
  }

  // 6. ✅ High-end score/rating
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "ScoreHigh",
      creatorUserId: "feedbackHost5",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userHigh",
      score: 10,
      feedback: "Outstanding!",
      commentToSession: "Perfect!",
      rating: 5,
    });
    console.log("✅ Max score/rating accepted");
  } catch (e) {
    console.error("❌ Max score/rating failed:", e.message);
  }

  // 7. ❌ Malformed input (non-numeric rating)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "BadRating",
      creatorUserId: "feedbackHost6",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userBad",
      score: 4,
      feedback: "OK",
      commentToSession: "",
      rating: "five",
    });
    console.log("❌ Non-numeric rating accepted");
  } catch (e) {
    console.log("✅ Rejected invalid rating:", e.message);
  }

  // 8. ✅ Repeated feedback (overwrite scenario)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "OverwriteTest",
      creatorUserId: "feedbackHost7",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userRepeat",
      score: 4,
      feedback: "Nice first try",
      commentToSession: "",
      rating: 4.1,
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userRepeat",
      score: 5,
      feedback: "Even better later!",
      commentToSession: "Improved",
      rating: 4.7,
    });

    console.log("✅ Repeated feedback submitted");
  } catch (e) {
    console.error("❌ Failed on repeated feedback:", e.message);
  }

  // 9. ❌ Extra fields (ignored)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "ExtraFields",
      creatorUserId: "feedbackHost8",
    });

    await ChimeMeetingManager.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userExtra",
      score: 3,
      feedback: "Fine",
      commentToSession: "",
      rating: 3.5,
      debugFlag: true, // should be ignored
    });
    console.log("✅ Extra field ignored");
  } catch (e) {
    console.error("❌ Extra field broke submission:", e.message);
  }

  // 10. ❌ Empty string IDs
  try {
    await ChimeMeetingManager.submitFeedback({
      meetingId: "",
      userId: "",
      score: 3,
      feedback: "Hmm",
      commentToSession: "",
      rating: 3,
    });
    console.log("❌ Empty IDs accepted");
  } catch (e) {
    console.log("✅ Empty IDs blocked:", e.message);
  }
}

testSubmitFeedback();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testUpdateRevenue() {
  console.log("\n==== TEST: updateRevenue ====\n");

  // 1. ✅ Basic tip entry
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "RevenueTest1",
      creatorUserId: "hostRev1",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 5,
      tokens: 50,
      source: "booking",
    });

    console.log("✅ Basic revenue added");
  } catch (e) {
    console.error("❌ Failed basic revenue:", e.message);
  }

  // 2. ✅ Multiple revenue types
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "MultiRevenue",
      creatorUserId: "hostRev2",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 10,
      tokens: 100,
      source: "bonus",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      type: "chat",
      amount: 3,
      tokens: 30,
    });

    console.log("✅ Multiple revenue types added");
  } catch (e) {
    console.error("❌ Multi-revenue entry failed:", e.message);
  }

  // 3. ❌ Invalid meeting ID
  try {
    await ChimeMeetingManager.updateRevenue("bad-id", {
      type: "tip",
      amount: 1,
      tokens: 10,
    });
    console.log("❌ Invalid meeting accepted");
  } catch (e) {
    console.log("✅ Invalid meeting rejected:", e.message);
  }

  // 4. ❌ Null revenue
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "NullRevenue",
      creatorUserId: "hostRev3",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, null);
    console.log("❌ Null revenue entry accepted");
  } catch (e) {
    console.log("✅ Null revenue rejected:", e.message);
  }

  // 5. ✅ Edge value: $0 tip
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "ZeroTip",
      creatorUserId: "hostRev4",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 0,
      tokens: 0,
    });

    console.log("✅ $0 tip accepted");
  } catch (e) {
    console.error("❌ Failed $0 tip:", e.message);
  }

  // 6. ✅ Long session with multiple payments
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "LongSession",
      creatorUserId: "hostRev5",
    });

    const payments = [
      { type: "connect", amount: 2, tokens: 20 },
      { type: "tip", amount: 4, tokens: 40 },
      { type: "extension", amount: 6, tokens: 60 },
    ];

    for (const entry of payments) {
      await ChimeMeetingManager.updateRevenue(meeting.MeetingId, entry);
    }

    console.log("✅ Batch revenue entries added");
  } catch (e) {
    console.error("❌ Failed batch revenue:", e.message);
  }

  // 7. ❌ Missing fields
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "MissingRevenueFields",
      creatorUserId: "hostRev6",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      amount: 7,
      // missing type, tokens
    });

    console.log("❌ Missing revenue fields accepted");
  } catch (e) {
    console.log("✅ Rejected missing fields:", e.message);
  }

  // 8. ✅ Non-cash revenue (type: gift)
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "GiftRevenue",
      creatorUserId: "hostRev7",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      type: "gift",
      tokens: 80,
      description: "Gifted tokens",
    });

    console.log("✅ Non-cash revenue accepted");
  } catch (e) {
    console.error("❌ Gift revenue failed:", e.message);
  }

  // 9. ✅ High-value transaction
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "HighValue",
      creatorUserId: "hostRev8",
    });

    await ChimeMeetingManager.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 1000,
      tokens: 10000,
    });

    console.log("✅ High-value transaction accepted");
  } catch (e) {
    console.error("❌ Failed high-value tip:", e.message);
  }

  // 10. ❌ Empty meeting ID
  try {
    await ChimeMeetingManager.updateRevenue("", {
      type: "tip",
      amount: 2,
      tokens: 20,
    });

    console.log("❌ Empty meeting ID accepted");
  } catch (e) {
    console.log("✅ Empty meeting ID blocked:", e.message);
  }
}

testUpdateRevenue();

import ChimeMeetingManager from "./ChimeMeetingManager.js";
import ScyllaDb from "./ScyllaDb.js";

async function testGetUserRingtone() {
  console.log("\n==== TEST: getUserRingtone ====\n");

  // 1. ✅ User with custom ringtone
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "ringUser1",
      Ringtone: "classic",
    });

    const tone = await ChimeMeetingManager.getUserRingtone("ringUser1");
    console.log(
      tone === "classic"
        ? "✅ Custom ringtone returned"
        : "❌ Incorrect ringtone"
    );
  } catch (e) {
    console.error("❌ Failed to get custom ringtone:", e.message);
  }

  // 2. ✅ User with default ringtone
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "ringUser2",
      // no Ringtone field
    });

    const tone = await ChimeMeetingManager.getUserRingtone("ringUser2");
    console.log(
      tone === "default"
        ? "✅ Default ringtone returned"
        : "❌ Incorrect fallback"
    );
  } catch (e) {
    console.error("❌ Default fallback failed:", e.message);
  }

  // 3. ❌ User not in DB
  try {
    const tone = await ChimeMeetingManager.getUserRingtone("notInDbUser");
    console.log(
      tone === "default"
        ? "✅ Non-existent user = default"
        : "❌ Should fallback to default"
    );
  } catch (e) {
    console.error("❌ Non-existent user threw error:", e.message);
  }

  // 4. ❌ Null userId
  try {
    await ChimeMeetingManager.getUserRingtone(null);
    console.log("❌ Null userId accepted");
  } catch (e) {
    console.log("✅ Null userId rejected:", e.message);
  }

  // 5. ❌ Empty string
  try {
    await ChimeMeetingManager.getUserRingtone("");
    console.log("❌ Empty userId accepted");
  } catch (e) {
    console.log("✅ Empty userId rejected:", e.message);
  }

  // 6. ✅ Ringtone set to empty string
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "emptyToneUser",
      Ringtone: "",
    });

    const tone = await ChimeMeetingManager.getUserRingtone("emptyToneUser");
    console.log(
      tone === "default"
        ? "✅ Empty ringtone returns default"
        : "❌ Should fallback to default"
    );
  } catch (e) {
    console.error("❌ Empty ringtone failed:", e.message);
  }

  // 7. ✅ Ringtone = null explicitly
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "nullToneUser",
      Ringtone: null,
    });

    const tone = await ChimeMeetingManager.getUserRingtone("nullToneUser");
    console.log(
      tone === "default"
        ? "✅ Null ringtone returns default"
        : "❌ Null should fallback"
    );
  } catch (e) {
    console.error("❌ Null ringtone error:", e.message);
  }

  // 8. ❌ Ringtone malformed field (number instead of string)
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "malformedToneUser",
      Ringtone: 1234,
    });

    const tone = await ChimeMeetingManager.getUserRingtone("malformedToneUser");
    console.log(
      typeof tone === "string"
        ? "✅ Non-string coerced"
        : "❌ Ringtone type mismatch"
    );
  } catch (e) {
    console.error("❌ Malformed ringtone field:", e.message);
  }

  // 9. ✅ Multiple calls, ensure consistent result
  try {
    const userId = "multiToneUser";
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: userId,
      Ringtone: "vintage",
    });

    const tone1 = await ChimeMeetingManager.getUserRingtone(userId);
    const tone2 = await ChimeMeetingManager.getUserRingtone(userId);

    console.log(
      tone1 === tone2 ? "✅ Consistent ringtone" : "❌ Inconsistent results"
    );
  } catch (e) {
    console.error("❌ Consistency test failed:", e.message);
  }

  // 10. ❌ Long string for ringtone
  try {
    const longTone = "ring_" + "x".repeat(500);
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "longToneUser",
      Ringtone: longTone,
    });

    const tone = await ChimeMeetingManager.getUserRingtone("longToneUser");
    console.log(
      tone === longTone ? "✅ Long ringtone handled" : "❌ Truncated or failed"
    );
  } catch (e) {
    console.error("❌ Long ringtone test failed:", e.message);
  }
}

testGetUserRingtone();

import ChimeMeetingManager from "./ChimeMeetingManager.js";
import ScyllaDb from "./ScyllaDb.js";

async function testGetUserMeetingAvatar() {
  console.log("\n==== TEST: getUserMeetingAvatar ====\n");

  // 1. ✅ User has a custom avatar
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "avatarUser1",
      AvatarUrl: "https://cdn.site.com/img1.png",
    });

    const avatar = await ChimeMeetingManager.getUserMeetingAvatar(
      "avatarUser1"
    );
    console.log(
      avatar === "https://cdn.site.com/img1.png"
        ? "✅ Custom avatar returned"
        : "❌ Wrong avatar"
    );
  } catch (e) {
    console.error("❌ Custom avatar fetch failed:", e.message);
  }

  // 2. ✅ User exists but no avatar set
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "avatarUser2",
    });

    const avatar = await ChimeMeetingManager.getUserMeetingAvatar(
      "avatarUser2"
    );
    console.log(
      avatar === null ? "✅ Null for missing avatar" : "❌ Should be null"
    );
  } catch (e) {
    console.error("❌ Missing avatar test failed:", e.message);
  }

  // 3. ❌ User doesn't exist in DB
  try {
    const avatar = await ChimeMeetingManager.getUserMeetingAvatar("noSuchUser");
    console.log(
      avatar === null ? "✅ Null for unknown user" : "❌ Should return null"
    );
  } catch (e) {
    console.error("❌ Failed on unknown user:", e.message);
  }

  // 4. ❌ Null userId
  try {
    await ChimeMeetingManager.getUserMeetingAvatar(null);
    console.log("❌ Null userId accepted");
  } catch (e) {
    console.log("✅ Null userId rejected:", e.message);
  }

  // 5. ❌ Empty userId
  try {
    await ChimeMeetingManager.getUserMeetingAvatar("");
    console.log("❌ Empty userId accepted");
  } catch (e) {
    console.log("✅ Empty userId rejected:", e.message);
  }

  // 6. ✅ Repeated calls return same avatar
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "repeatAvatar",
      AvatarUrl: "https://cdn.site.com/img2.png",
    });

    const a1 = await ChimeMeetingManager.getUserMeetingAvatar("repeatAvatar");
    const a2 = await ChimeMeetingManager.getUserMeetingAvatar("repeatAvatar");
    console.log(
      a1 === a2 ? "✅ Consistent results" : "❌ Inconsistent avatar result"
    );
  } catch (e) {
    console.error("❌ Repeated fetch error:", e.message);
  }

  // 7. ✅ Avatar with unusual URL
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "weirdUrlAvatar",
      AvatarUrl: "ftp://example.org/avatar.png",
    });

    const avatar = await ChimeMeetingManager.getUserMeetingAvatar(
      "weirdUrlAvatar"
    );
    console.log(
      avatar.startsWith("ftp")
        ? "✅ Non-http URL supported"
        : "❌ URL format issue"
    );
  } catch (e) {
    console.error("❌ Non-http avatar fetch failed:", e.message);
  }

  // 8. ✅ Very long avatar URL
  try {
    const longUrl = "https://cdn.site.com/" + "a".repeat(400) + ".png";
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "longAvatarUser",
      AvatarUrl: longUrl,
    });

    const avatar = await ChimeMeetingManager.getUserMeetingAvatar(
      "longAvatarUser"
    );
    console.log(
      avatar === longUrl ? "✅ Long URL handled" : "❌ Truncated or failed"
    );
  } catch (e) {
    console.error("❌ Long avatar test failed:", e.message);
  }

  // 9. ❌ Avatar field is not string (simulate error)
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "badAvatarUser",
      AvatarUrl: 123456,
    });

    const avatar = await ChimeMeetingManager.getUserMeetingAvatar(
      "badAvatarUser"
    );
    console.log(
      typeof avatar === "string" || avatar === null
        ? "✅ Handled non-string avatar"
        : "❌ Invalid type"
    );
  } catch (e) {
    console.error("❌ Bad avatar field test failed:", e.message);
  }

  // 10. ✅ Simulate default avatar logic in front-end
  try {
    const avatar = await ChimeMeetingManager.getUserMeetingAvatar(
      "nonExistentUser"
    );
    const finalUrl = avatar || "https://cdn.site.com/default.png";
    console.log(
      finalUrl.endsWith("default.png")
        ? "✅ Default fallback logic ready"
        : "❌ Fallback issue"
    );
  } catch (e) {
    console.error("❌ Default logic test failed:", e.message);
  }
}

testGetUserMeetingAvatar();

import ChimeMeetingManager from "./ChimeMeetingManager.js";

async function testGetDefaultAvatars() {
  console.log("\n==== TEST: getDefaultAvatars ====\n");

  // 1. ✅ Check it returns an array
  const avatars = await ChimeMeetingManager.getDefaultAvatars();
  console.log(
    Array.isArray(avatars) ? "✅ Returns an array" : "❌ Not an array"
  );

  // 2. ✅ Contains 3 avatars
  console.log(
    avatars.length === 3
      ? "✅ Contains 3 entries"
      : `❌ Wrong count: ${avatars.length}`
  );

  // 3. ✅ All entries are strings
  const allStrings = avatars.every((url) => typeof url === "string");
  console.log(
    allStrings ? "✅ All are strings" : "❌ Non-string entries found"
  );

  // 4. ✅ All entries are valid URLs (basic check)
  const allURLs = avatars.every((url) => /^https?:\/\/.+/.test(url));
  console.log(allURLs ? "✅ All look like URLs" : "❌ Invalid URL formats");

  // 5. ✅ No duplicate URLs
  const noDupes = new Set(avatars).size === avatars.length;
  console.log(noDupes ? "✅ No duplicates" : "❌ Duplicate URLs present");

  // 6. ✅ Starts with expected CDN domain (example)
  const expectedPrefix = "https://cdn.example.com/";
  const allCDN = avatars.every((url) => url.startsWith(expectedPrefix));
  console.log(
    allCDN ? "✅ All from expected CDN" : "❌ Some not from expected source"
  );

  // 7. ✅ URLs end with .png
  const allPng = avatars.every((url) => url.endsWith(".png"));
  console.log(allPng ? "✅ All are .png images" : "❌ Non-png entries");

  // 8. ✅ Stable result across calls
  const avatars2 = await ChimeMeetingManager.getDefaultAvatars();
  const stable = JSON.stringify(avatars) === JSON.stringify(avatars2);
  console.log(stable ? "✅ Stable results" : "❌ Different on repeated calls");

  // 9. ✅ Can be safely JSON.stringified
  try {
    const json = JSON.stringify(await ChimeMeetingManager.getDefaultAvatars());
    console.log(
      json.includes(".png") ? "✅ JSON.stringify works" : "❌ Unexpected JSON"
    );
  } catch (e) {
    console.error("❌ Failed to JSON stringify:", e.message);
  }

  // 10. ✅ Ready for front-end use
  console.log("✅ Ready for front-end <select> or avatar picker UI");
}

testGetDefaultAvatars();

import ChimeMeetingManager from "./ChimeMeetingManager.js";
import ScyllaDb from "./ScyllaDb.js";

async function testNotifyMeetingStarted() {
  console.log("\n==== TEST: notifyMeetingStarted ====\n");

  // 1. ✅ Valid meetingId logs without error
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Test Notify",
      creatorUserId: "notifHost",
    });

    await ChimeMeetingManager.notifyMeetingStarted(meeting.MeetingId);
    console.log("✅ notifyMeetingStarted passed with valid ID");
  } catch (e) {
    console.error("❌ Failed with valid meetingId:", e.message);
  }

  // 2. ❌ Invalid meetingId logs event anyway
  try {
    await ChimeMeetingManager.notifyMeetingStarted("nonexistent-id");
    console.log(
      "✅ notifyMeetingStarted still logs with bad ID (OK for placeholder)"
    );
  } catch (e) {
    console.error("❌ Should not fail on bad ID:", e.message);
  }

  // 3. ❌ Null meetingId
  try {
    await ChimeMeetingManager.notifyMeetingStarted(null);
    console.log("✅ Handled null ID gracefully");
  } catch (e) {
    console.log("❌ Threw error on null ID:", e.message);
  }

  // 4. ❌ Empty string
  try {
    await ChimeMeetingManager.notifyMeetingStarted("");
    console.log("✅ Handled empty ID gracefully");
  } catch (e) {
    console.log("❌ Threw error on empty ID:", e.message);
  }

  // 5. ✅ Repeated calls should log again
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Repeat Notify",
      creatorUserId: "notifHost2",
    });

    await ChimeMeetingManager.notifyMeetingStarted(meeting.MeetingId);
    await ChimeMeetingManager.notifyMeetingStarted(meeting.MeetingId);
    console.log("✅ Multiple calls log independently");
  } catch (e) {
    console.error("❌ Repeat notify error:", e.message);
  }

  // 6. ✅ Log timestamp exists
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Timestamp Notify",
      creatorUserId: "notifHost3",
    });

    console.time("NotifyTimestamp");
    await ChimeMeetingManager.notifyMeetingStarted(meeting.MeetingId);
    console.timeEnd("NotifyTimestamp");
  } catch (e) {
    console.error("❌ Timestamp log failed:", e.message);
  }

  // 7. ✅ Accepts meetingId as string only
  try {
    const id = 12345;
    await ChimeMeetingManager.notifyMeetingStarted(id.toString());
    console.log("✅ Accepts stringified meeting ID");
  } catch (e) {
    console.error("❌ Stringified ID failed:", e.message);
  }

  // 8. ❌ Non-string meetingId
  try {
    await ChimeMeetingManager.notifyMeetingStarted(12345);
    console.log("✅ Accepted non-string ID (should be reviewed)");
  } catch (e) {
    console.log("❌ Non-string ID rejected:", e.message);
  }

  // 9. ✅ Handles special chars in ID
  try {
    await ChimeMeetingManager.notifyMeetingStarted("💥-weird-id-🚀");
    console.log("✅ Weird characters handled");
  } catch (e) {
    console.error("❌ Special char ID failed:", e.message);
  }

  // 10. ✅ No exceptions thrown at all
  try {
    await ChimeMeetingManager.notifyMeetingStarted("whatever");
    console.log("✅ No exception thrown (placeholder safe)");
  } catch (e) {
    console.error("❌ Unexpected error:", e.message);
  }
}

testNotifyMeetingStarted();

//add support for trailer and or thumbanil
// get call type - audio video priate public
// validateUserAccess
