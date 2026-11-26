import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { env } from "../../config/env";
import { invitationEmail, sendEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { logAudit } from "../audit/audit.service";
import { notify } from "../notifications/notifications.service";

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const createInvitations = async (
  companyId: string,
  assessmentId: string,
  emails: string[],
  req: Request,
) => {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, companyId, deletedAt: null },
    include: {
      company: { select: { name: true, companyProfile: { select: { companyName: true } } } },
    },
  });
  if (!assessment) throw ApiError.notFound("Assessment not found");
  if (assessment.status !== "PUBLISHED") {
    throw ApiError.conflict("Candidates can only be invited to a PUBLISHED assessment");
  }

  const expiresAt = new Date(
    Math.min(Date.now() + INVITE_TTL_MS, assessment.endsAt?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  if (expiresAt <= new Date()) throw ApiError.badRequest("Assessment window has already ended");

  const issued: { email: string; token: string }[] = [];
  const skipped: { email: string; reason: string }[] = [];

  await prisma.$transaction(async (tx) => {
    // Serialise concurrent invite calls so the slot cap cannot be exceeded.
    await tx.$queryRaw`SELECT id FROM "Assessment" WHERE id = ${assessmentId} FOR UPDATE`;

    const existing = await tx.invitation.findMany({
      where: { assessmentId, email: { in: emails } },
    });
    const byEmail = new Map(existing.map((i) => [i.email, i]));
    const used = await tx.invitation.count({
      where: { assessmentId, status: { not: "REVOKED" }, deletedAt: null },
    });
    let free = assessment.candidateSlots - used;

    for (const email of emails) {
      const prev = byEmail.get(email);
      if (prev && prev.status !== "REVOKED" && !prev.deletedAt) {
        skipped.push({ email, reason: "Already invited" });
        continue;
      }
      if (free <= 0) {
        skipped.push({ email, reason: "No candidate slots remaining" });
        continue;
      }
      const token = crypto.randomBytes(32).toString("hex");
      if (prev) {
        // Re-invite after revoke: refresh the same row (unique assessmentId+email).
        await tx.invitation.update({
          where: { id: prev.id },
          data: {
            tokenHash: hash(token),
            status: "PENDING",
            expiresAt,
            candidateId: null,
            deletedAt: null,
          },
        });
      } else {
        await tx.invitation.create({
          data: { assessmentId, email, tokenHash: hash(token), expiresAt },
        });
      }
      free--;
      issued.push({ email, token });
    }

    await logAudit(
      {
        actorId: companyId,
        action: "INVITATIONS_CREATED",
        entity: "Assessment",
        entityId: assessmentId,
        after: { invited: issued.map((i) => i.email), skipped },
        req,
      },
      tx,
    );
  });

  const companyName = assessment.company.companyProfile?.companyName ?? assessment.company.name;
  // Emails go out after commit; failures never roll back invitations.
  await Promise.all(
    issued.map(({ email, token }) => {
      const mail = invitationEmail({
        companyName,
        assessmentTitle: assessment.title,
        durationMins: assessment.durationMins,
        link: `${env.CLIENT_URL}/invitations/accept?token=${token}`,
        expiresAt,
      });
      return sendEmail(email, mail.subject, mail.title, mail.body);
    }),
  );

  // Testing/demo convenience: tokens are returned outside production, or when
  // EXPOSE_INVITE_TOKENS=true (e.g. a demo deployment without real candidate mailboxes).
  return {
    invited: issued.map((i) => ({
      email: i.email,
      ...((env.NODE_ENV !== "production" || env.EXPOSE_INVITE_TOKENS) && { token: i.token }),
    })),
    skipped,
    slotsRemaining: Math.max(0, assessment.candidateSlots - (await countUsed(assessmentId))),
  };
};

const countUsed = (assessmentId: string) =>
  prisma.invitation.count({ where: { assessmentId, status: { not: "REVOKED" }, deletedAt: null } });

export const listInvitations = async (companyId: string, assessmentId: string, q: any) => {
  const owned = await prisma.assessment.findFirst({
    where: { id: assessmentId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) throw ApiError.notFound("Assessment not found");

  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.InvitationWhereInput = {
    assessmentId,
    deletedAt: null,
    ...(q.status && { status: q.status }),
    ...(q.q && { email: { contains: q.q, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        candidateId: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.invitation.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const revokeInvitation = async (companyId: string, id: string, req: Request) => {
  const inv = await prisma.invitation.findFirst({
    where: { id, deletedAt: null, assessment: { companyId } },
  });
  if (!inv) throw ApiError.notFound("Invitation not found");
  if (inv.status === "REVOKED") throw ApiError.conflict("Invitation already revoked");

  if (inv.candidateId) {
    const active = await prisma.attempt.count({
      where: {
        assessmentId: inv.assessmentId,
        candidateId: inv.candidateId,
        status: "IN_PROGRESS",
      },
    });
    if (active) throw ApiError.conflict("Candidate has an attempt in progress");
  }

  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id }, data: { status: "REVOKED" } });
    await logAudit(
      {
        actorId: companyId,
        action: "INVITATION_REVOKED",
        entity: "Invitation",
        entityId: id,
        before: { status: inv.status },
        after: { status: "REVOKED" },
        req,
      },
      tx,
    );
  });
};

export const acceptInvitation = async (
  user: NonNullable<Request["user"]>,
  token: string,
  req: Request,
) => {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hash(token) },
    include: {
      assessment: {
        select: { id: true, title: true, status: true, companyId: true, deletedAt: true },
      },
    },
  });
  if (!inv || inv.deletedAt) throw ApiError.notFound("Invalid invitation token");
  if (inv.email !== user.email.toLowerCase()) {
    throw ApiError.forbidden("This invitation was issued to a different email address");
  }
  if (inv.status === "REVOKED") throw ApiError.conflict("Invitation was revoked");
  if (inv.expiresAt <= new Date() || inv.status === "EXPIRED") {
    throw ApiError.conflict("Invitation has expired");
  }
  if (inv.assessment.deletedAt || inv.assessment.status !== "PUBLISHED") {
    throw ApiError.conflict("Assessment is not open");
  }
  if (inv.status === "ACCEPTED")
    return { invitationId: inv.id, assessmentId: inv.assessmentId, alreadyAccepted: true };

  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: inv.id },
      data: { status: "ACCEPTED", candidateId: user.id },
    });
    await notify(
      inv.assessment.companyId,
      "Invitation accepted",
      `${user.email} accepted the invitation to "${inv.assessment.title}"`,
      "INVITATION",
      tx,
    );
    await logAudit(
      {
        actorId: user.id,
        action: "INVITATION_ACCEPTED",
        entity: "Invitation",
        entityId: inv.id,
        req,
      },
      tx,
    );
  });
  return { invitationId: inv.id, assessmentId: inv.assessmentId, alreadyAccepted: false };
};

export const myInvitations = async (user: NonNullable<Request["user"]>, q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.InvitationWhereInput = {
    email: user.email.toLowerCase(),
    deletedAt: null,
    status: { not: "REVOKED" },
    ...(q.status && { status: q.status }),
  };
  const [items, total] = await Promise.all([
    prisma.invitation.findMany({
      where,
      select: {
        id: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        assessment: {
          select: { id: true, title: true, durationMins: true, status: true, endsAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.invitation.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};
