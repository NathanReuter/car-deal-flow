-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "modelYear" INTEGER NOT NULL,
    "mileageKm" INTEGER NOT NULL,
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
    "fipeValueBRL" INTEGER NOT NULL,
    "manualVerdictOverride" TEXT,
    "overrideReason" TEXT
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BuyingGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "budgetMinBRL" INTEGER NOT NULL,
    "budgetMaxBRL" INTEGER NOT NULL,
    "minYear" INTEGER NOT NULL,
    "maxMileageKm" INTEGER NOT NULL,
    "requiredFeatures" TEXT NOT NULL,
    "preferredBodyTypes" TEXT NOT NULL,
    "preferredBrands" TEXT NOT NULL,
    "excludedBrandsModels" TEXT NOT NULL,
    "fuelEconomyThresholdKmL" INTEGER NOT NULL,
    "minResaleLiquidityScore" INTEGER NOT NULL,
    "familySpaceRequired" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "RiskCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carId" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "caixaApplicable" BOOLEAN NOT NULL,
    "caixaEditalReviewed" BOOLEAN NOT NULL,
    "caixaHiddenTransferCosts" INTEGER NOT NULL,
    "caixaResaleStigmaNote" TEXT NOT NULL,
    "caixaHistoryClarity" TEXT NOT NULL,
    "caixaLegalTransferRisk" TEXT NOT NULL,
    CONSTRAINT "RiskCheck_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConditionReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carId" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "mechanicNotes" TEXT NOT NULL,
    CONSTRAINT "ConditionReview_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskCheck_carId_key" ON "RiskCheck"("carId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionReview_carId_key" ON "ConditionReview"("carId");
