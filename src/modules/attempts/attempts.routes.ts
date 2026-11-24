import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { attemptLimiter } from "../../middlewares/rateLimit";
import { validate } from "../../middlewares/validate";
import * as controller from "./attempts.controller";
import {
  answerParamSchema,
  eventSchema,
  idParamSchema,
  myAttemptsSchema,
  saveAnswerSchema,
} from "./attempts.validation";

const idParam = validate(idParamSchema, "params");

/** Mounted at /assessments/:id/attempts */
export const assessmentAttemptsRouter = Router({ mergeParams: true });
assessmentAttemptsRouter.post(
  "/",
  authenticate,
  authorize("CANDIDATE"),
  attemptLimiter,
  idParam,
  controller.start,
);

/** Mounted at /attempts */
export const attemptsRouter = Router();
attemptsRouter.use(authenticate, authorize("CANDIDATE"), attemptLimiter);
attemptsRouter.get("/mine", validate(myAttemptsSchema, "query"), controller.mine);
attemptsRouter.get("/:id", idParam, controller.getOne);
attemptsRouter.get("/:id/result", idParam, controller.result);
attemptsRouter.put(
  "/:id/answers/:problemId",
  validate(answerParamSchema, "params"),
  validate(saveAnswerSchema),
  controller.saveAnswer,
);
attemptsRouter.post("/:id/events", idParam, validate(eventSchema), controller.event);
attemptsRouter.post("/:id/submit", idParam, controller.submit);
