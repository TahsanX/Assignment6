import { prisma } from "../../lib/prisma";
import { cache } from "../../lib/redis";
import { ApiError } from "../../utils/ApiError";
import { sweepExpiredForAssessment } from "../attempts/attempts.service";

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const assertOwns = async (companyId: string, assessmentId: string) => {
  const a = await prisma.assessment.findFirst({
    where: { id: assessmentId, companyId, deletedAt: null },
    select: { id: true, title: true, passMarks: true, status: true },
  });
  if (!a) throw ApiError.notFound("Assessment not found");
  return a;
};

export const getReport = async (companyId: string, assessmentId: string) => {
  const assessment = await assertOwns(companyId, assessmentId);
  await sweepExpiredForAssessment(assessmentId);

  // Cache is invalidated by prefix whenever scores change (see evaluation/attempts services).
  return cache.wrap(`report:${assessmentId}:summary`, 120, async () => {
    const [invited, attempts, problems] = await Promise.all([
      prisma.invitation.count({
        where: { assessmentId, deletedAt: null, status: { not: "REVOKED" } },
      }),
      prisma.attempt.findMany({
        where: { assessmentId },
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
      }),
      prisma.assessmentProblem.findMany({
        where: { assessmentId },
        orderBy: { order: "asc" },
        select: {
          problemId: true,
          points: true,
          problem: { select: { title: true, type: true, difficulty: true } },
        },
      }),
    ]);

    const byStatus = attempts.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    const evaluated = attempts.filter((a) => a.status === "EVALUATED" && a.score != null);
    const scores = evaluated.map((a) => a.score as number).sort((x, y) => x - y);
    const mid = Math.floor(scores.length / 2);
    const median = scores.length
      ? scores.length % 2
        ? scores[mid]
        : (scores[mid - 1] + scores[mid]) / 2
      : 0;
    const durations = evaluated
      .filter((a) => a.submittedAt)
      .map((a) => ((a.submittedAt as Date).getTime() - a.startedAt.getTime()) / 60000);

    // Per-problem performance across evaluated attempts
    const answers = await prisma.answer.findMany({
      where: { attempt: { assessmentId, status: "EVALUATED" } },
      select: { problemId: true, autoScore: true, manualScore: true },
    });
    const perProblem = problems.map((p) => {
      const rows = answers.filter((a) => a.problemId === p.problemId);
      const earned = rows.reduce((s, r) => s + (r.autoScore ?? r.manualScore ?? 0), 0);
      const full = rows.filter((r) => (r.autoScore ?? r.manualScore ?? 0) >= p.points).length;
      return {
        problemId: p.problemId,
        title: p.problem.title,
        type: p.problem.type,
        difficulty: p.problem.difficulty,
        maxPoints: p.points,
        responses: rows.length,
        averageScore: rows.length ? round(earned / rows.length) : 0,
        fullMarksRate: rows.length ? round((full / rows.length) * 100, 1) : 0,
      };
    });

    const leaderboard = [...evaluated]
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, 10)
      .map((a, i) => ({
        rank: i + 1,
        candidate: a.candidate,
        score: a.score,
        totalPoints: a.totalPoints,
        passed: a.passed,
      }));

    return {
      assessment: { id: assessment.id, title: assessment.title, passMarks: assessment.passMarks },
      funnel: {
        invited,
        attempted: attempts.length,
        completed: attempts.filter((a) => a.status !== "IN_PROGRESS").length,
        evaluated: evaluated.length,
        completionRate: invited ? round((attempts.length / invited) * 100, 1) : 0,
      },
      attemptsByStatus: byStatus,
      scores: {
        average: scores.length ? round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0,
        median,
        highest: scores.length ? scores[scores.length - 1] : 0,
        lowest: scores.length ? scores[0] : 0,
        passRate: evaluated.length
          ? round((evaluated.filter((a) => a.passed).length / evaluated.length) * 100, 1)
          : 0,
        averageTimeMinutes: durations.length
          ? round(durations.reduce((s, v) => s + v, 0) / durations.length, 1)
          : 0,
      },
      perProblem,
      leaderboard,
    };
  });
};

/** Guards against CSV/formula injection from user-controlled names and emails. */
const csvCell = (value: unknown) => {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const exportCsv = async (companyId: string, assessmentId: string) => {
  const assessment = await assertOwns(companyId, assessmentId);
  await sweepExpiredForAssessment(assessmentId);
  const attempts = await prisma.attempt.findMany({
    where: { assessmentId },
    orderBy: [{ score: "desc" }, { submittedAt: "asc" }],
    select: {
      status: true,
      score: true,
      totalPoints: true,
      passed: true,
      startedAt: true,
      submittedAt: true,
      candidate: { select: { name: true, email: true } },
    },
  });
  const header = ["Name", "Email", "Status", "Score", "Total", "Passed", "Started", "Submitted"];
  const rows = attempts.map((a) =>
    [
      a.candidate.name,
      a.candidate.email,
      a.status,
      a.score,
      a.totalPoints,
      a.passed == null ? "" : a.passed ? "YES" : "NO",
      a.startedAt.toISOString(),
      a.submittedAt?.toISOString() ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return {
    filename: `${assessment.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report.csv`,
    csv: [header.map(csvCell).join(","), ...rows].join("\n"),
  };
};
