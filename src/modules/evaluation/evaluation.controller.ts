import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./evaluation.service";

const p = (v: unknown) => String(v);

export const listSubmissions = catchAsync(async (req, res) => {
  const { items, meta } = await service.listSubmissions(req.user!.id, p(req.params.id), req.query);
  sendResponse(res, { message: "Submissions fetched", data: items, meta });
});

export const getSubmission = catchAsync(async (req, res) => {
  const data = await service.getSubmission(req.user!.id, p(req.params.attemptId));
  sendResponse(res, { message: "Submission fetched", data });
});

export const evaluateAnswer = catchAsync(async (req, res) => {
  const data = await service.evaluateAnswer(req.user!.id, p(req.params.id), req.body, req);
  sendResponse(res, { message: "Answer evaluated", data });
});

export const finalize = catchAsync(async (req, res) => {
  const data = await service.finalizeSubmission(req.user!.id, p(req.params.attemptId), req);
  sendResponse(res, { message: "Submission finalised", data });
});

export const releaseResults = catchAsync(async (req, res) => {
  const data = await service.releaseResults(req.user!.id, p(req.params.id), req);
  sendResponse(res, { message: "Results released to candidates", data });
});
