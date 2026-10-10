import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { decideBuildPlan } from "./build-plan";
import { KNOWN_PRODUCTION_ENDPOINT_SUBSTRING } from "./production-endpoint";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SECRET = "s3cr3t-never-printed";
const neon = (endpoint: string, pooled: boolean) =>
  `postgresql://app_user:${SECRET}@${endpoint}${pooled ? "-pooler" : ""}.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
const PROD = `${KNOWN_PRODUCTION_ENDPOINT_SUBSTRING}`;
const PREVIEW_ENDPOINT = "ep-preview-branch-000001";
const previewDb = { DATABASE_URL: neon(PREVIEW_ENDPOINT, true), DIRECT_URL: neon(PREVIEW_ENDPOINT, false) };
const productionDb = { DATABASE_URL: neon(PROD, true), DIRECT_URL: neon(PROD, false) };

test("outside Vercel: next build only, never a migration - even with a production URL in the environment", () => {
  for (const env of [{}, { ...previewDb }, { ...productionDb }, { VERCEL: "0", ...productionDb }, { CI: "true", ...productionDb }]) {
    assert.deepEqual(decideBuildPlan(env), { ok: true, steps: ["build"], reason: "Hors Vercel : build seul, aucune migration automatique." });
  }
});

test("Vercel Production keeps today's behaviour: migrate deploy then next build", () => {
  for (const env of [{ VERCEL: "1", VERCEL_ENV: "production", ...productionDb }, { VERCEL: "1", VERCEL_ENV: "production", APP_ENV: "production", ...productionDb }, { VERCEL: "1", VERCEL_ENV: "production" }]) {
    const plan = decideBuildPlan(env);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.ok && plan.steps, ["migrate", "build"]);
  }
});

test("Preview on a verified non-production database: next build only, no migration by default", () => {
  for (const vercelEnv of ["preview", "development"]) {
    const plan = decideBuildPlan({ VERCEL: "1", VERCEL_ENV: vercelEnv, ...previewDb });
    assert.deepEqual(plan.ok && plan.steps, ["build"], vercelEnv);
  }
});

test("Preview migrates only with the explicit opt-in, and only when the database is verified non-production", () => {
  const optIn = decideBuildPlan({ VERCEL: "1", VERCEL_ENV: "preview", ...previewDb, ALLOW_PREVIEW_MIGRATE: "1" });
  assert.deepEqual(optIn.ok && optIn.steps, ["migrate", "build"]);
  for (const value of ["true", "yes", "0", "", " 1"]) {
    const plan = decideBuildPlan({ VERCEL: "1", VERCEL_ENV: "preview", ...previewDb, ALLOW_PREVIEW_MIGRATE: value });
    assert.deepEqual(plan.ok && plan.steps, ["build"], `value ${JSON.stringify(value)}`);
  }
  // the opt-in never overrides the production refusal
  assert.equal(decideBuildPlan({ VERCEL: "1", VERCEL_ENV: "preview", ...productionDb, ALLOW_PREVIEW_MIGRATE: "1" }).ok, false);
});

test("Preview is refused (no migration, no build) when any connection targets the production endpoint", () => {
  for (const env of [
    { ...productionDb },
    { DATABASE_URL: previewDb.DATABASE_URL, DIRECT_URL: productionDb.DIRECT_URL },
    { DATABASE_URL: productionDb.DATABASE_URL, DIRECT_URL: previewDb.DIRECT_URL },
  ]) {
    for (const vercelEnv of ["preview", "development"]) {
      const plan = decideBuildPlan({ VERCEL: "1", VERCEL_ENV: vercelEnv, ALLOW_PREVIEW_MIGRATE: "1", ...env });
      assert.equal(plan.ok, false, vercelEnv);
      assert.match(plan.reason, /production/);
    }
  }
});

test("ambiguous configuration fails safe: unknown/missing VERCEL_ENV, missing URLs, mixed endpoints, unknown host, APP_ENV=production", () => {
  const refused: Array<Record<string, string>> = [
    { VERCEL: "1", ...previewDb },
    { VERCEL: "1", VERCEL_ENV: "", ...previewDb },
    { VERCEL: "1", VERCEL_ENV: "staging", ...previewDb },
    { VERCEL: "1", VERCEL_ENV: "Production", ...productionDb },
    { VERCEL: "1", VERCEL_ENV: "preview" },
    { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: previewDb.DATABASE_URL },
    { VERCEL: "1", VERCEL_ENV: "preview", DIRECT_URL: previewDb.DIRECT_URL },
    { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: neon("ep-one-000001", true), DIRECT_URL: neon("ep-two-000002", false) },
    { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: `postgresql://u:${SECRET}@db.example.com/app`, DIRECT_URL: `postgresql://u:${SECRET}@db.example.com/app` },
    { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: "not a url", DIRECT_URL: "not a url" },
    { VERCEL: "1", VERCEL_ENV: "preview", APP_ENV: "production", ...previewDb },
  ];
  for (const env of refused) assert.equal(decideBuildPlan(env).ok, false, JSON.stringify(Object.keys(env)));
});

test("a refusal or a decision never contains a connection string, a host or a secret", () => {
  const envs = [
    { VERCEL: "1", VERCEL_ENV: "preview", ...productionDb },
    { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: neon("ep-one-000001", true), DIRECT_URL: neon("ep-two-000002", false) },
    { VERCEL: "1", VERCEL_ENV: "preview", ...previewDb, ALLOW_PREVIEW_MIGRATE: "1" },
    { VERCEL: "1", VERCEL_ENV: "production", ...productionDb },
  ];
  for (const env of envs) {
    const { reason } = decideBuildPlan(env);
    for (const leak of [SECRET, "postgresql://", "neon.tech", PROD, PREVIEW_ENDPOINT, "ep-one", "ep-two"]) {
      assert.equal(reason.includes(leak), false, `${leak} leaked in: ${reason}`);
    }
  }
});

test("wiring: `npm run build` goes through the guard; no raw `prisma migrate deploy` is left in the package scripts", () => {
  const scripts = (JSON.parse(read("../package.json")) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts.build, "tsx scripts/vercel-build.ts");
  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(/migrate\s+deploy/.test(command), false, `script "${name}" runs a migration directly`);
  }
  assert.equal("vercel-build" in scripts, false, "one single entry point");

  const runner = read("../scripts/vercel-build.ts");
  assert.match(runner, /decideBuildPlan\(process\.env\)/);
  assert.match(runner, /if \(!plan\.ok\) \{\s+console\.error\(`\[build-guard\] REFUSÉ : \$\{plan\.reason\}`\);\s+process\.exit\(1\);/);
  assert.match(runner, /migrate: "prisma migrate deploy",\s+build: "next build",/);
  // it only ever prints the plan's own wording, never the environment
  assert.equal(/console\.(log|error)\([^)]*process\.env/.test(runner), false);
});
