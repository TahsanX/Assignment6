import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

/**
 * Records a critical action. Pass a transaction client as `db` so the audit row is
 * committed atomically with the change it describes.
 */
export const logAudit = async (input: AuditInput, db: Db = prisma) => {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: input.req?.ip ?? null,
    },
  });
};
