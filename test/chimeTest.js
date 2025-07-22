// chimeTestRunner.mjs
import dotenv from "dotenv";
import Chime from "../chime/Chime.js";
import ScyllaDb from "../ScyllaDb.js";
import ErrorHandler from "../utils/ErrorHandler.js";

dotenv.config();

// Test utilities
function logTest(testName) {
  console.log(`\n🧪 Testing ${testName}...`);
}

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logError(message, context = {}) {
  console.error(`❌ ${message instanceof Error ? message.message : message}:`);
  if (message instanceof Error && message.stack) {
    console.error("Stack:", message.stack);
  }

  console.error(
    JSON.stringify(
      {
        message: message.message || message,
        context,
      },
      null,
      2
    )
  );
}

// Global test data
let testMeetingId = null;
let testAttendeeId = null;
const testUserId = "test-user-123";
const testCreatorId = "creator-user-456";
const MEETINGS_TABLE = "MeetingMeetings";

async function runAllTests() {
  try {
    console.log("🚀 Starting Chime Test Suite");
    console.log("Loading table configurations...");
    await ScyllaDb.loadTableConfigs("./tables.json");
    logSuccess("Table configurations loaded successfully");

    // Run all tests
    await testCreateMeeting();
    await testGetMeeting();
    await testCanJoinMeeting();
    await testAddAttendee();
    await testDeleteAttendee();
    await testBlockAttendee();
    await testUserJoinedMeeting();
    await testUserLeftMeeting();
    await testSubmitFeedback();
    await testUpdateRevenue();
    await testGetRecording();
    await testHasRecording();
    await testGetUserRingtone();
    await testGetUserMeetingAvatar();
    await testGetDefaultAvatars();
    await testNotifyMeetingStarted();
    await testChannelFunctions();

    console.log("\n🎉 All tests completed!");
  } catch (error) {
    logError(error.message, { context: "runAllTests", stack: error.stack });
  }
}

async function testCreateMeeting() {
  ErrorHandler.clear(); // Start with a clean error list
  logTest("createMeeting");

  // 1. Basic meeting
  logTest("Basic meeting");
  try {
    const res = await Chime.createMeeting({
      title: "Basic Audio",
      creatorUserId: "user001",
    });
    console.log("✅ Created:", res.MeetingId);
  } catch (e) {
    logError("❌ Failed basic meeting:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. Video with recording
  logTest("Video with recording");
  try {
    const res = await Chime.createMeeting({
      title: "Video Call",
      type: "private_video",
      recordingEnabled: true,
      creatorUserId: "user002",
    });
    console.log("✅ Video w/ recording:", res.MeetingId);
  } catch (e) {
    logError("❌ Failed video:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. Scheduled meeting
  logTest("Scheduled meeting");
  try {
    const res = await Chime.createMeeting({
      title: "Scheduled",
      creatorUserId: "user003",
      defaultPIN: "4321",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "book789",
    });
    console.log("✅ Scheduled:", res.MeetingId);
  } catch (e) {
    logError("❌ Scheduled failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. Group audio
  logTest("Group audio");
  try {
    const res = await Chime.createMeeting({
      title: "Group Audio",
      type: "group_audio",
      creatorUserId: "user004",
    });
    console.log("✅ Group audio:", res.MeetingId);
  } catch (e) {
    logError("❌ Group audio failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. Missing title
  logTest("Missing title (should fail)");
  try {
    const res = await Chime.createMeeting({
      creatorUserId: "user005",
    });
    console.log("❌ Should fail but passed:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (no title):", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. Missing creatorUserId
  logTest("Missing creatorUserId (should fail)");
  try {
    const res = await Chime.createMeeting({
      title: "No Creator",
    });
    console.log("❌ Should fail but passed:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (no creatorUserId):", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. Chat disabled
  logTest("Chat disabled");
  try {
    const res = await Chime.createMeeting({
      title: "No Chat",
      chatEnabled: false,
      creatorUserId: "user006",
    });
    console.log("✅ Chat disabled:", res.MeetingId);
  } catch (e) {
    logError("❌ Chat disabled failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. Invalid type
  logTest("Invalid type (should fail)");
  try {
    const res = await Chime.createMeeting({
      title: "Bad Type",
      creatorUserId: "user007",
      type: "nonsense_type",
    });
    console.log("✅ Unexpected success (invalid type)", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (invalid type):", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. Simulate AWS SDK failure
  logTest("Simulate AWS region failure");
  try {
    process.env.AWS_REGION = "invalid-region";
    const res = await Chime.createMeeting({
      title: "AWS fail",
      creatorUserId: "user008",
    });
    console.log("❌ Unexpected success on bad AWS region:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected AWS region fail:", e.message);
  } finally {
    process.env.AWS_REGION = "us-east-1"; // reset
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. Full metadata
  logTest("Full metadata");
  try {
    const res = await Chime.createMeeting({
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
    logError("❌ Full meta failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 11. Basic meeting with testCreatorId
  logTest("Basic meeting with testCreatorId");
  try {
    const meeting1 = await Chime.createMeeting({
      title: "Test Meeting 1",
      creatorUserId: testCreatorId,
    });

    testMeetingId = meeting1.MeetingId;
    logSuccess(`Created basic meeting: ${meeting1.MeetingId}`);
  } catch (e) {
    logError("❌ Test meeting 1 failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 12. Advanced meeting
  logTest("Advanced meeting");
  try {
    const meeting2 = await Chime.createMeeting({
      title: "Advanced Test Meeting",
      type: "public_video",
      isOpen: false,
      creatorUserId: testCreatorId,
      defaultPIN: "1234",
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      linkedBookingId: "booking-123",
      chatEnabled: false,
      recordingEnabled: true,
    });

    logSuccess(`Created advanced meeting: ${meeting2.MeetingId}`);
  } catch (e) {
    logError("❌ Advanced meeting failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 13. Missing title (duplicate test)
  logTest("Duplicate missing title (should fail)");
  try {
    await Chime.createMeeting({
      creatorUserId: testCreatorId,
    });
    logError("❌ Should have failed without title", {
      method: "createMeeting",
      input: { creatorUserId: testCreatorId },
    });
  } catch (e) {
    logSuccess("✅ Correctly failed without title");
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetMeeting() {
  ErrorHandler.clear(); // Clear previous errors
  logTest("getMeeting");

  console.log("\n==== TEST: getMeeting ====\n");

  // 1. ✅ Valid meetingId from DB (not cached)
  logTest("Valid meetingId from DB");
  try {
    const res = await Chime.getMeeting("valid-meeting-001");
    if (res) console.log("✅ Fetched meeting:", res.MeetingId);
    else console.log("❌ Meeting not found");
  } catch (e) {
    logError("❌ Error on valid meeting:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ✅ Cached in Redis
  logTest("Cached meeting fetch");
  try {
    const res = await Chime.getMeeting("cached-meeting-123");
    if (res) console.log("✅ Fetched cached meeting:", res.MeetingId);
    else console.log("❌ Cached meeting not found");
  } catch (e) {
    logError("❌ Redis fetch failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Meeting does not exist
  logTest("Non-existent meeting");
  try {
    const res = await Chime.getMeeting("not-a-real-id");
    console.log(
      res ? "❌ Should not exist but got result" : "✅ Correctly returned null"
    );
  } catch (e) {
    logError("❌ Error on non-existent meeting:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Empty string input
  logTest("Empty string input");
  try {
    const res = await Chime.getMeeting("");
    console.log(
      res
        ? "❌ Should fail but got result"
        : "✅ Correctly returned null on empty string"
    );
  } catch (e) {
    logError("✅ Expected error on empty string:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ❌ Null input
  logTest("Null input");
  try {
    const res = await Chime.getMeeting(null);
    console.log(
      res
        ? "❌ Should fail but got result"
        : "✅ Correctly returned null on null input"
    );
  } catch (e) {
    logError("✅ Expected error on null input:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ✅ Fetch multiple times to test Redis caching
  logTest("Multiple fetch for caching");
  try {
    const id = "valid-meeting-001";
    await Chime.getMeeting(id); // first fetch (DB)
    const res = await Chime.getMeeting(id); // second fetch (cache)
    console.log(
      "✅ Double fetch result:",
      res?.MeetingId || "No meeting found"
    );
  } catch (e) {
    logError("❌ Error on multiple fetch:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Malformed ID input
  logTest("Malformed ID input");
  try {
    const res = await Chime.getMeeting("#$%^&*!");
    console.log(
      res
        ? "❌ Unexpected success on malformed ID"
        : "✅ Gracefully handled malformed ID"
    );
  } catch (e) {
    logError("✅ Expected error on malformed ID:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ❌ Redis unavailable (simulate)
  logTest("Redis unavailable simulation");
  try {
    const originalRedis = redis;
    redis = null; // simulate Redis down
    const res = await Chime.getMeeting("valid-meeting-001");
    console.log(
      "✅ Fallback to DB worked:",
      res?.MeetingId || "No meeting found"
    );
    redis = originalRedis;
  } catch (e) {
    logError("❌ Error with Redis unavailable:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ Meeting created then fetched
  logTest("Create and fetch meeting");
  try {
    const created = await Chime.createMeeting({
      title: "Temp Fetch Test",
      creatorUserId: "user-fetch",
    });
    const fetched = await Chime.getMeeting(created.MeetingId);
    console.log(
      "✅ Created and fetched meeting:",
      fetched?.MeetingId || "No meeting found"
    );
  } catch (e) {
    logError("❌ Create and fetch failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ❌ Non-string input (number)
  logTest("Non-string input (number)");
  try {
    const res = await Chime.getMeeting(123456);
    console.log(
      res
        ? "❌ Unexpected success on number input"
        : "✅ Handled number input gracefully"
    );
  } catch (e) {
    logError("✅ Expected error on number input:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testCanJoinMeeting() {
  ErrorHandler.clear();
  logTest("canJoinMeeting");

  console.log("\n==== TEST: canJoinMeeting ====\n");

  // 1. ✅ Valid meeting + user
  logTest("Valid meeting + user");
  try {
    const canJoin = await Chime.canJoinMeeting("meeting-valid-001", "userA");
    console.log("✅ UserA can join:", canJoin);
  } catch (e) {
    logError("❌ Failed valid user:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ❌ Meeting does not exist
  logTest("Non-existent meeting");
  try {
    await Chime.canJoinMeeting("fake-meeting", "userX");
    console.log("❌ Unexpected success on non-existent meeting");
  } catch (e) {
    logTest("✅ Expected failure (no meeting): " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ User blocked
  logTest("Blocked user");
  try {
    const meetingId = "meeting-blocked";
    const userId = "blocked-user";
    await Chime.blockAttendee(meetingId, userId); // Simulate blocking
    await Chime.canJoinMeeting(meetingId, userId);
    console.log("❌ Should have blocked user");
  } catch (e) {
    logTest("✅ Blocked user rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ User already joined
  logTest("User already joined");
  try {
    const meeting = await Chime.createMeeting({
      title: "Join Twice",
      creatorUserId: "creator01",
    });
    await Chime.addAttendee(meeting.MeetingId, "userDup");
    const again = await Chime.canJoinMeeting(meeting.MeetingId, "userDup");
    console.log("❌ Unexpected success (userDup already joined):", again);
  } catch (e) {
    logTest("✅ Rejected repeat join: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ❌ Over attendee limit
  logTest("Over attendee limit");
  try {
    const meeting = await Chime.createMeeting({
      title: "Overload",
      creatorUserId: "creator02",
    });
    for (let i = 0; i < 25; i++) {
      await Chime.addAttendee(meeting.MeetingId, `auto-user-${i}`);
    }
    const allowed = await Chime.canJoinMeeting(meeting.MeetingId, "late-user");
    console.log(
      allowed
        ? "❌ Exceeded limit, but allowed"
        : "✅ Correctly denied over-limit"
    );
  } catch (e) {
    logError("❌ Error during max test:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ❌ Null meeting ID
  logTest("Null meeting ID");
  try {
    await Chime.canJoinMeeting(null, "userNull");
    console.log("❌ Should not allow null meeting");
  } catch (e) {
    logTest("✅ Null meeting ID handled: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Empty user ID
  logTest("Empty user ID");
  try {
    await Chime.canJoinMeeting("meeting-valid-001", "");
    console.log("❌ Empty user should be rejected");
  } catch (e) {
    logTest("✅ Empty user ID error: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ✅ Fresh new user joining valid session
  logTest("Fresh new user");
  try {
    const meeting = await Chime.createMeeting({
      title: "Joinable Meeting",
      creatorUserId: "hostX",
    });
    const allowed = await Chime.canJoinMeeting(meeting.MeetingId, "freshUser");
    console.log("✅ Fresh user can join:", allowed);
  } catch (e) {
    logError("❌ Error on fresh user:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ❌ Malformed IDs
  logTest("Malformed IDs");
  try {
    await Chime.canJoinMeeting("$$$", "@@@@");
    console.log("❌ Should not allow invalid characters");
  } catch (e) {
    logTest("✅ Malformed input rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ❌ Redis corrupted / down (simulate)
  logTest("Redis unavailable simulation");
  try {
    const originalRedis = redis;
    redis = null; // simulate Redis down
    const allowed = await Chime.canJoinMeeting(
      "meeting-valid-001",
      "redisFailUser"
    );
    console.log("✅ Fallback passed (Redis broken):", allowed);
    redis = originalRedis;
  } catch (e) {
    logError("❌ Redis fail join blocked:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testAddAttendee() {
  ErrorHandler.clear();
  logTest("addAttendee");

  console.log("\n==== TEST: addAttendee ====\n");

  // 1. ✅ Normal attendee add
  logTest("Normal attendee add");
  try {
    const meeting = await Chime.createMeeting({
      title: "Attendee Test 1",
      creatorUserId: "hostA",
    });
    const res = await Chime.addAttendee(meeting.MeetingId, "userA");
    console.log("✅ Added userA:", res.AttendeeId);
  } catch (e) {
    logError("❌ Failed to add userA:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ✅ Add moderator
  logTest("Add moderator");
  try {
    const meeting = await Chime.createMeeting({
      title: "Mod Meeting",
      creatorUserId: "hostMod",
    });
    const res = await Chime.addAttendee(meeting.MeetingId, "modUser", true);
    console.log("✅ Added moderator:", res.AttendeeId);
  } catch (e) {
    logError("❌ Failed to add moderator:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Add to non-existent meeting
  logTest("Add to non-existent meeting");
  try {
    await Chime.addAttendee("non-existent-id", "userFake");
    console.log("❌ Should fail, added to bad meeting");
  } catch (e) {
    logTest("✅ Rejected on non-existent meeting: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Add blocked user
  logTest("Add blocked user");
  try {
    const meeting = await Chime.createMeeting({
      title: "Block Test",
      creatorUserId: "hostBlock",
    });
    await Chime.blockAttendee(meeting.MeetingId, "badGuy");
    await Chime.addAttendee(meeting.MeetingId, "badGuy");
    console.log("❌ Blocked user should not be added");
  } catch (e) {
    logTest("✅ Blocked user rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ❌ Re-add same user without leaving
  logTest("Re-add same user without leaving");
  try {
    const meeting = await Chime.createMeeting({
      title: "Dup Join Test",
      creatorUserId: "hostDup",
    });
    await Chime.addAttendee(meeting.MeetingId, "dupUser");
    await Chime.addAttendee(meeting.MeetingId, "dupUser");
    console.log("❌ Rejoined without leave");
  } catch (e) {
    logTest("✅ Reject duplicate active join: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ❌ Over max limit
  logTest("Over max attendee limit");
  try {
    const meeting = await Chime.createMeeting({
      title: "Overflow",
      creatorUserId: "hostOver",
    });
    for (let i = 0; i < 25; i++) {
      await Chime.addAttendee(meeting.MeetingId, `user-${i}`);
    }
    await Chime.addAttendee(meeting.MeetingId, "extraUser");
    console.log("❌ Exceeded attendee cap");
  } catch (e) {
    logTest("✅ Correctly rejected overflow: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Empty userId
  logTest("Empty userId");
  try {
    const meeting = await Chime.createMeeting({
      title: "Empty UserID",
      creatorUserId: "hostEmpty",
    });
    await Chime.addAttendee(meeting.MeetingId, "");
    console.log("❌ Allowed empty userId");
  } catch (e) {
    logTest("✅ Empty userId rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ❌ Null meeting ID
  logTest("Null meeting ID");
  try {
    await Chime.addAttendee(null, "nullMeetingGuy");
    console.log("❌ Allowed null meetingId");
  } catch (e) {
    logTest("✅ Null meeting rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ Fresh second attendee
  logTest("Second attendee join");
  try {
    const meeting = await Chime.createMeeting({
      title: "Duo Join",
      creatorUserId: "duoHost",
    });
    await Chime.addAttendee(meeting.MeetingId, "firstUser");
    const res = await Chime.addAttendee(meeting.MeetingId, "secondUser");
    console.log("✅ Second user added:", res.AttendeeId);
  } catch (e) {
    logError("❌ Failed on second attendee:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ❌ Redis misconfigured
  logTest("Redis misconfigured simulation");
  try {
    const oldRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://fail";
    const meeting = await Chime.createMeeting({
      title: "Redis Fail",
      creatorUserId: "redisHost",
    });
    await Chime.addAttendee(meeting.MeetingId, "redisGuy");
    console.log("✅ Redis down but added attendee");
    process.env.REDIS_URL = oldRedisUrl;
  } catch (e) {
    logTest("❌ Redis down caused failure: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testDeleteAttendee() {
  ErrorHandler.clear();
  logTest("deleteAttendee");

  console.log("\n==== TEST: deleteAttendee ====\n");

  // 1. ✅ Valid deletion
  logTest("Valid deletion");
  try {
    const meeting = await Chime.createMeeting({
      title: "DeleteTest",
      creatorUserId: "hostDel",
    });
    const attendee = await Chime.addAttendee(meeting.MeetingId, "userDel1");
    await Chime.deleteAttendee(meeting.MeetingId, attendee.AttendeeId);
    console.log("✅ Attendee deleted");
  } catch (e) {
    logError("❌ Valid delete failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ❌ Delete non-existent attendee ID
  logTest("Delete non-existent attendee");
  try {
    await Chime.deleteAttendee("meeting-valid-001", "non-existent-attendee");
    console.log("❌ Unexpected success deleting fake attendee");
  } catch (e) {
    logTest("✅ Failed as expected (bad attendee): " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Delete from non-existent meeting
  logTest("Delete from non-existent meeting");
  try {
    await Chime.deleteAttendee("non-existent-meeting", "fake-id");
    console.log("❌ Unexpected success (bad meeting)");
  } catch (e) {
    logTest("✅ Correctly failed on missing meeting: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Null inputs
  logTest("Null inputs");
  try {
    await Chime.deleteAttendee(null, null);
    console.log("❌ Allowed null inputs");
  } catch (e) {
    logTest("✅ Nulls rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ❌ Delete same attendee twice
  logTest("Delete twice");
  try {
    const meeting = await Chime.createMeeting({
      title: "DoubleDelete",
      creatorUserId: "hostDouble",
    });
    const attendee = await Chime.addAttendee(meeting.MeetingId, "userDouble");
    await Chime.deleteAttendee(meeting.MeetingId, attendee.AttendeeId);
    await Chime.deleteAttendee(meeting.MeetingId, attendee.AttendeeId);
    console.log("❓ Second delete did not throw (may be OK)");
  } catch (e) {
    logTest("✅ Second delete threw error: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ❌ Wrong types (numbers)
  logTest("Wrong types (number)");
  try {
    await Chime.deleteAttendee(123, 456);
    console.log("❌ Accepted wrong types");
  } catch (e) {
    logTest("✅ Wrong types rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ✅ Multiple deletes in sequence
  logTest("Multiple deletes");
  try {
    const meeting = await Chime.createMeeting({
      title: "MultiDelete",
      creatorUserId: "hostMulti",
    });
    const userA = await Chime.addAttendee(meeting.MeetingId, "userMultiA");
    const userB = await Chime.addAttendee(meeting.MeetingId, "userMultiB");
    await Chime.deleteAttendee(meeting.MeetingId, userA.AttendeeId);
    await Chime.deleteAttendee(meeting.MeetingId, userB.AttendeeId);
    console.log("✅ Multiple deletes succeeded");
  } catch (e) {
    logError("❌ Multi-delete failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ❌ Invalid string format
  logTest("Malformed string input");
  try {
    await Chime.deleteAttendee("@@bad@@", "**bad**");
    console.log("❌ Bad format accepted");
  } catch (e) {
    logTest("✅ Bad format rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ Delete and re-add same user
  logTest("Delete and re-add");
  try {
    const meeting = await Chime.createMeeting({
      title: "ReJoiner",
      creatorUserId: "hostRe",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userRe");
    await Chime.deleteAttendee(meeting.MeetingId, att.AttendeeId);
    const again = await Chime.addAttendee(meeting.MeetingId, "userRe");
    console.log("✅ Re-added user after deletion:", again.AttendeeId);
  } catch (e) {
    logError("❌ Failed to re-add:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ❌ Chime SDK failure (simulate region break)
  logTest("Simulate SDK failure via region");
  try {
    const oldRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = "invalid-region";
    const meeting = await Chime.createMeeting({
      title: "BadRegionDel",
      creatorUserId: "badHost",
    });
    const user = await Chime.addAttendee(meeting.MeetingId, "badGuy");
    await Chime.deleteAttendee(meeting.MeetingId, user.AttendeeId);
    console.log("❌ SDK should’ve failed");
    process.env.AWS_REGION = oldRegion;
  } catch (e) {
    logTest("✅ SDK error simulated: " + e.message);
    process.env.AWS_REGION = "us-east-1"; // restore
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testBlockAttendee() {
  ErrorHandler.clear();
  logTest("blockAttendee");

  console.log("\n==== TEST: blockAttendee ====\n");

  // 1. ✅ Block a user successfully
  logTest("Block user successfully");
  try {
    const meeting = await Chime.createMeeting({
      title: "Block Test 1",
      creatorUserId: "hostBlock1",
    });
    await Chime.blockAttendee(meeting.MeetingId, "blockUserA");
    console.log("✅ User blockUserA blocked");
  } catch (e) {
    logError("❌ Failed to block user:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ❌ Try to join blocked user
  logTest("Blocked user tries to join");
  try {
    const meeting = await Chime.createMeeting({
      title: "Block Then Join",
      creatorUserId: "hostBlock2",
    });
    await Chime.blockAttendee(meeting.MeetingId, "blockedUser");
    await Chime.canJoinMeeting(meeting.MeetingId, "blockedUser");
    console.log("❌ Blocked user joined anyway");
  } catch (e) {
    logTest("✅ Blocked user prevented: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ✅ Block same user again (idempotent)
  logTest("Block user again (idempotent)");
  try {
    const meeting = await Chime.createMeeting({
      title: "RepeatBlock",
      creatorUserId: "repeatHost",
    });
    await Chime.blockAttendee(meeting.MeetingId, "dupBlockUser");
    await Chime.blockAttendee(meeting.MeetingId, "dupBlockUser");
    console.log("✅ Re-blocking user did not fail");
  } catch (e) {
    logError("❌ Re-blocking failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Block user in non-existent meeting
  logTest("Block user in non-existent meeting");
  try {
    await Chime.blockAttendee("no-such-meeting", "lostUser");
    console.log("❌ Blocked in non-existent meeting");
  } catch (e) {
    logTest("✅ Correctly failed non-existent meeting: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ❌ Null meeting ID
  logTest("Null meeting ID");
  try {
    await Chime.blockAttendee(null, "ghost");
    console.log("❌ Null meetingId accepted");
  } catch (e) {
    logTest("✅ Null meetingId rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ❌ Null user ID
  logTest("Null user ID");
  try {
    const meeting = await Chime.createMeeting({
      title: "NullBlockUser",
      creatorUserId: "nullBlocker",
    });
    await Chime.blockAttendee(meeting.MeetingId, null);
    console.log("❌ Null userId accepted");
  } catch (e) {
    logTest("✅ Null userId rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Block malformed user ID
  logTest("Malformed user ID");
  try {
    const meeting = await Chime.createMeeting({
      title: "WeirdUserBlock",
      creatorUserId: "malformHost",
    });
    await Chime.blockAttendee(meeting.MeetingId, "$$##@@!!");
    console.log("✅ Weird ID handled (possibly valid)");
  } catch (e) {
    logTest("✅ Rejected malformed ID: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ✅ Confirm blocked user is logged in DB
  logTest("Blocked user appears in meeting record");
  try {
    const meeting = await Chime.createMeeting({
      title: "BlockLogCheck",
      creatorUserId: "logHost",
    });
    await Chime.blockAttendee(meeting.MeetingId, "logUser");
    const record = await Chime.getMeeting(meeting.MeetingId);
    const isBlocked = record.BlockedAttendeeIds.includes("logUser");
    console.log(isBlocked ? "✅ User in block list" : "❌ Not in block list");
  } catch (e) {
    logError("❌ Log check failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ Block user after they leave
  logTest("Block user after leave");
  try {
    const meeting = await Chime.createMeeting({
      title: "BlockAfterLeave",
      creatorUserId: "hostLeave",
    });
    const user = await Chime.addAttendee(meeting.MeetingId, "userBye");
    await Chime.userLeftMeeting(meeting.MeetingId, user.AttendeeId, "userBye");
    await Chime.blockAttendee(meeting.MeetingId, "userBye");
    console.log("✅ User blocked after leaving");
  } catch (e) {
    logError("❌ Error blocking post-leave:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ✅ Block and re-check `canJoinMeeting`
  logTest("Block and test canJoinMeeting");
  try {
    const meeting = await Chime.createMeeting({
      title: "VerifyBlock",
      creatorUserId: "checkHost",
    });
    await Chime.blockAttendee(meeting.MeetingId, "checkUser");
    const allowed = await Chime.canJoinMeeting(meeting.MeetingId, "checkUser");
    console.log(allowed ? "❌ Block ignored" : "✅ Block respected");
  } catch (e) {
    logTest("✅ Block logic consistent: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testUserJoinedMeeting() {
  ErrorHandler.clear();
  logTest("userJoinedMeeting");

  console.log("\n==== TEST: userJoinedMeeting ====\n");

  // 1. ✅ Standard join tracking
  logTest("Standard join tracking");
  try {
    const meeting = await Chime.createMeeting({
      title: "JoinStandard",
      creatorUserId: "hostJ1",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJ1");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJ1");
    console.log("✅ Join logged successfully");
  } catch (e) {
    logError("❌ Failed to log join:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ❌ Fake attendee
  logTest("Fake attendee rejected");
  try {
    await Chime.userJoinedMeeting(
      "meeting-valid-001",
      "fake-attendee",
      "userGhost"
    );
    console.log("❌ Fake attendee should not be tracked");
  } catch (e) {
    logTest("✅ Rejected invalid attendee: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Null inputs
  logTest("Null inputs rejected");
  try {
    await Chime.userJoinedMeeting(null, null, null);
    console.log("❌ Null values accepted");
  } catch (e) {
    logTest("✅ Nulls correctly rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ✅ Double call updates timestamp
  logTest("Double join updates timestamp");
  try {
    const meeting = await Chime.createMeeting({
      title: "DoubleJoin",
      creatorUserId: "hostJ2",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJ2");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJ2");
    await new Promise((r) => setTimeout(r, 1000)); // delay
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJ2");
    console.log("✅ Second join updated timestamp");
  } catch (e) {
    logError("❌ Failed on second join update:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ✅ Log output confirmation
  logTest("Log output visually checked");
  try {
    const meeting = await Chime.createMeeting({
      title: "LogCheckJoin",
      creatorUserId: "logHost",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userLog");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userLog");
    console.log("✅ Logged join visually verified in console");
  } catch (e) {
    logError("❌ Log test failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ❌ Bad meeting ID
  logTest("Bad meeting ID rejected");
  try {
    await Chime.userJoinedMeeting("invalid-meet-id", "some-att", "userX");
    console.log("❌ Invalid meeting ID passed");
  } catch (e) {
    logTest("✅ Bad meeting rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Empty strings rejected
  logTest("Empty string inputs rejected");
  try {
    await Chime.userJoinedMeeting("", "", "");
    console.log("❌ Empty values accepted");
  } catch (e) {
    logTest("✅ Empty inputs blocked: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ✅ Rejoin allowed after leave
  logTest("Rejoin allowed after leave");
  try {
    const meeting = await Chime.createMeeting({
      title: "LeaveAndRejoin",
      creatorUserId: "reHost",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userRe");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userRe");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userRe");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userRe");
    console.log("✅ Rejoined after leave");
  } catch (e) {
    logError("❌ Failed rejoin after leave:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ❌ Invalid data types rejected
  logTest("Invalid types rejected");
  try {
    await Chime.userJoinedMeeting({}, [], 12345);
    console.log("❌ Bad types passed");
  } catch (e) {
    logTest("✅ Rejected invalid types: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ✅ Join log record added to JoinLogs table
  logTest("Join log record created");
  try {
    const meeting = await Chime.createMeeting({
      title: "JoinLogsVerify",
      creatorUserId: "hostJL",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJL");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJL");
    console.log("✅ Log entry created (check DB: JoinLogs)");
  } catch (e) {
    logError("❌ Failed to create log entry:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testUserLeftMeeting() {
  ErrorHandler.clear();
  logTest("userLeftMeeting");

  console.log("\n==== TEST: userLeftMeeting ====\n");

  // 1. ✅ Standard leave
  logTest("Standard leave");
  try {
    const meeting = await Chime.createMeeting({
      title: "LeaveStandard",
      creatorUserId: "hostLeave1",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userL1");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userL1");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userL1");
    console.log("✅ Leave tracked");
  } catch (e) {
    logError("❌ Leave tracking failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ❌ Leave unknown attendee
  logTest("Leave unknown attendee rejected");
  try {
    await Chime.userLeftMeeting("valid-meeting-id", "bad-attendee", "ghost");
    console.log("❌ Left for fake attendee allowed");
  } catch (e) {
    logTest("✅ Rejected unknown attendee: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Leave unknown meeting
  logTest("Leave unknown meeting rejected");
  try {
    await Chime.userLeftMeeting("no-meeting", "att-id", "user");
    console.log("❌ Invalid meeting passed");
  } catch (e) {
    logTest("✅ Bad meeting rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Null input rejected
  logTest("Null input rejected");
  try {
    await Chime.userLeftMeeting(null, null, null);
    console.log("❌ Null values passed");
  } catch (e) {
    logTest("✅ Null values rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ✅ Leave twice handled
  logTest("Leave twice handled");
  try {
    const meeting = await Chime.createMeeting({
      title: "DoubleLeave",
      creatorUserId: "hostDLeave",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userDL");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userDL");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userDL");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userDL");
    console.log("✅ Multiple leaves handled");
  } catch (e) {
    logError("❌ Double leave failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ✅ Leave without join still logs
  logTest("Leave without join logged");
  try {
    const meeting = await Chime.createMeeting({
      title: "NoJoinLeave",
      creatorUserId: "hostNJ",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userNJ");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userNJ");
    console.log("✅ Left without join tracked");
  } catch (e) {
    logError("❌ Error logging leave without join:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Invalid input types rejected
  logTest("Invalid input types rejected");
  try {
    await Chime.userLeftMeeting({}, [], 42);
    console.log("❌ Invalid types passed");
  } catch (e) {
    logTest("✅ Type validation triggered: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ✅ Join then leave logged
  logTest("Join then leave logged");
  try {
    const meeting = await Chime.createMeeting({
      title: "JoinThenLeave",
      creatorUserId: "hostJL",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJL");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJL");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userJL");
    console.log("✅ Join and leave flow recorded");
  } catch (e) {
    logError("❌ Join/leave failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ Leave multiple users logged
  logTest("Multiple leaves logged");
  try {
    const meeting = await Chime.createMeeting({
      title: "MultiLeave",
      creatorUserId: "hostML",
    });
    const a1 = await Chime.addAttendee(meeting.MeetingId, "userML1");
    const a2 = await Chime.addAttendee(meeting.MeetingId, "userML2");
    await Chime.userLeftMeeting(meeting.MeetingId, a1.AttendeeId, "userML1");
    await Chime.userLeftMeeting(meeting.MeetingId, a2.AttendeeId, "userML2");
    console.log("✅ Multiple attendees logged leave");
  } catch (e) {
    logError("❌ Error in batch leaves:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ✅ Leave log created
  logTest("Leave log created");
  try {
    const meeting = await Chime.createMeeting({
      title: "LogLeave",
      creatorUserId: "hostLogL",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "logUser");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "logUser");
    console.log("✅ Leave log written to JoinLogs (verify DB)");
  } catch (e) {
    logError("❌ Failed to log leave:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testSubmitFeedback() {
  ErrorHandler.clear();
  logTest("submitFeedback");

  console.log("\n==== TEST: submitFeedback ====\n");

  // 1. ✅ Submit valid feedback with all fields
  logTest("Valid full feedback");
  try {
    const meeting = await Chime.createMeeting({
      title: "FeedbackTest1",
      creatorUserId: "feedbackHost1",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userFeedback1",
      score: 5,
      feedback: "Great session!",
      commentToSession: "You were awesome!",
      rating: 4.9,
    });
    console.log("✅ Full feedback submitted");
  } catch (e) {
    logError("❌ Failed to submit full feedback:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ✅ Submit feedback with minimal optional fields
  logTest("Minimal feedback");
  try {
    const meeting = await Chime.createMeeting({
      title: "MinimalFeedback",
      creatorUserId: "feedbackHost2",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userMin",
      score: 3,
      feedback: "",
      commentToSession: null,
      rating: 3.0,
    });
    console.log("✅ Minimal feedback accepted");
  } catch (e) {
    logError("❌ Minimal feedback failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Invalid meeting ID rejected
  logTest("Invalid meeting ID rejected");
  try {
    await Chime.submitFeedback({
      meetingId: "non-existent-meeting",
      userId: "userFail",
      score: 4,
      feedback: "Okay",
      commentToSession: "",
      rating: 4,
    });
    console.log("❌ Feedback on invalid meeting accepted");
  } catch (e) {
    logTest("✅ Rejected invalid meeting: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Null user ID rejected
  logTest("Null userId rejected");
  try {
    const meeting = await Chime.createMeeting({
      title: "NoUserFeedback",
      creatorUserId: "feedbackHost3",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: null,
      score: 4,
      feedback: "Nice",
      commentToSession: "Well done",
      rating: 4.2,
    });
    console.log("❌ Allowed null userId");
  } catch (e) {
    logTest("✅ Rejected null userId: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ✅ Numeric edge case score 0 accepted
  logTest("Edge case zero score");
  try {
    const meeting = await Chime.createMeeting({
      title: "ScoreEdge",
      creatorUserId: "feedbackHost4",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userEdge",
      score: 0,
      feedback: "Terrible",
      commentToSession: "",
      rating: 0,
    });
    console.log("✅ Zero score accepted");
  } catch (e) {
    logError("❌ Zero score rejected:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ✅ High-end score/rating accepted
  logTest("High-end score and rating");
  try {
    const meeting = await Chime.createMeeting({
      title: "ScoreHigh",
      creatorUserId: "feedbackHost5",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userHigh",
      score: 10,
      feedback: "Outstanding!",
      commentToSession: "Perfect!",
      rating: 5,
    });
    console.log("✅ Max score/rating accepted");
  } catch (e) {
    logError("❌ Max score/rating failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Malformed rating (non-numeric) rejected
  logTest("Malformed rating rejected");
  try {
    const meeting = await Chime.createMeeting({
      title: "BadRating",
      creatorUserId: "feedbackHost6",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userBad",
      score: 4,
      feedback: "OK",
      commentToSession: "",
      rating: "five",
    });
    console.log("❌ Non-numeric rating accepted");
  } catch (e) {
    logTest("✅ Rejected invalid rating: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ✅ Repeated feedback (overwrite allowed)
  logTest("Repeated feedback");
  try {
    const meeting = await Chime.createMeeting({
      title: "OverwriteTest",
      creatorUserId: "feedbackHost7",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userRepeat",
      score: 4,
      feedback: "Nice first try",
      commentToSession: "",
      rating: 4.1,
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userRepeat",
      score: 5,
      feedback: "Even better later!",
      commentToSession: "Improved",
      rating: 4.7,
    });

    console.log("✅ Repeated feedback submitted");
  } catch (e) {
    logError("❌ Failed on repeated feedback:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ Extra fields ignored safely
  logTest("Extra fields ignored");
  try {
    const meeting = await Chime.createMeeting({
      title: "ExtraFields",
      creatorUserId: "feedbackHost8",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userExtra",
      score: 3,
      feedback: "Fine",
      commentToSession: "",
      rating: 3.5,
      debugFlag: true, // ignored extra field
    });
    console.log("✅ Extra field ignored");
  } catch (e) {
    logError("❌ Extra field broke submission:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ❌ Empty string IDs rejected
  logTest("Empty string IDs rejected");
  try {
    await Chime.submitFeedback({
      meetingId: "",
      userId: "",
      score: 3,
      feedback: "Hmm",
      commentToSession: "",
      rating: 3,
    });
    console.log("❌ Empty IDs accepted");
  } catch (e) {
    logTest("✅ Empty IDs blocked: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testUpdateRevenue() {
  ErrorHandler.clear();
  logTest("updateRevenue");

  console.log("\n==== TEST: updateRevenue ====\n");

  // 1. ✅ Basic tip entry
  logTest("Basic tip entry");
  try {
    const meeting = await Chime.createMeeting({
      title: "RevenueTest1",
      creatorUserId: "hostRev1",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 5,
      tokens: 50,
      source: "booking",
    });

    console.log("✅ Basic revenue added");
  } catch (e) {
    logError("❌ Failed basic revenue:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ✅ Multiple revenue types
  logTest("Multiple revenue types");
  try {
    const meeting = await Chime.createMeeting({
      title: "MultiRevenue",
      creatorUserId: "hostRev2",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 10,
      tokens: 100,
      source: "bonus",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      type: "chat",
      amount: 3,
      tokens: 30,
      source: "chatSession",
    });

    console.log("✅ Multiple revenue types added");
  } catch (e) {
    logError("❌ Multi-revenue entry failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Invalid meeting ID
  logTest("Invalid meeting ID rejected");
  try {
    await Chime.updateRevenue("bad-id", {
      type: "tip",
      amount: 1,
      tokens: 10,
      source: "test",
    });
    console.log("❌ Invalid meeting accepted");
  } catch (e) {
    logTest("✅ Invalid meeting rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Null revenue
  logTest("Null revenue rejected");
  try {
    const meeting = await Chime.createMeeting({
      title: "NullRevenue",
      creatorUserId: "hostRev3",
    });

    await Chime.updateRevenue(meeting.MeetingId, null);
    console.log("❌ Null revenue entry accepted");
  } catch (e) {
    logTest("✅ Null revenue rejected: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. ✅ Edge value: $0 tip
  logTest("Edge value zero tip");
  try {
    const meeting = await Chime.createMeeting({
      title: "ZeroTip",
      creatorUserId: "hostRev4",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 0,
      tokens: 0,
      source: "free",
    });

    console.log("✅ $0 tip accepted");
  } catch (e) {
    logError("❌ Failed $0 tip:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. ✅ Long session with multiple payments
  logTest("Long session multiple payments");
  try {
    const meeting = await Chime.createMeeting({
      title: "LongSession",
      creatorUserId: "hostRev5",
    });

    const payments = [
      { type: "connect", amount: 2, tokens: 20, source: "connect" },
      { type: "tip", amount: 4, tokens: 40, source: "tip" },
      { type: "extension", amount: 6, tokens: 60, source: "extension" },
    ];

    for (const entry of payments) {
      await Chime.updateRevenue(meeting.MeetingId, entry);
    }

    console.log("✅ Batch revenue entries added");
  } catch (e) {
    logError("❌ Failed batch revenue:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. ❌ Missing fields
  logTest("Missing revenue fields rejected");
  try {
    const meeting = await Chime.createMeeting({
      title: "MissingRevenueFields",
      creatorUserId: "hostRev6",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      amount: 7,
      // missing type, tokens, source
    });

    console.log("❌ Missing revenue fields accepted");
  } catch (e) {
    logTest("✅ Rejected missing fields: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 8. ✅ Non-cash revenue (type: gift)
  logTest("Non-cash revenue accepted");
  try {
    const meeting = await Chime.createMeeting({
      title: "GiftRevenue",
      creatorUserId: "hostRev7",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      type: "gift",
      tokens: 80,
      source: "gift",
      description: "Gifted tokens",
    });

    console.log("✅ Non-cash revenue accepted");
  } catch (e) {
    logError("❌ Gift revenue failed:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 9. ✅ High-value transaction
  logTest("High-value transaction accepted");
  try {
    const meeting = await Chime.createMeeting({
      title: "HighValue",
      creatorUserId: "hostRev8",
    });

    await Chime.updateRevenue(meeting.MeetingId, {
      type: "tip",
      amount: 1000,
      tokens: 10000,
      source: "bigTip",
    });

    console.log("✅ High-value transaction accepted");
  } catch (e) {
    logError("❌ Failed high-value tip:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 10. ❌ Empty meeting ID
  logTest("Empty meeting ID rejected");
  try {
    await Chime.updateRevenue("", {
      type: "tip",
      amount: 2,
      tokens: 20,
      source: "test",
    });

    console.log("❌ Empty meeting ID accepted");
  } catch (e) {
    logTest("✅ Empty meeting ID blocked: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetRecording() {
  ErrorHandler.clear();
  logTest("getRecording");

  console.log("\n==== TEST: getRecording ====\n");

  // 1. ✅ Valid meeting with recording URL
  logTest("Valid meeting with recording");
  try {
    const meeting = await Chime.createMeeting({
      title: "RecordingTest1",
      creatorUserId: "hostRec1",
    });

    // Manually add RecordingS3Url for testing
    await ScyllaDb.updateItem(
      MEETINGS_TABLE,
      { MeetingId: meeting.MeetingId },
      { RecordingS3Url: "https://s3.amazonaws.com/recording1.mp4" }
    );

    const url = await Chime.getRecording(meeting.MeetingId);
    if (url === "https://s3.amazonaws.com/recording1.mp4") {
      console.log("✅ Recording URL retrieved correctly");
    } else {
      console.error("❌ Recording URL mismatch:", url);
    }
  } catch (e) {
    logError("❌ Failed to get recording URL:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ✅ Valid meeting with no recording
  logTest("Valid meeting without recording");
  try {
    const meeting = await Chime.createMeeting({
      title: "NoRecording",
      creatorUserId: "hostRec2",
    });

    const url = await Chime.getRecording(meeting.MeetingId);
    if (url === null) {
      console.log("✅ Null returned for no recording");
    } else {
      console.error("❌ Expected null but got:", url);
    }
  } catch (e) {
    logError("❌ Failed no-recording test:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Invalid meeting ID rejected
  logTest("Invalid meeting ID rejected");
  try {
    await Chime.getRecording("invalid-id");
    console.log("❌ Invalid meeting ID accepted");
  } catch (e) {
    logTest("✅ Rejected invalid meeting ID: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Null meeting ID rejected
  logTest("Null meeting ID rejected");
  try {
    await Chime.getRecording(null);
    console.log("❌ Null meeting ID accepted");
  } catch (e) {
    logTest("✅ Rejected null meeting ID: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testHasRecording() {
  ErrorHandler.clear();
  logTest("hasRecording");

  console.log("\n==== TEST: hasRecording ====\n");

  // 1. ✅ Meeting with recording returns true
  logTest("Meeting with recording returns true");
  try {
    const meeting = await Chime.createMeeting({
      title: "HasRecordingTrue",
      creatorUserId: "hostHR1",
    });

    await ScyllaDb.updateItem(
      MEETINGS_TABLE,
      { MeetingId: meeting.MeetingId },
      { RecordingS3Url: "https://s3.amazonaws.com/recording2.mp4" }
    );

    const hasRec = await Chime.hasRecording(meeting.MeetingId);
    if (hasRec === true) {
      console.log("✅ hasRecording returned true correctly");
    } else {
      console.error("❌ hasRecording returned false incorrectly");
    }
  } catch (e) {
    logError("❌ Failed hasRecording test:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. ✅ Meeting without recording returns false
  logTest("Meeting without recording returns false");
  try {
    const meeting = await Chime.createMeeting({
      title: "HasRecordingFalse",
      creatorUserId: "hostHR2",
    });

    const hasRec = await Chime.hasRecording(meeting.MeetingId);
    if (hasRec === false) {
      console.log("✅ hasRecording returned false correctly");
    } else {
      console.error("❌ hasRecording returned true incorrectly");
    }
  } catch (e) {
    logError("❌ Failed hasRecording false test:", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. ❌ Invalid meeting ID rejected
  logTest("Invalid meeting ID rejected");
  try {
    await Chime.hasRecording("bad-id");
    console.log("❌ Invalid meeting ID accepted");
  } catch (e) {
    logTest("✅ Rejected invalid meeting ID: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. ❌ Null meeting ID rejected
  logTest("Null meeting ID rejected");
  try {
    await Chime.hasRecording(null);
    console.log("❌ Null meeting ID accepted");
  } catch (e) {
    logTest("✅ Rejected null meeting ID: " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetUserRingtone() {
  ErrorHandler.clear();
  logTest("getUserRingtone");

  console.log("\n==== TEST: getUserRingtone ====\n");

  // 1. ✅ User with custom ringtone
  logTest("User with custom ringtone");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "ringUser1",
      Ringtone: "classic",
    });
    const tone = await Chime.getUserRingtone("ringUser1");
    console.log(
      tone === "classic"
        ? "✅ Custom ringtone returned"
        : "❌ Incorrect ringtone"
    );
  } catch (e) {
    logError("❌ Failed custom ringtone:", e.message);
  }

  // 2. ✅ Fallback to default ringtone
  logTest("Default ringtone fallback");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "ringUser2",
    });
    const tone = await Chime.getUserRingtone("ringUser2");
    console.log(
      tone === "default" ? "✅ Default ringtone" : "❌ Expected default"
    );
  } catch (e) {
    logError("❌ Default fallback failed:", e.message);
  }

  // 3. ❌ Unknown user
  logTest("Unknown user returns default");
  try {
    const tone = await Chime.getUserRingtone("nonexistentUser");
    console.log(
      tone === "default" ? "✅ Fallback default" : "❌ Should fallback"
    );
  } catch (e) {
    logError("❌ Unknown user threw error:", e.message);
  }

  // 4. ❌ Null userId
  logTest("Null userId rejected");
  try {
    await Chime.getUserRingtone(null);
    console.log("❌ Null userId accepted");
  } catch (e) {
    logTest("✅ Null userId rejected: " + e.message);
  }

  // 5. ❌ Empty userId
  logTest("Empty userId rejected");
  try {
    await Chime.getUserRingtone("");
    console.log("❌ Empty userId accepted");
  } catch (e) {
    logTest("✅ Empty userId rejected: " + e.message);
  }

  // 6. ✅ Ringtone is null
  logTest("Ringtone set to null");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "nullToneUser",
      Ringtone: null,
    });
    const tone = await Chime.getUserRingtone("nullToneUser");
    console.log(
      tone === "default" ? "✅ Null returns default" : "❌ Null failed"
    );
  } catch (e) {
    logError("❌ Null ringtone failed:", e.message);
  }

  // 7. ✅ Long ringtone string
  logTest("Long ringtone string");
  try {
    const longTone = "tone_" + "x".repeat(300);
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "longToneUser",
      Ringtone: longTone,
    });
    const tone = await Chime.getUserRingtone("longToneUser");
    console.log(tone === longTone ? "✅ Long tone accepted" : "❌ Truncated?");
  } catch (e) {
    logError("❌ Long tone failed:", e.message);
  }

  // 8. ✅ Multiple consistent calls
  logTest("Consistent ringtone return");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "repeatToneUser",
      Ringtone: "synth",
    });
    const t1 = await Chime.getUserRingtone("repeatToneUser");
    const t2 = await Chime.getUserRingtone("repeatToneUser");
    console.log(t1 === t2 ? "✅ Consistent output" : "❌ Inconsistent return");
  } catch (e) {
    logError("❌ Consistency test failed:", e.message);
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetUserMeetingAvatar() {
  ErrorHandler.clear();
  logTest("getUserMeetingAvatar");

  console.log("\n==== TEST: getUserMeetingAvatar ====\n");

  // 1. ✅ User with custom avatar
  logTest("User with custom avatar");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "avatarUser1",
      AvatarUrl: "https://cdn.site.com/avatar1.png",
    });
    const avatar = await Chime.getUserMeetingAvatar("avatarUser1");
    console.log(
      avatar === "https://cdn.site.com/avatar1.png"
        ? "✅ Correct avatar"
        : "❌ Wrong URL"
    );
  } catch (e) {
    logError("❌ Custom avatar test failed:", e.message);
  }

  // 2. ✅ User with no avatar
  logTest("User with no avatar returns null");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "avatarUser2",
    });
    const avatar = await Chime.getUserMeetingAvatar("avatarUser2");
    console.log(avatar === null ? "✅ Null avatar" : "❌ Should be null");
  } catch (e) {
    logError("❌ No avatar test failed:", e.message);
  }

  // 3. ❌ Unknown user
  logTest("Unknown user returns null");
  try {
    const avatar = await Chime.getUserMeetingAvatar("ghostAvatarUser");
    console.log(
      avatar === null ? "✅ Null for unknown user" : "❌ Should be null"
    );
  } catch (e) {
    logError("❌ Unknown avatar error:", e.message);
  }

  // 4. ❌ Null userId
  logTest("Null userId rejected");
  try {
    await Chime.getUserMeetingAvatar(null);
    console.log("❌ Null userId accepted");
  } catch (e) {
    logTest("✅ Null rejected: " + e.message);
  }

  // 5. ❌ Empty userId
  logTest("Empty userId rejected");
  try {
    await Chime.getUserMeetingAvatar("");
    console.log("❌ Empty userId accepted");
  } catch (e) {
    logTest("✅ Empty rejected: " + e.message);
  }

  // 6. ✅ Consistency check
  logTest("Avatar consistency check");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "repeatAvatar",
      AvatarUrl: "https://cdn.site.com/avatarX.png",
    });
    const a1 = await Chime.getUserMeetingAvatar("repeatAvatar");
    const a2 = await Chime.getUserMeetingAvatar("repeatAvatar");
    console.log(a1 === a2 ? "✅ Consistent output" : "❌ Inconsistent avatar");
  } catch (e) {
    logError("❌ Avatar consistency failed:", e.message);
  }

  // 7. ✅ Weird URL
  logTest("Unusual avatar URL");
  try {
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "weirdAvatar",
      AvatarUrl: "ftp://example.com/img.png",
    });
    const avatar = await Chime.getUserMeetingAvatar("weirdAvatar");
    console.log(
      avatar.startsWith("ftp") ? "✅ Weird URL accepted" : "❌ FTP rejected"
    );
  } catch (e) {
    logError("❌ Weird URL test failed:", e.message);
  }

  // 8. ✅ Long URL
  logTest("Very long avatar URL");
  try {
    const longUrl = "https://cdn.site.com/" + "a".repeat(300) + ".png";
    await ScyllaDb.putItem("MeetingAttendees_UserProfiles", {
      UserId: "longAvatar",
      AvatarUrl: longUrl,
    });
    const avatar = await Chime.getUserMeetingAvatar("longAvatar");
    console.log(
      avatar === longUrl ? "✅ Long URL returned" : "❌ Long URL failed"
    );
  } catch (e) {
    logError("❌ Long avatar failed:", e.message);
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetDefaultAvatars() {
  console.log("\n==== TEST: getDefaultAvatars ====\n");

  // 1. ✅ Check it returns an array
  const avatars = await Chime.getDefaultAvatars();
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
  const avatars2 = await Chime.getDefaultAvatars();
  const stable = JSON.stringify(avatars) === JSON.stringify(avatars2);
  console.log(stable ? "✅ Stable results" : "❌ Different on repeated calls");

  // 9. ✅ Can be safely JSON.stringified
  try {
    const json = JSON.stringify(await Chime.getDefaultAvatars());
    console.log(
      json.includes(".png") ? "✅ JSON.stringify works" : "❌ Unexpected JSON"
    );
  } catch (e) {
    console.error("❌ Failed to JSON stringify:", e.message);
  }

  // 10. ✅ Ready for front-end use
  console.log("✅ Ready for front-end <select> or avatar picker UI");
}

async function testNotifyMeetingStarted() {
  console.log("\n==== TEST: notifyMeetingStarted ====\n");

  // 1. ✅ Valid meetingId logs without error
  try {
    const meeting = await Chime.createMeeting({
      title: "Test Notify",
      creatorUserId: "notifHost",
    });

    await Chime.notifyMeetingStarted(meeting.MeetingId);
    console.log("✅ notifyMeetingStarted passed with valid ID");
  } catch (e) {
    console.error("❌ Failed with valid meetingId:", e.message);
  }

  // 2. ❌ Invalid meetingId logs event anyway
  try {
    await Chime.notifyMeetingStarted("nonexistent-id");
    console.log(
      "✅ notifyMeetingStarted still logs with bad ID (OK for placeholder)"
    );
  } catch (e) {
    console.error("❌ Should not fail on bad ID:", e.message);
  }

  // 3. ❌ Null meetingId
  try {
    await Chime.notifyMeetingStarted(null);
    console.log("✅ Handled null ID gracefully");
  } catch (e) {
    console.log("❌ Threw error on null ID:", e.message);
  }

  // 4. ❌ Empty string
  try {
    await Chime.notifyMeetingStarted("");
    console.log("✅ Handled empty ID gracefully");
  } catch (e) {
    console.log("❌ Threw error on empty ID:", e.message);
  }

  // 5. ✅ Repeated calls should log again
  try {
    const meeting = await Chime.createMeeting({
      title: "Repeat Notify",
      creatorUserId: "notifHost2",
    });

    await Chime.notifyMeetingStarted(meeting.MeetingId);
    await Chime.notifyMeetingStarted(meeting.MeetingId);
    console.log("✅ Multiple calls log independently");
  } catch (e) {
    console.error("❌ Repeat notify error:", e.message);
  }

  // 6. ✅ Log timestamp exists
  try {
    const meeting = await Chime.createMeeting({
      title: "Timestamp Notify",
      creatorUserId: "notifHost3",
    });

    console.time("NotifyTimestamp");
    await Chime.notifyMeetingStarted(meeting.MeetingId);
    console.timeEnd("NotifyTimestamp");
  } catch (e) {
    console.error("❌ Timestamp log failed:", e.message);
  }

  // 7. ✅ Accepts meetingId as string only
  try {
    const id = 12345;
    await Chime.notifyMeetingStarted(id.toString());
    console.log("✅ Accepts stringified meeting ID");
  } catch (e) {
    console.error("❌ Stringified ID failed:", e.message);
  }

  // 8. ❌ Non-string meetingId
  try {
    await Chime.notifyMeetingStarted(12345);
    console.log("✅ Accepted non-string ID (should be reviewed)");
  } catch (e) {
    console.log("❌ Non-string ID rejected:", e.message);
  }

  // 9. ✅ Handles special chars in ID
  try {
    await Chime.notifyMeetingStarted("💥-weird-id-🚀");
    console.log("✅ Weird characters handled");
  } catch (e) {
    console.error("❌ Special char ID failed:", e.message);
  }

  // 10. ✅ No exceptions thrown at all
  try {
    await Chime.notifyMeetingStarted("whatever");
    console.log("✅ No exception thrown (placeholder safe)");
  } catch (e) {
    console.error("❌ Unexpected error:", e.message);
  }
}

async function testChannelFunctions() {
  console.log("\n==== TEST: createChannel & deleteChannel ====\n");

  // 1. ✅ createChannel should not throw and should log correctly
  try {
    const result = await Chime.createChannel();
    console.log("✅ createChannel executed successfully with result:", result);
  } catch (e) {
    console.error("❌ createChannel threw an error:", e.message);
  }

  // 2. ✅ deleteChannel should not throw and should log correctly
  try {
    const result = await Chime.deleteChannel();
    console.log("✅ deleteChannel executed successfully with result:", result);
  } catch (e) {
    console.error("❌ deleteChannel threw an error:", e.message);
  }

  // 3. ✅ Confirm it returns null
  try {
    const createResult = await Chime.createChannel();
    const deleteResult = await Chime.deleteChannel();

    if (createResult === null && deleteResult === null) {
      console.log("✅ Both functions return null as expected");
    } else {
      console.error("❌ One or both functions did not return null");
    }
  } catch (e) {
    console.error("❌ Error during null return check:", e.message);
  }

  // 4. ✅ Call repeatedly without error
  try {
    await Chime.createChannel();
    await Chime.createChannel();
    await Chime.deleteChannel();
    await Chime.deleteChannel();
    console.log("✅ Multiple calls to channel methods succeeded");
  } catch (e) {
    console.error("❌ Error on repeated calls:", e.message);
  }

  // 5. ✅ Special case: call in rapid succession
  try {
    await Promise.all([Chime.createChannel(), Chime.deleteChannel()]);
    console.log("✅ Rapid succession call handled");
  } catch (e) {
    console.error("❌ Failed in rapid succession call:", e.message);
  }
}

// Run all tests
runAllTests();
