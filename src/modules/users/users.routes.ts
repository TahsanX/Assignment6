import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { uploadLimiter } from "../../middlewares/rateLimit";
import { uploadImage, uploadResume } from "../../middlewares/upload";
import { validate } from "../../middlewares/validate";
import * as controller from "./users.controller";
import { candidateProfileSchema, companyProfileSchema, updateMeSchema } from "./users.validation";

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get("/me", controller.getMe);
usersRouter.patch("/me", validate(updateMeSchema), controller.updateMe);
usersRouter.delete("/me", controller.deleteMe);

usersRouter.put(
  "/me/profile/company",
  authorize("COMPANY"),
  validate(companyProfileSchema),
  controller.updateProfile,
);
usersRouter.put(
  "/me/profile/candidate",
  authorize("CANDIDATE"),
  validate(candidateProfileSchema),
  controller.updateProfile,
);

usersRouter.post(
  "/me/avatar",
  authorize("CANDIDATE"),
  uploadLimiter,
  uploadImage,
  controller.uploadAvatar,
);
usersRouter.post(
  "/me/resume",
  authorize("CANDIDATE"),
  uploadLimiter,
  uploadResume,
  controller.uploadResume,
);
usersRouter.post(
  "/me/logo",
  authorize("COMPANY"),
  uploadLimiter,
  uploadImage,
  controller.uploadLogo,
);
