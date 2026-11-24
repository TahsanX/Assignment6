import Joi from "joi";

export const createAssessmentSchema = Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().max(5000).allow(""),
  durationMins: Joi.number().integer().min(5).max(480).required(),
  passMarks: Joi.number().integer().min(0).default(0),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().greater(Joi.ref("startsAt")).allow(null),
  candidateSlots: Joi.number().integer().min(1).max(1000).default(10),
  maxAttempts: Joi.number().integer().min(1).max(3).default(1),
});

export const updateAssessmentSchema = Joi.object({
  title: Joi.string().trim().min(3).max(200),
  description: Joi.string().trim().max(5000).allow(""),
  durationMins: Joi.number().integer().min(5).max(480),
  passMarks: Joi.number().integer().min(0),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().allow(null),
  candidateSlots: Joi.number().integer().min(1).max(1000),
  maxAttempts: Joi.number().integer().min(1).max(3),
}).min(1);

export const listAssessmentsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid("DRAFT", "PENDING_PAYMENT", "PUBLISHED", "CLOSED"),
  q: Joi.string().trim().max(100),
  sortBy: Joi.string().valid("createdAt", "title", "durationMins", "endsAt").default("createdAt"),
  order: Joi.string().valid("asc", "desc").default("desc"),
});

export const attachProblemsSchema = Joi.object({
  problemIds: Joi.array().items(Joi.string().uuid()).min(1).max(50).unique().required(),
});

export const reorderProblemsSchema = Joi.object({
  order: Joi.array().items(Joi.string().uuid()).min(1).unique().required(),
});

export const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });

export const problemParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
  problemId: Joi.string().uuid().required(),
});
