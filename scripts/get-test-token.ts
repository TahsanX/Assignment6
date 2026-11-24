/**
 * Mints a Clerk session JWT for an existing user so the API can be tested headlessly
 * (Postman / curl / smoke tests) without a frontend.
 *
 *   npx tsx scripts/get-test-token.ts admin@codeassess.dev
 *
 * Prints only the token on stdout so it can be captured: TOKEN=$(npx tsx scripts/get-test-token.ts <email>)
 */
import { createClerkClient } from "@clerk/backend";
import dotenv from "dotenv";

dotenv.config();

export const mintToken = async (email: string, expiresInSeconds = 3600) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  const clerk = createClerkClient({ secretKey });

  const users = await clerk.users.getUserList({ emailAddress: [email.toLowerCase()] });
  const user = users.data[0];
  if (!user) throw new Error(`No Clerk user with email ${email}`);

  const session = await clerk.sessions.createSession({ userId: user.id });
  const token = await clerk.sessions.getToken(session.id, undefined, expiresInSeconds);
  return { token: token.jwt, sessionId: session.id, userId: user.id };
};

if (require.main === module) {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx scripts/get-test-token.ts <email>");
    process.exit(1);
  }
  mintToken(email)
    .then((r) => console.log(r.token))
    .catch((e) => {
      console.error(e.message ?? e);
      process.exit(1);
    });
}
