import { notFound } from "next/navigation";
import Link from "next/link";
import { getBundle } from "@/lib/aggregate";
import { CarDetailTabs } from "@/components/cars/car-detail-tabs";

export const dynamic = "force-dynamic";

export default async function CarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getBundle(id);
  if (!bundle) notFound();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href="/" className="text-sm text-accent hover:underline">← Back to pipeline</Link>
      <h1 className="mt-2 text-xl font-semibold text-text-primary">
        {bundle.car.brand} {bundle.car.model} <span className="text-text-muted">· {bundle.car.year}</span>
      </h1>
      <div className="mt-4"><CarDetailTabs bundle={bundle} /></div>
    </main>
  );
}
