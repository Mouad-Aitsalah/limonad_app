import { spawnSync } from "node:child_process";

import { decideBuildPlan, type BuildStep } from "../lib/build-plan";

/**
 * `npm run build` entry point (used by Vercel and locally). Runs only what
 * decideBuildPlan allows for the current environment - see lib/build-plan.ts.
 * `--dry-run` prints the decision and runs nothing.
 *
 * The commands are fixed literals; the environment is only read, never printed.
 */
const COMMANDS: Record<BuildStep, string> = {
  migrate: "prisma migrate deploy",
  build: "next build",
};

const plan = decideBuildPlan(process.env);

if (!plan.ok) {
  console.error(`[build-guard] REFUSÉ : ${plan.reason}`);
  process.exit(1);
}

console.log(`[build-guard] ${plan.reason}`);
console.log(`[build-guard] étapes : ${plan.steps.join(" -> ")}`);

if (process.argv.includes("--dry-run")) {
  console.log("[build-guard] --dry-run : rien n'est exécuté.");
  process.exit(0);
}

for (const step of plan.steps) {
  console.log(`[build-guard] > ${COMMANDS[step]}`);
  const result = spawnSync(COMMANDS[step], { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) {
    console.error(`[build-guard] étape « ${step} » en échec.`);
    process.exit(result.status ?? 1);
  }
}
