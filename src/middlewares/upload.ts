import multer from "multer";
import { ApiError } from "../utils/ApiError";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOC_TYPES = ["application/pdf"];

const build = (allowed: string[], maxMb: number) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (allowed.includes(file.mimetype)) return cb(null, true);
      cb(ApiError.badRequest(`Unsupported file type. Allowed: ${allowed.join(", ")}`));
    },
  });

export const uploadImage = build(IMAGE_TYPES, 2).single("file");
export const uploadResume = build(DOC_TYPES, 5).single("file");
