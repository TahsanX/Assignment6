import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { resultEmail, sendEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { cache } from "../../lib/redis";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { sweepExpiredForAssessment } from "../attempts/attempts.service";
import { logAudit } from "../audit/audit.service";
import { notify } from "../notifications/notifications.service";
import { finalizeScores } from "./grading";

const assertOwnsAssessment = async (companyId: string, assessmentId: string) => {
  const a = await prisma.assessment.findFirst({
    where: { id: assessmentId, companyId, deletedAt: null },
    select: { id: true, title: true, passMarks: true },
  });
  if (!a) throw ApiError.notFound("Assessment not found");
  return a;
};

const ownedAttempt = async (companyId: string, attemptId: string) => {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, assessment: { companyId, deletedAt: null } },
    include: {
      assessment: { select: { id: true, title: true, passMarks: true } },
      candidate: { select: { id: true, name: true, email: true } },
    },
  });
  if (!attempt) throw ApiError.notFound("Submission not found");
  return attempt;
};

export const listSubmissions = async (companyId: string, assessmentId: string, q: any) => {
  await assertOwnsAssessment(companyId, assessmentId);
  await sweepExpiredForAssessment(assessmentId);

  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.AttemptWhereInput = {
    assessmentId,
    ...(q.status && { status: q.status }),
    ...(q.passed !== undefined && { passed: q.passed }),
    ...(q.minScore !== undefined && { score: { gte: q.minScore } }),
    ...(q.q && {
      candidate: {
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { email: { contains: q.q, mode: "insensitive" } },
        ],
      },
    }),
  };
  const [items, total] = await Promise.all([
    prisma.attempt.findMany({
      where,
      select: {
        id: true,
        status: true,
        score: true,
        totalPoints: true,
        passed: true,
        startedAt: true,
        submittedAt: true,
        candidate: { select: { id: true, name: true, email: true } },
      },
      orderBy: { [q.sortBy]: q.order },
      skip,
      take,
    }),
    prisma.attempt.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const getSubmission = async (companyId: string, attemptId: string) => {
  const attempt = await ownedAttempt(companyId, attemptId);
  const answers = await prisma.answer.findMany({
    where: { attemptId },
    select: {
      id: true,
      response: true,
      autoScore: true,
      manualScore: true,
      feedback: true,
      problem: {
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          options: true,
          correctAnswer: true,
          testCases: true,
          assessments: { where: { assessmentId: attempt.assessmentId }, select: { points: true } },
        },
      },
    },
  });
  const { assessment, candidate, events, ...rest } = attempt;
  return {
    ...rest,
    assessment,
    candidate,
    events,
    answers: answers.map(({ problem, ...a }) => ({
      ...a,
      maxPoints: problem.assessments[0]?.points ?? 0,
      problem: { ...problem, assessments: undefined },
    })),
  };
};

export const evaluateAnswer = async (
  companyId: string,
  answerId: string,
  input: { score: number; feedback?: string },
  req: Request,
) => {
  const answer = await prisma.answer.findFirst({
    where: { id: answerId, attempt: { assessment: { companyId, deletedAt: null } } },
    include: {
      problem: { select: { type: true } },
      attempt: { select: { id: true, status: true, assessmentId: true } },
    },
  });
  if (!answer) throw ApiError.notFound("Answer not found");
  if (answer.problem.type === "MCQ")
    throw ApiError.badRequest("MCQ answers are graded automatically");
  if (answer.attempt.status === "IN_PROGRESS")
    throw ApiError.conflict("Candidate is still attempting");

  const ap = await prisma.assessmentProblem.findUniqueOrThrow({
    where: {
      assessmentId_problemId: {
        assessmentId: answer.attempt.assessmentId,
        problemId: answer.problemId,
      },
    },
    select: { points: true },
  });
  if (input.score > ap.points) throw ApiError.badRequest(`score cannot exceed ${ap.points} points`);

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.answer.update({
      where: { id: answerId },
      data: { manualScore: input.score, feedback: input.feedback ?? null, evaluatorId: companyId },
      select: { id: true, manualScore: true, feedback: true },
    });
    // Re-scoring an already finalised attempt keeps totals in sync.
    if (answer.attempt.status === "EVALUATED") await finalizeScores(tx, answer.attempt.id);
    await logAudit(
      {
        actorId: companyId,
        action: "ANSWER_EVALUATED",
        entity: "Answer",
        entityId: answerId,
        before: { manualScore: answer.manualScore },
        after: { manualScore: input.score },
        req,
      },
      tx,
    );
    return res;
  });
  await cache.delByPrefix(`report:${answer.attempt.assessmentId}`);
  return updated;
};

export const finalizeSubmission = async (companyId: string, attemptId: string, req: Request) => {
  const attempt = await ownedAttempt(companyId, attemptId);
  if (attempt.status === "IN_PROGRESS") throw ApiError.conflict("Candidate is still attempting");
  if (attempt.status === "EVALUATED") throw ApiError.conflict("Submission is already finalised");

  const pending = await prisma.answer.count({
    where: { attemptId, autoScore: null, manualScore: null },
  });
  if (pending > 0) throw ApiError.conflict(`${pending} answer(s) still need a score`);

  const done = await prisma.$transaction(async (tx) => {
    const res = await finalizeScores(tx, attemptId);
    await logAudit(
      {
        actorId: companyId,
        action: "ATTEMPT_FINALIZED",
        entity: "Attempt",
        entityId: attemptId,
        before: { status: attempt.status },
        after: { status: "EVALUATED", score: res.score, passed: res.passed },
        req,
      },
      tx,
    );
    return res;
  });
  await cache.delByPrefix(`report:${attempt.assessmentId}`);

  const mail = resultEmail({
    assessmentTitle: attempt.assessment.title,
    score: done.score ?? 0,
    totalPoints: done.totalPoints ?? 0,
    passed: !!done.passed,
  });
  await sendEmail(attempt.candidate.email, mail.subject, mail.title, mail.body);
  return {
    attemptId,
    status: done.status,
    score: done.score,
    totalPoints: done.totalPoints,
    passed: done.passed,
  };
};

export const releaseResults = async (companyId: string, assessmentId: string, req: Request) => {
  const a = await assertOwnsAssessment(companyId, assessmentId);
  await sweepExpiredForAssessment(assessmentId);
  const pending = await prisma.attempt.count({
    where: { assessmentId, status: { in: ["IN_PROGRESS", "SUBMITTED", "EXPIRED"] } },
  });
  if (pending > 0) {
    throw ApiError.conflict(`${pending} attempt(s) are not fully evaluated yet`);
  }

  const candidates = await prisma.attempt.findMany({
    where: { assessmentId },
    select: { candidateId: true },
    distinct: ["candidateId"],
  });
  await prisma.$transaction(async (tx) => {
    await tx.assessment.update({ where: { id: assessmentId }, data: { resultsReleased: true } });
    for (const c of candidates) {
      await notify(
        c.candidateId,
        "Results released",
        `Your results for "${a.title}" are available`,
        "RESULT",
        tx,
      );
    }
    await logAudit(
      {
        actorId: companyId,
        action: "RESULTS_RELEASED",
        entity: "Assessment",
        entityId: assessmentId,
        req,
      },
      tx,
    );
  });
  return { assessmentId, resultsReleased: true, notified: candidates.length };
};
