import { createClient } from "redis";

class RedisWrapper {
  constructor() {
    this.client = null;
    this.memoryCache = new Map();
    this.isConnected = false;
    this.useMemoryFallback = true;
  }

  async connect() {
    try {
      if (process.env.REDIS_URL) {
        this.client = createClient({
          url: process.env.REDIS_URL,
        });

        this.client.on("error", (err) => {
          console.warn("Redis Client Error:", err);
          this.isConnected = false;
        });

        this.client.on("connect", () => {
          console.log("Redis connected successfully");
          this.isConnected = true;
        });

        await this.client.connect();
        this.useMemoryFallback = false;
      } else {
        console.log("No REDIS_URL provided, using in-memory cache");
        this.useMemoryFallback = true;
      }
    } catch (error) {
      console.warn(
        "Failed to connect to Redis, falling back to memory cache:",
        error.message
      );
      this.useMemoryFallback = true;
      this.isConnected = false;
    }
  }

  async get(key) {
    try {
      if (this.useMemoryFallback || !this.isConnected) {
        return this.memoryCache.get(key) || null;
      }
      return await this.client.get(key);
    } catch (error) {
      console.warn("Redis GET error, using memory fallback:", error.message);
      return this.memoryCache.get(key) || null;
    }
  }

  async set(key, value, mode = null, duration = null) {
    try {
      if (this.useMemoryFallback || !this.isConnected) {
        this.memoryCache.set(key, value);
        if (mode === "EX" && duration) {
          setTimeout(() => {
            this.memoryCache.delete(key);
          }, duration * 1000);
        }
        return "OK";
      }

      if (mode === "EX" && duration) {
        return await this.client.setEx(key, duration, value);
      }
      return await this.client.set(key, value);
    } catch (error) {
      console.warn("Redis SET error, using memory fallback:", error.message);
      this.memoryCache.set(key, value);
      return "OK";
    }
  }

  async del(key) {
    try {
      if (this.useMemoryFallback || !this.isConnected) {
        const existed = this.memoryCache.has(key);
        this.memoryCache.delete(key);
        return existed ? 1 : 0;
      }
      return await this.client.del(key);
    } catch (error) {
      console.warn("Redis DEL error, using memory fallback:", error.message);
      const existed = this.memoryCache.has(key);
      this.memoryCache.delete(key);
      return existed ? 1 : 0;
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.disconnect();
      }
      this.memoryCache.clear();
    } catch (error) {
      console.warn("Error disconnecting Redis:", error.message);
    }
  }

  // Helper method to clear memory cache if needed
  clearMemoryCache() {
    this.memoryCache.clear();
  }

  // Get cache stats
  getCacheStats() {
    return {
      isRedisConnected: this.isConnected,
      useMemoryFallback: this.useMemoryFallback,
      memoryCacheSize: this.memoryCache.size,
      redisUrl: process.env.REDIS_URL ? "configured" : "not configured",
    };
  }
}

// Create and export a singleton instance
const redisWrapper = new RedisWrapper();

// Auto-connect on import
redisWrapper.connect().catch((err) => {
  console.warn("Initial Redis connection failed:", err.message);
});

export default redisWrapper;
