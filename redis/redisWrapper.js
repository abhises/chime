// redisWrapper.mjs
import { createClient } from "redis";

class RedisWrapper {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.init();
  }

  async init() {
    try {
      if (process.env.REDIS_URL) {
        this.client = createClient({
          url: process.env.REDIS_URL,
        });

        this.client.on("error", (err) => {
          console.log("Redis Client Error", err);
          this.isConnected = false;
        });

        this.client.on("connect", () => {
          console.log("Redis connected");
          this.isConnected = true;
        });

        await this.client.connect();
      } else {
        console.log("No REDIS_URL provided, using in-memory cache fallback");
        this.cache = new Map();
      }
    } catch (error) {
      console.log(
        "Redis connection failed, using in-memory cache:",
        error.message
      );
      this.cache = new Map();
    }
  }

  async get(key) {
    try {
      if (this.client && this.isConnected) {
        return await this.client.get(key);
      } else {
        return this.cache?.get(key) || null;
      }
    } catch (error) {
      console.log("Redis get error:", error.message);
      return null;
    }
  }

  async set(key, value, mode = null, duration = null) {
    try {
      if (this.client && this.isConnected) {
        if (mode === "EX" && duration) {
          return await this.client.setEx(key, duration, value);
        } else {
          return await this.client.set(key, value);
        }
      } else {
        if (this.cache) {
          this.cache.set(key, value);
          if (mode === "EX" && duration) {
            setTimeout(() => {
              this.cache.delete(key);
            }, duration * 1000);
          }
        }
        return "OK";
      }
    } catch (error) {
      console.log("Redis set error:", error.message);
      return null;
    }
  }

  async del(key) {
    try {
      if (this.client && this.isConnected) {
        return await this.client.del(key);
      } else {
        if (this.cache) {
          return this.cache.delete(key) ? 1 : 0;
        }
        return 0;
      }
    } catch (error) {
      console.log("Redis del error:", error.message);
      return 0;
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.disconnect();
      }
    } catch (error) {
      console.log("Redis disconnect error:", error.message);
    }
  }
}

// Create singleton instance
const redisWrapper = new RedisWrapper();
export default redisWrapper;
