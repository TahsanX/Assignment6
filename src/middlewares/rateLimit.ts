import { Ratelimit } from "@upstash/ratelimit";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { redis } from "../lib/redis";

const tooMany = {
  success: false,
  message: "Too many requests, please try again later",
  errors: [],
};

/** In-memory fallback limiter (used when Redis is not configured). */
const memoryLimiter = (windowMs: number, max: number) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooMany,
  });

/**
 * Creates a limiter backed by Upstash Redis (shared across serverless instances),
 * falling back to in-memory limiting. Fails open if Redis errors.
 */
const createLimiter = (name: string, max: number, windowSeconds: number) => {
  if (!redis) return memoryLimiter(windowSeconds * 1000, max);

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
    prefix: `rl:${name}`,
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = (req as any).auth?.userId ?? req.ip ?? "anonymous";
      const { success, limit, remaining, reset } = await limiter.limit(String(id));
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", reset);
      if (!success) return res.status(429).json(tooMany);
    } catch {
      /* fail open */
    }
    next();
  };
};

export const globalLimiter = createLimiter("global", 200, 60);
export const authLimiter = createLimiter("auth", 20, 60);
export const attemptLimiter = createLimiter("attempt", 120, 60);
export const paymentLimiter = createLimiter("payment", 20, 60);
export const uploadLimiter = createLimiter("upload", 15, 60);
