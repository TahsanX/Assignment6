import Joi from "joi";

export const createInvitationsSchema = Joi.object({
  emails: Joi.array()
    .items(Joi.string().trim().lowercase().email())
    .min(1)
    .max(100)
    .unique()
    .required(),
});

export const listInvitationsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid("PENDING", "ACCEPTED", "EXPIRED", "REVOKED"),
  q: Joi.string().trim().max(100),
});

export const acceptInvitationSchema = Joi.object({
  token: Joi.string().trim().length(64).hex().required(),
});

export const idParamSchema = Joi.object({ id: Joi.string().uuid().required() });
