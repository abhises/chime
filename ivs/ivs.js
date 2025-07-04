// IVSService.js
import {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteStreamKeyCommand, // ✅
  ListStreamKeysCommand, // ✅
  DeleteChannelCommand,
  ListChannelsCommand,
  GetChannelCommand,
} from "@aws-sdk/client-ivs";
import getIvsClient from "./ivsClient.js"; // ✅ This correctly imports the default
import logEvent from "../utils/logEvent.js";
import logError from "../utils/logError.js";
import ScyllaDb from "../ScyllaDb.js";

const STREAMS_TABLE = "IVSStreams";
const JOIN_LOGS_TABLE = "IVSJoinLogs";
const STATS_TABLE = "IVSStats";
const CHANNELS_TABLE = "IVSChannels";

export default class IVSService {
  static async createStream({
    creator_user_id,
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

    let awsChannel, streamKey;

    try {
      const ivsClient = getIvsClient();

      const channelRes = await ivsClient.send(
        new CreateChannelCommand({
          name: `channel-${creator_user_id}-${Date.now()}`,
          latencyMode: "LOW",
          type: "STANDARD",
        })
      );
      console.log("channel id ", channelRes.channel.arn);
      awsChannel = channelRes.channel;
      const existingKeys = await ivsClient.send(
        new ListStreamKeysCommand({ channelArn: awsChannel.arn })
      );
      for (const key of existingKeys.streamKeys || []) {
        await ivsClient.send(new DeleteStreamKeyCommand({ arn: key.arn }));
      }

      const keyRes = await ivsClient.send(
        new CreateStreamKeyCommand({
          channelArn: awsChannel.arn,
        })
      );
      streamKey = keyRes.streamKey;

      await ScyllaDb.putItem(CHANNELS_TABLE, {
        id: creator_user_id,
        name: awsChannel.name,
        description,
        profile_thumbnail: "",
        tags,
        language: "",
        category: "",
        followers: 0,
        aws_channel_arn: awsChannel.arn,
        playback_url: awsChannel.playbackUrl,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      logError(err, { creator_user_id });
      throw new Error("Failed to create IVS channel or stream key");
    }

    const item = {
      id,
      channel_id: awsChannel.arn,
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
      stream_key: streamKey.value,
    };

    await ScyllaDb.putItem(STREAMS_TABLE, item);
    logEvent("createStream", {
      stream_id: id,
      creator_user_id,
      channel_id: awsChannel.arn,
    });

    return {
      ...item,
      ingest_endpoint: awsChannel.ingestEndpoint,
      playback_url: awsChannel.playbackUrl,
    };
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
