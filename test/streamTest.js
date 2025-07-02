import dotenv from "dotenv";
import StreamManager from "../ivs/streamManger.js";
import ScyllaDb from "../ScyllaDb.js";

dotenv.config();

function logTest(testName) {
  console.log(`\n🧪 Testing ${testName}...`);
}

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logError(message, error) {
  console.error(`❌ ${message}:`, error.message);
}

async function runAllStreamManagerTests() {
  try {
    console.log("\n🚀 Starting StreamManager Test Suite");
    console.log("🚀 Starting IVSService Test Suite");
    console.log("Loading table configurations...");
    await ScyllaDb.loadTableConfigs("./tables.json");
    logSuccess("Table configurations loaded successfully");

    await testCreateStream();
    await testUpdateStream();
    await testJoinLeaveStream();
    await testAddAnnouncement();
    await testValidateUserAccess();
    await testTipFlow();
    await testSetGoalProgress();
    await testSetTrailerAndThumbnail();
    await testAddAndListCollaborators();
    await testGetSessionType();

    console.log("\n🎉 All StreamManager tests completed!");
  } catch (err) {
    logError("StreamManager test suite failed", err);
  }
}

const streamData = {
  creator_user_id: "user123",
  channel_id: "channel-xyz",
  title: "Test Stream",
  access_type: "public",
};

let testStream;

async function testCreateStream() {
  logTest("createStream");
  try {
    testStream = await StreamManager.createStream(streamData);
    if (testStream && testStream.id) logSuccess("Stream created successfully");
    else throw new Error("No stream returned");
  } catch (err) {
    logError("createStream failed", err);
  }
}

async function testUpdateStream() {
  logTest("StreamManager.updateStream");

  try {
    const now = new Date().toISOString();

    // Step 1: Create a new stream
    const stream = await StreamManager.createStream({
      creator_user_id: "test-user-001",
      channel_id: "channel-123",
      title: "Original Stream Title",
      access_type: "public",
      description: "Initial test stream",
      tags: ["initial"],
    });

    const stream_id = stream.id;

    // Step 2: Update stream with new values
    const updates = {
      title: "Updated Stream Title",
      description: "This stream has been updated",
      status: "live",
    };

    await StreamManager.updateStream(stream_id, updates);

    // Step 3: Fetch updated stream to verify
    const updatedStream = await ScyllaDb.get("IVSStreams", stream_id);

    if (
      updatedStream.title === updates.title &&
      updatedStream.description === updates.description &&
      updatedStream.status === "live"
    ) {
      logSuccess("Stream updated successfully with new values");
    } else {
      throw new Error("Stream values were not updated as expected");
    }
  } catch (err) {
    logError("Failed to update stream", err);
  }
}

async function testJoinLeaveStream() {
  logTest("joinStream / leaveStream");
  try {
    await StreamManager.joinStream(testStream.id, "viewer123");
    await StreamManager.leaveStream(testStream.id, "viewer123");
    logSuccess("joinStream and leaveStream executed");
  } catch (err) {
    logError("join/leave failed", err);
  }
}

async function testAddAnnouncement() {
  logTest("addAnnouncement");
  try {
    await StreamManager.addAnnouncement(
      testStream.id,
      "Test Title",
      "This is the body"
    );
    logSuccess("Announcement added");
  } catch (err) {
    logError("addAnnouncement failed", err);
  }
}

async function testValidateUserAccess() {
  logTest("validateUserAccess");
  try {
    const access = await StreamManager.validateUserAccess(
      testStream.id,
      "user123"
    );
    if (access) logSuccess("User has access");
    else throw new Error("Access denied");
  } catch (err) {
    logError("validateUserAccess failed", err);
  }
}

async function testTipFlow() {
  logTest("registerTip + getTipLeaderboard");
  try {
    await StreamManager.registerTip(
      testStream.id,
      "tipper1",
      50,
      "Great stream!"
    );
    const leaderboard = await StreamManager.getTipLeaderboard(testStream.id);
    if (leaderboard.length > 0)
      logSuccess("Tip registered and leaderboard fetched");
    else throw new Error("No leaderboard returned");
  } catch (err) {
    logError("Tip flow failed", err);
  }
}

async function testSetGoalProgress() {
  logTest("setGoalProgress");
  try {
    await ScyllaDb.update("IVSStreams", testStream.id, {
      goals: [{ id: "goal1", target: 100, progress: 0, achieved: false }],
    });
    await StreamManager.setGoalProgress(testStream.id, "goal1", 100);
    logSuccess("Goal progress set and marked as achieved");
  } catch (err) {
    logError("setGoalProgress failed", err);
  }
}

async function testSetTrailerAndThumbnail() {
  logTest("setTrailer / setThumbnail");
  try {
    await StreamManager.setTrailer(testStream.id, "http://trailer.url");
    await StreamManager.setThumbnail(testStream.id, "http://thumbnail.url");
    logSuccess("Trailer and thumbnail set successfully");
  } catch (err) {
    logError("Setting trailer/thumbnail failed", err);
  }
}

async function testAddAndListCollaborators() {
  logTest("addCollaborator / listCollaborators");
  try {
    await StreamManager.addCollaborator(testStream.id, "collab1");
    const collabs = await StreamManager.listCollaborators(testStream.id);
    if (collabs.includes("collab1"))
      logSuccess("Collaborator added and listed");
    else throw new Error("Collaborator missing");
  } catch (err) {
    logError("Collaborator flow failed", err);
  }
}

async function testGetSessionType() {
  logTest("getSessionType");
  try {
    const type = await StreamManager.getSessionType(testStream.id);
    if (type) logSuccess("Session type retrieved: " + type);
    else throw new Error("Session type undefined");
  } catch (err) {
    logError("getSessionType failed", err);
  }
}

runAllStreamManagerTests();
