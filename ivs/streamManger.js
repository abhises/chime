// StreamManager.js
import crypto from "crypto";
import ScyllaDb from "../ScyllaDb.js";
import Redis from "ioredis";
import IVSService from "./ivs.js";
import logEvent from "../utils/logEvent.js";
import logError from "../utils/logError.js";

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const STREAMS_TABLE = "IVSStreams";
const CHANNELS_TABLE = "IVSChannels";
const STATS_TABLE = "IVSStats";
const JOIN_LOGS_TABLE = "IVSJoinLogs";

export default class StreamManager {
  static async createStream({
    creator_user_id,
    channel_id,
    title,
    access_type,
    is_private = false,
    pricing_type = "free",
    description = "",
    tags = [],
    allow_comments = true,
    collaborators = [],
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const item = {
      id,
      channel_id,
      creator_user_id,
      title,
      description,
      access_type,
      is_private,
      pricing_type,
      allow_comments,
      collaborators,
      tags,
      goals: [],
      games: [],
      gifts: [],
      tips: [],
      multi_cam_urls: [],
      announcements: [],
      status: "offline",
      created_at: now,
      updated_at: now,
    };

    await ScyllaDb.putItem(STREAMS_TABLE, item);
    logEvent("createStream", { stream_id: id });
    return item;
  }

  static async updateStream(stream_id, updates) {
    updates.updated_at = new Date().toISOString();
    // Overwrite the whole stream record
    const updatedItem = { id: stream_id, ...updates };
    await ScyllaDb.putItem(STREAMS_TABLE, updatedItem);
    logEvent("updateStream", { stream_id, updates });
    const verified = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
    console.log("🔍 Verified Stream:", verified);
  }

  static async joinStream(stream_id, user_id, role = "viewer") {
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
    logEvent("joinStream", entry);
  }

  static async leaveStream(stream_id, user_id) {
    if (redis) {
      await redis.srem(`stream:${stream_id}:active`, user_id);
      // Optionally remove from global set if empty
    }
    // Find the join-log entry
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
    logEvent("leaveStream", { stream_id, user_id });
  }

  static async incrementLike(stream_id) {
    // Atomic increment not supported; read-modify-write instead
    const stats = await ScyllaDb.getItem(STATS_TABLE, { id: stream_id });
    const likes = (stats?.likes || 0) + 1;
    await ScyllaDb.updateItem(STATS_TABLE, { id: stream_id }, { likes });
  }

  static async registerTip(
    stream_id,
    user_id,
    amount,
    message = "",
    gift_id = null
  ) {
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
    // console.log("return stream", stream);
    if (!stream) {
      throw new Error(`Stream not found: ${stream_id}`);
    }

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
    // console.log("show streamUpdate", streamUpdate);

    // ✅ Fix: Key should be { id: stream_id } instead of { stream_id }

    const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id: stream_id });

    const totalTips = (stats?.tips_total || 0) + amount;

    await ScyllaDb.updateItem(
      STATS_TABLE,
      { stream_id },
      {
        tips_total: totalTips,
        updated_at: new Date().toISOString(),
      }
    );
    const finalUpdate = await this.updateTipBoard(stream_id, user_id, amount);
    console.log("final upate", finalUpdate);

    logEvent("registerTip", { stream_id, user_id, amount });

    // ✅ Return something useful
    return newTip;
  }

  static async updateTipBoard(stream_id, user_id, amount) {
    const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id }); // ✅ FIXED KEY

    stats.tip_board = stats.tip_board || [];

    const userEntry = stats.tip_board.find((x) => x.user_id === user_id);
    if (userEntry) {
      userEntry.total += amount;
    } else {
      stats.tip_board.push({ user_id, total: amount });
    }

    stats.highest_tipper = stats.tip_board.sort(
      (a, b) => b.total - a.total
    )[0]?.user_id;

    await ScyllaDb.updateItem(
      STATS_TABLE,
      { stream_id }, // ✅ FIXED KEY
      {
        tip_board: stats.tip_board,
        highest_tipper: stats.highest_tipper,
      }
    );
  }

  static async getTipLeaderboard(stream_id) {
    const stats = await ScyllaDb.getItem(STATS_TABLE, { stream_id });
    return (stats.tip_board || []).sort((a, b) => b.total - a.total);
  }

  static async setGoalProgress(stream_id, goalId, amount) {
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
    stream.goals = (stream.goals || []).map((goal) =>
      goal.id === goalId
        ? { ...goal, progress: amount, achieved: amount >= goal.target }
        : goal
    );
    await ScyllaDb.updateItem(
      STREAMS_TABLE,
      { id: stream_id },
      { goals: stream.goals },
      { access_type: "open_public" }
    );
  }

  static async addAnnouncement(stream_id, title, body) {
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
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
  }

  static async validateUserAccess(stream_id, user_id) {
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });

    if (!stream) {
      throw new Error(`Stream with id "${stream_id}" not found`);
    }

    if (typeof stream.access_type !== "string") {
      throw new Error(`Invalid stream.access_type for stream "${stream_id}"`);
    }

    if (stream.access_type.includes("open")) {
      return true;
    }

    // otherwise check invite list, token unlock, subscription (future logic)
    return false;
  }

  static async logToyAction(stream_id, toyData) {
    const stats = await ScyllaDb.getItem(STATS_TABLE, { id: stream_id });
    stats.toys_log = stats.toys_log || [];
    stats.toys_log.push({ ...toyData, timestamp: new Date().toISOString() });
    await ScyllaDb.updateItem(
      STATS_TABLE,
      { id: stream_id },
      { toys_log: stats.toys_log }
    );
  }

  static async getStats(stream_id) {
    return await ScyllaDb.getItem(STATS_TABLE, { stream_id: stream_id });
  }

  static async getSessionType(stream_id) {
    console.log("stream_id inside getSessonType", stream_id);
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
    console.log("stream is", stream);

    return stream.access_type;
  }

  static async getActiveStreams() {
    const streamIds = redis ? await redis.smembers("active_streams") : [];
    return Promise.all(
      streamIds.map((id) => ScyllaDb.getItem(STREAMS_TABLE, { id }))
    );
  }

  static async setTrailer(stream_id, trailer_url) {
    await ScyllaDb.updateItem(
      STREAMS_TABLE,
      { id: stream_id },
      { trailer_url }
    );
  }

  static async setThumbnail(stream_id, thumbnail_url) {
    await ScyllaDb.updateItem(
      STREAMS_TABLE,
      { id: stream_id },
      { thumbnail_url }
    );
  }

  static async addCollaborator(stream_id, user_id) {
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
    stream.collaborators = stream.collaborators || [];
    if (!stream.collaborators.includes(user_id)) {
      stream.collaborators.push(user_id);
      await ScyllaDb.updateItem(
        STREAMS_TABLE,
        { id: stream_id },
        {
          collaborators: stream.collaborators,
        }
      );
    }
  }

  static async listCollaborators(stream_id) {
    const stream = await ScyllaDb.getItem(STREAMS_TABLE, { id: stream_id });
    return stream.collaborators || [];
  }
}
