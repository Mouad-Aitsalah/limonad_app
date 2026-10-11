"use client";

import { CoverageSection } from "@/components/dashboard/commercial/coverage-section";
import { SalesAnalysisSection } from "@/components/dashboard/commercial/sales-analysis-section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * « Analyse commerciale » block of the Dashboard (admin only - see page.tsx and
 * lib/commercial-analysis/access.ts): two separate sections in tabs, so the
 * existing dashboard is not made heavier. A hidden tab is not mounted: its data
 * is only requested when it is opened.
 */
export function CommercialAnalysisTabs() {
  return (
    <section aria-label="Analyse commerciale" className="space-y-4">
      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
          <TabsTrigger value="sales" className="px-5">Analyse des ventes</TabsTrigger>
          <TabsTrigger value="coverage" className="px-5">Couverture commerciale</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">
          <SalesAnalysisSection />
        </TabsContent>
        <TabsContent value="coverage">
          <CoverageSection />
        </TabsContent>
      </Tabs>
    </section>
  );
}
