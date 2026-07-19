"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { syncAllFipeValues, type FipeSyncResult } from "@/lib/actions/fipe-sync";

export function FipeSyncAllButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState<FipeSyncResult[] | null>(null);

  function handleSync() {
    startTransition(async () => {
      const r = await syncAllFipeValues();
      setResults(r);
      router.refresh();
    });
  }

  const succeeded = results?.filter((r) => r.ok) ?? [];
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" size="sm" disabled={isPending} onClick={handleSync}>
        <RefreshCw className={isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        {isPending ? "Syncing all..." : "Sync all from FIPE"}
      </Button>

      {results && (
        <div className="w-full max-w-md rounded-md border border-border bg-surface p-3 text-xs sm:w-96">
          <p className="font-medium text-text-primary">
            {succeeded.length} synced, {failed.length} failed
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {succeeded.map((r) => (
              <li key={r.carId} className="text-[var(--success)]">
                {r.label}: {formatBRL(r.valueBRL!)}
              </li>
            ))}
            {failed.map((r) => (
              <li key={r.carId} className="text-[var(--danger)]">
                {r.label}: {r.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
