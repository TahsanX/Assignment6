import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProd } from "./config/env";
import { errorHandler, notFound } from "./middlewares/errorHandler";
import { globalLimiter } from "./middlewares/rateLimit";
import { apiRouter } from "./routes";

export const createApp = (): Express => {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());

  const origins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origins.includes("*") || origins.includes(origin)) return cb(null, true);
        // Unknown origin: omit CORS headers (browser blocks it) instead of throwing a 500.
        return cb(null, false);
      },
      credentials: true,
    }),
  );

  app.use(morgan(isProd ? "combined" : "dev"));

  // Raw body routes (webhooks) are mounted by the router before JSON parsing where needed.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(globalLimiter);

  app.get("/", (_req, res) => {
    res.json({ success: true, message: "CodeAssess API is running", data: { version: "v1" } });
  });
  app.get("/health", (_req, res) => {
    res.json({ success: true, message: "OK", data: { uptime: process.uptime() } });
  });

  app.use("/api/v1", apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
};
