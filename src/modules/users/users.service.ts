import type { Request } from "express";
import { uploadBuffer } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { logAudit } from "../audit/audit.service";
import { getMe } from "../auth/auth.service";

export const getProfile = getMe;

export const updateMe = async (userId: string, data: { name?: string }) => {
  await prisma.user.update({ where: { id: userId }, data });
  return getMe(userId);
};

export const updateProfile = async (
  user: NonNullable<Request["user"]>,
  data: Record<string, unknown>,
) => {
  if (user.role === "COMPANY") {
    await prisma.companyProfile.update({ where: { userId: user.id }, data });
  } else if (user.role === "CANDIDATE") {
    await prisma.candidateProfile.update({ where: { userId: user.id }, data });
  } else {
    throw ApiError.forbidden("Admins do not have a profile");
  }
  return getMe(user.id);
};

export const uploadAsset = async (
  user: NonNullable<Request["user"]>,
  kind: "avatar" | "resume" | "logo",
  file: Express.Multer.File | undefined,
) => {
  if (!file) throw ApiError.badRequest("A file is required (multipart field name: file)");

  if (kind === "logo" && user.role !== "COMPANY")
    throw ApiError.forbidden("Only companies have a logo");
  if (kind !== "logo" && user.role !== "CANDIDATE") {
    throw ApiError.forbidden("Only candidates can upload an avatar or resume");
  }

  const { url } = await uploadBuffer(file.buffer, { folder: `${kind}s` });
  if (kind === "logo") {
    await prisma.companyProfile.update({ where: { userId: user.id }, data: { logoUrl: url } });
  } else {
    await prisma.candidateProfile.update({
      where: { userId: user.id },
      data: kind === "avatar" ? { avatarUrl: url } : { resumeUrl: url },
    });
  }
  return { url };
};

export const softDeleteMe = async (userId: string, req: Request) => {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    await logAudit(
      { actorId: userId, action: "USER_SELF_DELETED", entity: "User", entityId: userId, req },
      tx,
    );
  });
};
