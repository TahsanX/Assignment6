import { Router } from "express";
import { authRouter, webhookRouter } from "./modules/auth/auth.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/webhooks", webhookRouter);
