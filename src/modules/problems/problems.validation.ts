import Joi from "joi";

const optionSchema = Joi.object({
  id: Joi.string().trim().max(20).required(),
  text: Joi.string().trim().max(500).required(),
});

const testCaseSchema = Joi.object({
  input: Joi.string().allow("").max(2000).required(),
  expectedOutput: Joi.string().allow("").max(2000).required(),
  hidden: Joi.boolean().default(false),
});

export const createProblemSchema = Joi.object({
  type: Joi.string().valid("MCQ", "WRITTEN", "CODING").required(),
  title: Joi.string().trim().min(3).max(200).required(),
  body: Joi.string().trim().min(5).max(10000).required(),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD").default("MEDIUM"),
  tags: Joi.array().items(Joi.string().trim().lowercase().max(30)).max(10).default([]),
  points: Joi.number().integer().min(1).max(100).default(10),
  options: Joi.array().items(optionSchema).min(2).max(8).unique("id").when("type", {
    is: "MCQ",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  correctAnswer: Joi.array().items(Joi.string()).min(1).when("type", {
    is: "MCQ",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  testCases: Joi.array().items(testCaseSchema).min(1).max(20).when("type", {
    is: "CODING",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

export const updateProblemSchema = Joi.object({
  title: Joi.string().trim().min(3).max(200),
  body: Joi.string().trim().min(5).max(10000),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD"),
  tags: Joi.array().items(Joi.string().trim().lowercase().max(30)).max(10),
  points: Joi.number().integer().min(1).max(100),
  options: Joi.array().items(optionSchema).min(2).max(8).unique("id"),
  correctAnswer: Joi.array().items(Joi.string()).min(1),
  testCases: Joi.array().items(testCaseSchema).min(1).max(20),
}).min(1);

export const listProblemsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  type: Joi.string().valid("MCQ", "WRITTEN", "CODING"),
  difficulty: Joi.string().valid("EASY", "MEDIUM", "HARD"),
  tag: Joi.string().trim().lowercase(),
  q: Joi.string().trim().max(100),
  sortBy: Joi.string().valid("createdAt", "title", "points", "difficulty").default("createdAt"),
  order: Joi.string().valid("asc", "desc").default("desc"),
});

export const searchProblemsSchema = Joi.object({
  q: Joi.string().trim().min(1).max(100).required(),
});

export const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });
