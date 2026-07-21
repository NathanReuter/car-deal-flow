-- CreateIndex
CREATE INDEX "Car_pipelineStage_idx" ON "Car"("pipelineStage");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_dealPhase_idx" ON "Car"("pipelineStage", "dealPhase");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_sourceChannel_idx" ON "Car"("pipelineStage", "sourceChannel");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_confidence_idx" ON "Car"("pipelineStage", "confidence");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_verdict_idx" ON "Car"("pipelineStage", "verdict");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_state_idx" ON "Car"("pipelineStage", "state");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_askingPriceBRL_idx" ON "Car"("pipelineStage", "askingPriceBRL");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_finalScore_idx" ON "Car"("pipelineStage", "finalScore");

-- CreateIndex
CREATE INDEX "Car_pipelineStage_createdAt_idx" ON "Car"("pipelineStage", "createdAt");

-- CreateIndex
CREATE INDEX "Car_brand_idx" ON "Car"("brand");

-- CreateIndex
CREATE INDEX "Car_fipeValueBRL_askingPriceBRL_idx" ON "Car"("fipeValueBRL", "askingPriceBRL");
