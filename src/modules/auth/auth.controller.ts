import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { verifySvixWebhook } from "../../utils/svix";
import * as service from "./auth.service";

export const onboard = catchAsync(async (req, res) => {
  const data = await service.onboard(req.user!.id, req.body, req);
  sendResponse(res, { statusCode: 201, message: "Onboarding completed", data });
});

export const refresh = catchAsync(async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized("Missing Bearer token");
  const data = await service.refreshToken(header.slice(7).trim());
  sendResponse(res, { message: "Token refreshed", data });
});

export const logout = catchAsync(async (req, res) => {
  await service.logout(req.user!.id, req.user!.sessionId, req);
  sendResponse(res, { message: "Logged out successfully" });
});

export const clerkWebhook = catchAsync(async (req, res) => {
  if (!env.CLERK_WEBHOOK_SECRET) throw ApiError.badRequest("Webhook secret not configured");
  let evt: { type: string; data: unknown };
  try {
    evt = verifySvixWebhook(env.CLERK_WEBHOOK_SECRET, req.rawBody?.toString("utf8") ?? "", {
      id: req.headers["svix-id"] as string | undefined,
      timestamp: req.headers["svix-timestamp"] as string | undefined,
      signature: req.headers["svix-signature"] as string | undefined,
    });
  } catch {
    throw ApiError.badRequest("Invalid webhook signature");
  }
  await service.handleClerkEvent(evt);
  sendResponse(res, { message: "Webhook processed" });
});

export const register = catchAsync(async (req, res) => {
  const data = await service.register(req.body, req);
  sendResponse(res, { statusCode: 201, message: "Registration successful", data });
});

export const login = catchAsync(async (req, res) => {
  const data = await service.login(req.body.email, req.body.password);
  sendResponse(res, { message: "Login successful", data });
});
