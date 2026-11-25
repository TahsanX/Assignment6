/**
 * End-to-end API smoke test across all three roles.
 *
 *   BASE_URL=http://localhost:5000 npx tsx scripts/smoke.ts
 *
 * Requirements: seeded database (npm run db:seed), Clerk keys, and a running server.
 * The single manual step is paying the Stripe test checkout (card 4242 4242 4242 4242);
 * the script prints the URL and then polls until the payment settles.
 * Test data is intentionally left in place (no cleanup).
 */
import dotenv from "dotenv";
import { mintToken } from "./get-test-token";

dotenv.config();

const BASE = (process.env.BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");
const API = `${BASE}/api/v1`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@codeassess.dev";
const COMPANY_EMAIL = "hiring@northwind-labs.dev";
const OTHER_COMPANY_EMAIL = "talent@bluepeak-systems.dev";
const CANDIDATE_A = "nusrat.jahan@example.com";
const CANDIDATE_B = "arif.chowdhury@example.com";

let passed = 0;
let failed = 0;
const failures: string[] = [];

const check = (label: string, ok: boolean, extra?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "");
  }
};

type Res = { status: number; json: any };
const call = async (method: string, path: string, token?: string, body?: unknown): Promise<Res> => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
};

const section = (name: string) => console.log(`\n== ${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  console.log(`Smoke test against ${BASE}`);

  const [admin, company, otherCompany, candA, candB] = await Promise.all(
    [ADMIN_EMAIL, COMPANY_EMAIL, OTHER_COMPANY_EMAIL, CANDIDATE_A, CANDIDATE_B].map((e) =>
      mintToken(e).then((r) => r.token),
    ),
  );

  section("Public & infrastructure");
  check("GET /health", (await fetch(`${BASE}/health`)).status === 200);
  check("GET /public/stats", (await call("GET", "/public/stats")).status === 200);
  check(
    "unknown route -> 404 JSON",
    (await call("GET", "/does-not-exist")).json?.success === false,
  );

  section("Auth & RBAC");
  check("no token -> 401", (await call("GET", "/users/me")).status === 401);
  check("garbage token -> 401", (await call("GET", "/users/me", "abc.def.ghi")).status === 401);
  check("GET /users/me (company)", (await call("GET", "/users/me", company)).status === 200);
  check(
    "candidate cannot create problem -> 403",
    (await call("POST", "/problems", candA, {})).status === 403,
  );
  check(
    "company cannot hit admin -> 403",
    (await call("GET", "/admin/users", company)).status === 403,
  );
  check(
    "candidate cannot hit admin -> 403",
    (await call("GET", "/admin/dashboard-stats", candA)).status === 403,
  );
  const onboardAgain = await call("POST", "/auth/onboard", company, {
    role: "COMPANY",
    companyName: "Again Ltd",
  });
  check("re-onboarding -> 409", onboardAgain.status === 409, onboardAgain.json);
  check(
    "onboard validation -> 422",
    (await call("POST", "/auth/onboard", company, { role: "ADMIN" })).status === 422,
  );
  check(
    "PATCH /users/me",
    (await call("PATCH", "/users/me", company, { name: "Farhana Rahman" })).status === 200,
  );
  check(
    "PUT company profile",
    (
      await call("PUT", "/users/me/profile/company", company, {
        description: "Hiring backend engineers",
      })
    ).status === 200,
  );
  check(
    "PUT candidate profile",
    (
      await call("PUT", "/users/me/profile/candidate", candA, {
        skills: ["typescript", "node", "postgres"],
        headline: "Backend developer",
      })
    ).status === 200,
  );

  section("Problems");
  const mcqRes = await call("POST", "/problems", company, {
    type: "MCQ",
    title: `Which status code means Created? (${stamp})`,
    body: "Pick the correct HTTP status code for a successful resource creation.",
    difficulty: "EASY",
    tags: ["http"],
    points: 10,
    options: [
      { id: "a", text: "200" },
      { id: "b", text: "201" },
      { id: "c", text: "204" },
    ],
    correctAnswer: ["b"],
  });
  check("create MCQ", mcqRes.status === 201, mcqRes.json);
  const writtenRes = await call("POST", "/problems", company, {
    type: "WRITTEN",
    title: `Explain database indexes (${stamp})`,
    body: "When do indexes help and when do they hurt write performance?",
    points: 20,
  });
  check("create WRITTEN", writtenRes.status === 201, writtenRes.json);
  const codingRes = await call("POST", "/problems", company, {
    type: "CODING",
    title: `Reverse a string (${stamp})`,
    body: "Write a function that reverses a string without using built-in reverse helpers.",
    points: 20,
    testCases: [
      { input: "abc", expectedOutput: "cba" },
      { input: "", expectedOutput: "", hidden: true },
    ],
  });
  check("create CODING", codingRes.status === 201, codingRes.json);
  const [mcqId, writtenId, codingId] = [mcqRes, writtenRes, codingRes].map(
    (r) => r.json?.data?.id as string,
  );

  check(
    "invalid MCQ (no options) -> 422",
    (
      await call("POST", "/problems", company, {
        type: "MCQ",
        title: "Bad one",
        body: "No options here",
      })
    ).status === 422,
  );
  const list = await call(
    "GET",
    "/problems?page=1&limit=5&type=MCQ&sortBy=points&order=desc",
    company,
  );
  check(
    "list problems paginated+filtered",
    list.status === 200 && list.json?.meta?.limit === 5,
    list.json,
  );
  check(
    "search problems",
    (await call("GET", "/problems/search?q=status", company)).status === 200,
  );
  check("get problem", (await call("GET", `/problems/${mcqId}`, company)).status === 200);
  check(
    "update problem",
    (await call("PATCH", `/problems/${mcqId}`, company, { points: 15 })).status === 200,
  );
  check(
    "other company cannot read problem -> 404",
    (await call("GET", `/problems/${mcqId}`, otherCompany)).status === 404,
  );
  check(
    "problem bad uuid -> 422",
    (await call("GET", "/problems/not-a-uuid", company)).status === 422,
  );

  section("Assessments");
  const aRes = await call("POST", "/assessments", company, {
    title: `Backend Screening ${stamp}`,
    description: "Smoke test assessment",
    durationMins: 30,
    passMarks: 20,
    candidateSlots: 3,
  });
  check("create assessment", aRes.status === 201, aRes.json);
  const aid = aRes.json?.data?.id as string;
  check(
    "publish-request without problems -> 400",
    (await call("POST", `/assessments/${aid}/publish-request`, company)).status === 400,
  );
  const att = await call("POST", `/assessments/${aid}/problems`, company, {
    problemIds: [mcqId, writtenId, codingId],
  });
  check("attach problems", att.status === 201, att.json);
  check(
    "reorder problems",
    (
      await call("PUT", `/assessments/${aid}/problems/reorder`, company, {
        order: [codingId, mcqId, writtenId],
      })
    ).status === 200,
  );
  check(
    "detach problem",
    (await call("DELETE", `/assessments/${aid}/problems/${codingId}`, company)).status === 200,
  );
  check(
    "re-attach problem",
    (await call("POST", `/assessments/${aid}/problems`, company, { problemIds: [codingId] }))
      .status === 201,
  );
  check(
    "update assessment",
    (await call("PATCH", `/assessments/${aid}`, company, { durationMins: 45 })).status === 200,
  );
  const lst = await call(
    "GET",
    "/assessments?status=DRAFT&q=Backend&sortBy=createdAt&order=desc&limit=5",
    company,
  );
  check(
    "list assessments with filter/search/sort",
    lst.status === 200 && Array.isArray(lst.json?.data),
    lst.json,
  );
  check("get assessment", (await call("GET", `/assessments/${aid}`, company)).status === 200);
  check(
    "other company cannot read -> 404",
    (await call("GET", `/assessments/${aid}`, otherCompany)).status === 404,
  );
  check(
    "invite before publish -> 409",
    (await call("POST", `/assessments/${aid}/invitations`, company, { emails: [CANDIDATE_A] }))
      .status === 409,
  );
  check(
    "pay before publish-request -> 409",
    (await call("POST", "/payments/initiate", company, { assessmentId: aid })).status === 409,
  );
  check(
    "publish-request",
    (await call("POST", `/assessments/${aid}/publish-request`, company)).status === 200,
  );
  check(
    "edit after request -> 409",
    (await call("PATCH", `/assessments/${aid}`, company, { title: "Changed title" })).status ===
      409,
  );

  section("Payment (Stripe test mode)");
  const pay = await call("POST", "/payments/initiate", company, { assessmentId: aid });
  check("initiate payment", pay.status === 201 && !!pay.json?.data?.checkoutUrl, pay.json);
  const paymentId = pay.json?.data?.paymentId as string;
  const dup = await call("POST", "/payments/initiate", company, { assessmentId: aid });
  check(
    "second initiate reuses open session",
    !!paymentId && dup.json?.data?.paymentId === paymentId,
    dup.json,
  );
  check(
    "candidate cannot initiate -> 403",
    (await call("POST", "/payments/initiate", candA, { assessmentId: aid })).status === 403,
  );
  console.log(
    `\n  >>> Pay here with card 4242 4242 4242 4242:\n  ${pay.json?.data?.checkoutUrl}\n`,
  );
  let status = "PENDING";
  for (let i = 0; i < 100 && status !== "COMPLETED"; i++) {
    await sleep(3000);
    const r = await call("POST", `/payments/${paymentId}/refresh`, company);
    status = r.json?.data?.status ?? status;
  }
  check("payment COMPLETED", status === "COMPLETED");
  check("get payment", (await call("GET", `/payments/${paymentId}`, company)).status === 200);
  check("list payments", (await call("GET", "/payments?status=COMPLETED", company)).status === 200);
  check(
    "other company cannot read payment -> 404",
    (await call("GET", `/payments/${paymentId}`, otherCompany)).status === 404,
  );
  check(
    "webhook without signature -> 400",
    (await call("POST", "/payments/webhook", undefined, { type: "x" })).status === 400,
  );
  const published = await call("GET", `/assessments/${aid}`, company);
  check(
    "assessment PUBLISHED after payment",
    published.json?.data?.status === "PUBLISHED",
    published.json,
  );
  if (status !== "COMPLETED") {
    console.log("\nPayment not completed; skipping the rest.");
    return summary();
  }

  section("Invitations");
  const inv = await call("POST", `/assessments/${aid}/invitations`, company, {
    emails: [CANDIDATE_A, CANDIDATE_B],
  });
  check("invite candidates", inv.status === 201 && inv.json?.data?.invited?.length === 2, inv.json);
  const tokenA = inv.json?.data?.invited?.find((i: any) => i.email === CANDIDATE_A)
    ?.token as string;
  const tokenB = inv.json?.data?.invited?.find((i: any) => i.email === CANDIDATE_B)
    ?.token as string;
  const dupInv = await call("POST", `/assessments/${aid}/invitations`, company, {
    emails: [CANDIDATE_A],
  });
  check("duplicate invite skipped", dupInv.json?.data?.skipped?.length === 1, dupInv.json);
  const slots = await call("POST", `/assessments/${aid}/invitations`, company, {
    emails: ["rafiq.islam@example.com", "mim.sultana@example.com"],
  });
  check("slot cap enforced (3 slots)", slots.json?.data?.skipped?.length === 1, slots.json);
  check(
    "list invitations",
    (await call("GET", `/assessments/${aid}/invitations?status=PENDING`, company)).status === 200,
  );
  check(
    "candidate cannot list company invitations -> 403",
    (await call("GET", `/assessments/${aid}/invitations`, candA)).status === 403,
  );
  check(
    "start before accepting -> 403",
    (await call("POST", `/assessments/${aid}/attempts`, candA)).status === 403,
  );
  check(
    "accept with wrong user -> 403",
    (await call("POST", "/invitations/accept", candB, { token: tokenA })).status === 403,
  );
  check(
    "accept invitation A",
    (await call("POST", "/invitations/accept", candA, { token: tokenA })).status === 200,
  );
  check(
    "accept invitation B",
    (await call("POST", "/invitations/accept", candB, { token: tokenB })).status === 200,
  );
  check("my invitations", (await call("GET", "/invitations/mine", candA)).status === 200);
  check(
    "candidate sees invited assessment",
    ((await call("GET", "/assessments", candA)).json?.data ?? []).some((a: any) => a.id === aid),
  );

  section("Attempts (race + timer + autosave)");
  const [r1, r2] = await Promise.all([
    call("POST", `/assessments/${aid}/attempts`, candA),
    call("POST", `/assessments/${aid}/attempts`, candA),
  ]);
  const statuses = [r1.status, r2.status].sort();
  check(
    "concurrent start: exactly one 201 and one 409",
    statuses[0] === 201 && statuses[1] === 409,
    [r1.status, r2.status],
  );
  const started = r1.status === 201 ? r1 : r2;
  const attemptId = started.json?.data?.attemptId as string;
  const questions = started.json?.data?.questions ?? [];
  check("3 questions served", questions.length === 3);
  check("no answers leaked", !JSON.stringify(questions).includes("correctAnswer"));
  check(
    "get attempt w/ time left",
    ((await call("GET", `/attempts/${attemptId}`, candA)).json?.data?.timeLeftSeconds ?? 0) > 0,
  );
  check(
    "other candidate cannot read attempt -> 404",
    (await call("GET", `/attempts/${attemptId}`, candB)).status === 404,
  );
  check(
    "save MCQ answer",
    (
      await call("PUT", `/attempts/${attemptId}/answers/${mcqId}`, candA, {
        response: { selected: ["b"] },
      })
    ).status === 200,
  );
  check(
    "invalid MCQ option -> 400",
    (
      await call("PUT", `/attempts/${attemptId}/answers/${mcqId}`, candA, {
        response: { selected: ["zzz"] },
      })
    ).status === 400,
  );
  check(
    "save written answer",
    (
      await call("PUT", `/attempts/${attemptId}/answers/${writtenId}`, candA, {
        response: { text: "Indexes speed up reads but add write overhead." },
      })
    ).status === 200,
  );
  check(
    "save coding answer",
    (
      await call("PUT", `/attempts/${attemptId}/answers/${codingId}`, candA, {
        response: {
          language: "typescript",
          code: "const rev=(s:string)=>[...s].reduceRight((a,c)=>a+c,'')",
        },
      })
    ).status === 200,
  );
  check(
    "record anti-cheat event",
    (await call("POST", `/attempts/${attemptId}/events`, candA, { type: "TAB_SWITCH" })).status ===
      202,
  );
  check(
    "company cannot start attempt -> 403",
    (await call("POST", `/assessments/${aid}/attempts`, company)).status === 403,
  );
  const sub = await call("POST", `/attempts/${attemptId}/submit`, candA);
  check(
    "submit attempt (awaits manual grading)",
    sub.status === 200 && sub.json?.data?.status === "SUBMITTED",
    sub.json,
  );
  check(
    "double submit -> 409",
    (await call("POST", `/attempts/${attemptId}/submit`, candA)).status === 409,
  );
  check(
    "save after submit -> 409",
    (
      await call("PUT", `/attempts/${attemptId}/answers/${mcqId}`, candA, {
        response: { selected: ["a"] },
      })
    ).status === 409,
  );
  check(
    "max attempts enforced -> 409",
    (await call("POST", `/assessments/${aid}/attempts`, candA)).status === 409,
  );
  check(
    "my attempts",
    (await call("GET", "/attempts/mine?status=SUBMITTED", candA)).status === 200,
  );
  check(
    "result pending evaluation",
    (await call("GET", `/attempts/${attemptId}/result`, candA)).json?.data?.message?.includes(
      "awaiting",
    ) === true,
  );

  section("Evaluation & reports");
  const subs = await call(
    "GET",
    `/assessments/${aid}/submissions?status=SUBMITTED&sortBy=submittedAt`,
    company,
  );
  check("list submissions", subs.status === 200 && subs.json?.data?.length >= 1, subs.json);
  const detail = await call("GET", `/submissions/${attemptId}`, company);
  check(
    "submission detail (with events)",
    detail.status === 200 && Array.isArray(detail.json?.data?.answers),
    detail.json,
  );
  check(
    "other company cannot view submission -> 404",
    (await call("GET", `/submissions/${attemptId}`, otherCompany)).status === 404,
  );
  check(
    "finalize with unscored answers -> 409",
    (await call("POST", `/submissions/${attemptId}/finalize`, company)).status === 409,
  );
  const answers: any[] = detail.json?.data?.answers ?? [];
  const written = answers.find((a) => a.problem.type === "WRITTEN");
  const coding = answers.find((a) => a.problem.type === "CODING");
  check(
    "score above max -> 400",
    (await call("PATCH", `/answers/${written.id}/evaluate`, company, { score: 999 })).status ===
      400,
  );
  check(
    "evaluate written",
    (
      await call("PATCH", `/answers/${written.id}/evaluate`, company, {
        score: 15,
        feedback: "Good coverage of read/write trade-offs.",
      })
    ).status === 200,
  );
  check(
    "evaluate coding",
    (
      await call("PATCH", `/answers/${coding.id}/evaluate`, company, {
        score: 18,
        feedback: "Correct and readable.",
      })
    ).status === 200,
  );
  const fin = await call("POST", `/submissions/${attemptId}/finalize`, company);
  check(
    "finalize submission",
    fin.status === 200 && fin.json?.data?.status === "EVALUATED",
    fin.json,
  );
  check("final score computed", typeof fin.json?.data?.score === "number", fin.json);
  check(
    "result hidden before release",
    (await call("GET", `/attempts/${attemptId}/result`, candA)).json?.data?.message?.includes(
      "not been released",
    ) === true,
  );
  check(
    "release results",
    (await call("POST", `/assessments/${aid}/release-results`, company)).status === 200,
  );
  const result = await call("GET", `/attempts/${attemptId}/result`, candA);
  check("candidate sees result after release", result.json?.data?.score != null, result.json);
  const report = await call("GET", `/assessments/${aid}/report`, company);
  check("report", report.status === 200 && report.json?.data?.funnel?.invited >= 2, report.json);
  const csv = await fetch(`${API}/assessments/${aid}/report/export`, {
    headers: { Authorization: `Bearer ${company}` },
  });
  check(
    "CSV export",
    csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv"),
  );
  check(
    "close assessment",
    (await call("POST", `/assessments/${aid}/close`, company)).status === 200,
  );
  check(
    "close again -> 409",
    (await call("POST", `/assessments/${aid}/close`, company)).status === 409,
  );
  check(
    "delete blocked (has attempts) -> 409",
    (await call("DELETE", `/assessments/${aid}`, company)).status === 409,
  );

  section("Notifications");
  const notes = await call("GET", "/notifications?limit=5", company);
  check("list notifications", notes.status === 200, notes.json);
  const firstNote = notes.json?.data?.items?.[0];
  if (firstNote)
    check(
      "mark notification read",
      (await call("PATCH", `/notifications/${firstNote.id}/read`, company)).status === 200,
    );

  section("Admin");
  check(
    "admin users (filter+paginate)",
    (await call("GET", "/admin/users?role=CANDIDATE&page=1&limit=5&sortBy=createdAt", admin))
      .status === 200,
  );
  const me = await call("GET", "/users/me", candB);
  const candBId = me.json?.data?.id as string;
  check(
    "admin cannot change own role -> 400",
    (
      await call(
        "PATCH",
        `/admin/users/${(await call("GET", "/users/me", admin)).json?.data?.id}/role`,
        admin,
        { role: "COMPANY" },
      )
    ).status === 400,
  );
  check(
    "admin suspends user",
    (await call("PATCH", `/admin/users/${candBId}/status`, admin, { status: "SUSPENDED" }))
      .status === 200,
  );
  check("suspended user blocked -> 403", (await call("GET", "/users/me", candB)).status === 403);
  check(
    "admin reactivates user",
    (await call("PATCH", `/admin/users/${candBId}/status`, admin, { status: "ACTIVE" })).status ===
      200,
  );
  check(
    "admin assessments",
    (await call("GET", "/admin/assessments?status=CLOSED", admin)).status === 200,
  );
  check(
    "admin payments",
    (await call("GET", "/admin/payments?status=COMPLETED", admin)).status === 200,
  );
  check(
    "admin dashboard stats",
    (await call("GET", "/admin/dashboard-stats", admin)).status === 200,
  );
  const logs = await call("GET", "/admin/audit-logs?entity=Attempt&page=1&limit=5", admin);
  check("admin audit logs", logs.status === 200 && logs.json?.data?.length >= 1, logs.json);
  check(
    "admin can read any payment",
    (await call("GET", `/payments/${paymentId}`, admin)).status === 200,
  );

  section("Auth tokens");
  check("refresh token", (await call("POST", "/auth/refresh-token", candA)).status === 200);

  summary();
}

function summary() {
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`Failed checks:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
