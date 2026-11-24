import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./attempts.service";

const p = (v: unknown) => String(v);

export const start = catchAsync(async (req, res) => {
  const data = await service.startAttempt(req.user!, p(req.params.id), req);
  sendResponse(res, { statusCode: 201, message: "Attempt started", data });
});

export const getOne = catchAsync(async (req, res) => {
  const data = await service.getAttempt(req.user!.id, p(req.params.id));
  sendResponse(res, { message: "Attempt fetched", data });
});

export const mine = catchAsync(async (req, res) => {
  const { items, meta } = await service.myAttempts(req.user!.id, req.query);
  sendResponse(res, { message: "Your attempts", data: items, meta });
});

export const saveAnswer = catchAsync(async (req, res) => {
  const data = await service.saveAnswer(
    req.user!.id,
    p(req.params.id),
    p(req.params.problemId),
    req.body.response,
  );
  sendResponse(res, { message: "Answer saved", data });
});

export const event = catchAsync(async (req, res) => {
  await service.recordEvent(req.user!.id, p(req.params.id), req.body);
  sendResponse(res, { statusCode: 202, message: "Event recorded" });
});

export const submit = catchAsync(async (req, res) => {
  const data = await service.submitAttempt(req.user!.id, p(req.params.id), req);
  sendResponse(res, { message: "Attempt submitted", data });
});

export const result = catchAsync(async (req, res) => {
  const data = await service.getResult(req.user!.id, p(req.params.id));
  sendResponse(res, { message: "Result fetched", data });
});
