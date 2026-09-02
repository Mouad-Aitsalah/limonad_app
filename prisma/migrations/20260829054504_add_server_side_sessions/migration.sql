-- Adds server-side, revocable login sessions (see lib/server/auth.ts and
-- the Session model doc comment in schema.prisma). Purely additive: one new
-- table, no existing table is altered, no existing row is touched or
-- deleted. Safe to apply without any downtime or data loss.
--
-- Sessions created under the previous self-sufficient signed-cookie scheme
-- have no row here and will simply stop being recognized once the app code
-- ships (getCurrentSessionUser looks up a Session row now, not an HMAC
-- signature) - every logged-in user is signed out and must log in again
-- exactly once. No data is lost by this; see the task's final report for
-- the full before/after explanation.

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
