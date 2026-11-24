import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

const MCQ_EXACT = (selected: unknown, correct: unknown) => {
  if (!Array.isArray(selected) || !Array.isArray(correct)) return false;
  const a = [...new Set(selected.map(String))].sort();
  const b = [...new Set(correct.map(String))].sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

/**
 * Grades an attempt inside a transaction:
 *  - MCQ answers are auto-scored (all-or-nothing on the exact option set).
 *  - WRITTEN / CODING answers with no response are scored 0; the rest wait for an evaluator.
 * Returns the resulting attempt status and totals.
 */
export const gradeAttempt = async (
  tx: Tx,
  attemptId: string,
  opts: { timedOut: boolean; submittedAt: Date },
) => {
  const attempt = await tx.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      assessment: {
        select: {
          passMarks: true,
          problems: { select: { problemId: true, points: true, problem: true } },
        },
      },
      answers: true,
    },
  });

  const byProblem = new Map(attempt.answers.map((a) => [a.problemId, a]));
  let needsManual = false;

  for (const ap of attempt.assessment.problems) {
    const existing = byProblem.get(ap.problemId);
    const response = (existing?.response ?? null) as any;
    let data: { autoScore?: number; manualScore?: number } = {};

    if (ap.problem.type === "MCQ") {
      const ok = MCQ_EXACT(response?.selected, ap.problem.correctAnswer);
      data = { autoScore: ok ? ap.points : 0 };
    } else {
      const text = ap.problem.type === "CODING" ? response?.code : response?.text;
      const empty = !text || String(text).trim().length === 0;
      if (empty) data = { manualScore: 0 };
      else if (existing?.manualScore == null) needsManual = true;
    }

    if (existing) {
      if (Object.keys(data).length) {
        await tx.answer.update({ where: { id: existing.id }, data });
      }
    } else {
      await tx.answer.create({ data: { attemptId, problemId: ap.problemId, ...data } });
    }
  }

  const status = needsManual ? (opts.timedOut ? "EXPIRED" : "SUBMITTED") : "EVALUATED";
  const updated = await tx.attempt.update({
    where: { id: attemptId },
    data: { status, submittedAt: opts.submittedAt },
  });
  if (status === "EVALUATED") return finalizeScores(tx, attemptId);
  return updated;
};

/** Sums scores and sets pass/fail. Caller guarantees every answer is scored. */
export const finalizeScores = async (tx: Tx, attemptId: string) => {
  const attempt = await tx.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      assessment: { select: { passMarks: true, problems: { select: { points: true } } } },
      answers: { select: { autoScore: true, manualScore: true } },
    },
  });
  const score = attempt.answers.reduce((s, a) => s + (a.autoScore ?? a.manualScore ?? 0), 0);
  const totalPoints = attempt.assessment.problems.reduce((s, p) => s + p.points, 0);
  return tx.attempt.update({
    where: { id: attemptId },
    data: {
      status: "EVALUATED",
      score,
      totalPoints,
      passed: score >= attempt.assessment.passMarks,
    },
  });
};
