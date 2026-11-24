import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./invitations.service";

export const create = catchAsync(async (req, res) => {
  const data = await service.createInvitations(
    req.user!.id,
    String(req.params.id),
    req.body.emails,
    req,
  );
  sendResponse(res, { statusCode: 201, message: "Invitations processed", data });
});

export const listForAssessment = catchAsync(async (req, res) => {
  const { items, meta } = await service.listInvitations(
    req.user!.id,
    String(req.params.id),
    req.query,
  );
  sendResponse(res, { message: "Invitations fetched", data: items, meta });
});

export const revoke = catchAsync(async (req, res) => {
  await service.revokeInvitation(req.user!.id, String(req.params.id), req);
  sendResponse(res, { message: "Invitation revoked" });
});

export const accept = catchAsync(async (req, res) => {
  const data = await service.acceptInvitation(req.user!, req.body.token, req);
  sendResponse(res, { message: "Invitation accepted", data });
});

export const mine = catchAsync(async (req, res) => {
  const { items, meta } = await service.myInvitations(req.user!, req.query);
  sendResponse(res, { message: "Your invitations", data: items, meta });
});
