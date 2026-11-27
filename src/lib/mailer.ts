import { Resend } from "resend";
import { env } from "../config/env";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const layout = (title: string, body: string) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
    <h2 style="color:#111827;margin-top:0">${title}</h2>
    ${body}
    <p style="color:#6b7280;font-size:12px;margin-top:32px">Sent by CodeAssess</p>
  </div>`;

/** Sends a transactional email. Never throws: email problems must not fail the API call. */
export const sendEmail = async (to: string, subject: string, title: string, bodyHtml: string) => {
  if (!resend) {
    console.warn(`[mailer] RESEND_API_KEY not set, skipping email "${subject}" to ${to}`);
    return false;
  }
  // Resend allows ~2 requests/second; back off and retry on rate-limit or transient errors.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { error } = await resend.emails.send({
        from: env.EMAIL_FROM,
        to,
        subject,
        html: layout(title, bodyHtml),
      });
      if (!error) return true;
      const retryable =
        error.name === "rate_limit_exceeded" ||
        error.name === "application_error" ||
        error.name === "internal_server_error";
      console.error(`[mailer] send to ${to} failed (try ${attempt}):`, error.name, error.message);
      if (!retryable) return false;
    } catch (e) {
      console.error(`[mailer] send to ${to} errored (try ${attempt}):`, e);
    }
    await sleep(600 * attempt);
  }
  return false;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends many emails one after another, spaced under Resend's rate limit. */
export const sendEmailsSequentially = async (
  items: { to: string; subject: string; title: string; body: string }[],
) => {
  const results: boolean[] = [];
  for (const [i, m] of items.entries()) {
    if (i > 0) await sleep(550);
    results.push(await sendEmail(m.to, m.subject, m.title, m.body));
  }
  return results;
};

export const invitationEmail = (opts: {
  companyName: string;
  assessmentTitle: string;
  durationMins: number;
  link: string;
  expiresAt: Date;
}) => ({
  subject: `${opts.companyName} invited you to "${opts.assessmentTitle}"`,
  title: "You have been invited to an assessment",
  body: `<p><b>${opts.companyName}</b> invited you to take <b>${opts.assessmentTitle}</b>
         (${opts.durationMins} minutes).</p>
         <p><a href="${opts.link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
         <p style="color:#6b7280;font-size:13px">This invitation expires on ${opts.expiresAt.toUTCString()}.</p>`,
});

export const resultEmail = (opts: {
  assessmentTitle: string;
  score: number;
  totalPoints: number;
  passed: boolean;
}) => ({
  subject: `Your result for "${opts.assessmentTitle}"`,
  title: "Your assessment result is ready",
  body: `<p>You scored <b>${opts.score}/${opts.totalPoints}</b> on <b>${opts.assessmentTitle}</b>.</p>
         <p>Outcome: <b>${opts.passed ? "Passed" : "Not passed"}</b></p>`,
});
