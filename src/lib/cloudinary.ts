import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const uploadBuffer = (
  buffer: Buffer,
  opts: { folder: string; resourceType?: "image" | "raw" | "auto" },
): Promise<{ url: string; publicId: string }> => {
  if (!env.CLOUDINARY_CLOUD_NAME) {
    return Promise.reject(new ApiError(503, "File storage is not configured"));
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `codeassess/${opts.folder}`, resource_type: opts.resourceType ?? "auto" },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Upload failed"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
};
