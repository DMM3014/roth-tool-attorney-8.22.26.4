import { useEffect, useState } from "react";
import { Leaf, SlidersHorizontal, TrendingUp, FolderOpen, Table2, ListTree, GitCompareArrows, BarChart3, Dices, Lightbulb, BadgeCheck, ScrollText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchDefaults } from "@/lib/api";
import { Optimizer } from "@/components/Optimizer";
import { Projection } from "@/components/Projection";
import { Scenarios } from "@/components/Scenarios";
import { PlanInputs } from "@/components/PlanInputs";
import { DetailCashflow } from "@/components/DetailCashflow";
import { Compare } from "@/components/Compare";
import { Analytics } from "@/components/Analytics";
import { MonteCarlo } from "@/components/MonteCarlo";
import { Concepts } from "@/components/Concepts";
import { WhitePaper } from "@/components/WhitePaper";

export const Planner = () => {
  const [scenario, setScenario] = useState(null);
  const [mcResult, setMcResult] = useState(null);

  useEffect(() => {
    fetchDefaults().then(setScenario);
  }, []);

  // a scenario edit invalidates a prior Monte Carlo run
  const scenarioSig = scenario && JSON.stringify(scenario);
  useEffect(() => { setMcResult(null); }, [scenarioSig]);

  if (!scenario) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse label-cap">Loading tax engine…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grain">
      <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-[#EBE8E0]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[#4A6741] flex items-center justify-center">
              <Leaf className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight leading-none">Roth Conversion & Retirement Planner</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Spreadsheet-grade tax engine · ordinary vs. LTCG/dividend separation</p>
            </div>
          </div>
          <span className="hidden md:flex items-center gap-3">
            <span className="label-cap text-[#7A9B76]">v9 Longevity Engine</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4A6741]/30 bg-[#4A6741]/5 px-2.5 py-1 text-[10px] font-medium text-[#4A6741]" data-testid="obbba-badge">
              <BadgeCheck className="h-3 w-3" /> Current law · OBBBA 2025 (permanent, indexed brackets)
            </span>
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <Tabs defaultValue="optimizer">
          <TabsList className="bg-[#EBE8E0] mb-8" data-testid="main-tabs">
            <TabsTrigger value="optimizer" data-testid="tab-optimizer" className="gap-2 data-[state=active]:bg-white">
              <SlidersHorizontal className="h-4 w-4" /> Single-Year Optimizer
            </TabsTrigger>
            <TabsTrigger value="projection" data-testid="tab-projection" className="gap-2 data-[state=active]:bg-white">
              <TrendingUp className="h-4 w-4" /> Multi-Year Projection
            </TabsTrigger>
            <TabsTrigger value="cashflow" data-testid="tab-cashflow" className="gap-2 data-[state=active]:bg-white">
              <ListTree className="h-4 w-4" /> Detail / Cashflow
            </TabsTrigger>
            <TabsTrigger value="analytics" data-testid="tab-analytics" className="gap-2 data-[state=active]:bg-white">
              <BarChart3 className="h-4 w-4" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="concepts" data-testid="tab-concepts" className="gap-2 data-[state=active]:bg-white">
              <Lightbulb className="h-4 w-4" /> Concepts
            </TabsTrigger>
            <TabsTrigger value="whitepaper" data-testid="tab-whitepaper" className="gap-2 data-[state=active]:bg-white">
              <ScrollText className="h-4 w-4" /> White Paper
            </TabsTrigger>
            <TabsTrigger value="montecarlo" data-testid="tab-montecarlo" className="gap-2 data-[state=active]:bg-white">
              <Dices className="h-4 w-4" /> Monte Carlo
            </TabsTrigger>
            <TabsTrigger value="inputs" data-testid="tab-inputs" className="gap-2 data-[state=active]:bg-white">
              <Table2 className="h-4 w-4" /> Plan Inputs
            </TabsTrigger>
            <TabsTrigger value="scenarios" data-testid="tab-scenarios" className="gap-2 data-[state=active]:bg-white">
              <FolderOpen className="h-4 w-4" /> Scenarios
            </TabsTrigger>
            <TabsTrigger value="compare" data-testid="tab-compare" className="gap-2 data-[state=active]:bg-white">
              <GitCompareArrows className="h-4 w-4" /> Compare
            </TabsTrigger>
          </TabsList>

          <TabsContent value="optimizer">
            <Optimizer scenario={scenario} />
          </TabsContent>
          <TabsContent value="projection">
            <Projection scenario={scenario} setScenario={setScenario} mcResult={mcResult} />
          </TabsContent>
          <TabsContent value="cashflow">
            <DetailCashflow scenario={scenario} />
          </TabsContent>
          <TabsContent value="analytics">
            <Analytics scenario={scenario} />
          </TabsContent>
          <TabsContent value="concepts">
            <Concepts scenario={scenario} />
          </TabsContent>
          <TabsContent value="whitepaper">
            <WhitePaper />
          </TabsContent>
          <TabsContent value="montecarlo">
            <MonteCarlo scenario={scenario} onResult={setMcResult} />
          </TabsContent>
          <TabsContent value="inputs">
            <PlanInputs scenario={scenario} setScenario={setScenario} />
          </TabsContent>
          <TabsContent value="scenarios">
            <Scenarios scenario={scenario} setScenario={setScenario} />
          </TabsContent>
          <TabsContent value="compare">
            <Compare scenario={scenario} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-[#EBE8E0] py-6 mt-10">
        <p className="text-center text-xs text-muted-foreground">
          Educational model. LTCG/QDIV stacks on ordinary income at 0/15/20% · NIIT 3.8% · IRMAA · indexed brackets. Verify figures against current IRS tables.
        </p>
      </footer>
    </div>
  );
};
