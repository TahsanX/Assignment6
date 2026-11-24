import Joi from "joi";

export const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });

export const answerParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
  problemId: Joi.string().uuid().required(),
});

export const saveAnswerSchema = Joi.object({
  response: Joi.object({
    selected: Joi.array().items(Joi.string().max(20)).max(8),
    text: Joi.string().allow("").max(20000),
    language: Joi.string().max(30),
    code: Joi.string().allow("").max(50000),
  })
    .min(1)
    .required(),
});

export const eventSchema = Joi.object({
  type: Joi.string()
    .valid("TAB_SWITCH", "WINDOW_BLUR", "COPY", "PASTE", "FULLSCREEN_EXIT", "RIGHT_CLICK")
    .required(),
  detail: Joi.string().max(200),
});

export const myAttemptsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid("IN_PROGRESS", "SUBMITTED", "EXPIRED", "EVALUATED"),
});
