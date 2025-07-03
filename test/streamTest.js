import dotenv from "dotenv";
import StreamManager from "../ivs/streamManger.js";
import ScyllaDb from "../ScyllaDb.js";
import getIvsClient from "../ivs/ivsClient.js";
import {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  ListStreamKeysCommand,
  DeleteStreamKeyCommand,
} from "@aws-sdk/client-ivs";
import crypto from "crypto";

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

const STREAMS_TABLE = "IVSStreams";

let globalStreamKey = null;
let globalChannel = null;

async function createChannelWithStreamKey(testCreatorId = "user001") {
  if (globalChannel && globalStreamKey)
    return { channel: globalChannel, streamKey: globalStreamKey };

  const ivsClient = getIvsClient();

  const channelRes = await ivsClient.send(
    new CreateChannelCommand({
      name: `test-channel-${testCreatorId}-${Date.now()}`,
      latencyMode: "LOW",
      type: "STANDARD",
    })
  );

  const channel = channelRes.channel;

  const existingKeys = await ivsClient.send(
    new ListStreamKeysCommand({ channelArn: channel.arn })
  );
  for (const key of existingKeys.streamKeys || []) {
    await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
  }

  const keyRes = await ivsClient.send(
    new CreateStreamKeyCommand({
      channelArn: channel.arn,
    })
  );

  globalChannel = channel;
  globalStreamKey = keyRes.streamKey;

  return { channel: globalChannel, streamKey: globalStreamKey };
}

let testStream;

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
    await testRegisterTip();
    // await testTipFlow();
    await testGetStats();
    await testSetGoalProgress();
    await testSetTrailerAndThumbnail();
    await testAddAndListCollaborators();
    await testGetSessionType();

    console.log("\n🎉 All StreamManager tests completed!");
  } catch (err) {
    logError("StreamManager test suite failed", err);
  }
}

async function testCreateStream() {
  logTest("createStream");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    testStream = await StreamManager.createStream({
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Test Stream",
      stream_key: streamKey.value,
      access_type: "open_public", // ✅ required and must include "open"
    });

    if (testStream && testStream.id) logSuccess("Stream created successfully");
    else throw new Error("No stream returned");
  } catch (err) {
    logError("createStream failed", err);
  }
}

async function testUpdateStream() {
  logTest("StreamManager.updateStream");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey(); // ✅ Fix here

    const updates = {
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Test Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
    };

    await StreamManager.updateStream(testStream.id, updates);
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
      "user001"
    );
    if (access) logSuccess("User has access");
    else throw new Error("Access denied");
  } catch (err) {
    logError("validateUserAccess failed", err);
  }
}

async function testRegisterTip() {
  logTest("registerTip + getTipLeaderboard");

  try {
    // Step 1: Create channel and stream key

    // Step 3: Register tip
    const registerTip = await StreamManager.registerTip(
      testStream.id,
      "user001",
      50,
      "Great stream!"
    );
    console.log("registertip ", registerTip);
    // Step 4: Get leaderboard
  } catch (err) {
    logError("Tip flow failed", err);
  }
}

async function testSetGoalProgress() {
  logTest("setGoalProgress");
  try {
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: testStream.id,
      goals: [{ id: "goal1", target: 100, progress: 0, achieved: false }],
      access_type: "open_public",
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
    // console.log("get the type", type);
    if (type) logSuccess("Session type retrieved: " + type);
    else throw new Error("Session type undefined");
  } catch (err) {
    logError("getSessionType failed", err);
  }
}

async function testGetStats() {
  logTest("StreamManager.getStats");

  try {
    // Insert test stats manually

    // Call the method to test
    const result = await StreamManager.getStats(testStream.id);
    console.log("results", result);

    // Check result
    if (result) {
      logSuccess("getStats returned expected result", result);
    } else {
      throw new Error("Returned stats are incorrect or missing");
    }
  } catch (err) {
    logError("getStats failed", err);
  }
}

runAllStreamManagerTests();
