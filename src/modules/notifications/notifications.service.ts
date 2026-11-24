import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";

type Db = Prisma.TransactionClient | typeof prisma;

/** In-app notification. Pass a tx client to keep it atomic with the triggering change. */
export const notify = (
  userId: string,
  title: string,
  message: string,
  type = "GENERAL",
  db: Db = prisma,
) => db.notification.create({ data: { userId, title, message, type } });

export const listNotifications = async (userId: string, q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(q.unread === true && { isRead: false }),
  };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { items, unread, meta: buildMeta(page, limit, total) };
};

export const markRead = async (userId: string, id: string) => {
  const res = await prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
  if (!res.count) throw ApiError.notFound("Notification not found");
};
