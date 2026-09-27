import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCronGet, handleCronPost } from "./purchase-forecast-cron";

const SECRET = "test-secret";
const summary = {
  businessDay: "2026-09-14",
  organizationsTotal: 1,
  organizationsSucceeded: 1,
  organizationsFailed: 0,
  durationMs: 5,
  results: [],
};

function deps(overrides: Partial<Parameters<typeof handleCronGet>[1]> = {}) {
  const calls: Array<{ organizationId?: string; businessDay?: string }> = [];
  return {
    calls,
    cronSecret: SECRET,
    run: async (options: { organizationId?: string; businessDay?: string }) => {
      calls.push(options);
      return summary;
    },
    ...overrides,
  };
}

function request(options: { method?: string; authorization?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (options.authorization !== undefined) headers.authorization = options.authorization;
  return new Request("http://localhost/api/cron/purchase-forecast", {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

test("D1. valid secret: the run is executed and its summary returned", async () => {
  const d = deps();
  const response = await handleCronGet(request({ authorization: `Bearer ${SECRET}` }), d);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), summary);
  assert.deepEqual(d.calls, [{}]);
});

test("D2. invalid or missing secret: 401 (GET) / 403 (POST), the run is NEVER called", async () => {
  for (const authorization of [undefined, "Bearer wrong", "wrong-format", `bearer ${SECRET}`]) {
    const dGet = deps();
    const getResponse = await handleCronGet(request({ authorization }), dGet);
    assert.equal(getResponse.status, 401, String(authorization));
    assert.equal(dGet.calls.length, 0);

    const dPost = deps();
    const postResponse = await handleCronPost(request({ method: "POST", authorization, body: {} }), dPost);
    assert.equal(postResponse.status, 403, String(authorization));
    assert.equal(dPost.calls.length, 0);
  }
});

test("an unset CRON_SECRET always refuses - never treated as \"open\", even with a matching empty header", async () => {
  const d = deps({ cronSecret: undefined });
  const response = await handleCronGet(request({ authorization: "Bearer undefined" }), d);
  assert.equal(response.status, 401);
  assert.equal(d.calls.length, 0);
  const response2 = await handleCronGet(request({}), deps({ cronSecret: undefined }));
  assert.equal(response2.status, 401);
});

test("9. manual recompute: organizationId is accepted ONLY here, server-to-server with the secret, and passed through to `run` unchanged", async () => {
  const d = deps();
  const response = await handleCronPost(
    request({ method: "POST", authorization: `Bearer ${SECRET}`, body: { organizationId: "org_123" } }),
    d,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(d.calls, [{ organizationId: "org_123" }]);
});

test("manual recompute: businessDay must be YYYY-MM-DD, unknown fields are refused", async () => {
  const ok = await handleCronPost(request({ method: "POST", authorization: `Bearer ${SECRET}`, body: { businessDay: "2026-09-14" } }), deps());
  assert.equal(ok.status, 200);
  const badDay = await handleCronPost(request({ method: "POST", authorization: `Bearer ${SECRET}`, body: { businessDay: "14-09-2026" } }), deps());
  assert.equal(badDay.status, 400);
  const badField = await handleCronPost(request({ method: "POST", authorization: `Bearer ${SECRET}`, body: { organizationIdd: "x" } }), deps());
  assert.equal(badField.status, 400);
  const missingBody = await handleCronPost(request({ method: "POST", authorization: `Bearer ${SECRET}` }), deps());
  assert.equal(missingBody.status, 200, "an absent body defaults to {} (every ACTIVE organisation)");
});

test("10. a run failure is reported as 500, not a crash", async () => {
  const response = await handleCronGet(request({ authorization: `Bearer ${SECRET}` }), {
    cronSecret: SECRET,
    run: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(response.status, 500);
});
