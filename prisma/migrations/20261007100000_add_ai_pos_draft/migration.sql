-- AI assistant -> POS cart preparation. A new, isolated table holding a cart
-- PREPARED by the assistant: only { productId, quantity } lines and an optional
-- customer. No price, total, VAT, discount, payment or stock data is stored -
-- the POS recomputes everything when the draft is opened, and the sale itself
-- is only ever created by the POS's normal validation.
-- Additive only: no existing table or row is altered.

-- CreateEnum
CREATE TYPE "AiPosDraftStatus" AS ENUM ('OPEN', 'APPLIED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AiPosDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT,
    "lines" JSONB NOT NULL,
    "status" "AiPosDraftStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPosDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPosDraft_conversationId_status_idx" ON "AiPosDraft"("conversationId", "status");

-- CreateIndex
CREATE INDEX "AiPosDraft_organizationId_userId_status_idx" ON "AiPosDraft"("organizationId", "userId", "status");

-- AddForeignKey
ALTER TABLE "AiPosDraft" ADD CONSTRAINT "AiPosDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPosDraft" ADD CONSTRAINT "AiPosDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPosDraft" ADD CONSTRAINT "AiPosDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPosDraft" ADD CONSTRAINT "AiPosDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
