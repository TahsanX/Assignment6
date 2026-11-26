# CodeAssess — Developer Assessment & Coding Platform API

Companies build timed assessments (MCQ, written, coding), pay to publish them, invite candidates,
and review scored submissions and analytics. Candidates accept invitations, take a server-timed
attempt, and see results once released. Admins moderate the platform.

```
Project Name    : CodeAssess - Developer Assessment Platform (Backend)
Backend Repo    : https://github.com/TahsanX/Assignment6
Live API        : https://codeassess-backend.vercel.app (health: /health, API base: /api/v1)
API Docs        : postman/collection.json (import into Postman) / <published docs link>
Demo Video      : <fill>
Admin Email     : admin@codeassess.dev
Admin Password  : Admin#CodeAssess2026
```

## Stack

Node.js · TypeScript · Express · PostgreSQL (Supabase) · Prisma · Joi · Biome · Clerk (email/password +
Google) · Upstash Redis · Resend · Multer + Cloudinary · Stripe (Checkout).

## Architecture (MVC)

```
Route  ->  Middleware (auth, RBAC, rate limit, Joi validation)  ->  Controller  ->  Service  ->  Prisma (model)
```

```
src/
  app.ts, server.ts, routes.ts      app wiring, v1 router
  config/env.ts                     Joi-validated environment
  lib/                              prisma, redis (fail-open cache), clerk, stripe, cloudinary, mailer
  middlewares/                      auth, authorize, validate, rateLimit, upload, errorHandler
  modules/<name>/                   routes · controller · service · validation
    auth users problems assessments invitations attempts evaluation reports payments notifications admin audit
  utils/                            ApiError, sendResponse, catchAsync, pagination, shuffle, svix
prisma/                             schema.prisma, migrations, seed.ts
scripts/                            smoke.ts, get-test-token.ts, build-postman.ts
```

## Roles

| Role | Capabilities |
|---|---|
| `COMPANY` | Own problem bank, assessments, payment to publish, invitations, evaluation, reports |
| `CANDIDATE` | Profile/resume, accept invitations, take attempts, view released results |
| `ADMIN` | Users (role/status), moderation, all payments, dashboard stats, audit logs |

Only `COMPANY`/`CANDIDATE` can be chosen at onboarding; `ADMIN` is seeded or granted by an admin.

## Core workflow

1. Company creates problems and an assessment (`DRAFT`), attaches problems.
2. `POST /assessments/:id/publish-request` → `PENDING_PAYMENT` (price = slots × `PRICE_PER_CANDIDATE_SLOT`).
3. `POST /payments/initiate` → Stripe Checkout URL. Payment is verified by the **signed webhook** (and the
   success redirect, which re-reads the session from Stripe). Completion is idempotent and atomically
   moves the assessment to `PUBLISHED`.
4. Company invites candidates (capped by slots, hashed one-time tokens, emailed via Resend).
5. Candidate accepts → starts an attempt (row-locked transaction, one active attempt, server-side deadline,
   seeded question shuffle, no answers exposed) → autosaves → submits.
6. MCQs auto-grade; written/coding answers are scored by the company; finalize → release results.

State machine: `DRAFT → PENDING_PAYMENT → PUBLISHED → CLOSED` (all transitions go through one guarded function and are audited).

## Engineering notes

- **Concurrency:** `SELECT … FOR UPDATE` on the invitation (start attempt) and assessment (invite slots); a partial unique
  index allows only one `IN_PROGRESS` attempt per candidate/assessment; guarded `updateMany` makes submit/expire and
  payment settlement idempotent.
- **Timer:** deadline stored server-side; expired attempts are auto-graded lazily (on access) with a 5 s grace.
- **Caching/limits (Upstash):** cached problem lists, reports, dashboard and public stats (prefix invalidation);
  sliding-window rate limits (global, auth, attempts, payments, uploads). All Redis calls fail open.
- **Soft deletes:** users, problems, assessments, invitations. **Audit logs** written in the same transaction as the change.
- **Security:** Helmet, CORS allow-list, Bearer JWT (Clerk), role middleware, Joi validation on every body/query/param,
  CSV formula-injection guard, Stripe/Clerk webhook signature verification, hashed invitation tokens.
- **Response format:** `{ success, message, data[, meta] }` / `{ success:false, message, errors[] }`.

## API endpoints (`/api/v1`)

> All authenticated endpoints require `Authorization: Bearer <token>`. Obtain a token via `POST /auth/login`.
> Response envelope: `{ success, message, data[, meta] }` or `{ success: false, message, errors[] }`.

### Auth

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/auth/register` | No | — | Register with name, email, password (15+ chars), role |
| `POST` | `/auth/login` | No | — | Login with email + password; returns Bearer token (1 hr) |
| `POST` | `/auth/onboard` | Yes | any | Set role + create profile (one-time, after Google sign-in) |
| `POST` | `/auth/refresh-token` | Yes | any | Mint a new Clerk session token |
| `POST` | `/auth/logout` | Yes | any | Revoke current session |
| `POST` | `/webhooks/clerk` | Svix | — | Clerk user sync webhook (svix-verified) |

### Users & Profiles

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/users/me` | Yes | any | Get own user + profile |
| `PATCH` | `/users/me` | Yes | any | Update name |
| `DELETE` | `/users/me` | Yes | any | Soft-delete own account |
| `PUT` | `/users/me/profile/company` | Yes | COMPANY | Upsert company profile (name, website, description) |
| `PUT` | `/users/me/profile/candidate` | Yes | CANDIDATE | Upsert candidate profile (skills, github, headline) |
| `POST` | `/users/me/avatar` | Yes | CANDIDATE | Upload avatar image (Cloudinary) |
| `POST` | `/users/me/resume` | Yes | CANDIDATE | Upload resume PDF (Cloudinary) |
| `POST` | `/users/me/logo` | Yes | COMPANY | Upload company logo (Cloudinary) |

### Problems

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/problems` | Yes | COMPANY | Create problem (MCQ / WRITTEN / CODING) |
| `GET` | `/problems` | Yes | COMPANY | List own problems (`page`, `limit`, `type`, `difficulty`, `tag`, `q`, `sortBy`, `order`) |
| `GET` | `/problems/search` | Yes | COMPANY | Search problems by keyword (`q`) |
| `GET` | `/problems/:id` | Yes | COMPANY | Get single problem |
| `PATCH` | `/problems/:id` | Yes | COMPANY | Update problem |
| `DELETE` | `/problems/:id` | Yes | COMPANY | Soft-delete problem |

### Assessments

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/assessments` | Yes | COMPANY | Create assessment |
| `GET` | `/assessments` | Yes | COMPANY / CANDIDATE | List assessments (company: own; candidate: invited; `page`, `limit`, `status`, `q`, `sortBy`) |
| `GET` | `/assessments/:id` | Yes | COMPANY / CANDIDATE | Get single assessment |
| `PATCH` | `/assessments/:id` | Yes | COMPANY | Update assessment (DRAFT only) |
| `DELETE` | `/assessments/:id` | Yes | COMPANY | Soft-delete assessment |
| `POST` | `/assessments/:id/problems` | Yes | COMPANY | Attach problems to assessment |
| `PUT` | `/assessments/:id/problems/reorder` | Yes | COMPANY | Reorder attached problems |
| `DELETE` | `/assessments/:id/problems/:problemId` | Yes | COMPANY | Remove problem from assessment |
| `POST` | `/assessments/:id/publish-request` | Yes | COMPANY | Move to PENDING_PAYMENT (requires ≥1 problem) |
| `POST` | `/assessments/:id/close` | Yes | COMPANY | Close published assessment |

### Invitations

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/assessments/:id/invitations` | Yes | COMPANY | Bulk-invite candidates (up to 100 emails, capped by slots) |
| `GET` | `/assessments/:id/invitations` | Yes | COMPANY | List invitations for an assessment |
| `DELETE` | `/invitations/:id` | Yes | COMPANY | Revoke invitation |
| `POST` | `/invitations/accept` | Yes | CANDIDATE | Accept invitation by token |
| `GET` | `/invitations/mine` | Yes | CANDIDATE | List own invitations |

### Attempts

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/assessments/:id/attempts` | Yes | CANDIDATE | Start attempt (locked transaction; one active per candidate) |
| `GET` | `/attempts/mine` | Yes | CANDIDATE | List own attempts |
| `GET` | `/attempts/:id` | Yes | CANDIDATE | Get attempt + questions (no correct answers) + time left |
| `GET` | `/attempts/:id/result` | Yes | CANDIDATE | Get scored result (after company releases) |
| `PUT` | `/attempts/:id/answers/:problemId` | Yes | CANDIDATE | Autosave answer |
| `POST` | `/attempts/:id/events` | Yes | CANDIDATE | Log anti-cheat event (tab switch, etc.) |
| `POST` | `/attempts/:id/submit` | Yes | CANDIDATE | Submit attempt |

### Evaluation

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/assessments/:id/submissions` | Yes | COMPANY | List submissions for an assessment (`status`, `page`, `limit`) |
| `GET` | `/submissions/:attemptId` | Yes | COMPANY | Get full submission with all answers |
| `PATCH` | `/answers/:id/evaluate` | Yes | COMPANY | Score a written/coding answer (manualScore, feedback) |
| `POST` | `/submissions/:attemptId/finalize` | Yes | COMPANY | Finalize evaluation (marks attempt EVALUATED) |
| `POST` | `/assessments/:id/release-results` | Yes | COMPANY | Release results to candidates |

### Reports

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/assessments/:id/report` | Yes | COMPANY | Analytics: avg score, pass rate, per-problem stats, leaderboard (Redis-cached) |
| `GET` | `/assessments/:id/report/export` | Yes | COMPANY | Export report as CSV (formula-injection safe) |

### Payments

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/payments/initiate` | Yes | COMPANY | Create Stripe Checkout session for a PENDING_PAYMENT assessment |
| `POST` | `/payments/webhook` | Stripe | — | Stripe signed webhook (checkout.session.completed) |
| `GET` | `/payments/success` | No | — | Stripe success redirect; re-verifies session and publishes assessment |
| `GET` | `/payments/cancel` | No | — | Stripe cancel redirect; marks payment CANCELLED |
| `GET` | `/payments` | Yes | COMPANY | List own payments (`page`, `limit`, `status`, `assessmentId`) |
| `GET` | `/payments/:id` | Yes | COMPANY / ADMIN | Get single payment |
| `POST` | `/payments/:id/refresh` | Yes | COMPANY | Re-sync payment status from Stripe |

### Notifications

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/notifications` | Yes | any | List notifications (`page`, `limit`, `unread`) |
| `PATCH` | `/notifications/:id/read` | Yes | any | Mark notification as read |

### Admin

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/admin/users` | Yes | ADMIN | List users (`role`, `status`, `q`, `includeDeleted`, `sortBy`, `order`) |
| `PATCH` | `/admin/users/:id/role` | Yes | ADMIN | Change user role |
| `PATCH` | `/admin/users/:id/status` | Yes | ADMIN | Suspend or activate user |
| `GET` | `/admin/assessments` | Yes | ADMIN | List all assessments (`status`, `companyId`, `q`, `includeDeleted`) |
| `PATCH` | `/admin/assessments/:id/moderate` | Yes | ADMIN | Moderate assessment (TAKEDOWN / REMOVE + note) |
| `GET` | `/admin/payments` | Yes | ADMIN | List all payments (`status`, `companyId`) |
| `GET` | `/admin/dashboard-stats` | Yes | ADMIN | Platform-wide stats (cached) |
| `GET` | `/admin/audit-logs` | Yes | ADMIN | Audit logs (`action`, `entity`, `actorId`, `from`, `to`) |

### Public

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `GET` | `/public/stats` | No | Public platform counters (Redis-cached) |

## Local setup

```bash
npm install
cp .env.example .env            # fill in the keys
npx prisma migrate deploy       # applies prisma/migrations (uses DIRECT_URL)
npm run db:seed                 # admin + demo companies/candidates + problem bank (+ Clerk users if keys set)
npm run dev
```

Scripts: `npm run lint` (Biome) · `npm run typecheck` · `npm run build` · `npm run docs:postman` · `npm run smoke`.

### Testing without a frontend

`POST /api/v1/auth/login` with email + password returns a Bearer token (valid 1 hour):

| Role | Email | Password |
|---|---|---|
| ADMIN | admin@codeassess.dev | Admin#CodeAssess2026 |
| COMPANY | hiring@northwind-labs.dev | CodeAssess#2026 |
| CANDIDATE | nusrat.jahan@example.com | CodeAssess#2026 |

New accounts: `POST /api/v1/auth/register` (Clerk requires 15+ character passwords). Google login goes through Clerk.

```bash
TOKEN=$(npx tsx scripts/get-test-token.ts hiring@northwind-labs.dev)   # Clerk session JWT
curl -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/v1/users/me
BASE_URL=http://localhost:5000 npm run smoke                           # all roles end to end
```

Stripe: use test keys, card `4242 4242 4242 4242`. For webhooks run
`stripe listen --forward-to localhost:5000/api/v1/payments/webhook` and set `STRIPE_WEBHOOK_SECRET`
(or point a Stripe dashboard endpoint at `<live-url>/api/v1/payments/webhook`).
Clerk webhook (optional user sync): `<live-url>/api/v1/webhooks/clerk`.

## Deployment

- **Render:** `render.yaml` (build runs `prisma migrate deploy`). **Vercel:** `vercel.json` + `api/index.ts`.
- Use Supabase's pooled connection (port 6543, `pgbouncer=true`) for `DATABASE_URL` and the direct one for `DIRECT_URL`.
- Set `APP_URL` to the public API URL (used for Stripe redirect URLs) and every variable from `.env.example`.
