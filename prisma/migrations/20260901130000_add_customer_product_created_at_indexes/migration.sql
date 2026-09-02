-- PostgreSQL/Neon infra audit (Phase 3): the only two index recommendations
-- from that audit that showed a measured, clear gain at bench scale -
-- Customer ~90x faster (6.18ms seq scan+sort -> 0.07ms index scan at 24k
-- rows), Product ~3.7x faster (1.39ms -> 0.38ms at 5k rows) - see the
-- audit report for the full EXPLAIN ANALYZE evidence. The other candidates
-- audited (StockMovement composites, Sale/Tour/etc.) showed no net gain at
-- current real volume and were deliberately NOT applied.
--
-- Purely additive: two new indexes, no existing table/column/constraint is
-- altered, no existing row is touched. Safe to apply without any downtime
-- or data loss. Index names match Prisma's own default naming convention
-- for `@@index([organizationId, createdAt(sort: Desc)])`.

CREATE INDEX IF NOT EXISTS "Customer_organizationId_createdAt_idx"
  ON "Customer"("organizationId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Product_organizationId_createdAt_idx"
  ON "Product"("organizationId", "createdAt" DESC);
