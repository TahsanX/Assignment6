import { createClerkClient } from "@clerk/backend";
import { PrismaClient, type Role } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const clerk = process.env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : null;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@codeassess.dev").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "CodeAssess#2026";

/** Returns a real Clerk user id (creating the account if needed); falls back to a placeholder. */
const ensureClerkUser = async (email: string, first: string, last: string, password: string) => {
  if (!clerk) return `seed_${email.replace(/[^a-z0-9]/gi, "_")}`;
  const found = await clerk.users.getUserList({ emailAddress: [email] });
  if (found.data[0]) return found.data[0].id;
  const created = await clerk.users.createUser({
    emailAddress: [email],
    firstName: first,
    lastName: last,
    password,
    skipPasswordChecks: true,
  });
  return created.id;
};

const upsertUser = async (
  email: string,
  first: string,
  last: string,
  role: Role,
  password: string,
) => {
  const clerkId = await ensureClerkUser(email, first, last, password);
  return prisma.user.upsert({
    where: { email },
    create: { clerkId, email, name: `${first} ${last}`, role, onboarded: true },
    update: { clerkId, role, onboarded: true, deletedAt: null, status: "ACTIVE" },
  });
};

const mcq = (
  title: string,
  body: string,
  options: string[],
  correct: number[],
  tags: string[],
  difficulty: "EASY" | "MEDIUM" | "HARD" = "EASY",
) => ({
  type: "MCQ" as const,
  title,
  body,
  difficulty,
  tags,
  points: 5,
  options: options.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
  correctAnswer: correct.map((i) => String.fromCharCode(97 + i)),
});

async function main() {
  console.log("Seeding CodeAssess…");

  const admin = await upsertUser(ADMIN_EMAIL, "Platform", "Admin", "ADMIN", ADMIN_PASSWORD);

  const companies = [
    {
      email: "hiring@northwind-labs.dev",
      first: "Farhana",
      last: "Rahman",
      company: "Northwind Labs",
      site: "https://northwind-labs.dev",
    },
    {
      email: "talent@bluepeak-systems.dev",
      first: "Imran",
      last: "Hossain",
      company: "BluePeak Systems",
      site: "https://bluepeak-systems.dev",
    },
  ];
  const candidates = [
    {
      email: "nusrat.jahan@example.com",
      first: "Nusrat",
      last: "Jahan",
      skills: ["typescript", "node", "postgres"],
    },
    {
      email: "arif.chowdhury@example.com",
      first: "Arif",
      last: "Chowdhury",
      skills: ["react", "javascript", "css"],
    },
    {
      email: "sabrina.akter@example.com",
      first: "Sabrina",
      last: "Akter",
      skills: ["python", "django", "sql"],
    },
    {
      email: "tanvir.ahmed@example.com",
      first: "Tanvir",
      last: "Ahmed",
      skills: ["java", "spring", "docker"],
    },
  ];

  const companyUsers = [];
  for (const c of companies) {
    const u = await upsertUser(c.email, c.first, c.last, "COMPANY", DEMO_PASSWORD);
    await prisma.companyProfile.upsert({
      where: { userId: u.id },
      create: {
        userId: u.id,
        companyName: c.company,
        website: c.site,
        description: `${c.company} engineering hiring`,
      },
      update: {},
    });
    companyUsers.push(u);
  }
  for (const c of candidates) {
    const u = await upsertUser(c.email, c.first, c.last, "CANDIDATE", DEMO_PASSWORD);
    await prisma.candidateProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, skills: c.skills, headline: `${c.skills[0]} developer` },
      update: {},
    });
  }

  // Problem bank for the first company (skipped when it already has problems)
  const owner = companyUsers[0];
  const existing = await prisma.problem.count({ where: { companyId: owner.id } });
  if (existing === 0) {
    const problems = [
      mcq(
        "Array vs linked list",
        "Which structure gives O(1) random access by index?",
        ["Linked list", "Array", "Queue", "Stack"],
        [1],
        ["data-structures"],
      ),
      mcq(
        "HTTP idempotency",
        "Which HTTP methods are idempotent by specification?",
        ["GET", "PUT", "POST", "DELETE"],
        [0, 1, 3],
        ["http", "backend"],
        "MEDIUM",
      ),
      mcq(
        "SQL isolation",
        "Which isolation level prevents dirty reads but allows non-repeatable reads?",
        ["Read uncommitted", "Read committed", "Repeatable read", "Serializable"],
        [1],
        ["sql", "databases"],
        "MEDIUM",
      ),
      mcq(
        "Big-O of binary search",
        "What is the time complexity of binary search on a sorted array?",
        ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
        [1],
        ["algorithms"],
      ),
      {
        type: "WRITTEN" as const,
        title: "Explain optimistic vs pessimistic locking",
        body: "Describe both strategies and when you would pick each in a booking system.",
        difficulty: "MEDIUM" as const,
        tags: ["databases", "concurrency"],
        points: 15,
      },
      {
        type: "CODING" as const,
        title: "Two Sum",
        body: "Given an array of integers and a target, return the indices of the two numbers that add up to the target.",
        difficulty: "EASY" as const,
        tags: ["algorithms", "arrays"],
        points: 20,
        testCases: [
          { input: "[2,7,11,15], 9", expectedOutput: "[0,1]", hidden: false },
          { input: "[3,2,4], 6", expectedOutput: "[1,2]", hidden: false },
          { input: "[3,3], 6", expectedOutput: "[0,1]", hidden: true },
        ],
      },
      {
        type: "CODING" as const,
        title: "Debounce function",
        body: "Implement a debounce(fn, wait) utility in TypeScript.",
        difficulty: "MEDIUM" as const,
        tags: ["javascript", "typescript"],
        points: 25,
        testCases: [
          { input: "calls within wait window", expectedOutput: "fn invoked once", hidden: false },
        ],
      },
    ];
    for (const p of problems) {
      await prisma.problem.create({ data: { ...p, companyId: owner.id } });
    }
  }

  // A DRAFT sample assessment (publishing requires a real bKash payment).
  const hasAssessment = await prisma.assessment.count({ where: { companyId: owner.id } });
  if (hasAssessment === 0) {
    const bank = await prisma.problem.findMany({
      where: { companyId: owner.id },
      orderBy: { createdAt: "asc" },
    });
    const assessment = await prisma.assessment.create({
      data: {
        companyId: owner.id,
        title: "Backend Engineer Screening",
        description: "MCQ, written and coding screen for backend candidates.",
        durationMins: 60,
        passMarks: 40,
        candidateSlots: 5,
      },
    });
    await prisma.assessmentProblem.createMany({
      data: bank.map((p, order) => ({
        assessmentId: assessment.id,
        problemId: p.id,
        order,
        points: p.points,
      })),
    });
  }

  console.log(
    `Seed complete. Admin: ${admin.email}${clerk ? "" : " (Clerk not configured: placeholder ids)"}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
