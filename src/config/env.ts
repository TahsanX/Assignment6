import dotenv from "dotenv";
import Joi from "joi";

dotenv.config();

const str = (def = "") => Joi.string().allow("").default(def);

const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  PORT: Joi.number().default(5000),
  APP_URL: Joi.string().default("http://localhost:5000"),
  CLIENT_URL: Joi.string().default("http://localhost:3000"),
  CORS_ORIGINS: Joi.string().default("http://localhost:3000"),
  DATABASE_URL: Joi.string().required(),
  DIRECT_URL: str(),
  CLERK_PUBLISHABLE_KEY: str(),
  CLERK_SECRET_KEY: str(),
  CLERK_WEBHOOK_SECRET: str(),
  UPSTASH_REDIS_REST_URL: str(),
  UPSTASH_REDIS_REST_TOKEN: str(),
  RESEND_API_KEY: str(),
  EMAIL_FROM: Joi.string().default("CodeAssess <onboarding@resend.dev>"),
  CLOUDINARY_CLOUD_NAME: str(),
  CLOUDINARY_API_KEY: str(),
  CLOUDINARY_API_SECRET: str(),
  BKASH_BASE_URL: Joi.string().uri().default("https://tokenized.sandbox.bka.sh/v1.2.0-beta"),
  BKASH_APP_KEY: str(),
  BKASH_APP_SECRET: str(),
  BKASH_USERNAME: str(),
  BKASH_PASSWORD: str(),
  PAYMENT_CURRENCY: Joi.string().default("BDT"),
  PRICE_PER_CANDIDATE_SLOT: Joi.number().positive().default(100),
  ADMIN_EMAIL: Joi.string().email().default("admin@codeassess.dev"),
  ADMIN_PASSWORD: Joi.string().default("ChangeMe123!"),
}).unknown(true);

const { value, error } = schema.validate(process.env, { abortEarly: false });
if (error) {
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

export const env = value as {
  NODE_ENV: string;
  PORT: number;
  APP_URL: string;
  CLIENT_URL: string;
  CORS_ORIGINS: string;
  DATABASE_URL: string;
  DIRECT_URL: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  BKASH_BASE_URL: string;
  BKASH_APP_KEY: string;
  BKASH_APP_SECRET: string;
  BKASH_USERNAME: string;
  BKASH_PASSWORD: string;
  PAYMENT_CURRENCY: string;
  PRICE_PER_CANDIDATE_SLOT: number;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
};

export const isProd = env.NODE_ENV === "production";
