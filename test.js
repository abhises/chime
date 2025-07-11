const Chime = require("./chime/Chime");
const ScyllaDb = require("./ScyllaDb");
const dotenv = require("dotenv");
const ErrorHandler = require("./utils/ErrorHandler");

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

let testMeetingId = null;
let testAttendeeId = null;
const testUserId = "test-user-123";
const testCreatorId = "creator-user-456";

async function runAlltest() {
  await testAddAttendee();
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

runAlltest();
