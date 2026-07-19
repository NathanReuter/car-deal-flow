"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateCarStage } from "@/lib/actions/pipeline";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

export function StageSelect({ carId, stage }: { carId: string; stage: PipelineStage }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: PipelineStage) {
    startTransition(async () => {
      await updateCarStage(carId, value);
      router.refresh();
    });
  }

  return (
    <Select value={stage} onValueChange={(v) => handleChange(v as PipelineStage)} disabled={isPending}>
      <SelectTrigger className="h-7 w-fit text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {PIPELINE_STAGES.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
