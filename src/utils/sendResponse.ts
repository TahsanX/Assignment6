import type { Response } from "express";

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const sendResponse = <T>(
  res: Response,
  opts: { statusCode?: number; message: string; data?: T; meta?: Meta },
) => {
  const body: Record<string, unknown> = {
    success: true,
    message: opts.message,
    data: opts.data ?? null,
  };
  if (opts.meta) body.meta = opts.meta;
  return res.status(opts.statusCode ?? 200).json(body);
};
