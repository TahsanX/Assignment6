import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { authLimiter } from "../../middlewares/rateLimit";
import { validate } from "../../middlewares/validate";
import * as controller from "./auth.controller";
import { loginSchema, onboardSchema, registerSchema } from "./auth.validation";

export const authRouter = Router();

// Limiter must come first so login/register (the brute-force targets) are throttled too.
authRouter.use(authLimiter);
authRouter.post("/register", validate(registerSchema), controller.register);
authRouter.post("/login", validate(loginSchema), controller.login);
authRouter.post("/onboard", authenticate, validate(onboardSchema), controller.onboard);
authRouter.post("/refresh-token", controller.refresh);
authRouter.post("/logout", authenticate, controller.logout);

export const webhookRouter = Router();
webhookRouter.post("/clerk", controller.clerkWebhook);
