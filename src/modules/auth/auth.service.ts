import { verifyToken } from "@clerk/backend";
import type { Role } from "@prisma/client";
import type { Request } from "express";
import { env } from "../../config/env";
import { clerk } from "../../lib/clerk";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { logAudit } from "../audit/audit.service";

const userSelect = {
  id: true,
  clerkId: true,
  email: true,
  name: true,
  role: true,
  status: true,
  onboarded: true,
  deletedAt: true,
} as const;

/** Finds the local user for a Clerk id, creating it from Clerk data on first sight. */
export const findOrCreateUser = async (clerkId: string) => {
  const existing = await prisma.user.findUnique({ where: { clerkId }, select: userSelect });
  if (existing) return existing;

  const cu = await clerk.users.getUser(clerkId);
  const email =
    cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)?.emailAddress ??
    cu.emailAddresses[0]?.emailAddress;
  if (!email) throw ApiError.badRequest("Clerk account has no email address");
  const name = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email.split("@")[0];

  // Seeded admin may already exist by email; link it instead of duplicating.
  const byEmail = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (byEmail) {
    return prisma.user.update({ where: { id: byEmail.id }, data: { clerkId }, select: userSelect });
  }
  return prisma.user.create({
    data: { clerkId, email: email.toLowerCase(), name },
    select: userSelect,
  });
};

/** Verifies a Clerk session JWT; optionally tolerates expiry (used by refresh). */
export const verifySessionToken = async (token: string, allowExpired = false) => {
  try {
    return await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      ...(allowExpired ? { clockSkewInMs: 1000 * 60 * 60 * 24 * 7 } : {}),
    });
  } catch {
    throw ApiError.unauthorized("Invalid or expired token");
  }
};

export const onboard = async (
  userId: string,
  input: { role: Extract<Role, "COMPANY" | "CANDIDATE">; companyName?: string; headline?: string },
  req: Request,
) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.onboarded || user.role) throw ApiError.conflict("Account is already onboarded");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { role: input.role, onboarded: true },
      select: userSelect,
    });
    if (input.role === "COMPANY") {
      await tx.companyProfile.create({
        data: { userId, companyName: input.companyName ?? user.name },
      });
    } else {
      await tx.candidateProfile.create({
        data: { userId, headline: input.headline, skills: [] },
      });
    }
    await logAudit(
      {
        actorId: userId,
        action: "USER_ONBOARDED",
        entity: "User",
        entityId: userId,
        after: { role: input.role },
        req,
      },
      tx,
    );
    return updated;
  });
};

export const getMe = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      ...userSelect,
      createdAt: true,
      companyProfile: true,
      candidateProfile: true,
    },
  });

export const refreshToken = async (token: string) => {
  const payload = await verifySessionToken(token, true);
  const sessionId = (payload as { sid?: string }).sid;
  if (!sessionId) throw ApiError.badRequest("Token has no session");
  const session = await clerk.sessions.getSession(sessionId);
  if (session.status !== "active") throw ApiError.unauthorized("Session is no longer active");
  const fresh = await clerk.sessions.getToken(sessionId);
  return { token: fresh.jwt, sessionId };
};

export const logout = async (userId: string, sessionId: string | undefined, req: Request) => {
  if (sessionId) await clerk.sessions.revokeSession(sessionId);
  await logAudit({ actorId: userId, action: "USER_LOGOUT", entity: "User", entityId: userId, req });
};

/** Applies Clerk webhook events to the local user table. */
export const handleClerkEvent = async (evt: { type: string; data: any }) => {
  const d = evt.data;
  if (evt.type === "user.created" || evt.type === "user.updated") {
    const email = d.email_addresses?.find(
      (e: any) => e.id === d.primary_email_address_id,
    )?.email_address;
    if (!email) return;
    const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || email.split("@")[0];
    await prisma.user.upsert({
      where: { clerkId: d.id },
      create: { clerkId: d.id, email: email.toLowerCase(), name },
      update: { email: email.toLowerCase(), name },
    });
  } else if (evt.type === "user.deleted") {
    await prisma.user.updateMany({
      where: { clerkId: d.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
};
