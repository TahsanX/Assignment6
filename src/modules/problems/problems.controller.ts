import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./problems.service";

export const create = catchAsync(async (req, res) => {
  const data = await service.createProblem(req.user!.id, req.body, req);
  sendResponse(res, { statusCode: 201, message: "Problem created", data });
});

export const list = catchAsync(async (req, res) => {
  const { items, meta } = await service.listProblems(req.user!.id, req.query);
  sendResponse(res, { message: "Problems fetched", data: items, meta });
});

export const search = catchAsync(async (req, res) => {
  const data = await service.searchProblems(req.user!.id, String(req.query.q));
  sendResponse(res, { message: "Search results", data });
});

export const getOne = catchAsync(async (req, res) => {
  const data = await service.getProblem(req.user!.id, String(req.params.id));
  sendResponse(res, { message: "Problem fetched", data });
});

export const update = catchAsync(async (req, res) => {
  const data = await service.updateProblem(req.user!.id, String(req.params.id), req.body, req);
  sendResponse(res, { message: "Problem updated", data });
});

export const remove = catchAsync(async (req, res) => {
  await service.deleteProblem(req.user!.id, String(req.params.id), req);
  sendResponse(res, { message: "Problem deleted" });
});
