// ivsClient.js
const { IvsClient } = require("@aws-sdk/client-ivs");
const ErrorHandler = require("../utils/ErrorHandler");
const Logger = require("../utils/UtilityLogger");

let cachedClient = null;

function getIvsClient() {
  if (cachedClient) {
    return cachedClient;
  }

  try {
    cachedClient = new IvsClient({
      region: process.env.AWS_REGION || "us-west-2",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID_IVS,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_IVS,
      },
    });

    Logger.writeLog({
      flag: "IVS_CLIENT_INIT",
      action: "initClient",
      data: { region: process.env.AWS_REGION || "us-west-2" },
      message: "Initialized IVS client",
    }); // :contentReference[oaicite:0]{index=0}

    return cachedClient;
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "getIvsClient" }); // :contentReference[oaicite:1]{index=1}
    Logger.writeLog({
      flag: "IVS_CLIENT_ERROR",
      action: "initClient",
      data: { error: err.message },
      critical: true,
      message: "Failed to initialize IVS client",
    }); // :contentReference[oaicite:2]{index=2}
    throw err;
  }
}

module.exports = getIvsClient;

// ivs.js
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

// StreamManager.js
import crypto from "crypto";
import ScyllaDb from "../ScyllaDb.js";
import Redis from "ioredis";
import IVSService from "./ivs.js";
import SafeUtils from "../utils/SafeUtils.js";
import ErrorHandler from "../utils/ErrorHandler.js";
import Logger from "../utils/UtilityLogger.js";

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = "IVSStreams";
const CHANNELS_TABLE = "IVSChannels";
const STATS_TABLE = "IVSStats";
const JOIN_LOGS_TABLE = "IVSJoinLogs";

export default class StreamManager {
  static async createStream(rawArgs) {
    try {
      const params = SafeUtils.sanitizeValidate({
        creator_user_id: {
          value: rawArgs.creator_user_id,
          type: "string",
          required: true,
        },
        channel_id: {
          value: rawArgs.channel_id,
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
      const item = {
        id,
        channel_id: params.channel_id,
        creator_user_id: params.creator_user_id,
        title: params.title,
        access_type: params.access_type,
        is_private: params.is_private,
        pricing_type: params.pricing_type,
        description: params.description,
        tags: params.tags,
        allow_comments: params.allow_comments,
        collaborators: params.collaborators,
        status: "offline",
        created_at: now,
        updated_at: now,
      };

      await ScyllaDb.putItem(STREAMS_TABLE, item);

      Logger.writeLog({
        flag: "STREAM_CREATE",
        action: "createStream",
        data: { stream_id: id, channel_id: params.channel_id },
        message: `Stream ${id} created`,
      });

      return item;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "createStream" });
      Logger.writeLog({
        flag: "STREAM_CREATE_ERROR",
        action: "createStream",
        data: { error: err.message },
        critical: true,
        message: "Failed to create stream",
      });
      return null;
    }
  }

  static async updateStream(rawStreamId, rawUpdates) {
    try {
      const { stream_id, updates } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
        updates: { value: rawUpdates, type: "object", required: true },
      });

      updates.updated_at = new Date().toISOString();
      const updatedItem = { id: stream_id, ...updates };
      await ScyllaDb.putItem(STREAMS_TABLE, updatedItem);

      Logger.writeLog({
        flag: "STREAM_UPDATE",
        action: "updateStream",
        data: { stream_id, updates },
        message: `Updated stream ${stream_id}`,
      });

      return updatedItem;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "updateStream",
        stream_id: rawStreamId,
      });
      Logger.writeLog({
        flag: "STREAM_UPDATE_ERROR",
        action: "updateStream",
        data: { error: err.message, stream_id: rawStreamId },
        critical: true,
        message: `Failed to update stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async joinStream(rawStreamId, rawUserId, rawRole = "viewer") {
    try {
      const { stream_id, user_id, role } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
        user_id: { value: rawUserId, type: "string", required: true },
        role: { value: rawRole, type: "string", required: true },
      });

      const entry = {
        id: crypto.randomUUID(),
        stream_id,
        user_id,
        joined_at: new Date().toISOString(),
        role,
      };
      await ScyllaDb.putItem(JOIN_LOGS_TABLE, entry);

      if (redis) {
        await redis.sadd(`stream:${stream_id}:active`, user_id);
        await redis.sadd("active_streams", stream_id);
      }

      Logger.writeLog({
        flag: "STREAM_JOIN",
        action: "joinStream",
        data: entry,
        message: `User ${user_id} joined stream ${stream_id}`,
      });

      return entry;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "joinStream",
        stream_id: rawStreamId,
        user_id: rawUserId,
      });
      Logger.writeLog({
        flag: "STREAM_JOIN_ERROR",
        action: "joinStream",
        data: {
          error: err.message,
          stream_id: rawStreamId,
          user_id: rawUserId,
        },
        critical: true,
        message: `Failed to join stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async leaveStream(rawStreamId, rawUserId) {
    try {
      const { stream_id, user_id } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
        user_id: { value: rawUserId, type: "string", required: true },
      });

      if (redis) {
        await redis.srem(`stream:${stream_id}:active`, user_id);
        // Optionally remove from global set if empty
      }

      const logs = await ScyllaDb.scan(JOIN_LOGS_TABLE, {
        FilterExpression: "stream_id = :s and user_id = :u",
        ExpressionAttributeValues: { ":s": stream_id, ":u": user_id },
      });
      if (logs.length > 0) {
        const log = logs[0];
        await ScyllaDb.updateItem(
          JOIN_LOGS_TABLE,
          { id: log.id },
          { left_at: new Date().toISOString() }
        );
      }

      Logger.writeLog({
        flag: "STREAM_LEAVE",
        action: "leaveStream",
        data: { stream_id, user_id },
        message: `User ${user_id} left stream ${stream_id}`,
      });

      return true;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "leaveStream",
        stream_id: rawStreamId,
        user_id: rawUserId,
      });
      Logger.writeLog({
        flag: "STREAM_LEAVE_ERROR",
        action: "leaveStream",
        data: {
          error: err.message,
          stream_id: rawStreamId,
          user_id: rawUserId,
        },
        critical: true,
        message: `Failed to leave stream ${rawStreamId}`,
      });
      return false;
    }
  }

  static async incrementLike(rawStreamId) {
    try {
      const { stream_id } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
      });

      const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });
      const likes = (stats?.likes || 0) + 1;
      await ScyllaDb.updateItem(STATS_TABLE, { stream_id }, { likes });

      Logger.writeLog({
        flag: "STREAM_LIKE",
        action: "incrementLike",
        data: { stream_id, likes },
        message: `Incremented like for stream ${stream_id}`,
      });

      return likes;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "incrementLike",
        stream_id: rawStreamId,
      });
      Logger.writeLog({
        flag: "STREAM_LIKE_ERROR",
        action: "incrementLike",
        data: { error: err.message, stream_id: rawStreamId },
        critical: true,
        message: `Failed to increment like for stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async registerTip(
    rawStreamId,
    rawUserId,
    rawAmount,
    rawMessage = "",
    rawGiftId = null
  ) {
    try {
      const { stream_id, user_id, amount, message, gift_id } =
        SafeUtils.sanitizeValidate({
          stream_id: { value: rawStreamId, type: "string", required: true },
          user_id: { value: rawUserId, type: "string", required: true },
          amount: { value: rawAmount, type: "number", required: true },
          message: { value: rawMessage, type: "string", default: "" },
          gift_id: { value: rawGiftId, type: "string", default: null },
        });

      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
      if (!stream) throw new Error(`Stream not found: ${stream_id}`);

      stream.tips = stream.tips || [];
      const newTip = {
        user_id,
        amount,
        message,
        gift_id,
        timestamp: new Date().toISOString(),
      };
      stream.tips.push(newTip);
      await ScyllaDb.updateItem(
        STREAMS_TABLE,
        { id: stream_id },
        { tips: stream.tips }
      );

      // Update aggregate stats
      const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });
      const totalTips = (stats?.tips_total || 0) + amount;
      await ScyllaDb.updateItem(
        STATS_TABLE,
        { stream_id },
        { tips_total: totalTips, updated_at: new Date().toISOString() }
      );
      await this.updateTipBoard(stream_id, user_id, amount);

      Logger.writeLog({
        flag: "STREAM_TIP",
        action: "registerTip",
        data: { stream_id, user_id, amount },
        message: `Registered tip for stream ${stream_id}`,
      });

      return newTip;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "registerTip",
        stream_id: rawStreamId,
        user_id: rawUserId,
      });
      Logger.writeLog({
        flag: "STREAM_TIP_ERROR",
        action: "registerTip",
        data: {
          error: err.message,
          stream_id: rawStreamId,
          user_id: rawUserId,
        },
        critical: true,
        message: `Failed to register tip for stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async updateTipBoard(rawStreamId, rawUserId, rawAmount) {
    try {
      const { stream_id, user_id, amount } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
        user_id: { value: rawUserId, type: "string", required: true },
        amount: { value: rawAmount, type: "number", required: true },
      });

      const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });
      stats.tip_board = stats.tip_board || [];
      const entry = stats.tip_board.find((x) => x.user_id === user_id);
      if (entry) {
        entry.total += amount;
      } else {
        stats.tip_board.push({ user_id, total: amount });
      }

      await ScyllaDb.updateItem(
        STATS_TABLE,
        { stream_id },
        { tip_board: stats.tip_board }
      );

      Logger.writeLog({
        flag: "STREAM_TIP_BOARD_UPDATE",
        action: "updateTipBoard",
        data: { stream_id, user_id, amount },
        message: `Updated tip board for stream ${stream_id}`,
      });

      return stats.tip_board;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "updateTipBoard",
        stream_id: rawStreamId,
        user_id: rawUserId,
      });
      Logger.writeLog({
        flag: "STREAM_TIP_BOARD_UPDATE_ERROR",
        action: "updateTipBoard",
        data: {
          error: err.message,
          stream_id: rawStreamId,
          user_id: rawUserId,
        },
        critical: true,
        message: `Failed to update tip board for stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async logToyAction(rawStreamId, rawToyData) {
    try {
      const { stream_id, toyData } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
        toyData: { value: rawToyData, type: "object", required: true },
      });

      const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });
      stats.toys_log = stats.toys_log || [];
      stats.toys_log.push({ ...toyData, timestamp: new Date().toISOString() });
      await ScyllaDb.updateItem(
        STATS_TABLE,
        { stream_id },
        { toys_log: stats.toys_log }
      );

      Logger.writeLog({
        flag: "STREAM_TOY_LOG",
        action: "logToyAction",
        data: { stream_id, toyData },
        message: `Logged toy action for stream ${stream_id}`,
      });

      return stats.toys_log;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "logToyAction",
        stream_id: rawStreamId,
      });
      Logger.writeLog({
        flag: "STREAM_TOY_LOG_ERROR",
        action: "logToyAction",
        data: { error: err.message, stream_id: rawStreamId },
        critical: true,
        message: `Failed to log toy action for stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async getStats(rawStreamId) {
    try {
      const { stream_id } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
      });
      const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });

      Logger.writeLog({
        flag: "STREAM_GET_STATS",
        action: "getStats",
        data: { stream_id },
        message: `Fetched stats for stream ${stream_id}`,
      });

      return stats;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "getStats",
        stream_id: rawStreamId,
      });
      Logger.writeLog({
        flag: "STREAM_GET_STATS_ERROR",
        action: "getStats",
        data: { error: err.message, stream_id: rawStreamId },
        critical: true,
        message: `Failed to fetch stats for stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async getTipLeaderboard(rawStreamId) {
    try {
      const { stream_id } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
      });
      const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });
      const board = (stats?.tip_board || []).sort((a, b) => b.total - a.total);

      Logger.writeLog({
        flag: "STREAM_TIP_LEADERBOARD",
        action: "getTipLeaderboard",
        data: { stream_id },
        message: `Fetched tip leaderboard for stream ${stream_id}`,
      });

      return board;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "getTipLeaderboard",
        stream_id: rawStreamId,
      });
      Logger.writeLog({
        flag: "STREAM_TIP_LEADERBOARD_ERROR",
        action: "getTipLeaderboard",
        data: { error: err.message, stream_id: rawStreamId },
        critical: true,
        message: `Failed to fetch tip leaderboard for stream ${rawStreamId}`,
      });
      return [];
    }
  }

  static async setGoalProgress(rawStreamId, rawGoalId, rawAmount) {
    try {
      const { stream_id, goal_id, amount } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
        goal_id: { value: rawGoalId, type: "string", required: true },
        amount: { value: rawAmount, type: "number", required: true },
      });

      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
      stream.goals = (stream.goals || []).map((goal) =>
        goal.id === goal_id
          ? { ...goal, progress: (goal.progress || 0) + amount }
          : goal
      );
      await ScyllaDb.updateItem(
        STREAMS_TABLE,
        { id: stream_id },
        { goals: stream.goals }
      );

      Logger.writeLog({
        flag: "STREAM_GOAL_PROGRESS",
        action: "setGoalProgress",
        data: { stream_id, goal_id, amount },
        message: `Set goal progress for stream ${stream_id}`,
      });

      return stream.goals;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "setGoalProgress",
        stream_id: rawStreamId,
        goal_id: rawGoalId,
      });
      Logger.writeLog({
        flag: "STREAM_GOAL_PROGRESS_ERROR",
        action: "setGoalProgress",
        data: {
          error: err.message,
          stream_id: rawStreamId,
          goal_id: rawGoalId,
        },
        critical: true,
        message: `Failed to set goal progress for stream ${rawStreamId}`,
      });
      return null;
    }
  }

  static async listCollaborators(rawStreamId) {
    try {
      const { stream_id } = SafeUtils.sanitizeValidate({
        stream_id: { value: rawStreamId, type: "string", required: true },
      });
      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
      const collaborators = stream.collaborators || [];

      Logger.writeLog({
        flag: "STREAM_LIST_COLLABORATORS",
        action: "listCollaborators",
        data: { stream_id },
        message: `Listed collaborators for stream ${stream_id}`,
      });

      return collaborators;
    } catch (err) {
      ErrorHandler.add_error(err.message, {
        method: "listCollaborators",
        stream_id: rawStreamId,
      });
      Logger.writeLog({
        flag: "STREAM_LIST_COLLABORATORS_ERROR",
        action: "listCollaborators",
        data: { error: err.message, stream_id: rawStreamId },
        critical: true,
        message: `Failed to list collaborators for stream ${rawStreamId}`,
      });
      return [];
    }
  }
}
