import { Router } from "express";
import Joi from "joi";
import { authenticate } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./notifications.service";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  "/",
  validate(
    Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      unread: Joi.boolean(),
    }),
    "query",
  ),
  catchAsync(async (req, res) => {
    const { items, unread, meta } = await service.listNotifications(req.user!.id, req.query);
    sendResponse(res, { message: "Notifications fetched", data: { items, unread }, meta });
  }),
);

notificationsRouter.patch(
  "/:id/read",
  validate(Joi.object({ id: Joi.string().uuid().required() }), "params"),
  catchAsync(async (req, res) => {
    await service.markRead(req.user!.id, String(req.params.id));
    sendResponse(res, { message: "Notification marked as read" });
  }),
);
