import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      clerkId: string;
      email: string;
      name: string;
      role: Role | null;
      sessionId?: string;
    }
    interface Request {
      user?: AuthUser;
      rawBody?: Buffer;
    }
  }
}
