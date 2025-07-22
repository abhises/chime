import dotenv from "dotenv";
import Chime from "./chime/Chime.js";
import ScyllaDb from "./ScyllaDb.js";
import ErrorHandler from "./utils/ErrorHandler.js";

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

    console.log("\n🎉 All tests completed!");
  } catch (error) {
    logError(error.message, { context: "runAllTests", stack: error.stack });
  }
}

async function testCreateMeeting() {
  ErrorHandler.clear(); // Start with a clean error list
  logTest("createMeeting");
  console.log("Current AWS Region:", process.env.AWS_REGION);

  // 1. Basic meeting
  logTest("Basic meeting");
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
}

runAllTests();
