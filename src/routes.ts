import { Router } from "express";
import { authRouter, webhookRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/webhooks", webhookRouter);
apiRouter.use("/users", usersRouter);
