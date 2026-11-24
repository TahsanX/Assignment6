import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { resultEmail, sendEmail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { seededShuffle } from "../../utils/shuffle";
import { logAudit } from "../audit/audit.service";
import { gradeAttempt } from "../evaluation/grading";
import { notify } from "../notifications/notifications.service";

/** Extra time tolerated for in-flight requests when the deadline passes. */
const GRACE_MS = 5000;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const notifyResult = async (attemptId: string) => {
  const a = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: {
      score: true,
      totalPoints: true,
      passed: true,
      status: true,
      candidate: { select: { id: true, email: true } },
      assessment: { select: { title: true, companyId: true } },
    },
  });
  if (!a) return;
  await notify(
    a.assessment.companyId,
    "Submission received",
    `A candidate submitted "${a.assessment.title}"`,
    "SUBMISSION",
  );
  if (a.status === "EVALUATED" && a.score != null) {
    const mail = resultEmail({
      assessmentTitle: a.assessment.title,
      score: a.score,
      totalPoints: a.totalPoints ?? 0,
      passed: !!a.passed,
    });
    await sendEmail(a.candidate.email, mail.subject, mail.title, mail.body);
  }
};

/**
 * Submits an IN_PROGRESS attempt atomically. The status check inside the transaction
 * (guarded update) makes concurrent submit/expire calls safe: only one wins.
 */
export const finalizeInProgress = async (attemptId: string, timedOut: boolean) => {
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.attempt.updateMany({
      where: { id: attemptId, status: "IN_PROGRESS" },
      data: { updatedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    const a = await tx.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { deadlineAt: true },
    });
    return gradeAttempt(tx, attemptId, {
      timedOut,
      submittedAt: timedOut ? a.deadlineAt : new Date(),
    });
  });
  if (result) await notifyResult(attemptId);
  return result;
};

/** Lazily expires an attempt whose deadline (plus grace) has passed. */
const expireIfNeeded = async <T extends { id: string; status: string; deadlineAt: Date }>(
  attempt: T,
) => {
  if (attempt.status === "IN_PROGRESS" && Date.now() > attempt.deadlineAt.getTime() + GRACE_MS) {
    await finalizeInProgress(attempt.id, true);
    return true;
  }
  return false;
};

export const sweepExpiredForAssessment = async (assessmentId: string) => {
  const stale = await prisma.attempt.findMany({
    where: {
      assessmentId,
      status: "IN_PROGRESS",
      deadlineAt: { lt: new Date(Date.now() - GRACE_MS) },
    },
    select: { id: true },
  });
  for (const s of stale) await finalizeInProgress(s.id, true);
};

const findOwnedAttempt = async (candidateId: string, id: string) => {
  const attempt = await prisma.attempt.findFirst({ where: { id, candidateId } });
  if (!attempt) throw ApiError.notFound("Attempt not found");
  return attempt;
};

/** Candidate-safe question payload: no correct answers, deterministic shuffle per attempt. */
const buildQuestions = async (attemptId: string, assessmentId: string, seed: number) => {
  const [items, answers] = await Promise.all([
    prisma.assessmentProblem.findMany({
      where: { assessmentId },
      orderBy: { order: "asc" },
      select: {
        points: true,
        problem: {
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            difficulty: true,
            options: true,
            testCases: true,
          },
        },
      },
    }),
    prisma.answer.findMany({ where: { attemptId }, select: { problemId: true, response: true } }),
  ]);
  const saved = new Map(answers.map((a) => [a.problemId, a.response]));

  const questions = items.map(({ points, problem }) => {
    const { testCases, options, ...rest } = problem;
    return {
      ...rest,
      points,
      options: Array.isArray(options) ? seededShuffle(options as unknown[], seed + 1) : undefined,
      // only expose visible sample test cases, never hidden ones
      sampleTestCases: Array.isArray(testCases)
        ? (testCases as any[])
            .filter((t) => !t.hidden)
            .map((t) => ({ input: t.input, expectedOutput: t.expectedOutput }))
        : undefined,
      savedResponse: saved.get(problem.id) ?? null,
    };
  });
  return seededShuffle(questions, seed);
};

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

export const startAttempt = async (
  user: NonNullable<Request["user"]>,
  assessmentId: string,
  req: Request,
) => {
  const attempt = await prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.findFirst({
      where: { id: assessmentId, deletedAt: null },
    });
    if (assessment?.status !== "PUBLISHED") {
      throw ApiError.notFound("Assessment is not available");
    }

    // Lock the candidate's invitation row: concurrent "start" calls serialise here.
    const invitation = await tx.invitation.findFirst({
      where: { assessmentId, email: user.email.toLowerCase(), deletedAt: null },
    });
    if (!invitation || invitation.status === "REVOKED") {
      throw ApiError.forbidden("You are not invited to this assessment");
    }
    await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id = ${invitation.id} FOR UPDATE`;
    if (invitation.status !== "ACCEPTED") {
      throw ApiError.forbidden("Accept your invitation before starting (POST /invitations/accept)");
    }

    const now = new Date();
    if (assessment.startsAt && now < assessment.startsAt) {
      throw ApiError.conflict(`Assessment opens at ${assessment.startsAt.toISOString()}`);
    }
    if (assessment.endsAt && now >= assessment.endsAt) {
      throw ApiError.conflict("Assessment window has ended");
    }

    const previous = await tx.attempt.findMany({
      where: { assessmentId, candidateId: user.id },
      select: { id: true, status: true, deadlineAt: true },
    });
    const active = previous.find((p) => p.status === "IN_PROGRESS");
    if (active) {
      if (now.getTime() <= active.deadlineAt.getTime() + GRACE_MS) {
        throw ApiError.conflict("You already have an attempt in progress", [
          { attemptId: active.id },
        ]);
      }
      // stale attempt: close it out inside this transaction before counting
      await gradeAttempt(tx, active.id, { timedOut: true, submittedAt: active.deadlineAt });
    }
    if (previous.length >= assessment.maxAttempts) {
      throw ApiError.conflict(`Maximum attempts (${assessment.maxAttempts}) reached`);
    }

    const deadlineAt = new Date(
      Math.min(
        now.getTime() + assessment.durationMins * 60_000,
        assessment.endsAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ),
    );
    const created = await tx.attempt.create({
      data: {
        assessmentId,
        candidateId: user.id,
        deadlineAt,
        seed: Math.floor(Math.random() * 2 ** 31),
      },
    });
    await logAudit(
      { actorId: user.id, action: "ATTEMPT_STARTED", entity: "Attempt", entityId: created.id, req },
      tx,
    );
    return created;
  });

  return {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    timeLeftSeconds: Math.max(0, Math.floor((attempt.deadlineAt.getTime() - Date.now()) / 1000)),
    questions: await buildQuestions(attempt.id, assessmentId, attempt.seed),
  };
};

/* ------------------------------------------------------------------ */
/* Read                                                                 */
/* ------------------------------------------------------------------ */

export const getAttempt = async (candidateId: string, id: string) => {
  let attempt = await findOwnedAttempt(candidateId, id);
  if (await expireIfNeeded(attempt)) attempt = await findOwnedAttempt(candidateId, id);

  const base = {
    attemptId: attempt.id,
    assessmentId: attempt.assessmentId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
  };
  if (attempt.status !== "IN_PROGRESS") return base;

  return {
    ...base,
    timeLeftSeconds: Math.max(0, Math.floor((attempt.deadlineAt.getTime() - Date.now()) / 1000)),
    questions: await buildQuestions(attempt.id, attempt.assessmentId, attempt.seed),
  };
};

export const myAttempts = async (candidateId: string, q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.AttemptWhereInput = { candidateId, ...(q.status && { status: q.status }) };
  const [items, total] = await Promise.all([
    prisma.attempt.findMany({
      where,
      select: {
        id: true,
        status: true,
        startedAt: true,
        submittedAt: true,
        deadlineAt: true,
        assessment: { select: { id: true, title: true, resultsReleased: true } },
      },
      orderBy: { startedAt: "desc" },
      skip,
      take,
    }),
    prisma.attempt.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

/* ------------------------------------------------------------------ */
/* Autosave / events / submit / result                                  */
/* ------------------------------------------------------------------ */

export const saveAnswer = async (
  candidateId: string,
  attemptId: string,
  problemId: string,
  response: Record<string, unknown>,
) => {
  const attempt = await findOwnedAttempt(candidateId, attemptId);
  if (await expireIfNeeded(attempt))
    throw ApiError.conflict("Time is up; the attempt was auto-submitted");
  if (attempt.status !== "IN_PROGRESS") throw ApiError.conflict("Attempt is no longer in progress");

  const ap = await prisma.assessmentProblem.findUnique({
    where: { assessmentId_problemId: { assessmentId: attempt.assessmentId, problemId } },
    select: { problem: { select: { type: true, options: true } } },
  });
  if (!ap) throw ApiError.notFound("Problem is not part of this assessment");

  const { type, options } = ap.problem;
  if (type === "MCQ") {
    const sel = (response as any).selected;
    const ids = new Set((options as any[]).map((o) => o.id));
    if (!Array.isArray(sel) || !sel.every((s) => ids.has(s))) {
      throw ApiError.badRequest("selected must be an array of valid option ids");
    }
  } else if (type === "WRITTEN" && typeof (response as any).text !== "string") {
    throw ApiError.badRequest("Written answers need a text field");
  } else if (type === "CODING" && typeof (response as any).code !== "string") {
    throw ApiError.badRequest("Coding answers need a code field");
  }

  if (Date.now() > attempt.deadlineAt.getTime() + GRACE_MS) {
    throw ApiError.conflict("Time is up");
  }

  const saved = await prisma.answer.upsert({
    where: { attemptId_problemId: { attemptId, problemId } },
    create: { attemptId, problemId, response: response as Prisma.InputJsonValue },
    update: { response: response as Prisma.InputJsonValue },
    select: { problemId: true, updatedAt: true },
  });
  return {
    ...saved,
    timeLeftSeconds: Math.max(0, Math.floor((attempt.deadlineAt.getTime() - Date.now()) / 1000)),
  };
};

export const recordEvent = async (
  candidateId: string,
  attemptId: string,
  event: { type: string; detail?: string },
) => {
  const attempt = await findOwnedAttempt(candidateId, attemptId);
  if (attempt.status !== "IN_PROGRESS") throw ApiError.conflict("Attempt is no longer in progress");
  const entry = JSON.stringify([{ ...event, at: new Date().toISOString() }]);
  // Atomic append, capped at the latest 500 events.
  await prisma.$executeRaw`
    UPDATE "Attempt"
    SET "events" = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (
        SELECT e FROM jsonb_array_elements("events" || ${entry}::jsonb) WITH ORDINALITY AS t(e, n)
        ORDER BY n DESC LIMIT 500
      ) s
    )
    WHERE id = ${attemptId} AND status = 'IN_PROGRESS'`;
};

export const submitAttempt = async (candidateId: string, attemptId: string, req: Request) => {
  const attempt = await findOwnedAttempt(candidateId, attemptId);
  if (attempt.status !== "IN_PROGRESS") throw ApiError.conflict("Attempt was already submitted");
  const timedOut = Date.now() > attempt.deadlineAt.getTime() + GRACE_MS;
  const result = await finalizeInProgress(attemptId, timedOut);
  if (!result) throw ApiError.conflict("Attempt was already submitted");
  await logAudit({
    actorId: candidateId,
    action: "ATTEMPT_SUBMITTED",
    entity: "Attempt",
    entityId: attemptId,
    after: { timedOut },
    req,
  });
  return {
    attemptId,
    status: result.status,
    timedOut,
    message:
      result.status === "EVALUATED"
        ? "Submitted and auto-graded"
        : "Submitted; written/coding answers await evaluation",
  };
};

export const getResult = async (candidateId: string, attemptId: string) => {
  let attempt = await findOwnedAttempt(candidateId, attemptId);
  if (await expireIfNeeded(attempt)) attempt = await findOwnedAttempt(candidateId, attemptId);
  if (attempt.status === "IN_PROGRESS") throw ApiError.conflict("Attempt is still in progress");

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: attempt.assessmentId },
    select: { title: true, resultsReleased: true, passMarks: true },
  });
  const base = {
    attemptId,
    assessment: assessment.title,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
  };
  if (attempt.status !== "EVALUATED")
    return { ...base, message: "Your submission is awaiting evaluation" };
  if (!assessment.resultsReleased)
    return { ...base, message: "Results have not been released yet" };

  const answers = await prisma.answer.findMany({
    where: { attemptId },
    select: {
      problemId: true,
      autoScore: true,
      manualScore: true,
      feedback: true,
      problem: { select: { title: true, type: true } },
    },
  });
  return {
    ...base,
    score: attempt.score,
    totalPoints: attempt.totalPoints,
    passMarks: assessment.passMarks,
    passed: attempt.passed,
    breakdown: answers.map((a) => ({
      problemId: a.problemId,
      title: a.problem.title,
      type: a.problem.type,
      score: a.autoScore ?? a.manualScore ?? 0,
      feedback: a.feedback,
    })),
  };
};
