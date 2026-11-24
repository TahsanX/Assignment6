import type { NextFunction, Request, Response } from "express";
import type Joi from "joi";

type Source = "body" | "query" | "params";

export const validate =
  (schema: Joi.ObjectSchema, source: Source = "body") =>
  (req: Request, _res: Response, next: NextFunction) => {
    const { value, error } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      return next(
        Object.assign(new Error("Validation failed"), {
          isJoi: true,
          details: error.details.map((d) => ({
            field: d.path.join("."),
            message: d.message.replace(/"/g, ""),
          })),
        }),
      );
    }
    if (source === "query") {
      // Express 5 exposes req.query as a getter, so redefine it with the validated value.
      Object.defineProperty(req, "query", { value, writable: true, configurable: true });
    } else {
      (req as any)[source] = value;
    }
    next();
  };
