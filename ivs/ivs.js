const {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteStreamKeyCommand,
  ListStreamKeysCommand,
  DeleteChannelCommand,
  ListChannelsCommand,
  GetChannelCommand,
} = require("@aws-sdk/client-ivs");
const crypto = require("crypto");
const getIvsClient = require("./ivsClient");
const SafeUtils = require("../utils/SafeUtils");
const ErrorHandler = require("../utils/ErrorHandler");
const Logger = require("../utils/UtilityLogger");
const ScyllaDb = require("../ScyllaDb");

const STREAMS_TABLE = "IVSStreams";
const CHANNELS_TABLE = "IVSChannels";

class IVSService {
  static async createStream(rawArgs) {
    try {
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
      }); // :contentReference[oaicite:3]{index=3}

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const ivsClient = getIvsClient();

      // 1. Create IVS channel
      const { channel: awsChannel } = await ivsClient.send(
        new CreateChannelCommand({
          name: `channel-${params.creator_user_id}-${Date.now()}`,
          latencyMode: "LOW",
          type: "STANDARD",
        })
      );

      // 2. Delete old stream keys
      const { streamKeys = [] } = await ivsClient.send(
        new ListStreamKeysCommand({ channelArn: awsChannel.arn })
      );
      for (const key of streamKeys) {
        await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
      }

      // 3. Create new stream key
      const { streamKey } = await ivsClient.send(
        new CreateStreamKeyCommand({ channelArn: awsChannel.arn })
      );

      // 4. Persist channel metadata
      await ScyllaDb.putItem(CHANNELS_TABLE, {
        id: params.creator_user_id,
        aws_channel_arn: awsChannel.arn,
        name: awsChannel.name,
        playback_url: awsChannel.playbackUrl,
        description: params.description,
        tags: params.tags,
        created_at: now,
        updated_at: now,
      });

      // 5. Persist stream record
      const record = {
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
        status: "offline",
        stream_key: streamKey.value,
        created_at: now,
        updated_at: now,
      };
      await ScyllaDb.putItem(STREAMS_TABLE, record);

      Logger.writeLog({
        flag: "IVS_CREATE_STREAM",
        action: "createStream",
        data: { stream_id: id, channel_arn: awsChannel.arn },
        message: `IVS stream ${id} created`,
      }); // :contentReference[oaicite:4]{index=4}

      return {
        ...record,
        ingest_endpoint: awsChannel.ingestEndpoint,
        playback_url: awsChannel.playbackUrl,
      };
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "createStream" }); // :contentReference[oaicite:5]{index=5}
      Logger.writeLog({
        flag: "IVS_CREATE_ERROR",
        action: "createStream",
        data: { error: err.message },
        critical: true,
        message: "Failed to create IVS stream",
      }); // :contentReference[oaicite:6]{index=6}
      return null;
    }
  }

  static async getChannelMeta(channel_id) {
    try {
      const { channel_id: validChannelId } = SafeUtils.sanitizeValidate({
        channel_id: { value: channel_id, type: "string", required: true },
      }); // :contentReference[oaicite:7]{index=7}

      return await ScyllaDb.getItem(CHANNELS_TABLE, { id: validChannelId });
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "getChannelMeta",
        channel_id,
      }); // :contentReference[oaicite:8]{index=8}
      Logger.writeLog({
        flag: "IVS_GET_CHANNEL_META_ERROR",
        action: "getChannelMeta",
        data: { error: err.message, channel_id },
        critical: true,
        message: "Failed to get channel metadata",
      }); // :contentReference[oaicite:9]{index=9}
      return null;
    }
  }

  static async updateChannel(channel_id, updates) {
    try {
      const { channel_id: validChannelId, updates: validUpdates } =
        SafeUtils.sanitizeValidate({
          channel_id: { value: channel_id, type: "string", required: true },
          updates: { value: updates, type: "object", required: true },
        }); // :contentReference[oaicite:10]{index=10}

      validUpdates.updated_at = new Date().toISOString();
      const fullItem = { id: validChannelId, ...validUpdates };
      await ScyllaDb.putItem(CHANNELS_TABLE, fullItem);

      Logger.writeLog({
        flag: "IVS_UPDATE_CHANNEL",
        action: "updateChannel",
        data: { channel_id: validChannelId },
        message: `Updated channel ${validChannelId}`,
      }); // :contentReference[oaicite:11]{index=11}

      return fullItem;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "updateChannel",
        channel_id,
      }); // :contentReference[oaicite:12]{index=12}
      Logger.writeLog({
        flag: "IVS_UPDATE_CHANNEL_ERROR",
        action: "updateChannel",
        data: { error: err.message, channel_id },
        critical: true,
        message: "Failed to update channel",
      }); // :contentReference[oaicite:13]{index=13}
      return null;
    }
  }

  static async listChannelStreams(channel_id) {
    try {
      const { channel_id: validChannelId } = SafeUtils.sanitizeValidate({
        channel_id: { value: channel_id, type: "string", required: true },
      }); // :contentReference[oaicite:14]{index=14}

      const allStreams = await ScyllaDb.scan(STREAMS_TABLE);
      return allStreams.filter((s) => s.channel_id === validChannelId);
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "listChannelStreams",
        channel_id,
      }); // :contentReference[oaicite:15]{index=15}
      Logger.writeLog({
        flag: "IVS_LIST_CHANNEL_STREAMS_ERROR",
        action: "listChannelStreams",
        data: { error: err.message, channel_id },
        message: "Failed to list channel streams",
      }); // :contentReference[oaicite:16]{index=16}
      return [];
    }
  }

  static async deleteChannel(channelArn) {
    try {
      const { channelArn: validArn } = SafeUtils.sanitizeValidate({
        channelArn: { value: channelArn, type: "string", required: true },
      }); // :contentReference[oaicite:17]{index=17}

      const ivsClient = getIvsClient();
      await ivsClient.send(new DeleteChannelCommand({ arn: validArn }));

      Logger.writeLog({
        flag: "IVS_DELETE_CHANNEL",
        action: "deleteChannel",
        data: { channelArn: validArn },
        message: `Deleted channel ${validArn}`,
      }); // :contentReference[oaicite:18]{index=18}

      return true;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "deleteChannel",
        channelArn,
      }); // :contentReference[oaicite:19]{index=19}
      Logger.writeLog({
        flag: "IVS_DELETE_ERROR",
        action: "deleteChannel",
        data: { error: err.message, channelArn },
        critical: true,
        message: "Failed to delete IVS channel",
      }); // :contentReference[oaicite:20]{index=20}
      return false;
    }
  }

  static async listAllChannels() {
    const ivsClient = getIvsClient();
    let nextToken = null;
    const allChannels = [];

    try {
      do {
        const res = await ivsClient.send(
          new ListChannelsCommand({ nextToken, maxResults: 100 })
        );
        allChannels.push(...res.channels);
        nextToken = res.nextToken;
      } while (nextToken);
      return allChannels;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "listAllChannels" }); // :contentReference[oaicite:21]{index=21}
      Logger.writeLog({
        flag: "IVS_LIST_CHANNELS_ERROR",
        action: "listAllChannels",
        data: { error: err.message },
        critical: true,
        message: "Failed to list IVS channels",
      }); // :contentReference[oaicite:22]{index=22}
      return [];
    }
  }

  static async countAllChannels() {
    try {
      const channels = await this.listAllChannels();
      return channels.length;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "countAllChannels" }); // :contentReference[oaicite:23]{index=23}
      Logger.writeLog({
        flag: "IVS_COUNT_CHANNELS_ERROR",
        action: "countAllChannels",
        data: { error: err.message },
        critical: true,
        message: "Failed to count IVS channels",
      }); // :contentReference[oaicite:24]{index=24}
      return 0;
    }
  }

  static async channelExists(channelArn) {
    try {
      const { channelArn: validArn } = SafeUtils.sanitizeValidate({
        channelArn: { value: channelArn, type: "string", required: true },
      }); // :contentReference[oaicite:25]{index=25}

      const ivsClient = getIvsClient();
      await ivsClient.send(new GetChannelCommand({ arn: validArn }));
      return true;
    } catch (err) {
      if (err.name === "ResourceNotFoundException") return false;
      ErrorHandler.add_error(err.message, {
        method: "channelExists",
        channelArn,
      }); // :contentReference[oaicite:26]{index=26}
      Logger.writeLog({
        flag: "IVS_CHANNEL_EXISTS_ERROR",
        action: "channelExists",
        data: { error: err.message, channelArn },
        message: "Error checking channel existence",
      }); // :contentReference[oaicite:27]{index=27}
      return false;
    }
  }

  static async validateChannel(channelArn) {
    try {
      const { channelArn: validArn } = SafeUtils.sanitizeValidate({
        channelArn: { value: channelArn, type: "string", required: true },
      }); // :contentReference[oaicite:28]{index=28}

      const ivsClient = getIvsClient();
      const { channel } = await ivsClient.send(
        new GetChannelCommand({ arn: validArn })
      );

      if (!channel || !channel.playbackUrl || !channel.ingestEndpoint) {
        return { valid: false, reason: "Missing playback or ingest info" };
      }
      return { valid: true, channel };
    } catch (err) {
      if (err.name === "ResourceNotFoundException") {
        return { valid: false, reason: "Channel does not exist" };
      }
      ErrorHandler.add_error(err.message, {
        method: "validateChannel",
        channelArn,
      }); // :contentReference[oaicite:29]{index=29}
      Logger.writeLog({
        flag: "IVS_VALIDATE_CHANNEL_ERROR",
        action: "validateChannel",
        data: { error: err.message, channelArn },
        critical: true,
        message: "Error validating channel",
      }); // :contentReference[oaicite:30]{index=30}
      return { valid: false, reason: "Unexpected error" };
    }
  }
}

module.exports = IVSService;
