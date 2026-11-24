import Joi from "joi";

export const updateMeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
}).min(1);

export const companyProfileSchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(120),
  website: Joi.string().uri().allow(null, ""),
  description: Joi.string().trim().max(1000).allow(null, ""),
}).min(1);

export const candidateProfileSchema = Joi.object({
  headline: Joi.string().trim().max(160).allow(null, ""),
  skills: Joi.array().items(Joi.string().trim().min(1).max(40)).max(30),
  github: Joi.string().uri().allow(null, ""),
}).min(1);
