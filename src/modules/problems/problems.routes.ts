import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import * as controller from "./problems.controller";
import {
  createProblemSchema,
  idParamSchema,
  listProblemsSchema,
  searchProblemsSchema,
  updateProblemSchema,
} from "./problems.validation";

export const problemsRouter = Router();

problemsRouter.use(authenticate, authorize("COMPANY"));

problemsRouter.post("/", validate(createProblemSchema), controller.create);
problemsRouter.get("/", validate(listProblemsSchema, "query"), controller.list);
problemsRouter.get("/search", validate(searchProblemsSchema, "query"), controller.search);
problemsRouter.get("/:id", validate(idParamSchema, "params"), controller.getOne);
problemsRouter.patch(
  "/:id",
  validate(idParamSchema, "params"),
  validate(updateProblemSchema),
  controller.update,
);
problemsRouter.delete("/:id", validate(idParamSchema, "params"), controller.remove);
