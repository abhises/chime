const crypto = require("crypto");
const ScyllaDb = require("../ScyllaDb.js");
const Redis = require("ioredis");
const SafeUtils = require("../utils/SafeUtils.js");
const ErrorHandler = require("../utils/ErrorHandler.js");
const Logger = require("../utils/UtilityLogger.js");

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = "IVSStreams";
const CHANNELS_TABLE = "IVSChannels";
const STATS_TABLE = "IVSStats";
const JOIN_LOGS_TABLE = "IVSJoinLogs";

class StreamManager {
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

  static async getSessionType(stream_id) {
    try {
      Logger.writeLog({
        flag: "GET_SESSION_TYPE",
        action: "getSessionType",
        data: { stream_id },
        message: `Fetching session type for stream ${stream_id}`,
      });

      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });

      if (!stream) {
        throw new Error(`Stream with id "${stream_id}" not found`);
      }

      return stream.access_type;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "getSessionType" });

      Logger.writeLog({
        flag: "GET_SESSION_TYPE_ERROR",
        action: "getSessionType",
        data: { stream_id, error: err.message },
        critical: true,
        message: `Failed to get session type for stream ${stream_id}`,
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
  static async addAnnouncement(stream_id, title, body) {
    try {
      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });

      if (!stream) {
        throw new Error(`Stream with id "${stream_id}" not found`);
      }

      stream.announcements = stream.announcements || [];
      stream.announcements.push({
        title,
        body,
        timestamp: new Date().toISOString(),
      });

      await ScyllaDb.updateItem(
        STREAMS_TABLE,
        { id: stream_id },
        { announcements: stream.announcements }
      );

      Logger.writeLog({
        flag: "ADD_ANNOUNCEMENT",
        action: "addAnnouncement",
        data: { stream_id, title },
        message: `Announcement added to stream ${stream_id}`,
      });
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "addAnnouncement" });
      Logger.writeLog({
        flag: "ADD_ANNOUNCEMENT_ERROR",
        action: "addAnnouncement",
        data: { stream_id, title, error: err.message },
        critical: true,
        message: `Failed to add announcement to stream ${stream_id}`,
      });
    }
  }
  static async validateUserAccess(stream_id, user_id) {
    try {
      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });

      if (!stream) {
        throw new Error(`Stream with id "${stream_id}" not found`);
      }

      if (typeof stream.access_type !== "string") {
        throw new Error(`Invalid stream.access_type for stream "${stream_id}"`);
      }

      const accessGranted = stream.access_type.includes("open");

      Logger.writeLog({
        flag: "VALIDATE_USER_ACCESS",
        action: "validateUserAccess",
        data: { stream_id, user_id, access: accessGranted },
        message: `User ${user_id} access validated for stream ${stream_id}`,
      });

      return accessGranted;
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "validateUserAccess" });
      Logger.writeLog({
        flag: "VALIDATE_USER_ACCESS_ERROR",
        action: "validateUserAccess",
        data: { stream_id, user_id, error: err.message },
        critical: true,
        message: `Failed to validate user access for stream ${stream_id}`,
      });
      return false;
    }
  }

  static async setTrailer(stream_id, trailer_url) {
    try {
      await ScyllaDb.updateItem(
        STREAMS_TABLE,
        { id: stream_id },
        { trailer_url }
      );

      Logger.writeLog({
        flag: "SET_TRAILER",
        action: "setTrailer",
        data: { stream_id, trailer_url },
        message: `Trailer URL updated for stream ${stream_id}`,
      });
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "setTrailer" });
      Logger.writeLog({
        flag: "SET_TRAILER_ERROR",
        action: "setTrailer",
        data: { stream_id, error: err.message },
        critical: true,
        message: `Failed to update trailer for stream ${stream_id}`,
      });
    }
  }
  static async setThumbnail(stream_id, thumbnail_url) {
    try {
      await ScyllaDb.updateItem(
        STREAMS_TABLE,
        { id: stream_id },
        { thumbnail_url }
      );

      Logger.writeLog({
        flag: "SET_THUMBNAIL",
        action: "setThumbnail",
        data: { stream_id, thumbnail_url },
        message: `Thumbnail URL updated for stream ${stream_id}`,
      });
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "setThumbnail" });
      Logger.writeLog({
        flag: "SET_THUMBNAIL_ERROR",
        action: "setThumbnail",
        data: { stream_id, error: err.message },
        critical: true,
        message: `Failed to update thumbnail for stream ${stream_id}`,
      });
    }
  }
  static async addCollaborator(stream_id, user_id) {
    try {
      const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });

      if (!stream) {
        throw new Error(`Stream with id "${stream_id}" not found`);
      }

      stream.collaborators = stream.collaborators || [];

      if (!stream.collaborators.includes(user_id)) {
        stream.collaborators.push(user_id);

        await ScyllaDb.updateItem(
          STREAMS_TABLE,
          { id: stream_id },
          { collaborators: stream.collaborators }
        );

        Logger.writeLog({
          flag: "ADD_COLLABORATOR",
          action: "addCollaborator",
          data: { stream_id, user_id },
          message: `Collaborator ${user_id} added to stream ${stream_id}`,
        });
      } else {
        Logger.writeLog({
          flag: "ADD_COLLABORATOR_SKIPPED",
          action: "addCollaborator",
          data: { stream_id, user_id },
          message: `Collaborator ${user_id} already exists in stream ${stream_id}`,
        });
      }
    } catch (err) {
      ErrorHandler.add_error(err.message, { method: "addCollaborator" });
      Logger.writeLog({
        flag: "ADD_COLLABORATOR_ERROR",
        action: "addCollaborator",
        data: { stream_id, user_id, error: err.message },
        critical: true,
        message: `Failed to add collaborator to stream ${stream_id}`,
      });
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

module.exports = StreamManager;
