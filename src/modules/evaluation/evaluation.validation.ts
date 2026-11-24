import Joi from "joi";

export const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });
export const attemptParamSchema = Joi.object({ attemptId: Joi.string().uuid().required() });

export const listSubmissionsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid("SUBMITTED", "EXPIRED", "EVALUATED", "IN_PROGRESS"),
  passed: Joi.boolean(),
  minScore: Joi.number().integer().min(0),
  q: Joi.string().trim().max(100),
  sortBy: Joi.string().valid("score", "submittedAt", "startedAt").default("submittedAt"),
  order: Joi.string().valid("asc", "desc").default("desc"),
});

export const evaluateAnswerSchema = Joi.object({
  score: Joi.number().integer().min(0).required(),
  feedback: Joi.string().trim().max(2000).allow(""),
});
