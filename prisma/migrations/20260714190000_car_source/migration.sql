-- CreateTable
CREATE TABLE "CarSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL,
    "editalUrl" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL,
    CONSTRAINT "CarSource_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CarSource_sourceUrl_key" ON "CarSource"("sourceUrl");

-- CreateIndex
CREATE INDEX "CarSource_carId_idx" ON "CarSource"("carId");

-- Backfill: one CarSource per existing Car from primary source fields
INSERT INTO "CarSource" ("id", "carId", "sourceUrl", "sourcePlatform", "editalUrl", "firstSeenAt", "lastSeenAt")
SELECT
  lower(hex(randomblob(8))) || lower(hex(randomblob(8))),
  "id",
  "sourceUrl",
  "sourcePlatform",
  NULL,
  COALESCE("createdAt", CURRENT_TIMESTAMP),
  COALESCE("updatedAt", CURRENT_TIMESTAMP)
FROM "Car"
WHERE "sourceUrl" IS NOT NULL
  AND "sourceUrl" != ''
  AND NOT EXISTS (
    SELECT 1 FROM "CarSource" cs WHERE cs."sourceUrl" = "Car"."sourceUrl"
  );
