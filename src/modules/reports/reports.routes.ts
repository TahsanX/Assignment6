import { Router } from "express";
import Joi from "joi";
import { authenticate, authorize } from "../../middlewares/auth";
import { validate } from "../../middlewares/validate";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./reports.service";

const idParam = validate(Joi.object({ id: Joi.string().uuid().required() }), "params");

/** Mounted at the API root alongside the other company-side assessment routes. */
export const reportsRouter = Router();

reportsRouter.get(
  "/assessments/:id/report",
  authenticate,
  authorize("COMPANY"),
  idParam,
  catchAsync(async (req, res) => {
    const data = await service.getReport(req.user!.id, String(req.params.id));
    sendResponse(res, { message: "Report generated", data });
  }),
);

reportsRouter.get(
  "/assessments/:id/report/export",
  authenticate,
  authorize("COMPANY"),
  idParam,
  catchAsync(async (req, res) => {
    const { filename, csv } = await service.exportCsv(req.user!.id, String(req.params.id));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);
