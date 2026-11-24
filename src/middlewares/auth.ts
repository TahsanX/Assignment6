import type { Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { findOrCreateUser, verifySessionToken } from "../modules/auth/auth.service";
import { ApiError } from "../utils/ApiError";

/** Requires a valid Clerk Bearer token and loads the local user onto req.user. */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized("Missing Bearer token");
    const payload = await verifySessionToken(header.slice(7).trim());
    const user = await findOrCreateUser(payload.sub);
    if (user.deletedAt) throw ApiError.unauthorized("Account no longer exists");
    if (user.status === "SUSPENDED") throw ApiError.forbidden("Account is suspended");
    req.user = {
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId: (payload as { sid?: string }).sid,
    };
    next();
  } catch (e) {
    next(e);
  }
};

/** Restricts a route to the given roles. Must run after authenticate. */
export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(ApiError.unauthorized());
    if (!user.role)
      return next(ApiError.forbidden("Complete onboarding (POST /auth/onboard) first"));
    if (!roles.includes(user.role)) {
      return next(ApiError.forbidden(`Requires role: ${roles.join(" or ")}`));
    }
    next();
  };
