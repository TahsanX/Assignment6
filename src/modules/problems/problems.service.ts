import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../../lib/prisma";
import { cache } from "../../lib/redis";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { logAudit } from "../audit/audit.service";

const listSelect = {
  id: true,
  type: true,
  title: true,
  difficulty: true,
  tags: true,
  points: true,
  createdAt: true,
} satisfies Prisma.ProblemSelect;

const cachePrefix = (companyId: string) => `problems:${companyId}:`;

const findOwned = async (companyId: string, id: string) => {
  const problem = await prisma.problem.findFirst({ where: { id, companyId, deletedAt: null } });
  if (!problem) throw ApiError.notFound("Problem not found");
  return problem;
};

const assertMcqConsistent = (options: any[] | undefined, correct: string[] | undefined) => {
  if (!options || !correct) return;
  const ids = new Set(options.map((o) => o.id));
  if (!correct.every((c) => ids.has(c))) {
    throw ApiError.badRequest("correctAnswer must reference existing option ids");
  }
};

export const createProblem = async (companyId: string, data: any, req: Request) => {
  assertMcqConsistent(data.options, data.correctAnswer);
  const problem = await prisma.$transaction(async (tx) => {
    const created = await tx.problem.create({ data: { ...data, companyId } });
    await logAudit(
      {
        actorId: companyId,
        action: "PROBLEM_CREATED",
        entity: "Problem",
        entityId: created.id,
        req,
      },
      tx,
    );
    return created;
  });
  await cache.delByPrefix(cachePrefix(companyId));
  return problem;
};

export const listProblems = async (companyId: string, q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const key = `${cachePrefix(companyId)}${JSON.stringify(q)}`;

  return cache.wrap(key, 60, async () => {
    const where: Prisma.ProblemWhereInput = {
      companyId,
      deletedAt: null,
      ...(q.type && { type: q.type }),
      ...(q.difficulty && { difficulty: q.difficulty }),
      ...(q.tag && { tags: { has: q.tag } }),
      ...(q.q && {
        OR: [
          { title: { contains: q.q, mode: "insensitive" } },
          { body: { contains: q.q, mode: "insensitive" } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      prisma.problem.findMany({
        where,
        select: listSelect,
        orderBy: { [q.sortBy ?? "createdAt"]: q.order ?? "desc" },
        skip,
        take,
      }),
      prisma.problem.count({ where }),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  });
};

export const searchProblems = (companyId: string, q: string) =>
  prisma.problem.findMany({
    where: {
      companyId,
      deletedAt: null,
      OR: [{ title: { contains: q, mode: "insensitive" } }, { tags: { has: q.toLowerCase() } }],
    },
    select: { id: true, title: true, type: true, difficulty: true, points: true },
    take: 20,
    orderBy: { title: "asc" },
  });

export const getProblem = (companyId: string, id: string) => findOwned(companyId, id);

export const updateProblem = async (companyId: string, id: string, data: any, req: Request) => {
  const existing = await findOwned(companyId, id);
  if (existing.type !== "MCQ" && (data.options || data.correctAnswer)) {
    throw ApiError.badRequest("options/correctAnswer apply to MCQ problems only");
  }
  if (existing.type !== "CODING" && data.testCases) {
    throw ApiError.badRequest("testCases apply to CODING problems only");
  }
  assertMcqConsistent(
    data.options ?? (existing.options as any[] | null) ?? undefined,
    data.correctAnswer ?? (existing.correctAnswer as string[] | null) ?? undefined,
  );

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.problem.update({ where: { id }, data });
    await logAudit(
      {
        actorId: companyId,
        action: "PROBLEM_UPDATED",
        entity: "Problem",
        entityId: id,
        before: { title: existing.title, points: existing.points },
        after: data,
        req,
      },
      tx,
    );
    return result;
  });
  await cache.delByPrefix(cachePrefix(companyId));
  return updated;
};

export const deleteProblem = async (companyId: string, id: string, req: Request) => {
  await findOwned(companyId, id);
  const inUse = await prisma.assessmentProblem.count({
    where: {
      problemId: id,
      assessment: { deletedAt: null, status: { in: ["PUBLISHED", "PENDING_PAYMENT"] } },
    },
  });
  if (inUse) throw ApiError.conflict("Problem is used by a live assessment and cannot be deleted");

  await prisma.$transaction(async (tx) => {
    await tx.problem.update({ where: { id }, data: { deletedAt: new Date() } });
    await logAudit(
      { actorId: companyId, action: "PROBLEM_DELETED", entity: "Problem", entityId: id, req },
      tx,
    );
  });
  await cache.delByPrefix(cachePrefix(companyId));
};
