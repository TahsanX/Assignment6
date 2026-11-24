import { Router } from "express";
import { authRouter, webhookRouter } from "./modules/auth/auth.routes";
import { problemsRouter } from "./modules/problems/problems.routes";
import { usersRouter } from "./modules/users/users.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/webhooks", webhookRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/problems", problemsRouter);
