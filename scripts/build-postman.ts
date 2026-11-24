/** Generates postman/collection.json from the endpoint table below. Run: npm run docs:postman */
import fs from "node:fs";
import path from "node:path";

type Tok = "admin" | "company" | "candidate" | null;
interface Ep {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  tok: Tok;
  body?: unknown;
  desc?: string;
  headers?: Record<string, string>;
}

const folders: Record<string, Ep[]> = {
  "Health & Public": [
    { name: "Health", method: "GET", path: "/../health", tok: null },
    { name: "Public stats (cached)", method: "GET", path: "/public/stats", tok: null },
  ],
  Auth: [
    {
      name: "Onboard (choose COMPANY or CANDIDATE, once)",
      method: "POST",
      path: "/auth/onboard",
      tok: "company",
      body: { role: "COMPANY", companyName: "Northwind Labs" },
    },
    {
      name: "Refresh token (works with an expired token)",
      method: "POST",
      path: "/auth/refresh-token",
      tok: "candidate",
    },
    {
      name: "Logout (revokes Clerk session)",
      method: "POST",
      path: "/auth/logout",
      tok: "candidate",
    },
    {
      name: "Clerk webhook (svix signed)",
      method: "POST",
      path: "/webhooks/clerk",
      tok: null,
      body: { type: "user.updated", data: {} },
      desc: "Called by Clerk. Requires svix headers.",
    },
  ],
  Users: [
    { name: "Get my profile", method: "GET", path: "/users/me", tok: "company" },
    {
      name: "Update my name",
      method: "PATCH",
      path: "/users/me",
      tok: "company",
      body: { name: "Farhana Rahman" },
    },
    {
      name: "Update company profile",
      method: "PUT",
      path: "/users/me/profile/company",
      tok: "company",
      body: {
        companyName: "Northwind Labs",
        website: "https://northwind-labs.dev",
        description: "Backend hiring",
      },
    },
    {
      name: "Update candidate profile",
      method: "PUT",
      path: "/users/me/profile/candidate",
      tok: "candidate",
      body: {
        headline: "Backend developer",
        skills: ["typescript", "node"],
        github: "https://github.com/example",
      },
    },
    {
      name: "Upload candidate avatar (multipart: file)",
      method: "POST",
      path: "/users/me/avatar",
      tok: "candidate",
      desc: "form-data, key: file (jpg/png/webp, max 2MB)",
    },
    {
      name: "Upload candidate resume (multipart: file)",
      method: "POST",
      path: "/users/me/resume",
      tok: "candidate",
      desc: "form-data, key: file (pdf, max 5MB)",
    },
    {
      name: "Upload company logo (multipart: file)",
      method: "POST",
      path: "/users/me/logo",
      tok: "company",
      desc: "form-data, key: file (jpg/png/webp, max 2MB)",
    },
    { name: "Delete my account (soft)", method: "DELETE", path: "/users/me", tok: "candidate" },
  ],
  Problems: [
    {
      name: "Create MCQ problem",
      method: "POST",
      path: "/problems",
      tok: "company",
      body: {
        type: "MCQ",
        title: "Which status code means Created?",
        body: "Pick the correct code.",
        difficulty: "EASY",
        tags: ["http"],
        points: 10,
        options: [
          { id: "a", text: "200" },
          { id: "b", text: "201" },
        ],
        correctAnswer: ["b"],
      },
    },
    {
      name: "Create WRITTEN problem",
      method: "POST",
      path: "/problems",
      tok: "company",
      body: {
        type: "WRITTEN",
        title: "Explain database indexes",
        body: "When do they help or hurt?",
        points: 20,
      },
    },
    {
      name: "Create CODING problem",
      method: "POST",
      path: "/problems",
      tok: "company",
      body: {
        type: "CODING",
        title: "Reverse a string",
        body: "Reverse a string without built-ins.",
        points: 20,
        testCases: [{ input: "abc", expectedOutput: "cba" }],
      },
    },
    {
      name: "List problems (paginate/filter/sort)",
      method: "GET",
      path: "/problems?page=1&limit=10&type=MCQ&difficulty=EASY&q=status&sortBy=createdAt&order=desc",
      tok: "company",
    },
    { name: "Search problems", method: "GET", path: "/problems/search?q=index", tok: "company" },
    { name: "Get problem", method: "GET", path: "/problems/{{problemId}}", tok: "company" },
    {
      name: "Update problem",
      method: "PATCH",
      path: "/problems/{{problemId}}",
      tok: "company",
      body: { points: 15 },
    },
    {
      name: "Delete problem (soft)",
      method: "DELETE",
      path: "/problems/{{problemId}}",
      tok: "company",
    },
  ],
  Assessments: [
    {
      name: "Create assessment",
      method: "POST",
      path: "/assessments",
      tok: "company",
      body: {
        title: "Backend Screening",
        description: "MCQ + written + coding",
        durationMins: 45,
        passMarks: 20,
        candidateSlots: 3,
        maxAttempts: 1,
      },
    },
    {
      name: "List assessments",
      method: "GET",
      path: "/assessments?status=DRAFT&q=backend&sortBy=createdAt&order=desc&page=1&limit=10",
      tok: "company",
    },
    {
      name: "List assessments (candidate: invited only)",
      method: "GET",
      path: "/assessments",
      tok: "candidate",
    },
    {
      name: "Get assessment",
      method: "GET",
      path: "/assessments/{{assessmentId}}",
      tok: "company",
    },
    {
      name: "Update assessment (DRAFT only)",
      method: "PATCH",
      path: "/assessments/{{assessmentId}}",
      tok: "company",
      body: { durationMins: 60 },
    },
    {
      name: "Delete assessment (soft)",
      method: "DELETE",
      path: "/assessments/{{assessmentId}}",
      tok: "company",
    },
    {
      name: "Attach problems",
      method: "POST",
      path: "/assessments/{{assessmentId}}/problems",
      tok: "company",
      body: { problemIds: ["{{problemId}}"] },
    },
    {
      name: "Reorder problems",
      method: "PUT",
      path: "/assessments/{{assessmentId}}/problems/reorder",
      tok: "company",
      body: { order: ["{{problemId}}"] },
    },
    {
      name: "Detach problem",
      method: "DELETE",
      path: "/assessments/{{assessmentId}}/problems/{{problemId}}",
      tok: "company",
    },
    {
      name: "Request publish (-> PENDING_PAYMENT)",
      method: "POST",
      path: "/assessments/{{assessmentId}}/publish-request",
      tok: "company",
    },
    {
      name: "Close assessment",
      method: "POST",
      path: "/assessments/{{assessmentId}}/close",
      tok: "company",
    },
  ],
  Invitations: [
    {
      name: "Invite candidates (bulk)",
      method: "POST",
      path: "/assessments/{{assessmentId}}/invitations",
      tok: "company",
      body: { emails: ["nusrat.jahan@example.com", "arif.chowdhury@example.com"] },
    },
    {
      name: "List invitations",
      method: "GET",
      path: "/assessments/{{assessmentId}}/invitations?status=PENDING&page=1&limit=10",
      tok: "company",
    },
    {
      name: "Revoke invitation",
      method: "DELETE",
      path: "/invitations/{{invitationId}}",
      tok: "company",
    },
    {
      name: "Accept invitation (token from email)",
      method: "POST",
      path: "/invitations/accept",
      tok: "candidate",
      body: { token: "{{inviteToken}}" },
    },
    { name: "My invitations", method: "GET", path: "/invitations/mine", tok: "candidate" },
  ],
  Attempts: [
    {
      name: "Start attempt",
      method: "POST",
      path: "/assessments/{{assessmentId}}/attempts",
      tok: "candidate",
    },
    {
      name: "Get attempt (questions + time left)",
      method: "GET",
      path: "/attempts/{{attemptId}}",
      tok: "candidate",
    },
    {
      name: "Autosave answer (MCQ)",
      method: "PUT",
      path: "/attempts/{{attemptId}}/answers/{{problemId}}",
      tok: "candidate",
      body: { response: { selected: ["b"] } },
      desc: "WRITTEN: {text}. CODING: {language, code}",
    },
    {
      name: "Record anti-cheat event",
      method: "POST",
      path: "/attempts/{{attemptId}}/events",
      tok: "candidate",
      body: { type: "TAB_SWITCH" },
    },
    {
      name: "Submit attempt",
      method: "POST",
      path: "/attempts/{{attemptId}}/submit",
      tok: "candidate",
    },
    {
      name: "My attempts",
      method: "GET",
      path: "/attempts/mine?status=SUBMITTED",
      tok: "candidate",
    },
    {
      name: "Attempt result (after release)",
      method: "GET",
      path: "/attempts/{{attemptId}}/result",
      tok: "candidate",
    },
  ],
  Evaluation: [
    {
      name: "List submissions",
      method: "GET",
      path: "/assessments/{{assessmentId}}/submissions?status=SUBMITTED&sortBy=score&order=desc",
      tok: "company",
    },
    {
      name: "Get submission detail",
      method: "GET",
      path: "/submissions/{{attemptId}}",
      tok: "company",
    },
    {
      name: "Evaluate answer",
      method: "PATCH",
      path: "/answers/{{answerId}}/evaluate",
      tok: "company",
      body: { score: 15, feedback: "Good explanation" },
    },
    {
      name: "Finalize submission",
      method: "POST",
      path: "/submissions/{{attemptId}}/finalize",
      tok: "company",
    },
    {
      name: "Release results",
      method: "POST",
      path: "/assessments/{{assessmentId}}/release-results",
      tok: "company",
    },
  ],
  Reports: [
    {
      name: "Assessment report (cached)",
      method: "GET",
      path: "/assessments/{{assessmentId}}/report",
      tok: "company",
    },
    {
      name: "Export CSV",
      method: "GET",
      path: "/assessments/{{assessmentId}}/report/export",
      tok: "company",
    },
  ],
  Payments: [
    {
      name: "Initiate Stripe checkout",
      method: "POST",
      path: "/payments/initiate",
      tok: "company",
      body: { assessmentId: "{{assessmentId}}" },
    },
    {
      name: "Success redirect (verifies with Stripe)",
      method: "GET",
      path: "/payments/success?session_id={{sessionId}}",
      tok: null,
    },
    {
      name: "Cancel redirect",
      method: "GET",
      path: "/payments/cancel?payment_id={{paymentId}}",
      tok: null,
    },
    {
      name: "Stripe webhook (signed)",
      method: "POST",
      path: "/payments/webhook",
      tok: null,
      body: {},
      desc: "Called by Stripe with Stripe-Signature header.",
    },
    {
      name: "List my payments",
      method: "GET",
      path: "/payments?status=COMPLETED&page=1&limit=10",
      tok: "company",
    },
    { name: "Get payment", method: "GET", path: "/payments/{{paymentId}}", tok: "company" },
    {
      name: "Re-sync payment with Stripe",
      method: "POST",
      path: "/payments/{{paymentId}}/refresh",
      tok: "company",
    },
  ],
  Notifications: [
    {
      name: "List notifications",
      method: "GET",
      path: "/notifications?unread=true",
      tok: "company",
    },
    {
      name: "Mark notification read",
      method: "PATCH",
      path: "/notifications/{{notificationId}}/read",
      tok: "company",
    },
  ],
  Admin: [
    {
      name: "List users",
      method: "GET",
      path: "/admin/users?role=CANDIDATE&q=nusrat&page=1&limit=10",
      tok: "admin",
    },
    {
      name: "Change user role",
      method: "PATCH",
      path: "/admin/users/{{userId}}/role",
      tok: "admin",
      body: { role: "COMPANY" },
    },
    {
      name: "Suspend / reactivate user",
      method: "PATCH",
      path: "/admin/users/{{userId}}/status",
      tok: "admin",
      body: { status: "SUSPENDED" },
    },
    {
      name: "List assessments",
      method: "GET",
      path: "/admin/assessments?status=PUBLISHED",
      tok: "admin",
    },
    {
      name: "Moderate assessment",
      method: "PATCH",
      path: "/admin/assessments/{{assessmentId}}/moderate",
      tok: "admin",
      body: { action: "TAKEDOWN", note: "Violates content policy" },
    },
    {
      name: "List payments",
      method: "GET",
      path: "/admin/payments?status=COMPLETED",
      tok: "admin",
    },
    { name: "Dashboard stats", method: "GET", path: "/admin/dashboard-stats", tok: "admin" },
    {
      name: "Audit logs",
      method: "GET",
      path: "/admin/audit-logs?entity=Assessment&page=1&limit=20",
      tok: "admin",
    },
  ],
};

const item = (e: Ep) => {
  const isHealth = e.path.startsWith("/../");
  const url = isHealth ? `{{baseUrl}}${e.path.slice(3)}` : `{{baseUrl}}/api/v1${e.path}`;
  const [pathPart, query] = url.split("?");
  return {
    name: e.name,
    request: {
      method: e.method,
      description: e.desc,
      header: [
        ...(e.body !== undefined ? [{ key: "Content-Type", value: "application/json" }] : []),
        ...(e.tok ? [{ key: "Authorization", value: `Bearer {{${e.tok}Token}}` }] : []),
      ],
      ...(e.body !== undefined && { body: { mode: "raw", raw: JSON.stringify(e.body, null, 2) } }),
      url: {
        raw: url,
        host: ["{{baseUrl}}"],
        path: pathPart.replace("{{baseUrl}}/", "").split("/"),
        ...(query && {
          query: query.split("&").map((q) => ({ key: q.split("=")[0], value: q.split("=")[1] })),
        }),
      },
    },
  };
};

const collection = {
  info: {
    name: "CodeAssess API",
    description:
      "Developer Assessment & Coding Platform. Roles: ADMIN, COMPANY, CANDIDATE. Auth: Clerk session JWT as Bearer token. Mint test tokens with `npx tsx scripts/get-test-token.ts <email>`.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:5000" },
    ...["admin", "company", "candidate"].map((r) => ({ key: `${r}Token`, value: "" })),
    ...[
      "problemId",
      "assessmentId",
      "invitationId",
      "inviteToken",
      "attemptId",
      "answerId",
      "paymentId",
      "sessionId",
      "notificationId",
      "userId",
    ].map((k) => ({ key: k, value: "" })),
  ],
  item: Object.entries(folders).map(([name, eps]) => ({ name, item: eps.map(item) })),
};

const out = path.join(__dirname, "..", "postman", "collection.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(collection, null, 2));
console.log(`Wrote ${out} (${Object.values(folders).flat().length} requests)`);
