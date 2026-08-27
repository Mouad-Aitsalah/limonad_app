-- Traceability for edits made to an existing "fiche de chargement" (open or
-- closed) via the new /chargements/[id] detail/edit view.
ALTER TABLE "TruckLoading"
ADD COLUMN "updatedByUserId" TEXT;

ALTER TABLE "TruckLoading"
ADD CONSTRAINT "TruckLoading_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
