import type { AssessmentStatus, Prisma } from "@prisma/client";
import type { Request } from "express";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { logAudit } from "../audit/audit.service";

type Tx = Prisma.TransactionClient;

/** Allowed lifecycle transitions. Everything else is rejected. */
const TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ["PENDING_PAYMENT"],
  PENDING_PAYMENT: ["PUBLISHED", "DRAFT"],
  PUBLISHED: ["CLOSED"],
  CLOSED: [],
};

export const priceFor = (candidateSlots: number) =>
  Math.round(candidateSlots * env.PRICE_PER_CANDIDATE_SLOT * 100) / 100;

/** The single place where assessment status changes (with audit trail). */
export const transitionStatus = async (
  tx: Tx,
  assessmentId: string,
  to: AssessmentStatus,
  actorId: string | null,
  req?: Request,
) => {
  const current = await tx.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
  if (!TRANSITIONS[current.status].includes(to)) {
    throw ApiError.conflict(`Cannot change assessment from ${current.status} to ${to}`);
  }
  const updated = await tx.assessment.update({ where: { id: assessmentId }, data: { status: to } });
  await logAudit(
    {
      actorId,
      action: "ASSESSMENT_STATUS_CHANGED",
      entity: "Assessment",
      entityId: assessmentId,
      before: { status: current.status },
      after: { status: to },
      req,
    },
    tx,
  );
  return updated;
};

const findOwned = async (companyId: string, id: string) => {
  const a = await prisma.assessment.findFirst({ where: { id, companyId, deletedAt: null } });
  if (!a) throw ApiError.notFound("Assessment not found");
  return a;
};

const requireDraft = (status: AssessmentStatus) => {
  if (status !== "DRAFT") throw ApiError.conflict("Only DRAFT assessments can be modified");
};

const listSelect = {
  id: true,
  title: true,
  description: true,
  durationMins: true,
  passMarks: true,
  status: true,
  startsAt: true,
  endsAt: true,
  candidateSlots: true,
  maxAttempts: true,
  createdAt: true,
  company: {
    select: { name: true, companyProfile: { select: { companyName: true, logoUrl: true } } },
  },
  _count: { select: { problems: true, invitations: true, attempts: true } },
} satisfies Prisma.AssessmentSelect;

export const createAssessment = async (companyId: string, data: any, req: Request) =>
  prisma.$transaction(async (tx) => {
    const created = await tx.assessment.create({ data: { ...data, companyId } });
    await logAudit(
      {
        actorId: companyId,
        action: "ASSESSMENT_CREATED",
        entity: "Assessment",
        entityId: created.id,
        req,
      },
      tx,
    );
    return created;
  });

export const listAssessments = async (user: NonNullable<Request["user"]>, q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.AssessmentWhereInput = {
    deletedAt: null,
    ...(q.status && { status: q.status }),
    ...(q.q && { title: { contains: q.q, mode: "insensitive" } }),
  };

  if (user.role === "COMPANY") {
    where.companyId = user.id;
  } else {
    // Candidates see only assessments they were invited to.
    where.status = q.status ?? { in: ["PUBLISHED", "CLOSED"] };
    where.invitations = {
      some: {
        email: user.email.toLowerCase(),
        deletedAt: null,
        status: { in: ["PENDING", "ACCEPTED"] },
      },
    };
  }

  const [items, total] = await Promise.all([
    prisma.assessment.findMany({
      where,
      select: listSelect,
      orderBy: { [q.sortBy]: q.order },
      skip,
      take,
    }),
    prisma.assessment.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const getAssessment = async (user: NonNullable<Request["user"]>, id: string) => {
  if (user.role === "COMPANY") {
    const a = await prisma.assessment.findFirst({
      where: { id, companyId: user.id, deletedAt: null },
      include: {
        problems: {
          orderBy: { order: "asc" },
          select: {
            order: true,
            points: true,
            problem: {
              select: { id: true, title: true, type: true, difficulty: true, tags: true },
            },
          },
        },
        _count: { select: { invitations: true, attempts: true } },
      },
    });
    if (!a) throw ApiError.notFound("Assessment not found");
    return { ...a, price: priceFor(a.candidateSlots) };
  }

  const a = await prisma.assessment.findFirst({
    where: {
      id,
      deletedAt: null,
      status: { in: ["PUBLISHED", "CLOSED"] },
      invitations: {
        some: {
          email: user.email.toLowerCase(),
          deletedAt: null,
          status: { in: ["PENDING", "ACCEPTED"] },
        },
      },
    },
    select: {
      ...listSelect,
      problems: { select: { points: true, problem: { select: { type: true } } } },
    },
  });
  if (!a) throw ApiError.notFound("Assessment not found");
  const { problems, ...rest } = a;
  return {
    ...rest,
    totalPoints: problems.reduce((s, p) => s + p.points, 0),
    questionCount: problems.length,
  };
};

export const updateAssessment = async (companyId: string, id: string, data: any, req: Request) => {
  const existing = await findOwned(companyId, id);
  requireDraft(existing.status);
  const startsAt = data.startsAt !== undefined ? data.startsAt : existing.startsAt;
  const endsAt = data.endsAt !== undefined ? data.endsAt : existing.endsAt;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw ApiError.badRequest("endsAt must be after startsAt");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assessment.update({ where: { id }, data });
    await logAudit(
      {
        actorId: companyId,
        action: "ASSESSMENT_UPDATED",
        entity: "Assessment",
        entityId: id,
        after: data,
        req,
      },
      tx,
    );
    return updated;
  });
};

export const deleteAssessment = async (companyId: string, id: string, req: Request) => {
  const existing = await findOwned(companyId, id);
  if (existing.status === "PUBLISHED")
    throw ApiError.conflict("Close the assessment before deleting it");
  const attempts = await prisma.attempt.count({ where: { assessmentId: id } });
  if (attempts) throw ApiError.conflict("Assessments with candidate attempts cannot be deleted");
  await prisma.$transaction(async (tx) => {
    await tx.assessment.update({ where: { id }, data: { deletedAt: new Date() } });
    await logAudit(
      { actorId: companyId, action: "ASSESSMENT_DELETED", entity: "Assessment", entityId: id, req },
      tx,
    );
  });
};

export const attachProblems = async (
  companyId: string,
  id: string,
  problemIds: string[],
  req: Request,
) => {
  const assessment = await findOwned(companyId, id);
  requireDraft(assessment.status);

  const problems = await prisma.problem.findMany({
    where: { id: { in: problemIds }, companyId, deletedAt: null },
    select: { id: true, points: true },
  });
  if (problems.length !== problemIds.length) {
    throw ApiError.badRequest("One or more problems do not exist or are not yours");
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.assessmentProblem.findMany({
      where: { assessmentId: id },
      select: { problemId: true, order: true },
    });
    const have = new Set(existing.map((e) => e.problemId));
    let next = existing.reduce((m, e) => Math.max(m, e.order), -1) + 1;
    const fresh = problemIds.filter((p) => !have.has(p));
    if (fresh.length === 0) throw ApiError.conflict("All selected problems are already attached");
    await tx.assessmentProblem.createMany({
      data: fresh.map((pid) => ({
        assessmentId: id,
        problemId: pid,
        order: next++,
        points: problems.find((p) => p.id === pid)!.points,
      })),
    });
    await logAudit(
      {
        actorId: companyId,
        action: "ASSESSMENT_PROBLEMS_ATTACHED",
        entity: "Assessment",
        entityId: id,
        after: { problemIds: fresh },
        req,
      },
      tx,
    );
  });
  return getAssessment({ id: companyId, role: "COMPANY" } as any, id);
};

export const reorderProblems = async (
  companyId: string,
  id: string,
  order: string[],
  req: Request,
) => {
  const assessment = await findOwned(companyId, id);
  requireDraft(assessment.status);
  const current = await prisma.assessmentProblem.findMany({
    where: { assessmentId: id },
    select: { problemId: true },
  });
  const set = new Set(current.map((c) => c.problemId));
  if (order.length !== set.size || !order.every((p) => set.has(p))) {
    throw ApiError.badRequest("order must contain exactly the attached problem ids");
  }
  await prisma.$transaction([
    ...order.map((problemId, index) =>
      prisma.assessmentProblem.update({
        where: { assessmentId_problemId: { assessmentId: id, problemId } },
        data: { order: index },
      }),
    ),
  ]);
  await logAudit({
    actorId: companyId,
    action: "ASSESSMENT_PROBLEMS_REORDERED",
    entity: "Assessment",
    entityId: id,
    req,
  });
  return getAssessment({ id: companyId, role: "COMPANY" } as any, id);
};

export const detachProblem = async (
  companyId: string,
  id: string,
  problemId: string,
  req: Request,
) => {
  const assessment = await findOwned(companyId, id);
  requireDraft(assessment.status);
  const res = await prisma.assessmentProblem.deleteMany({ where: { assessmentId: id, problemId } });
  if (!res.count) throw ApiError.notFound("Problem is not attached to this assessment");
  await logAudit({
    actorId: companyId,
    action: "ASSESSMENT_PROBLEM_DETACHED",
    entity: "Assessment",
    entityId: id,
    after: { problemId },
    req,
  });
};

/** DRAFT -> PENDING_PAYMENT after validating the assessment is publishable. */
export const requestPublish = async (companyId: string, id: string, req: Request) => {
  const assessment = await findOwned(companyId, id);
  const items = await prisma.assessmentProblem.findMany({
    where: { assessmentId: id },
    select: { points: true },
  });
  if (items.length === 0)
    throw ApiError.badRequest("Attach at least one problem before publishing");
  const total = items.reduce((s, i) => s + i.points, 0);
  if (assessment.passMarks > total)
    throw ApiError.badRequest(
      `passMarks (${assessment.passMarks}) exceeds total points (${total})`,
    );
  if (assessment.endsAt && assessment.endsAt <= new Date())
    throw ApiError.badRequest("endsAt must be in the future");

  await prisma.$transaction((tx) => transitionStatus(tx, id, "PENDING_PAYMENT", companyId, req));
  return {
    id,
    status: "PENDING_PAYMENT",
    amount: priceFor(assessment.candidateSlots),
    currency: env.PAYMENT_CURRENCY,
    totalPoints: total,
  };
};

export const closeAssessment = async (companyId: string, id: string, req: Request) => {
  await findOwned(companyId, id);
  return prisma.$transaction(async (tx) => {
    const updated = await transitionStatus(tx, id, "CLOSED", companyId, req);
    await tx.invitation.updateMany({
      where: { assessmentId: id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return updated;
  });
};
