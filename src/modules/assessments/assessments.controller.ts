import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./assessments.service";

const id = (req: { params: Record<string, any> }) => String(req.params.id);

export const create = catchAsync(async (req, res) => {
  const data = await service.createAssessment(req.user!.id, req.body, req);
  sendResponse(res, { statusCode: 201, message: "Assessment created", data });
});

export const list = catchAsync(async (req, res) => {
  const { items, meta } = await service.listAssessments(req.user!, req.query);
  sendResponse(res, { message: "Assessments fetched", data: items, meta });
});

export const getOne = catchAsync(async (req, res) => {
  const data = await service.getAssessment(req.user!, id(req));
  sendResponse(res, { message: "Assessment fetched", data });
});

export const update = catchAsync(async (req, res) => {
  const data = await service.updateAssessment(req.user!.id, id(req), req.body, req);
  sendResponse(res, { message: "Assessment updated", data });
});

export const remove = catchAsync(async (req, res) => {
  await service.deleteAssessment(req.user!.id, id(req), req);
  sendResponse(res, { message: "Assessment deleted" });
});

export const attach = catchAsync(async (req, res) => {
  const data = await service.attachProblems(req.user!.id, id(req), req.body.problemIds, req);
  sendResponse(res, { statusCode: 201, message: "Problems attached", data });
});

export const reorder = catchAsync(async (req, res) => {
  const data = await service.reorderProblems(req.user!.id, id(req), req.body.order, req);
  sendResponse(res, { message: "Problems reordered", data });
});

export const detach = catchAsync(async (req, res) => {
  await service.detachProblem(req.user!.id, id(req), String(req.params.problemId), req);
  sendResponse(res, { message: "Problem removed from assessment" });
});

export const publishRequest = catchAsync(async (req, res) => {
  const data = await service.requestPublish(req.user!.id, id(req), req);
  sendResponse(res, { message: "Assessment is awaiting payment to be published", data });
});

export const close = catchAsync(async (req, res) => {
  const data = await service.closeAssessment(req.user!.id, id(req), req);
  sendResponse(res, { message: "Assessment closed", data });
});
