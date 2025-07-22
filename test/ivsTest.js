import dotenv from "dotenv";
import ScyllaDb from "../ScyllaDb.js";
import IVSService from "../ivs/ivs.js";
import getIvsClient from "../ivs/ivsClient.js";
import logEvent from "../utils/logEvent.js";
import ErrorHandler from "../utils/ErrorHandler.js";

import {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteStreamKeyCommand,
  ListStreamKeysCommand,
} from "@aws-sdk/client-ivs";

dotenv.config();

const STREAMS_TABLE = "IVSStreams";
const JOIN_LOGS_TABLE = "IVSJoinLogs";
const STATS_TABLE = "IVSStats";
const CHANNELS_TABLE = "IVSChannels";

// Test utilities
function logTest(testName) {
  console.log(`\n🧪 Testing ${testName}...`);
}

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logError(message, error) {
  console.error(`❌ ${message}:`, error.message);
}

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
// Global test data
const testCreatorId = "user001";

async function runAllTests() {
  try {
    console.log("🚀 Starting IVSService Test Suite");
    console.log("Loading table configurations...");
    await ScyllaDb.loadTableConfigs("./tables.json");
    logSuccess("Table configurations loaded successfully");

    // Run all tests
    await testCreateStream();
    await testUpdateChannel();
    await testCreateStreamWithoutUserId();

    await testDuplicateStreamKey();
    await testListChannelStreams();
    await testGetChannelMeta();

    await testDeleteChannel();

    await testListAllChannels();

    await testCountAllChannels();
    await testChannelExists();
    await testValidateChannel();

    console.log("\n🎉 All IVS tests completed!");
  } catch (error) {
    logError("Test suite failed", error);
  }
}
// test for creating streams
async function testCreateStream() {
  ErrorHandler.clear();
  logTest("createStream");

  // 1. Valid open_public stream
  logTest("Valid open_public stream");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const stream = await IVSService.createStream({
      creator_user_id: "user001",
      channel_id: channel.arn,
      title: "Test Stream 1",
      stream_key: streamKey.value,
      access_type: "open_public",
    });
    logSuccess(`✅ Stream created: ${stream.id}`);
  } catch (e) {
    logError("❌ Failed to create valid stream", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 2. Missing stream key (should fail)
  logTest("Missing stream_key (should fail)");
  try {
    const { channel } = await createChannelWithStreamKey();
    await IVSService.createStream({
      creator_user_id: "user002",
      channel_id: channel.arn,
      title: "Test Stream 2",
      access_type: "open_public",
    });
    logError("❌ Should have failed (missing stream_key)");
  } catch (e) {
    logSuccess("✅ Correctly failed (missing stream_key): " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 3. Invalid access type (should fail)
  logTest("Invalid access_type (should fail)");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    await IVSService.createStream({
      creator_user_id: "user003",
      channel_id: channel.arn,
      title: "Invalid Access",
      stream_key: streamKey.value,
      access_type: "invalid_type",
    });
    logError("❌ Should have failed (invalid access_type)");
  } catch (e) {
    logSuccess("✅ Correctly failed (invalid access_type): " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 4. Missing creator_user_id (should fail)
  logTest("Missing creator_user_id (should fail)");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    await IVSService.createStream({
      channel_id: channel.arn,
      title: "No Creator",
      stream_key: streamKey.value,
      access_type: "open_public",
    });
    logError("❌ Should have failed (missing creator_user_id)");
  } catch (e) {
    logSuccess("✅ Correctly failed (missing creator_user_id): " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 5. Missing title (should fail)
  logTest("Missing title (should fail)");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    await IVSService.createStream({
      creator_user_id: "user005",
      channel_id: channel.arn,
      stream_key: streamKey.value,
      access_type: "open_public",
    });
    logError("❌ Should have failed (missing title)");
  } catch (e) {
    logSuccess("✅ Correctly failed (missing title): " + e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 6. Valid stream with private access
  logTest("Valid private stream");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();
    const stream = await IVSService.createStream({
      creator_user_id: "user006",
      channel_id: channel.arn,
      title: "Private Stream",
      stream_key: streamKey.value,
      access_type: "private",
    });
    logSuccess(`✅ Private stream created: ${stream.id}`);
  } catch (e) {
    logError("❌ Failed to create private stream", e.message);
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));

  // 7. Simulate AWS SDK failure
  logTest("Simulate AWS region failure");
  try {
    const originalRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = "invalid-region";

    const { channel, streamKey } = await createChannelWithStreamKey();
    await IVSService.createStream({
      creator_user_id: "user007",
      channel_id: channel.arn,
      title: "AWS Fail",
      stream_key: streamKey.value,
      access_type: "open_public",
    });

    logError("❌ Unexpected success in invalid AWS region");
    process.env.AWS_REGION = originalRegion;
  } catch (e) {
    logSuccess("✅ Correctly failed AWS SDK region issue: " + e.message);
    process.env.AWS_REGION = "us-east-1";
  }
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testUpdateChannel() {
  ErrorHandler.clear();
  logTest("updateChannel");

  // 1. Valid update
  logTest("Valid update");
  try {
    const { channel } = await createChannelWithStreamKey();

    const initialChannel = {
      id: channel.arn,
      name: "Initial Channel",
      description: "Initial description",
      profile_thumbnail: "",
      tags: [],
      language: "en",
      category: "education",
      followers: 0,
      aws_channel_arn: channel.arn,
      playback_url: "https://playback.example.com",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await ScyllaDb.putItem(CHANNELS_TABLE, initialChannel);

    const updates = {
      description: "Updated description",
      category: "gaming",
      language: "hi",
    };

    await IVSService.updateChannel(channel.arn, updates);

    const updatedChannel = await ScyllaDb.getItem(CHANNELS_TABLE, {
      id: channel.arn,
    });

    const isUpdated =
      updatedChannel.description === updates.description &&
      updatedChannel.category === updates.category &&
      updatedChannel.language === updates.language;

    if (isUpdated) {
      logSuccess("✅ Channel updated successfully");
    } else {
      const msg = "❌ Channel fields did not update as expected";
      ErrorHandler.add_error(msg, updatedChannel);
      logError(msg, new Error(JSON.stringify(updatedChannel)));
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "updateChannel" });
    logError("❌ updateChannel test failed", err);
  }

  // 2. Update with missing channel ARN (should fail)
  logTest("Missing channel ARN (should fail)");
  try {
    await IVSService.updateChannel(null, {
      description: "Fail case",
    });
    logError("❌ Should have failed due to missing channel ARN");
  } catch (err) {
    logSuccess(
      "✅ Correctly failed due to missing channel ARN: " + err.message
    );
    ErrorHandler.add_error(err.message, { method: "updateChannel" });
  }

  // 3. Update non-existent channel (should fail)
  logTest("Non-existent channel ARN (should fail)");
  try {
    await IVSService.updateChannel(
      "arn:aws:ivs:us-east-1:000000000000:channel/non-existent",
      {
        description: "Should not update",
      }
    );
    logError("❌ Should have failed with non-existent channel ARN");
  } catch (err) {
    logSuccess("✅ Correctly failed on non-existent channel: " + err.message);
    ErrorHandler.add_error(err.message, { method: "updateChannel" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testCreateStreamWithoutUserId() {
  ErrorHandler.clear();
  logTest("createStreamWithoutUserId");

  // 1. Missing creator_user_id (should fail)
  logTest("Missing creator_user_id (should fail)");
  try {
    await IVSService.createStream({
      creator_user_id: null,
      title: "Invalid Test Stream",
      access_type: "public",
    });

    const msg = "❌ No error thrown when creator_user_id was null";
    ErrorHandler.add_error(msg, { method: "createStream" });
    logError("Expected error when creator_user_id is missing", new Error(msg));
  } catch (error) {
    logSuccess("✅ Properly failed when creator_user_id is missing");
    ErrorHandler.add_error(error.message, { method: "createStream" });
  }

  // 2. Missing title (should fail)
  logTest("Missing title (should fail)");
  try {
    await IVSService.createStream({
      creator_user_id: "userTest",
      access_type: "public",
    });

    const msg = "❌ No error thrown when title was missing";
    ErrorHandler.add_error(msg, { method: "createStream" });
    logError("Expected error when title is missing", new Error(msg));
  } catch (error) {
    logSuccess("✅ Properly failed when title is missing");
    ErrorHandler.add_error(error.message, { method: "createStream" });
  }

  // 3. Missing access_type (should fail)
  logTest("Missing access_type (should fail)");
  try {
    await IVSService.createStream({
      creator_user_id: "userTest",
      title: "Missing Access Type",
    });

    const msg = "❌ No error thrown when access_type was missing";
    ErrorHandler.add_error(msg, { method: "createStream" });
    logError("Expected error when access_type is missing", new Error(msg));
  } catch (error) {
    logSuccess("✅ Properly failed when access_type is missing");
    ErrorHandler.add_error(error.message, { method: "createStream" });
  }

  // Final error output
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testDuplicateStreamKey() {
  ErrorHandler.clear();
  logTest("createStream (Duplicate Stream Key)");

  // 1. Create first valid stream
  logTest("Creating first valid stream");
  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    const firstStream = await IVSService.createStream({
      creator_user_id: "user_duplicate",
      channel_id: channel.arn,
      title: "First Stream",
      stream_key: streamKey.value,
      access_type: "public",
    });

    logSuccess(`✅ First stream created: ${firstStream.id}`);

    // 2. Try to create second stream with same creator (simulate quota exceed or key conflict)
    logTest("Creating second stream with same user (simulate quota)");

    try {
      await IVSService.createStream({
        creator_user_id: "user_duplicate",
        channel_id: channel.arn,
        title: "Second Stream",
        stream_key: streamKey.value, // re-using the same stream key
        access_type: "public",
      });

      const msg = "❌ Duplicate stream key accepted unexpectedly";
      ErrorHandler.add_error(msg, { method: "createStream" });
      logError(msg, new Error("Quota/Key conflict not triggered"));
    } catch (e2) {
      if (
        e2.message.toLowerCase().includes("quota") ||
        e2.message.toLowerCase().includes("duplicate")
      ) {
        logSuccess(
          "✅ Correctly failed on duplicate stream key or quota limit: " +
            e2.message
        );
        ErrorHandler.add_error(e2.message, { method: "createStream" });
      } else {
        const msg = "❌ Unexpected error on duplicate stream";
        ErrorHandler.add_error(e2.message, {
          method: "createStream",
          details: "Expected quota/duplicate issue",
        });
        logError(msg, e2);
      }
    }
  } catch (err) {
    const msg = "❌ Failed to create first stream";
    ErrorHandler.add_error(err.message, {
      method: "createStream",
      step: "initial",
    });
    logError(msg, err);
  }

  // Final error report
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testListChannelStreams() {
  ErrorHandler.clear();
  logTest("listChannelStreams");

  // 1. Create channel and add a stream, then list streams
  logTest("Create channel, add stream, then list streams");

  try {
    const now = new Date().toISOString();
    const ivsClient = getIvsClient();

    // Step 1: Create IVS channel
    const channelRes = await ivsClient.send(
      new CreateChannelCommand({
        name: `channel-${testCreatorId}-${Date.now()}`,
        latencyMode: "LOW",
        type: "STANDARD",
      })
    );

    const awsChannel = channelRes.channel;
    logSuccess(`✅ Created channel with ARN: ${awsChannel.arn}`);

    // Step 2: Clean old stream keys
    const existingKeys = await ivsClient.send(
      new ListStreamKeysCommand({ channelArn: awsChannel.arn })
    );
    for (const key of existingKeys.streamKeys || []) {
      await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
    }

    // Step 3: Create new stream key
    const keyRes = await ivsClient.send(
      new CreateStreamKeyCommand({ channelArn: awsChannel.arn })
    );
    const streamKey = keyRes.streamKey;

    // Step 4: Store stream metadata in DB
    const id = crypto.randomUUID();
    const item = {
      id,
      channel_id: awsChannel.arn,
      creator_user_id: testCreatorId,
      title: `Test Stream ${Date.now()}`,
      description: "",
      access_type: "public",
      is_private: false,
      pricing_type: "free",
      allow_comments: false,
      collaborators: [],
      tags: [],
      goals: [],
      games: [],
      gifts: [],
      tips: [],
      multi_cam_urls: [],
      announcements: [],
      status: "offline",
      created_at: now,
      updated_at: now,
      stream_key: streamKey.value,
    };

    await ScyllaDb.putItem(STREAMS_TABLE, item);

    logEvent("createStream", {
      stream_id: id,
      creator_user_id: testCreatorId,
      channel_id: awsChannel.arn,
    });

    // Step 5: Call the function to list streams
    const streams = await IVSService.listChannelStreams(awsChannel.arn);

    if (Array.isArray(streams)) {
      logSuccess(
        `✅ listChannelStreams returned an array with ${streams.length} stream(s)`
      );
    } else {
      const msg = "❌ listChannelStreams did not return an array";
      ErrorHandler.add_error(msg, { method: "listChannelStreams" });
      logError(msg, new Error("Invalid return type"));
    }
  } catch (error) {
    ErrorHandler.add_error(error.message, { method: "listChannelStreams" });
    logError("❌ listChannelStreams test failed", error);
  }

  // Optional: Test invalid channel ARN (should fail)
  logTest("Invalid channel ARN (should fail)");
  try {
    await IVSService.listChannelStreams(null);
    const msg = "❌ Should have failed due to null channel ARN";
    ErrorHandler.add_error(msg, { method: "listChannelStreams" });
    logError(msg, new Error("No error thrown for null channel ARN"));
  } catch (e) {
    logSuccess(`✅ Correctly failed for null channel ARN: ${e.message}`);
    ErrorHandler.add_error(e.message, { method: "listChannelStreams" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testGetChannelMeta() {
  ErrorHandler.clear();
  logTest("getChannelMeta");

  // 1. Create channel, save to DB, then fetch metadata
  logTest("Create channel, save to DB, then get metadata");

  try {
    const now = new Date().toISOString();
    const ivsClient = getIvsClient();

    // Create IVS channel
    const channelRes = await ivsClient.send(
      new CreateChannelCommand({
        name: `channel-${crypto.randomUUID()}`,
        latencyMode: "LOW",
        type: "STANDARD",
      })
    );
    const awsChannel = channelRes.channel;
    logSuccess(`✅ Created Channel ARN: ${awsChannel.arn}`);

    // Delete existing stream keys
    const existingKeys = await ivsClient.send(
      new ListStreamKeysCommand({ channelArn: awsChannel.arn })
    );
    for (const key of existingKeys.streamKeys || []) {
      await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
    }

    // Create new stream key
    const keyRes = await ivsClient.send(
      new CreateStreamKeyCommand({ channelArn: awsChannel.arn })
    );
    const streamKey = keyRes.streamKey;

    // Save channel metadata in DB
    await ScyllaDb.putItem(CHANNELS_TABLE, {
      id: awsChannel.arn,
      name: awsChannel.name,
      description: "",
      profile_thumbnail: "",
      tags: [],
      language: "",
      category: "",
      followers: 0,
      aws_channel_arn: awsChannel.arn,
      playback_url: awsChannel.playbackUrl,
      created_at: now,
      updated_at: now,
    });

    // Fetch channel metadata
    const meta = await IVSService.getChannelMeta(awsChannel.arn);

    if (meta && meta.aws_channel_arn === awsChannel.arn) {
      logSuccess("✅ getChannelMeta returned valid metadata");
    } else {
      const msg = "❌ getChannelMeta returned invalid or no metadata";
      ErrorHandler.add_error(msg, {
        method: "getChannelMeta",
        returnedMeta: meta,
      });
      logError(msg, new Error("Invalid metadata returned"));
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "getChannelMeta" });
    logError("❌ getChannelMeta test failed", err);
  }

  // 2. Test getChannelMeta with invalid ARN (should fail)
  logTest("Invalid channel ARN (should fail)");
  try {
    await IVSService.getChannelMeta(null);
    const msg = "❌ Should have failed due to null channel ARN";
    ErrorHandler.add_error(msg, { method: "getChannelMeta" });
    logError(msg, new Error("No error thrown for null ARN"));
  } catch (e) {
    logSuccess(`✅ Correctly failed for null channel ARN: ${e.message}`);
    ErrorHandler.add_error(e.message, { method: "getChannelMeta" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testDeleteChannel() {
  ErrorHandler.clear();
  logTest("deleteChannel");

  // 1. Create a stream and delete its channel
  logTest("Create stream and delete its channel");

  try {
    const stream = await IVSService.createStream({
      creator_user_id: "delete-test-user",
      title: "Temp Stream for Delete Test",
      access_type: "public",
      is_private: false,
      pricing_type: "free",
      description: "Will be deleted",
      tags: [],
      allow_comments: false,
      collaborators: [],
    });

    const channelArn = stream.channel_id;
    console.log("✅ Created channel ARN to delete:", channelArn);

    const result = await IVSService.deleteChannel(channelArn);

    if (result === true) {
      logSuccess("✅ deleteChannel successfully deleted the channel");
    } else {
      const msg = "❌ deleteChannel returned false, deletion failed";
      ErrorHandler.add_error(msg, { channelArn, method: "deleteChannel" });
      logError(msg, new Error("Deletion failed"));
    }
  } catch (error) {
    ErrorHandler.add_error(error.message, { method: "deleteChannel" });
    logError("❌ deleteChannel test failed", error);
  }

  // 2. Try deleting channel with invalid ARN (should fail)
  logTest("Delete channel with invalid ARN (should fail)");
  try {
    await IVSService.deleteChannel(null);
    const msg = "❌ Should have failed due to null channel ARN";
    ErrorHandler.add_error(msg, { method: "deleteChannel" });
    logError(msg, new Error("No error thrown for null ARN"));
  } catch (e) {
    logSuccess(
      `✅ Correctly failed to delete with null channel ARN: ${e.message}`
    );
    ErrorHandler.add_error(e.message, { method: "deleteChannel" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testListAllChannels() {
  ErrorHandler.clear();
  logTest("listAllChannels");

  // 1. Should return an array of channels
  logTest("listAllChannels returns array");
  try {
    const channels = await IVSService.listAllChannels();

    if (Array.isArray(channels)) {
      logSuccess(`✅ listAllChannels returned ${channels.length} channel(s)`);
      if (channels.length > 0) {
        console.log("Sample channel ARNs:");
        channels.slice(0, 3).forEach((ch) => {
          console.log(` - ${ch.arn}`);
        });
      }
    } else {
      const msg = "❌ listAllChannels did not return an array";
      ErrorHandler.add_error(msg, {
        method: "listAllChannels",
        returned: channels,
      });
      logError(msg, new Error("Expected array"));
    }
  } catch (e) {
    ErrorHandler.add_error(e.message, { method: "listAllChannels" });
    logError("❌ listAllChannels test failed", e);
  }

  // 2. Simulate AWS SDK failure by setting invalid region
  logTest("Simulate AWS SDK failure");
  try {
    const originalRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = "invalid-region";

    await IVSService.listAllChannels();

    logError("❌ Unexpected success in invalid AWS region");
    process.env.AWS_REGION = originalRegion;
  } catch (e) {
    logSuccess("✅ Correctly failed AWS SDK region issue: " + e.message);
    ErrorHandler.add_error(e.message, { method: "listAllChannels" });
    process.env.AWS_REGION = "us-east-1";
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testCountAllChannels() {
  ErrorHandler.clear();
  logTest("countAllChannels");

  // 1. Should return a number and match listAllChannels length
  logTest("countAllChannels returns a number and matches listAllChannels");
  try {
    const count = await IVSService.countAllChannels();

    if (typeof count === "number") {
      logSuccess(`✅ countAllChannels returned count: ${count}`);

      const allChannels = await IVSService.listAllChannels();

      if (count === allChannels.length) {
        logSuccess("✅ countAllChannels matches listAllChannels length");
      } else {
        const msg = `❌ countAllChannels (${count}) does not match listAllChannels length (${allChannels.length})`;
        ErrorHandler.add_error(msg, { count, listLength: allChannels.length });
        logError(msg, new Error(msg));
      }
    } else {
      const msg = "❌ countAllChannels did not return a number";
      ErrorHandler.add_error(msg, { returnedType: typeof count });
      logError(msg, new Error(msg));
    }
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "countAllChannels" });
    logError("❌ countAllChannels test failed", err);
  }

  // 2. Simulate failure case (e.g., invalid AWS region)
  logTest("Simulate failure with invalid AWS region");
  try {
    const originalRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = "invalid-region";

    await IVSService.countAllChannels();

    logError("❌ Unexpected success with invalid AWS region");
    process.env.AWS_REGION = originalRegion;
  } catch (err) {
    logSuccess("✅ Correctly failed due to invalid AWS region: " + err.message);
    ErrorHandler.add_error(err.message, { method: "countAllChannels" });
    process.env.AWS_REGION = "us-east-1";
  }

  // Output all errors at the end
  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testChannelExists() {
  ErrorHandler.clear();
  logTest("channelExists");

  const existingChannelArn =
    "arn:aws:ivs:us-east-1:701253760804:channel/7GOkYUVpMTLP"; // replace with a real channel ARN
  const fakeChannelArn =
    "arn:aws:ivs:us-east-1:123456789012:channel/fakeChannelXYZ";

  // 1. Check known existing channel
  logTest("Check existing channel");
  try {
    const exists = await IVSService.channelExists(existingChannelArn);
    if (exists) {
      logSuccess("✅ channelExists correctly identified existing channel");
    } else {
      const msg = "❌ channelExists returned false for existing channel";
      ErrorHandler.add_error(msg, { arn: existingChannelArn });
      logError(msg, new Error(msg));
    }
  } catch (e) {
    ErrorHandler.add_error(e.message, { method: "channelExists" });
    logError("❌ channelExists test failed on existing channel", e);
  }

  // 2. Check non-existing channel
  logTest("Check non-existing channel");
  try {
    const exists = await IVSService.channelExists(fakeChannelArn);
    if (!exists) {
      logSuccess(
        "✅ channelExists correctly returned false for non-existing channel"
      );
    } else {
      const msg = "❌ channelExists returned true for non-existing channel";
      ErrorHandler.add_error(msg, { arn: fakeChannelArn });
      logError(msg, new Error(msg));
    }
  } catch (e) {
    ErrorHandler.add_error(e.message, { method: "channelExists" });
    logError("❌ channelExists test failed on non-existing channel", e);
  }

  // 3. Invalid ARN (should fail)
  logTest("Invalid channel ARN (should fail)");
  try {
    await IVSService.channelExists(null);
    const msg = "❌ Should have failed due to null channel ARN";
    ErrorHandler.add_error(msg, { method: "channelExists" });
    logError(msg, new Error(msg));
  } catch (e) {
    logSuccess("✅ Correctly failed for null channel ARN: " + e.message);
    ErrorHandler.add_error(e.message, { method: "channelExists" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

async function testValidateChannel() {
  ErrorHandler.clear();
  logTest("validateChannel");

  const validChannelArn =
    "arn:aws:ivs:us-east-1:701253760804:channel/7GOkYUVpMTLP"; // Replace with a known valid ARN
  const invalidChannelArn =
    "arn:aws:ivs:us-east-1:123456789012:channel/nonexistentXYZ";

  // 1. Validate known valid channel ARN
  logTest("Validate known valid channel ARN");
  try {
    const validResult = await IVSService.validateChannel(validChannelArn);
    if (validResult.valid) {
      logSuccess("✅ validateChannel correctly validated a real channel");
    } else {
      const msg = `❌ validateChannel failed for a real channel: ${validResult.reason}`;
      ErrorHandler.add_error(msg, {
        arn: validChannelArn,
        result: validResult,
      });
      logError(msg, new Error(validResult.reason));
    }
  } catch (e) {
    ErrorHandler.add_error(e.message, { method: "validateChannel" });
    logError("❌ validateChannel test failed on valid channel", e);
  }

  // 2. Validate known invalid/non-existent channel ARN
  logTest("Validate known invalid/non-existent channel ARN");
  try {
    const invalidResult = await IVSService.validateChannel(invalidChannelArn);
    if (
      !invalidResult.valid &&
      invalidResult.reason === "Channel does not exist"
    ) {
      logSuccess(
        "✅ validateChannel correctly identified a non-existing channel"
      );
    } else {
      const msg = `❌ validateChannel did not handle non-existing channel properly: ${invalidResult.reason}`;
      ErrorHandler.add_error(msg, {
        arn: invalidChannelArn,
        result: invalidResult,
      });
      logError(msg, new Error(invalidResult.reason));
    }
  } catch (e) {
    ErrorHandler.add_error(e.message, { method: "validateChannel" });
    logError("❌ validateChannel test failed on invalid channel", e);
  }

  // 3. Validate with invalid input (null or empty ARN)
  logTest("Validate with null channel ARN (should fail)");
  try {
    await IVSService.validateChannel(null);
    const msg = "❌ Should have failed due to null channel ARN";
    ErrorHandler.add_error(msg, { method: "validateChannel" });
    logError(msg, new Error(msg));
  } catch (e) {
    logSuccess("✅ Correctly failed for null channel ARN: " + e.message);
    ErrorHandler.add_error(e.message, { method: "validateChannel" });
  }

  console.log(JSON.stringify(ErrorHandler.get_all_errors(), null, 2));
}

runAllTests();
