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
