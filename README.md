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

## API overview (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/onboard` · `POST /auth/refresh-token` · `POST /auth/logout` · `POST /webhooks/clerk` |
| Users | `GET/PATCH/DELETE /users/me` · `PUT /users/me/profile/{company,candidate}` · `POST /users/me/{avatar,resume,logo}` |
| Problems | `POST/GET /problems` · `GET /problems/search` · `GET/PATCH/DELETE /problems/:id` |
| Assessments | `POST/GET /assessments` · `GET/PATCH/DELETE /assessments/:id` · `POST /:id/problems` · `PUT /:id/problems/reorder` · `DELETE /:id/problems/:problemId` · `POST /:id/publish-request` · `POST /:id/close` |
| Invitations | `POST/GET /assessments/:id/invitations` · `DELETE /invitations/:id` · `POST /invitations/accept` · `GET /invitations/mine` |
| Attempts | `POST /assessments/:id/attempts` · `GET /attempts/:id` · `PUT /attempts/:id/answers/:problemId` · `POST /attempts/:id/events` · `POST /attempts/:id/submit` · `GET /attempts/mine` · `GET /attempts/:id/result` |
| Evaluation | `GET /assessments/:id/submissions` · `GET /submissions/:attemptId` · `PATCH /answers/:id/evaluate` · `POST /submissions/:attemptId/finalize` · `POST /assessments/:id/release-results` |
| Reports | `GET /assessments/:id/report` · `GET /assessments/:id/report/export` (CSV) |
| Payments | `POST /payments/initiate` · `POST /payments/webhook` · `GET /payments/success` · `GET /payments/cancel` · `GET /payments` · `GET /payments/:id` · `POST /payments/:id/refresh` |
| Notifications | `GET /notifications` · `PATCH /notifications/:id/read` |
| Admin | `GET /admin/users` · `PATCH /admin/users/:id/{role,status}` · `GET /admin/assessments` · `PATCH /admin/assessments/:id/moderate` · `GET /admin/payments` · `GET /admin/dashboard-stats` · `GET /admin/audit-logs` |
| Public | `GET /health` · `GET /api/v1/public/stats` |

List endpoints support `page`, `limit`, filters, `q` search and `sortBy`/`order`. Full examples: `postman/collection.json`.

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
