import { Router } from "express";
import { assessmentsRouter } from "./modules/assessments/assessments.routes";
import { assessmentAttemptsRouter, attemptsRouter } from "./modules/attempts/attempts.routes";
import { authRouter, webhookRouter } from "./modules/auth/auth.routes";
import { evaluationRouter } from "./modules/evaluation/evaluation.routes";
import {
  assessmentInvitationsRouter,
  invitationsRouter,
} from "./modules/invitations/invitations.routes";
import { problemsRouter } from "./modules/problems/problems.routes";
import { usersRouter } from "./modules/users/users.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/webhooks", webhookRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/problems", problemsRouter);
apiRouter.use(evaluationRouter);
apiRouter.use("/assessments/:id/invitations", assessmentInvitationsRouter);
apiRouter.use("/assessments/:id/attempts", assessmentAttemptsRouter);
apiRouter.use("/assessments", assessmentsRouter);
apiRouter.use("/attempts", attemptsRouter);
apiRouter.use("/invitations", invitationsRouter);
