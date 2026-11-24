import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import * as service from "./users.service";

export const getMe = catchAsync(async (req, res) => {
  sendResponse(res, { message: "Profile fetched", data: await service.getProfile(req.user!.id) });
});

export const updateMe = catchAsync(async (req, res) => {
  sendResponse(res, {
    message: "Profile updated",
    data: await service.updateMe(req.user!.id, req.body),
  });
});

export const updateProfile = catchAsync(async (req, res) => {
  sendResponse(res, {
    message: "Profile details updated",
    data: await service.updateProfile(req.user!, req.body),
  });
});

const upload = (kind: "avatar" | "resume" | "logo") =>
  catchAsync(async (req, res) => {
    const data = await service.uploadAsset(req.user!, kind, req.file);
    sendResponse(res, { statusCode: 201, message: `${kind} uploaded`, data });
  });

export const uploadAvatar = upload("avatar");
export const uploadResume = upload("resume");
export const uploadLogo = upload("logo");

export const deleteMe = catchAsync(async (req, res) => {
  await service.softDeleteMe(req.user!.id, req);
  sendResponse(res, { message: "Account deleted" });
});
