import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { isProd } from "../config/env";
import { ApiError } from "../utils/ApiError";

export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let message = "Internal server error";
  let errors: unknown[] = [];

  if (err?.isJoi) {
    status = 422;
    message = "Validation failed";
    errors = err.details;
  } else if (err instanceof ApiError) {
    status = err.statusCode;
    message = err.message;
    errors = err.errors;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      status = 409;
      message = "A record with these unique values already exists";
      errors = [{ field: (err.meta?.target as string[] | undefined)?.join(", ") }];
    } else if (err.code === "P2025") {
      status = 404;
      message = "Record not found";
    } else if (err.code === "P2003") {
      status = 400;
      message = "Invalid reference to a related record";
    }
  } else if (err?.name === "MulterError") {
    status = 400;
    message = err.message;
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed JSON body";
  } else if (typeof err?.statusCode === "number" && err.statusCode < 500) {
    status = err.statusCode;
    message = err.message;
  }

  if (status >= 500) console.error(err);

  res.status(status).json({
    success: false,
    message,
    errors,
    ...(isProd || status < 500 ? {} : { stack: err?.stack }),
  });
};
