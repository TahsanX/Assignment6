import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import * as controller from "./assessments.controller";
import {
  attachProblemsSchema,
  createAssessmentSchema,
  idParamSchema,
  listAssessmentsSchema,
  problemParamSchema,
  reorderProblemsSchema,
  updateAssessmentSchema,
} from "./assessments.validation";

export const assessmentsRouter = Router();
const idParam = validate(idParamSchema, "params");
const company = authorize("COMPANY");

assessmentsRouter.use(authenticate);

assessmentsRouter.post("/", company, validate(createAssessmentSchema), controller.create);
assessmentsRouter.get(
  "/",
  authorize("COMPANY", "CANDIDATE"),
  validate(listAssessmentsSchema, "query"),
  controller.list,
);
assessmentsRouter.get("/:id", authorize("COMPANY", "CANDIDATE"), idParam, controller.getOne);
assessmentsRouter.patch(
  "/:id",
  company,
  idParam,
  validate(updateAssessmentSchema),
  controller.update,
);
assessmentsRouter.delete("/:id", company, idParam, controller.remove);

assessmentsRouter.post(
  "/:id/problems",
  company,
  idParam,
  validate(attachProblemsSchema),
  controller.attach,
);
assessmentsRouter.put(
  "/:id/problems/reorder",
  company,
  idParam,
  validate(reorderProblemsSchema),
  controller.reorder,
);
assessmentsRouter.delete(
  "/:id/problems/:problemId",
  company,
  validate(problemParamSchema, "params"),
  controller.detach,
);

assessmentsRouter.post("/:id/publish-request", company, idParam, controller.publishRequest);
assessmentsRouter.post("/:id/close", company, idParam, controller.close);
