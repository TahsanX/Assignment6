import type { Prisma, Role, UserStatus } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../../lib/prisma";
import { cache } from "../../lib/redis";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { transitionStatus } from "../assessments/assessments.service";
import { logAudit } from "../audit/audit.service";
import { notify } from "../notifications/notifications.service";

/* ------------------------------ Users ------------------------------ */

export const listUsers = async (q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.UserWhereInput = {
    ...(q.includeDeleted ? {} : { deletedAt: null }),
    ...(q.role && { role: q.role }),
    ...(q.status && { status: q.status }),
    ...(q.q && {
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { email: { contains: q.q, mode: "insensitive" } },
      ],
    }),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        onboarded: true,
        createdAt: true,
        deletedAt: true,
      },
      orderBy: { [q.sortBy]: q.order },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const changeRole = async (actorId: string, userId: string, role: Role, req: Request) => {
  if (actorId === userId) throw ApiError.badRequest("You cannot change your own role");
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  if (user.role === role) throw ApiError.conflict(`User already has role ${role}`);

  const owned =
    user.role === "COMPANY"
      ? await prisma.assessment.count({
          where: {
            companyId: userId,
            deletedAt: null,
            status: { in: ["PUBLISHED", "PENDING_PAYMENT"] },
          },
        })
      : user.role === "CANDIDATE"
        ? await prisma.attempt.count({ where: { candidateId: userId, status: "IN_PROGRESS" } })
        : 0;
  if (owned > 0)
    throw ApiError.conflict(
      "User has live assessments or attempts; resolve them before changing role",
    );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { role, onboarded: true },
      select: { id: true, email: true, role: true },
    });
    if (role === "COMPANY") {
      await tx.companyProfile.upsert({
        where: { userId },
        create: { userId, companyName: user.name },
        update: {},
      });
    } else if (role === "CANDIDATE") {
      await tx.candidateProfile.upsert({
        where: { userId },
        create: { userId, skills: [] },
        update: {},
      });
    }
    await logAudit(
      {
        actorId,
        action: "USER_ROLE_CHANGED",
        entity: "User",
        entityId: userId,
        before: { role: user.role },
        after: { role },
        req,
      },
      tx,
    );
    await notify(userId, "Role updated", `Your role is now ${role}`, "ACCOUNT", tx);
    return updated;
  });
};

export const changeStatus = async (
  actorId: string,
  userId: string,
  status: UserStatus,
  req: Request,
) => {
  if (actorId === userId) throw ApiError.badRequest("You cannot change your own status");
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  if (user.status === status) throw ApiError.conflict(`User is already ${status}`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { status },
      select: { id: true, email: true, status: true },
    });
    await logAudit(
      {
        actorId,
        action: status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REACTIVATED",
        entity: "User",
        entityId: userId,
        before: { status: user.status },
        after: { status },
        req,
      },
      tx,
    );
    return updated;
  });
};

/* ---------------------------- Assessments ---------------------------- */

export const listAssessments = async (q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.AssessmentWhereInput = {
    ...(q.includeDeleted ? {} : { deletedAt: null }),
    ...(q.status && { status: q.status }),
    ...(q.companyId && { companyId: q.companyId }),
    ...(q.q && { title: { contains: q.q, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([
    prisma.assessment.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        candidateSlots: true,
        moderationNote: true,
        createdAt: true,
        deletedAt: true,
        company: { select: { id: true, name: true, email: true } },
        _count: { select: { problems: true, attempts: true, invitations: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.assessment.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const moderateAssessment = async (
  actorId: string,
  id: string,
  input: { action: "TAKEDOWN" | "REMOVE"; note: string },
  req: Request,
) => {
  const a = await prisma.assessment.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw ApiError.notFound("Assessment not found");

  const result = await prisma.$transaction(async (tx) => {
    if (input.action === "TAKEDOWN") {
      await transitionStatus(tx, id, "CLOSED", actorId, req);
      await tx.invitation.updateMany({
        where: { assessmentId: id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
    } else {
      await tx.assessment.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    const updated = await tx.assessment.update({
      where: { id },
      data: { moderationNote: input.note },
      select: { id: true, status: true, moderationNote: true, deletedAt: true },
    });
    await logAudit(
      {
        actorId,
        action: `ASSESSMENT_${input.action}`,
        entity: "Assessment",
        entityId: id,
        after: { note: input.note },
        req,
      },
      tx,
    );
    await notify(
      a.companyId,
      "Assessment moderated",
      `"${a.title}": ${input.note}`,
      "MODERATION",
      tx,
    );
    return updated;
  });
  await cache.del("admin:dashboard");
  return result;
};

/* ------------------------------ Payments ----------------------------- */

export const listPayments = async (q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.PaymentWhereInput = {
    ...(q.status && { status: q.status }),
    ...(q.companyId && { companyId: q.companyId }),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        invoiceNumber: true,
        paidAt: true,
        createdAt: true,
        company: { select: { id: true, name: true, email: true } },
        assessment: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

/* --------------------------- Stats & audit --------------------------- */

const countBy = <T extends Record<string, any>>(rows: T[], key: keyof T) =>
  Object.fromEntries(rows.map((r) => [String(r[key]), (r as any)._count._all]));

export const dashboardStats = () =>
  cache.wrap("admin:dashboard", 60, async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [users, assessments, attempts, revenue, recentSignups, recentAttempts, problems] =
      await Promise.all([
        prisma.user.groupBy({ by: ["role"], where: { deletedAt: null }, _count: { _all: true } }),
        prisma.assessment.groupBy({
          by: ["status"],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        prisma.attempt.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.payment.aggregate({
          where: { status: "COMPLETED" },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.user.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
        prisma.attempt.count({ where: { startedAt: { gte: since } } }),
        prisma.problem.count({ where: { deletedAt: null } }),
      ]);
    return {
      usersByRole: countBy(users, "role"),
      assessmentsByStatus: countBy(assessments, "status"),
      attemptsByStatus: countBy(attempts, "status"),
      problems,
      revenue: { total: Number(revenue._sum.amount ?? 0), payments: revenue._count._all },
      last7Days: { signups: recentSignups, attemptsStarted: recentAttempts },
    };
  });

export const listAuditLogs = async (q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action && { action: q.action }),
    ...(q.entity && { entity: q.entity }),
    ...(q.entityId && { entityId: q.entityId }),
    ...(q.actorId && { actorId: q.actorId }),
    ...((q.from || q.to) && {
      createdAt: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) },
    }),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const publicStats = () =>
  cache.wrap("public:stats", 300, async () => {
    const [companies, candidates, assessments, completedAttempts] = await Promise.all([
      prisma.user.count({ where: { role: "COMPANY", deletedAt: null } }),
      prisma.user.count({ where: { role: "CANDIDATE", deletedAt: null } }),
      prisma.assessment.count({
        where: { status: { in: ["PUBLISHED", "CLOSED"] }, deletedAt: null },
      }),
      prisma.attempt.count({ where: { status: "EVALUATED" } }),
    ]);
    return { companies, candidates, assessments, completedAttempts };
  });
