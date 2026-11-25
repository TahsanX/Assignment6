import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Interactive transactions default to a 5 s timeout, which a remote pooled database
// (several round trips per transaction) can exceed under load. Allow more headroom.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 30_000 } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
