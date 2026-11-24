import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { authLimiter } from "../../middlewares/rateLimit";
import { validate } from "../../middlewares/validate";
import * as controller from "./auth.controller";
import { onboardSchema } from "./auth.validation";

export const authRouter = Router();

authRouter.use(authLimiter);
authRouter.post("/onboard", authenticate, validate(onboardSchema), controller.onboard);
authRouter.get("/me", authenticate, controller.me);
authRouter.post("/refresh-token", controller.refresh);
authRouter.post("/logout", authenticate, controller.logout);

export const webhookRouter = Router();
webhookRouter.post("/clerk", controller.clerkWebhook);
