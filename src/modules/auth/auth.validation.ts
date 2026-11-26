import Joi from "joi";

export const onboardSchema = Joi.object({
  role: Joi.string().valid("COMPANY", "CANDIDATE").required(),
  companyName: Joi.string().trim().min(2).max(120).when("role", {
    is: "COMPANY",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  headline: Joi.string().trim().max(160).when("role", {
    is: "CANDIDATE",
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
});

export const loginSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  password: Joi.string().required(),
});

export const registerSchema = onboardSchema.keys({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(8).max(72).required(),
});
