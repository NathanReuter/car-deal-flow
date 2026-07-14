-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Car" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "modelYear" INTEGER NOT NULL,
    "mileageKm" INTEGER,
    "askingPriceBRL" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "sellerType" TEXT NOT NULL,
    "fuel" TEXT NOT NULL,
    "transmission" TEXT NOT NULL,
    "bodyType" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "plate" TEXT,
    "chassis" TEXT,
    "photos" TEXT NOT NULL,
    "pipelineStage" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fipeValueBRL" INTEGER,
    "manualVerdictOverride" TEXT,
    "overrideReason" TEXT,
    "stageReason" TEXT
);
INSERT INTO "new_Car" ("askingPriceBRL", "bodyType", "brand", "chassis", "city", "color", "createdAt", "fipeValueBRL", "fuel", "id", "manualVerdictOverride", "mileageKm", "model", "modelYear", "notes", "overrideReason", "photos", "pipelineStage", "plate", "sellerType", "sourcePlatform", "sourceUrl", "state", "transmission", "trim", "updatedAt", "year") SELECT "askingPriceBRL", "bodyType", "brand", "chassis", "city", "color", "createdAt", "fipeValueBRL", "fuel", "id", "manualVerdictOverride", "mileageKm", "model", "modelYear", "notes", "overrideReason", "photos", "pipelineStage", "plate", "sellerType", "sourcePlatform", "sourceUrl", "state", "transmission", "trim", "updatedAt", "year" FROM "Car";
DROP TABLE "Car";
ALTER TABLE "new_Car" RENAME TO "Car";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
