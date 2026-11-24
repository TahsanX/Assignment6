import { Router } from "express";
import Joi from "joi";
import { authenticate, authorize } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./admin.service";

const page = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
};
const idParam = validate(Joi.object({ id: Joi.string().uuid().required() }), "params");

export const adminRouter = Router();
adminRouter.use(authenticate, authorize("ADMIN"));

/* Users */
adminRouter.get(
  "/users",
  validate(
    Joi.object({
      ...page,
      role: Joi.string().valid("ADMIN", "COMPANY", "CANDIDATE"),
      status: Joi.string().valid("ACTIVE", "SUSPENDED"),
      q: Joi.string().trim().max(100),
      includeDeleted: Joi.boolean().default(false),
      sortBy: Joi.string().valid("createdAt", "name", "email").default("createdAt"),
      order: Joi.string().valid("asc", "desc").default("desc"),
    }),
    "query",
  ),
  catchAsync(async (req, res) => {
    const { items, meta } = await service.listUsers(req.query);
    sendResponse(res, { message: "Users fetched", data: items, meta });
  }),
);

adminRouter.patch(
  "/users/:id/role",
  idParam,
  validate(Joi.object({ role: Joi.string().valid("ADMIN", "COMPANY", "CANDIDATE").required() })),
  catchAsync(async (req, res) => {
    const data = await service.changeRole(req.user!.id, String(req.params.id), req.body.role, req);
    sendResponse(res, { message: "User role updated", data });
  }),
);

adminRouter.patch(
  "/users/:id/status",
  idParam,
  validate(Joi.object({ status: Joi.string().valid("ACTIVE", "SUSPENDED").required() })),
  catchAsync(async (req, res) => {
    const data = await service.changeStatus(
      req.user!.id,
      String(req.params.id),
      req.body.status,
      req,
    );
    sendResponse(res, { message: "User status updated", data });
  }),
);

/* Assessments */
adminRouter.get(
  "/assessments",
  validate(
    Joi.object({
      ...page,
      status: Joi.string().valid("DRAFT", "PENDING_PAYMENT", "PUBLISHED", "CLOSED"),
      companyId: Joi.string().uuid(),
      q: Joi.string().trim().max(100),
      includeDeleted: Joi.boolean().default(false),
    }),
    "query",
  ),
  catchAsync(async (req, res) => {
    const { items, meta } = await service.listAssessments(req.query);
    sendResponse(res, { message: "Assessments fetched", data: items, meta });
  }),
);

adminRouter.patch(
  "/assessments/:id/moderate",
  idParam,
  validate(
    Joi.object({
      action: Joi.string().valid("TAKEDOWN", "REMOVE").required(),
      note: Joi.string().trim().min(3).max(500).required(),
    }),
  ),
  catchAsync(async (req, res) => {
    const data = await service.moderateAssessment(
      req.user!.id,
      String(req.params.id),
      req.body,
      req,
    );
    sendResponse(res, { message: "Assessment moderated", data });
  }),
);

/* Payments */
adminRouter.get(
  "/payments",
  validate(
    Joi.object({
      ...page,
      status: Joi.string().valid("INITIATED", "PENDING", "COMPLETED", "FAILED", "CANCELLED"),
      companyId: Joi.string().uuid(),
    }),
    "query",
  ),
  catchAsync(async (req, res) => {
    const { items, meta } = await service.listPayments(req.query);
    sendResponse(res, { message: "Payments fetched", data: items, meta });
  }),
);

/* Stats & audit */
adminRouter.get(
  "/dashboard-stats",
  catchAsync(async (_req, res) => {
    sendResponse(res, { message: "Dashboard statistics", data: await service.dashboardStats() });
  }),
);

adminRouter.get(
  "/audit-logs",
  validate(
    Joi.object({
      ...page,
      action: Joi.string().max(60),
      entity: Joi.string().max(60),
      entityId: Joi.string().max(60),
      actorId: Joi.string().uuid(),
      from: Joi.date().iso(),
      to: Joi.date().iso(),
    }),
    "query",
  ),
  catchAsync(async (req, res) => {
    const { items, meta } = await service.listAuditLogs(req.query);
    sendResponse(res, { message: "Audit logs fetched", data: items, meta });
  }),
);

/** Public, cached marketing counters (no auth). */
export const publicRouter = Router();
publicRouter.get(
  "/stats",
  catchAsync(async (_req, res) => {
    sendResponse(res, { message: "Platform statistics", data: await service.publicStats() });
  }),
);
