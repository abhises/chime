// IVSService.js
const {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteStreamKeyCommand,
  ListStreamKeysCommand,
  DeleteChannelCommand,
  ListChannelsCommand,
  GetChannelCommand,
} = require("@aws-sdk/client-ivs");

const getIvsClient = require("./ivsClient");
const logEvent = require("../utils/logEvent");
const logError = require("../utils/logError");
const ScyllaDb = require("../ScyllaDb");
const SafeUtils = require("../utils/SafeUtils");
const ErrorHandler = require("../utils/ErrorHandler");

const STREAMS_TABLE = "IVSStreams";
const JOIN_LOGS_TABLE = "IVSJoinLogs";
const STATS_TABLE = "IVSStats";
const CHANNELS_TABLE = "IVSChannels";

class IVSService {
  static async createStream(rawArgs) {
    try {
      // ✅ Step 1: Validate & Sanitize Inputs
      const params = SafeUtils.sanitizeValidate({
        creator_user_id: {
          value: rawArgs.creator_user_id,
          type: "string",
          required: true,
        },
        title: { value: rawArgs.title, type: "string", required: true },
        access_type: {
          value: rawArgs.access_type,
          type: "string",
          required: true,
        },
        is_private: {
          value: rawArgs.is_private,
          type: "boolean",
          default: false,
        },
        pricing_type: {
          value: rawArgs.pricing_type,
          type: "string",
          default: "free",
        },
        description: {
          value: rawArgs.description,
          type: "string",
          default: "",
        },
        tags: { value: rawArgs.tags, type: "array", default: [] },
        allow_comments: {
          value: rawArgs.allow_comments,
          type: "boolean",
          default: true,
        },
        collaborators: {
          value: rawArgs.collaborators,
          type: "array",
          default: [],
        },
      });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const ivsClient = getIvsClient();

      // ✅ Step 2: Create Channel
      const channelRes = await ivsClient.send(
        new CreateChannelCommand({
          name: `channel-${params.creator_user_id}-${Date.now()}`,
          latencyMode: "LOW",
          type: "STANDARD",
        })
      );
      const awsChannel = channelRes.channel;

      // ✅ Step 3: Clean old keys
      const existingKeys = await ivsClient.send(
        new ListStreamKeysCommand({ channelArn: awsChannel.arn })
      );
      for (const key of existingKeys.streamKeys || []) {
        await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
      }

      // ✅ Step 4: Create Stream Key
      const keyRes = await ivsClient.send(
        new CreateStreamKeyCommand({ channelArn: awsChannel.arn })
      );
      const streamKey = keyRes.streamKey;

      // ✅ Step 5: Store channel in DB
      await ScyllaDb.putItem(CHANNELS_TABLE, {
        id: params.creator_user_id,
        name: awsChannel.name,
        description: params.description,
        profile_thumbnail: "",
        tags: params.tags,
        language: "",
        category: "",
        followers: 0,
        aws_channel_arn: awsChannel.arn,
        playback_url: awsChannel.playbackUrl,
        created_at: now,
        updated_at: now,
      });

      // ✅ Step 6: Store stream in DB
      const item = {
        id,
        channel_id: awsChannel.arn,
        creator_user_id: params.creator_user_id,
        title: params.title,
        description: params.description,
        access_type: params.access_type,
        is_private: params.is_private,
        pricing_type: params.pricing_type,
        allow_comments: params.allow_comments,
        collaborators: params.collaborators,
        tags: params.tags,
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
        creator_user_id: params.creator_user_id,
        channel_id: awsChannel.arn,
      });

      return {
        ...item,
        ingest_endpoint: awsChannel.ingestEndpoint,
        playback_url: awsChannel.playbackUrl,
      };
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "createStream" });
      // Optional: still throw to bubble up or return false/null
      // throw err;
      return null;
    }
  }

  static async getChannelMeta(channel_id) {
    return await ScyllaDb.getItem(CHANNELS_TABLE, { id: channel_id });
  }
  static async updateChannel(channel_id, updates) {
    updates.updated_at = new Date().toISOString();
    const fullItem = { id: channel_id, ...updates };
    return await ScyllaDb.putItem(CHANNELS_TABLE, fullItem);
  }
  // static async listChannelStreams(channel_id) {
  //   return await ScyllaDb.query(STREAMS_TABLE, "channel_id = :cid", {
  //     ":cid": channel_id,
  //   });
  // }

  static async listChannelStreams(channel_id) {
    const allStreams = await ScyllaDb.scan("IVSStreams"); // ⚠️ Scans all items
    return allStreams.filter((stream) => stream.channel_id === channel_id);
  }

  static async deleteChannel(channelArn) {
    try {
      const ivsClient = getIvsClient();
      await ivsClient.send(new DeleteChannelCommand({ arn: channelArn }));
      logEvent("deleteChannel", { channelArn });
      return true;
    } catch (err) {
      logError(err, { channelArn });
      return false;
    }
  }
  // ✅ listAllChannels()

  static async listAllChannels() {
    const ivsClient = getIvsClient();
    let nextToken = null;
    const allChannels = [];

    try {
      do {
        const res = await ivsClient.send(
          new ListChannelsCommand({
            nextToken,
            maxResults: 100,
          })
        );
        allChannels.push(...res.channels);
        nextToken = res.nextToken;
      } while (nextToken);
      return allChannels;
    } catch (err) {
      logError(err);
      return [];
    }
  }
  //   ✅ countAllChannels()

  static async countAllChannels() {
    const channels = await this.listAllChannels();
    return channels.length;
  }

  //   ✅ channelExists(channelArn)
  //   js;
  //   Copy;
  //   Edit;
  static async channelExists(channelArn) {
    try {
      const ivsClient = getIvsClient();
      await ivsClient.send(new GetChannelCommand({ arn: channelArn }));
      return true;
    } catch (err) {
      if (err.name === "ResourceNotFoundException") return false;
      logError(err, { channelArn });
      return false;
    }
  }

  //   ✅ validateChannel(channelArn)
  //   Optionally include logic to verify that the channel matches certain expected properties (like latency mode or type).

  //   js;
  //   Copy;
  //   Edit;
  static async validateChannel(channelArn) {
    try {
      const ivsClient = getIvsClient();
      const res = await ivsClient.send(
        new GetChannelCommand({ arn: channelArn })
      );
      const channel = res.channel;

      // Example check
      if (!channel || !channel.playbackUrl || !channel.ingestEndpoint) {
        return { valid: false, reason: "Missing playback or ingest info" };
      }

      return { valid: true, channel };
    } catch (err) {
      if (err.name === "ResourceNotFoundException") {
        return { valid: false, reason: "Channel does not exist" };
      }
      logError(err, { channelArn });
      return { valid: false, reason: "Unexpected error" };
    }
  }
}

module.exports = IVSService;
