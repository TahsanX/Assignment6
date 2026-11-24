import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import * as controller from "./evaluation.controller";
import {
  attemptParamSchema,
  evaluateAnswerSchema,
  idParamSchema,
  listSubmissionsSchema,
} from "./evaluation.validation";

/**
 * Company-side evaluation routes. Mounted at the API root; each route applies its own
 * guards so it never intercepts unrelated paths.
 */
export const evaluationRouter = Router();
const guard = [authenticate, authorize("COMPANY")];

evaluationRouter.get(
  "/assessments/:id/submissions",
  ...guard,
  validate(idParamSchema, "params"),
  validate(listSubmissionsSchema, "query"),
  controller.listSubmissions,
);
evaluationRouter.post(
  "/assessments/:id/release-results",
  ...guard,
  validate(idParamSchema, "params"),
  controller.releaseResults,
);
evaluationRouter.get(
  "/submissions/:attemptId",
  ...guard,
  validate(attemptParamSchema, "params"),
  controller.getSubmission,
);
evaluationRouter.post(
  "/submissions/:attemptId/finalize",
  ...guard,
  validate(attemptParamSchema, "params"),
  controller.finalize,
);
evaluationRouter.patch(
  "/answers/:id/evaluate",
  ...guard,
  validate(idParamSchema, "params"),
  validate(evaluateAnswerSchema),
  controller.evaluateAnswer,
);
