"use client";

import { useState } from "react";
import { Copy, Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { generateEmailReport } from "@/lib/scoring/email";
import type { CarBundle } from "@/lib/aggregate";
import type { EmailReport } from "@/lib/types";
import { isShortlistReportCandidate } from "@/lib/shortlist";

export function ReportGenerator({ bundles }: { bundles: CarBundle[] }) {
  const [singleCarId, setSingleCarId] = useState(bundles[0]?.car.id ?? "");
  const [report, setReport] = useState<EmailReport | null>(null);
  const [copied, setCopied] = useState(false);

  const shortlist = bundles.filter((b) => isShortlistReportCandidate(b));

  function generateSingle() {
    const bundle = bundles.find((b) => b.car.id === singleCarId);
    if (!bundle) return;
    setReport(generateEmailReport([bundle], "single"));
    setCopied(false);
  }

  function generateShortlist() {
    setReport(generateEmailReport(shortlist, "shortlist"));
    setCopied(false);
  }

  function generateDigest() {
    setReport(generateEmailReport(bundles, "digest"));
    setCopied(false);
  }

  async function copyToClipboard() {
    if (!report) return;
    await navigator.clipboard.writeText(report.bodyMarkdown);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <Card className="lg:w-96 lg:shrink-0">
        <CardHeader>
          <CardTitle>Generate report</CardTitle>
          <CardDescription>Produce an email-ready summary you can paste or send.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="single">
            <TabsList className="w-full">
              <TabsTrigger value="single" className="flex-1">Single</TabsTrigger>
              <TabsTrigger value="shortlist" className="flex-1">Shortlist</TabsTrigger>
              <TabsTrigger value="digest" className="flex-1">Digest</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="flex flex-col gap-3">
              <Select value={singleCarId} onValueChange={setSingleCarId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {bundles.map((b) => (
                    <SelectItem key={b.car.id} value={b.car.id}>{b.car.brand} {b.car.model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={generateSingle}><Mail className="h-4 w-4" /> Generate single-vehicle email</Button>
            </TabsContent>

            <TabsContent value="shortlist" className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">{shortlist.length} vehicles currently active and not marked Avoid.</p>
              <Button onClick={generateShortlist}><Mail className="h-4 w-4" /> Generate shortlist email</Button>
            </TabsContent>

            <TabsContent value="digest" className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">Covers all {bundles.length} tracked vehicles.</p>
              <Button onClick={generateDigest}><Mail className="h-4 w-4" /> Generate daily digest</Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{report ? report.subject : "Preview"}</CardTitle>
            <CardDescription>{report ? "Ready to copy into your email client." : "Generate a report to preview it here."}</CardDescription>
          </div>
          {report && (
            <Button variant="secondary" size="sm" onClick={copyToClipboard}>
              <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {report ? (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-hover/40 p-4 text-sm leading-relaxed text-text-secondary">
              {report.bodyMarkdown}
            </pre>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-text-muted">No report generated yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
