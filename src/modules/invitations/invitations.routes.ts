import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import * as controller from "./invitations.controller";
import {
  acceptInvitationSchema,
  createInvitationsSchema,
  idParamSchema,
  listInvitationsSchema,
} from "./invitations.validation";

/** Mounted at /assessments/:id/invitations (company side). */
export const assessmentInvitationsRouter = Router({ mergeParams: true });
assessmentInvitationsRouter.use(
  authenticate,
  authorize("COMPANY"),
  validate(idParamSchema, "params"),
);
assessmentInvitationsRouter.post("/", validate(createInvitationsSchema), controller.create);
assessmentInvitationsRouter.get(
  "/",
  validate(listInvitationsSchema, "query"),
  controller.listForAssessment,
);

/** Mounted at /invitations. */
export const invitationsRouter = Router();
invitationsRouter.use(authenticate);
invitationsRouter.get(
  "/mine",
  authorize("CANDIDATE"),
  validate(listInvitationsSchema, "query"),
  controller.mine,
);
invitationsRouter.post(
  "/accept",
  authorize("CANDIDATE"),
  validate(acceptInvitationSchema),
  controller.accept,
);
invitationsRouter.delete(
  "/:id",
  authorize("COMPANY"),
  validate(idParamSchema, "params"),
  controller.revoke,
);
