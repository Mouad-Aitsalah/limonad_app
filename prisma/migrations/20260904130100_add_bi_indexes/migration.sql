-- BI Phase 2A: index the two (organizationId, date) shapes every BI helper
-- filters on - revenue/margin/sales-count/active-customers on
-- Sale.validatedAt, purchases on Purchase.orderDate.
CREATE INDEX "Sale_organizationId_validatedAt_idx" ON "Sale"("organizationId", "validatedAt");

CREATE INDEX "Purchase_organizationId_orderDate_idx" ON "Purchase"("organizationId", "orderDate");
