import { Router } from "express";
import Joi from "joi";
import { authenticate, authorize } from "../../middlewares/auth";
import { paymentLimiter } from "../../middlewares/rateLimit";
import { validate } from "../../middlewares/validate";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./payments.service";

export const paymentsRouter = Router();

const idParam = validate(Joi.object({ id: Joi.string().uuid().required() }), "params");

/* ---- bKash-facing endpoint (no bearer token; authenticity is verified by executing with bKash) ---- */

paymentsRouter.get(
  "/bkash/callback",
  validate(
    Joi.object({
      paymentID: Joi.string().min(5).max(100).required(),
      status: Joi.string().valid("success", "failure", "cancel").required(),
    }).unknown(true),
    "query",
  ),
  catchAsync(async (req, res) => {
    const data = await service.handleCallback(
      String(req.query.paymentID),
      String(req.query.status),
    );
    sendResponse(res, { message: data.message, data });
  }),
);

/* ---- Authenticated endpoints ---- */

paymentsRouter.post(
  "/initiate",
  authenticate,
  authorize("COMPANY"),
  paymentLimiter,
  validate(Joi.object({ assessmentId: Joi.string().uuid().required() })),
  catchAsync(async (req, res) => {
    const data = await service.initiatePayment(req.user!.id, req.body.assessmentId, req);
    sendResponse(res, { statusCode: 201, message: "bKash payment created", data });
  }),
);

paymentsRouter.get(
  "/",
  authenticate,
  authorize("COMPANY"),
  validate(
    Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(10),
      status: Joi.string().valid("INITIATED", "PENDING", "COMPLETED", "FAILED", "CANCELLED"),
      assessmentId: Joi.string().uuid(),
    }),
    "query",
  ),
  catchAsync(async (req, res) => {
    const { items, meta } = await service.listPayments(req.user!.id, req.query);
    sendResponse(res, { message: "Payments fetched", data: items, meta });
  }),
);

paymentsRouter.get(
  "/:id",
  authenticate,
  authorize("COMPANY", "ADMIN"),
  idParam,
  catchAsync(async (req, res) => {
    const data = await service.getPayment(req.user!, String(req.params.id));
    sendResponse(res, { message: "Payment fetched", data });
  }),
);

paymentsRouter.post(
  "/:id/refresh",
  authenticate,
  authorize("COMPANY"),
  paymentLimiter,
  idParam,
  catchAsync(async (req, res) => {
    const data = await service.refreshPayment(req.user!.id, String(req.params.id));
    sendResponse(res, { message: "Payment status synced with bKash", data });
  }),
);
