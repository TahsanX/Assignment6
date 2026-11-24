import type { Meta } from "./sendResponse";

export const getPagination = (q: { page?: number | string; limit?: number | string }) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 10));
  return { page, limit, skip: (page - 1) * limit, take: limit };
};

export const buildMeta = (page: number, limit: number, total: number): Meta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});
