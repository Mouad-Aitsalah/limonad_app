-- Session.deviceId: optional, non-sensitive device identifier used to count
-- connected devices per user without counting one device twice. Nullable and
-- additive: existing sessions and every existing query keep working.
ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;
