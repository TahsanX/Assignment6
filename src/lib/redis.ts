import { Redis } from "@upstash/redis";
import { env } from "../config/env";

export const redis: Redis | null =
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
    : null;

/** Fail-open cache helpers: a Redis outage must never break the API. */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (!redis) return null;
    try {
      return (await redis.get<T>(key)) ?? null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    if (!redis) return;
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch {
      /* ignore */
    }
  },

  async del(...keys: string[]): Promise<void> {
    if (!redis || keys.length === 0) return;
    try {
      await redis.del(...keys);
    } catch {
      /* ignore */
    }
  },

  /** Delete every key beginning with the prefix (SCAN based). */
  async delByPrefix(prefix: string): Promise<void> {
    if (!redis) return;
    try {
      let cursor: string | number = 0;
      do {
        const [next, keys]: [string, string[]] = await redis.scan(cursor, {
          match: `${prefix}*`,
          count: 100,
        });
        if (keys.length) await redis.del(...keys);
        cursor = next;
      } while (String(cursor) !== "0");
    } catch {
      /* ignore */
    }
  },

  /** Read-through helper. */
  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await cache.get<T>(key);
    if (hit !== null) return hit;
    const fresh = await loader();
    await cache.set(key, fresh, ttlSeconds);
    return fresh;
  },
};
