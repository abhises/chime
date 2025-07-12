const dotenv = require("dotenv");
const ScyllaDb = require("../ScyllaDb");
const IVSService = require("../ivs/ivs");
const getIvsClient = require("../ivs/ivsClient");
const logEvent = require("../utils/logEvent");
const ErrorHandler = require("../utils/ErrorHandler");

const {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteStreamKeyCommand,
  ListStreamKeysCommand,
} = require("@aws-sdk/client-ivs");

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
  logTest("updateChannel");

  try {
    const { channel, streamKey } = await createChannelWithStreamKey();

    // Step 1: Insert initial channel into DB
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

    // Step 2: Prepare update data
    const updates = {
      description: "Updated description",
      category: "gaming",
      language: "hi",
    };

    // Step 3: Call updateChannel
    await IVSService.updateChannel(channel.arn, updates);

    // Step 4: Validate that it was updated
    const updatedChannel = await ScyllaDb.getItem(CHANNELS_TABLE, {
      id: channel.arn,
    });

    const isUpdated =
      updatedChannel.description === updates.description &&
      updatedChannel.category === updates.category &&
      updatedChannel.language === updates.language;

    if (isUpdated) {
      logSuccess("Channel updated successfully");
    } else {
      logError(
        "Channel fields did not update as expected",
        new Error(JSON.stringify(updatedChannel))
      );
    }
  } catch (err) {
    logError("updateChannel test failed", err);
  }
}

async function testCreateStreamWithoutUserId() {
  logTest("createStream (Missing creator_user_id)");

  try {
    await IVSService.createStream({
      creator_user_id: null, // ❌
      title: "Invalid Test Stream",
      access_type: "public",
    });
    logError(
      "Expected error when creator_user_id is missing",
      new Error("No error thrown")
    );
  } catch (error) {
    logSuccess("Properly failed when creator_user_id is missing");
  }
}

async function testDuplicateStreamKey() {
  logTest("createStream (Duplicate Stream Key)");

  try {
    const first = await IVSService.createStream({
      creator_user_id: testCreatorId,
      title: "First Stream",
      access_type: "public",
    });

    // Try again without deleting previous keys (simulate quota exceed)
    const second = await IVSService.createStream({
      creator_user_id: testCreatorId,
      title: "Second Stream",
      access_type: "public",
    });

    logSuccess("Both streams created (unexpected, unless cleanup happened)");
  } catch (error) {
    if (error.message.includes("quota")) {
      logSuccess("Correctly failed on duplicate stream key quota");
    } else {
      logError("Unexpected error during duplicate stream test", error);
    }
  }
}

async function testListChannelStreams() {
  logTest("listChannelStreams");

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
    console.log("✅ Created channel with ARN:", awsChannel.arn);

    // Step 2: Clean old stream keys
    const existingKeys = await ivsClient.send(
      new ListStreamKeysCommand({ channelArn: awsChannel.arn })
    );
    for (const key of existingKeys.streamKeys || []) {
      await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
    }

    // Step 3: Create a new stream key
    const keyRes = await ivsClient.send(
      new CreateStreamKeyCommand({
        channelArn: awsChannel.arn,
      })
    );
    const streamKey = keyRes.streamKey;

    // Step 4: Store metadata in DB
    const id = crypto.randomUUID(); // ✅ generate stream ID
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

    // Step 5: Call listChannelStreams
    const streams = await IVSService.listChannelStreams(awsChannel.arn);

    if (Array.isArray(streams)) {
      console.log("   ▶️ Found", streams.length, "stream(s)");
      logSuccess("listChannelStreams returned a valid array");
    } else {
      logError("Expected array but got something else", new Error());
    }
  } catch (error) {
    logError("listChannelStreams test failed", error);
  }
}
async function testGetChannelMeta() {
  logTest("getChannelMeta");

  try {
    const now = new Date().toISOString();

    let awsChannel, streamKey;

    try {
      const ivsClient = getIvsClient();

      // Create channel
      const channelRes = await ivsClient.send(
        new CreateChannelCommand({
          name: `channel-${crypto.randomUUID()}`,
          latencyMode: "LOW",
          type: "STANDARD",
        })
      );

      awsChannel = channelRes.channel;
      console.log("✅ Created Channel ARN:", awsChannel.arn);

      // Clean up any existing stream keys
      const existingKeys = await ivsClient.send(
        new ListStreamKeysCommand({ channelArn: awsChannel.arn })
      );

      for (const key of existingKeys.streamKeys || []) {
        await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
      }

      // Create new stream key
      const keyRes = await ivsClient.send(
        new CreateStreamKeyCommand({
          channelArn: awsChannel.arn,
        })
      );

      streamKey = keyRes.streamKey;

      // Save channel to ScyllaDB
      await ScyllaDb.putItem(CHANNELS_TABLE, {
        id: awsChannel.arn, // ✅ using ARN as the primary key
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

      // Fetch channel meta
      const meta = await IVSService.getChannelMeta(awsChannel.arn); // ✅ pass ARN to match saved id

      if (meta && meta.aws_channel_arn) {
        console.log("   ▶️ Channel ARN:", meta.aws_channel_arn);
        logSuccess("getChannelMeta returned metadata");
      } else {
        logError("getChannelMeta returned no data", new Error());
      }
    } catch (err) {
      logError("IVS or DB setup failed", err);
      throw new Error("Failed to create IVS channel or stream key");
    }
  } catch (error) {
    logError("getChannelMeta test failed", error);
  }
}
async function testDeleteChannel() {
  logTest("deleteChannel");

  try {
    // First, create a stream to get a valid channelArn
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
    console.log("Created channel ID to delete:", channelArn);

    // Now try deleting the channel
    const result = await IVSService.deleteChannel(channelArn);

    if (result === true) {
      logSuccess("deleteChannel successfully deleted the channel");
    } else {
      logError("deleteChannel returned false", new Error("Failed"));
    }
  } catch (error) {
    logError("deleteChannel test failed", error);
  }
}
async function testListAllChannels() {
  logTest("listAllChannels");

  try {
    const channels = await IVSService.listAllChannels();

    if (Array.isArray(channels)) {
      logSuccess(`listAllChannels returned ${channels.length} channel(s)`);

      if (channels.length > 0) {
        console.log("Sample channel ARNs:");
        channels.slice(0, 3).forEach((ch) => {
          console.log(` - ${ch.arn}`);
        });
      }
    } else {
      logError("listAllChannels did not return an array", new Error());
    }
  } catch (error) {
    logError("listAllChannels test failed", error);
  }
}
async function testCountAllChannels() {
  logTest("countAllChannels");

  try {
    const count = await IVSService.countAllChannels();

    if (typeof count === "number") {
      logSuccess(`countAllChannels returned count: ${count}`);

      // Optionally validate against listAllChannels
      const allChannels = await IVSService.listAllChannels();
      if (count === allChannels.length) {
        logSuccess("countAllChannels matches listAllChannels length");
      } else {
        logError(
          "countAllChannels does not match listAllChannels",
          new Error(`Expected ${allChannels.length}, got ${count}`)
        );
      }
    } else {
      logError("countAllChannels did not return a number", new Error());
    }
  } catch (error) {
    logError("countAllChannels test failed", error);
  }
}

async function testChannelExists() {
  logTest("channelExists");

  const existingChannelArn =
    "arn:aws:ivs:us-east-1:701253760804:channel/7GOkYUVpMTLP"; // replace with your actual channel ARN
  const fakeChannelArn =
    "arn:aws:ivs:us-east-1:123456789012:channel/fakeChannelXYZ";

  try {
    // Check known existing channel
    const exists = await IVSService.channelExists(existingChannelArn);
    if (exists) {
      logSuccess("channelExists correctly identified existing channel");
    } else {
      logError(
        "channelExists returned false for existing channel",
        new Error()
      );
    }

    // Check non-existing channel
    const notExists = await IVSService.channelExists(fakeChannelArn);
    if (!notExists) {
      logSuccess(
        "channelExists correctly returned false for non-existing channel"
      );
    } else {
      logError(
        "channelExists returned true for non-existing channel",
        new Error()
      );
    }
  } catch (error) {
    logError("channelExists test failed", error);
  }
}

async function testValidateChannel() {
  logTest("validateChannel");

  const validChannelArn =
    "arn:aws:ivs:us-east-1:701253760804:channel/7GOkYUVpMTLP"; // Replace with a known valid ARN
  const invalidChannelArn =
    "arn:aws:ivs:us-east-1:123456789012:channel/nonexistentXYZ";

  try {
    // ✅ Test valid channel
    const validResult = await IVSService.validateChannel(validChannelArn);
    if (validResult.valid) {
      logSuccess("validateChannel correctly validated a real channel");
    } else {
      logError(
        "validateChannel failed for a real channel",
        new Error(validResult.reason)
      );
    }

    // ❌ Test non-existent channel
    const invalidResult = await IVSService.validateChannel(invalidChannelArn);
    if (
      !invalidResult.valid &&
      invalidResult.reason === "Channel does not exist"
    ) {
      logSuccess("validateChannel correctly identified a non-existing channel");
    } else {
      logError(
        "validateChannel did not handle non-existing channel properly",
        new Error(invalidResult.reason)
      );
    }
  } catch (error) {
    logError("validateChannel test failed", error);
  }
}

runAllTests();
