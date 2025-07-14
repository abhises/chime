const dotenv = require("dotenv");
const StreamManager = require("../ivs/streamManger.js");
const ScyllaDb = require("../ScyllaDb.js");
const getIvsClient = require("../ivs/ivsClient.js");
const {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  ListStreamKeysCommand,
  DeleteStreamKeyCommand,
} = require("@aws-sdk/client-ivs");
const crypto = require("crypto");
const ErrorHandler = require("../utils/ErrorHandler.js");

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
    await testSetGoalProgress();
    await testSetTrailerAndThumbnail();
    await testAddAndListCollaborators();
    await testGetSessionType();
    await testGetStats();

    await testGetTipLeaderboard();

    console.log("\n🎉 All StreamManager tests completed!");
  } catch (err) {
    logError("StreamManager test suite failed", err);
  }
}

async function testCreateStream() {
  ErrorHandler.clear();
  logTest("StreamManager.createStream");

  // 1. Valid creation
  logTest("Valid stream creation");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const streamData = {
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Test Stream",
      stream_key: streamKey.value,
      access_type: "open_public", // required
    };

    const createdStream = await StreamManager.createStream(streamData);

    const storedStream = await ScyllaDb.getItem(STREAMS_TABLE, {
      id: createdStream.id,
    });

    const isCreated =
      storedStream &&
      storedStream.title === streamData.title &&
      storedStream.access_type === streamData.access_type &&
      storedStream.channel_id === streamData.channel_id;

    if (isCreated) {
      logSuccess("✅ Stream created successfully");
    } else {
      const msg = "❌ Stream fields did not match after creation";
      ErrorHandler.add_error(msg, storedStream);
      logError(msg, new Error(JSON.stringify(storedStream)));
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "createStream" });
    logError("❌ createStream valid case failed", err);
  }

  // 2. Missing required fields (should fail)
  logTest("Missing required fields (should fail)");
  try {
    await StreamManager.createStream({
      // creator_user_id is missing
      title: "Bad Stream",
      stream_key: "invalid-key",
      access_type: "open_public",
    });
    logError("❌ Should have failed due to missing required fields");
  } catch (err) {
    logSuccess(
      "✅ Correctly failed due to missing required fields: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "createStream" });
  }

  // 3. Duplicate stream ID (should fail) — only if ID conflict is handled
  logTest("Duplicate stream ID (should fail if duplicate logic enforced)");
  try {
    const duplicateId = `stream-${Date.now()}`;

    const { channel, streamKey } = await createChannelWithStreamKey();

    const streamData = {
      id: duplicateId,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Stream One",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, streamData); // insert manually

    // Try to create again with same ID
    await StreamManager.createStream({
      ...streamData,
      title: "Stream Duplicate",
    });

    logError("❌ Should have failed due to duplicate stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed on duplicate stream ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "createStream" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testUpdateStream() {
  ErrorHandler.clear();
  logTest("StreamManager.updateStream");

  // 1. Valid update
  logTest("Valid update");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const initialStream = {
      id: `stream-${Date.now()}`, // Generate unique ID
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Initial Stream",
      stream_key: streamKey.value,
      access_type: "private",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, initialStream);

    const updates = {
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Updated Test Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
    };

    await StreamManager.updateStream(initialStream.id, updates);

    const updatedStream = await ScyllaDb.getItem(STREAMS_TABLE, {
      id: initialStream.id,
    });

    const isUpdated =
      updatedStream.title === updates.title &&
      updatedStream.access_type === updates.access_type;

    if (isUpdated) {
      logSuccess("✅ Stream updated successfully");
    } else {
      const msg = "❌ Stream fields did not update as expected";
      ErrorHandler.add_error(msg, updatedStream);
      logError(msg, new Error(JSON.stringify(updatedStream)));
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "updateStream" });
    logError("❌ updateStream test failed", err);
  }

  // 2. Update with missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.updateStream(null, {
      title: "Missing ID case",
    });
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed due to missing stream ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "updateStream" });
  }

  // 3. Update non-existent stream (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.updateStream("stream-non-existent-id", {
      title: "Non-existent stream update",
    });
    logError("❌ Should have failed with non-existent stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed on non-existent stream: " + err.message);
    ErrorHandler.add_error(err.message, { method: "updateStream" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testJoinLeaveStream() {
  ErrorHandler.clear();
  logTest("StreamManager.joinStream / leaveStream");

  const viewerId = "viewer123";

  // 1. Valid join and leave
  logTest("Valid join and leave");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "JoinLeave Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    await StreamManager.joinStream(stream.id, viewerId);
    await StreamManager.leaveStream(stream.id, viewerId);

    logSuccess("✅ joinStream and leaveStream executed successfully");
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "joinLeaveStream" });
    logError("❌ join/leave failed", err);
  }

  // 2. Join with missing stream ID (should fail)
  logTest("Join with missing stream ID (should fail)");
  try {
    await StreamManager.joinStream(null, viewerId);
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed on joinStream: " + err.message);
    ErrorHandler.add_error(err.message, { method: "joinStream" });
  }

  // 3. Leave with missing stream ID (should fail)
  logTest("Leave with missing stream ID (should fail)");
  try {
    await StreamManager.leaveStream(null, viewerId);
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed on leaveStream: " + err.message);
    ErrorHandler.add_error(err.message, { method: "leaveStream" });
  }

  // 4. Join non-existent stream (should fail)
  logTest("Join non-existent stream (should fail)");
  try {
    await StreamManager.joinStream("stream-non-existent", viewerId);
    logError("❌ Should have failed on joinStream with non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed on joinStream: " + err.message);
    ErrorHandler.add_error(err.message, { method: "joinStream" });
  }

  // 5. Leave non-existent stream (should fail)
  logTest("Leave non-existent stream (should fail)");
  try {
    await StreamManager.leaveStream("stream-non-existent", viewerId);
    logError("❌ Should have failed on leaveStream with non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed on leaveStream: " + err.message);
    ErrorHandler.add_error(err.message, { method: "leaveStream" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testAddAnnouncement() {
  ErrorHandler.clear();
  logTest("StreamManager.addAnnouncement");

  const title = "Test Title";
  const body = "This is the body";

  // 1. Valid addAnnouncement
  logTest("Valid addAnnouncement");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Announcement Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    await StreamManager.addAnnouncement(stream.id, title, body);
    logSuccess("✅ Announcement added successfully");
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "addAnnouncement" });
    logError("❌ addAnnouncement failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.addAnnouncement(null, title, body);
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing stream ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "addAnnouncement" });
  }

  // 3. Missing title or body (should fail)
  logTest("Missing title/body (should fail)");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const streamId = `stream-${Date.now()}`;
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: streamId,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Missing Title Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await StreamManager.addAnnouncement(streamId, null, null);
    logError("❌ Should have failed due to missing title and body");
  } catch (err) {
    logSuccess("✅ Correctly failed on missing title/body: " + err.message);
    ErrorHandler.add_error(err.message, { method: "addAnnouncement" });
  }

  // 4. Non-existent stream ID (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.addAnnouncement("stream-non-existent", title, body);
    logError("❌ Should have failed with non-existent stream ID");
  } catch (err) {
    logSuccess(
      "✅ Correctly failed with non-existent stream ID: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "addAnnouncement" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testValidateUserAccess() {
  ErrorHandler.clear();
  logTest("StreamManager.validateUserAccess");

  const validUserId = "user001";
  const invalidUserId = "unauthorizedUser";

  // 1. Valid user access
  logTest("Valid user access");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: validUserId,
      channel_id: channel.arn,
      title: "Access Control Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    const access = await StreamManager.validateUserAccess(
      stream.id,
      validUserId
    );
    if (access) {
      logSuccess("✅ User has valid access");
    } else {
      throw new Error("User should have access but was denied");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "validateUserAccess" });
    logError("❌ validateUserAccess failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.validateUserAccess(null, validUserId);
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing stream ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "validateUserAccess" });
  }

  // 3. Missing user ID (should fail)
  logTest("Missing user ID (should fail)");
  try {
    const fakeStreamId = `stream-${Date.now()}`;
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: fakeStreamId,
      creator_user_id: validUserId,
      channel_id: "fake-channel-arn",
      title: "Missing User Test",
      stream_key: "some-key",
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await StreamManager.validateUserAccess(fakeStreamId, null);
    logError("❌ Should have failed due to missing user ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing user ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "validateUserAccess" });
  }

  // 4. Non-existent stream ID (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.validateUserAccess("stream-non-existent", validUserId);
    logError("❌ Should have failed due to non-existent stream ID");
  } catch (err) {
    logSuccess(
      "✅ Correctly failed with non-existent stream ID: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "validateUserAccess" });
  }

  // 5. Unauthorized user (should fail if access is restricted)
  logTest("Unauthorized user (should fail)");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: validUserId,
      channel_id: channel.arn,
      title: "Private Stream",
      stream_key: streamKey.value,
      access_type: "private", // access should be denied for other users
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    const access = await StreamManager.validateUserAccess(
      stream.id,
      invalidUserId
    );
    if (!access) {
      logSuccess("✅ Unauthorized user correctly denied access");
    } else {
      throw new Error("Unauthorized user was granted access");
    }
  } catch (err) {
    logSuccess(
      "✅ Correctly failed access for unauthorized user: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "validateUserAccess" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testRegisterTip() {
  ErrorHandler.clear();
  logTest("StreamManager.registerTip + getTipLeaderboard");

  const userId = "user001";
  const tipAmount = 50;
  const message = "Great stream!";

  // 1. Valid tip registration and leaderboard check
  logTest("Valid tip registration");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: userId,
      channel_id: channel.arn,
      title: "Tipping Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    const tip = await StreamManager.registerTip(
      stream.id,
      userId,
      tipAmount,
      message
    );
    if (tip && tip.amount === tipAmount) {
      logSuccess("✅ Tip registered successfully");
    } else {
      throw new Error("Tip registration failed or incorrect amount");
    }

    const leaderboard = await StreamManager.getTipLeaderboard(stream.id);
    const userOnTop = leaderboard.find((u) => u.user_id === userId);
    if (userOnTop && userOnTop.total_tips === tipAmount) {
      logSuccess("✅ Leaderboard reflects registered tip");
    } else {
      throw new Error("Leaderboard did not update correctly");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "registerTip" });
    logError("❌ registerTip failed (valid case)", err);
  }

  // 2. Missing stream ID
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.registerTip(null, userId, tipAmount, message);
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing stream ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "registerTip" });
  }

  // 3. Missing user ID
  logTest("Missing user ID (should fail)");
  try {
    const fakeStreamId = `stream-${Date.now()}`;
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: fakeStreamId,
      creator_user_id: userId,
      channel_id: "fake-channel-arn",
      title: "Stream No User",
      stream_key: "fake-key",
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await StreamManager.registerTip(fakeStreamId, null, tipAmount, message);
    logError("❌ Should have failed due to missing user ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing user ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "registerTip" });
  }

  // 4. Invalid tip amount
  logTest("Invalid tip amount (should fail)");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const streamId = `stream-${Date.now()}`;
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: streamId,
      creator_user_id: userId,
      channel_id: channel.arn,
      title: "Invalid Tip Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await StreamManager.registerTip(streamId, userId, -10, message); // Invalid negative tip
    logError("❌ Should have failed due to invalid tip amount");
  } catch (err) {
    logSuccess("✅ Correctly failed with invalid tip amount: " + err.message);
    ErrorHandler.add_error(err.message, { method: "registerTip" });
  }

  // 5. Non-existent stream ID
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.registerTip(
      "stream-non-existent",
      userId,
      tipAmount,
      message
    );
    logError("❌ Should have failed with non-existent stream ID");
  } catch (err) {
    logSuccess(
      "✅ Correctly failed with non-existent stream ID: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "registerTip" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}
async function testSetGoalProgress() {
  ErrorHandler.clear();
  logTest("StreamManager.setGoalProgress");

  const goalId = "goal1";
  const target = 100;
  const progress = 100;

  // 1. Valid goal progress update
  logTest("Valid goal progress update");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Goal Progress Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      goals: [
        {
          id: goalId,
          target,
          progress: 0,
          achieved: false,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    await StreamManager.setGoalProgress(stream.id, goalId, progress);

    const updatedStream = await ScyllaDb.getItem(STREAMS_TABLE, {
      id: stream.id,
    });

    const goal = updatedStream.goals.find((g) => g.id === goalId);

    if (goal && goal.progress === progress && goal.achieved) {
      logSuccess("✅ Goal progress updated and marked as achieved");
    } else {
      throw new Error("Goal not updated or not marked as achieved");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "setGoalProgress" });
    logError("❌ setGoalProgress failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.setGoalProgress(null, goalId, progress);
    logError("❌ Should have failed due to missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing stream ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setGoalProgress" });
  }

  // 3. Missing goal ID (should fail)
  logTest("Missing goal ID (should fail)");
  try {
    const fakeStreamId = `stream-${Date.now()}`;
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: fakeStreamId,
      creator_user_id: "user001",
      goals: [{ id: goalId, target, progress: 0, achieved: false }],
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await StreamManager.setGoalProgress(fakeStreamId, null, progress);
    logError("❌ Should have failed due to missing goal ID");
  } catch (err) {
    logSuccess("✅ Correctly failed with missing goal ID: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setGoalProgress" });
  }

  // 4. Non-existent stream (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.setGoalProgress(
      "stream-does-not-exist",
      goalId,
      progress
    );
    logError("❌ Should have failed with non-existent stream ID");
  } catch (err) {
    logSuccess(
      "✅ Correctly failed with non-existent stream ID: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "setGoalProgress" });
  }

  // 5. Goal not found in valid stream (should fail)
  logTest("Goal not found in stream (should fail)");
  try {
    const streamId = `stream-${Date.now()}`;
    await ScyllaDb.putItem(STREAMS_TABLE, {
      id: streamId,
      creator_user_id: "user001",
      goals: [],
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await StreamManager.setGoalProgress(streamId, goalId, progress);
    logError("❌ Should have failed because goal not found in stream");
  } catch (err) {
    logSuccess("✅ Correctly failed due to missing goal: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setGoalProgress" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testSetTrailerAndThumbnail() {
  ErrorHandler.clear();
  logTest("StreamManager.setTrailer / setThumbnail");

  const trailerUrl = "http://trailer.url";
  const thumbnailUrl = "http://thumbnail.url";

  // 1. Valid case
  logTest("Valid trailer/thumbnail update");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Media Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    await StreamManager.setTrailer(stream.id, trailerUrl);
    await StreamManager.setThumbnail(stream.id, thumbnailUrl);

    logSuccess("✅ Trailer and thumbnail set successfully");
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "setTrailer/Thumbnail" });
    logError("❌ Failed to set trailer/thumbnail (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.setTrailer(null, trailerUrl);
    logError("❌ Should have failed on missing stream ID for trailer");
  } catch (err) {
    logSuccess("✅ Correctly failed for trailer: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setTrailer" });
  }

  try {
    await StreamManager.setThumbnail(null, thumbnailUrl);
    logError("❌ Should have failed on missing stream ID for thumbnail");
  } catch (err) {
    logSuccess("✅ Correctly failed for thumbnail: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setThumbnail" });
  }

  // 3. Non-existent stream ID (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.setTrailer("stream-nonexistent", trailerUrl);
    logError("❌ Should have failed on trailer for non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed trailer: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setTrailer" });
  }

  try {
    await StreamManager.setThumbnail("stream-nonexistent", thumbnailUrl);
    logError("❌ Should have failed on thumbnail for non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed thumbnail: " + err.message);
    ErrorHandler.add_error(err.message, { method: "setThumbnail" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testAddAndListCollaborators() {
  ErrorHandler.clear();
  logTest("StreamManager.addCollaborator / listCollaborators");

  const collaboratorId = "collab1";

  // 1. Valid case
  logTest("Valid collaborator add and list");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Collab Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      collaborators: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    await StreamManager.addCollaborator(stream.id, collaboratorId);
    const collabs = await StreamManager.listCollaborators(stream.id);

    if (collabs.includes(collaboratorId)) {
      logSuccess("✅ Collaborator added and listed successfully");
    } else {
      throw new Error("Collaborator not found in list");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "addCollaborator" });
    logError("❌ addCollaborator failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.addCollaborator(null, collaboratorId);
    logError("❌ Should have failed to add with missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed on addCollaborator: " + err.message);
    ErrorHandler.add_error(err.message, { method: "addCollaborator" });
  }

  try {
    await StreamManager.listCollaborators(null);
    logError("❌ Should have failed to list with missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed on listCollaborators: " + err.message);
    ErrorHandler.add_error(err.message, { method: "listCollaborators" });
  }

  // 3. Non-existent stream (should fail)
  logTest("Non-existent stream (should fail)");
  try {
    await StreamManager.addCollaborator("stream-nonexistent", collaboratorId);
    logError("❌ Should have failed to add to non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "addCollaborator" });
  }

  try {
    await StreamManager.listCollaborators("stream-nonexistent");
    logError("❌ Should have failed to list from non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "listCollaborators" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetSessionType() {
  ErrorHandler.clear();
  logTest("StreamManager.getSessionType");

  // 1. Valid stream with access_type
  logTest("Valid getSessionType");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const stream = {
      id: `stream-${Date.now()}`,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Session Type Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    const type = await StreamManager.getSessionType(stream.id);
    if (type === stream.access_type) {
      logSuccess("✅ Session type retrieved: " + type);
    } else {
      throw new Error("Session type mismatch");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "getSessionType" });
    logError("❌ getSessionType failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.getSessionType(null);
    logError("❌ Should have failed with missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "getSessionType" });
  }

  // 3. Non-existent stream ID (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.getSessionType("stream-nonexistent");
    logError("❌ Should have failed on non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "getSessionType" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetStats() {
  ErrorHandler.clear();
  logTest("StreamManager.getStats");

  // 1. Valid stats retrieval
  logTest("Valid getStats");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const streamId = `stream-${Date.now()}`;
    const testStats = {
      id: streamId,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Stats Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      stats: {
        viewers: 10,
        likes: 5,
        duration: 3600,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, testStats);

    const result = await StreamManager.getStats(streamId);

    if (
      result &&
      result.viewers === testStats.stats.viewers &&
      result.likes === testStats.stats.likes &&
      result.duration === testStats.stats.duration
    ) {
      logSuccess("✅ getStats returned expected result", result);
    } else {
      throw new Error("Returned stats do not match expected values");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "getStats" });
    logError("❌ getStats failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.getStats(null);
    logError("❌ Should have failed with missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "getStats" });
  }

  // 3. Non-existent stream ID (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.getStats("stream-nonexistent");
    logError("❌ Should have failed with non-existent stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "getStats" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetTipLeaderboard() {
  ErrorHandler.clear();
  logTest("StreamManager.getTipLeaderboard");

  // 1. Valid leaderboard fetch
  logTest("Valid getTipLeaderboard");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const streamId = `stream-${Date.now()}`;

    const stream = {
      id: streamId,
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Leaderboard Stream",
      stream_key: streamKey.value,
      access_type: "open_public",
      tip_board: [
        { user_id: "user001", amount: 100 },
        { user_id: "user002", amount: 50 },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(STREAMS_TABLE, stream);

    const leaderboard = await StreamManager.getTipLeaderboard(streamId);

    if (
      leaderboard &&
      Array.isArray(leaderboard) &&
      leaderboard[0].user_id === "user001"
    ) {
      logSuccess("✅ Leaderboard fetched successfully", leaderboard);
    } else {
      throw new Error("Leaderboard format or data incorrect");
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "getTipLeaderboard" });
    logError("❌ getTipLeaderboard failed (valid case)", err);
  }

  // 2. Missing stream ID (should fail)
  logTest("Missing stream ID (should fail)");
  try {
    await StreamManager.getTipLeaderboard(null);
    logError("❌ Should have failed with missing stream ID");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "getTipLeaderboard" });
  }

  // 3. Non-existent stream (should fail)
  logTest("Non-existent stream ID (should fail)");
  try {
    await StreamManager.getTipLeaderboard("stream-does-not-exist");
    logError("❌ Should have failed on non-existent stream");
  } catch (err) {
    logSuccess("✅ Correctly failed: " + err.message);
    ErrorHandler.add_error(err.message, { method: "getTipLeaderboard" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

runAllStreamManagerTests();
