import { useEffect, useState } from "react";
import { Leaf, SlidersHorizontal, TrendingUp, FolderOpen, Table2, ListTree, GitCompareArrows, BarChart3, Dices, Lightbulb, BadgeCheck, ScrollText, Trophy, CalendarClock, Share2, LogOut, RotateCcw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fetchDefaults, fetchSharedScenario } from "@/lib/api";
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
import { StrategyOptimizer } from "@/components/StrategyOptimizer";
import { SSOptimizer } from "@/components/SSOptimizer";

export const Planner = () => {
  const [scenario, setScenario] = useState(null);
  const [mcResult, setMcResult] = useState(null);
  // Read-only shared-view mode: when the URL carries ?share=<token>, we fetch the
  // shared plan and disable editing / save tabs. `sharedInfo` gates the banner + tab
  // trimming; the actual plan just flows into `scenario` like a locally-loaded one.
  const [sharedInfo, setSharedInfo] = useState(null);
  const [shareError, setShareError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get("share");
    if (shareToken) {
      fetchSharedScenario(shareToken)
        .then((s) => {
          setScenario(s.config);
          setSharedInfo({ name: s.name, created_at: s.created_at });
        })
        .catch(() => {
          setShareError("This share link is invalid or has been revoked.");
          fetchDefaults().then(setScenario);
        });
    } else {
      fetchDefaults().then(setScenario);
    }
  }, []);

  // a scenario edit invalidates a prior Monte Carlo run
  const scenarioSig = scenario && JSON.stringify(scenario);
  useEffect(() => { setMcResult(null); }, [scenarioSig]);

  const exitShared = () => {
    // Drop the ?share= param and reload with the default scenario.
    window.location.href = window.location.origin + window.location.pathname;
  };

  // One-click restore: every input and switch across every tab binds to `scenario`,
  // so re-fetching /api/defaults resets the whole model in a single state swap.
  const resetToDefaults = () => {
    fetchDefaults()
      .then((d) => {
        setScenario(d);
        toast.success("Plan reset — all inputs and switches restored to model defaults.");
      })
      .catch(() => toast.error("Could not load defaults. Please try again."));
  };

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
          <div className="flex items-center gap-3">
            <span className="hidden md:flex items-center gap-3">
              <span className="label-cap text-[#7A9B76]">v9 Longevity Engine</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4A6741]/30 bg-[#4A6741]/5 px-2.5 py-1 text-[10px] font-medium text-[#4A6741]" data-testid="obbba-badge">
                <BadgeCheck className="h-3 w-3" /> Current law · OBBBA 2025 (permanent, indexed brackets)
              </span>
            </span>
            {!sharedInfo && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="reset-defaults-btn"
                    className="gap-1.5 rounded-full border-[#C87941]/50 text-[#C87941] hover:bg-[#C87941]/10 hover:text-[#B06A36]">
                    <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent data-testid="reset-defaults-dialog">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset plan to model defaults?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every input and switch — household, income streams, expenses, accounts, taxes,
                      Roth conversion controls, funding order, and legacy/heir settings — will be restored
                      to the model&apos;s defaults. Unsaved changes are lost; saved scenarios are untouched.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="reset-defaults-cancel">Cancel</AlertDialogCancel>
                    <AlertDialogAction data-testid="reset-defaults-confirm" onClick={resetToDefaults}
                      className="bg-[#C87941] hover:bg-[#B06A36]">
                      Reset plan
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </header>

      {sharedInfo && (
        <div className="bg-[#F1F5EF] border-b border-[#4A6741]/30" data-testid="shared-view-banner">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Share2 className="h-4 w-4 text-[#4A6741] shrink-0" />
              <p className="text-sm text-[#4A6741] truncate">
                <span className="font-semibold">Shared view (read-only)</span> · &ldquo;{sharedInfo.name}&rdquo;
                <span className="hidden sm:inline text-muted-foreground"> · saving and editing are disabled</span>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={exitShared} data-testid="exit-shared-view"
              className="gap-1.5 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10 shrink-0">
              <LogOut className="h-3.5 w-3.5" /> Exit
            </Button>
          </div>
        </div>
      )}
      {shareError && (
        <div className="bg-[#FBF3EC] border-b border-[#C87941]/30" data-testid="shared-view-error">
          <div className="max-w-7xl mx-auto px-6 py-3 text-sm text-[#C87941]">{shareError}</div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-10">
        <Tabs defaultValue="optimizer">
          <TabsList className="bg-[#EBE8E0] mb-8" data-testid="main-tabs">
            <TabsTrigger value="optimizer" data-testid="tab-optimizer" className="gap-2 data-[state=active]:bg-white">
              <SlidersHorizontal className="h-4 w-4" /> Single-Year Optimizer
            </TabsTrigger>
            <TabsTrigger value="projection" data-testid="tab-projection" className="gap-2 data-[state=active]:bg-white">
              <TrendingUp className="h-4 w-4" /> Multi-Year Projection
            </TabsTrigger>
            <TabsTrigger value="strategy" data-testid="tab-strategy" className="gap-2 data-[state=active]:bg-white">
              <Trophy className="h-4 w-4" /> Strategy Optimizer
            </TabsTrigger>
            <TabsTrigger value="ssopt" data-testid="tab-ssopt" className="gap-2 data-[state=active]:bg-white">
              <CalendarClock className="h-4 w-4" /> SS Optimizer
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
            {!sharedInfo && (
              <TabsTrigger value="inputs" data-testid="tab-inputs" className="gap-2 data-[state=active]:bg-white">
                <Table2 className="h-4 w-4" /> Plan Inputs
              </TabsTrigger>
            )}
            {!sharedInfo && (
              <TabsTrigger value="scenarios" data-testid="tab-scenarios" className="gap-2 data-[state=active]:bg-white">
                <FolderOpen className="h-4 w-4" /> Scenarios
              </TabsTrigger>
            )}
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
          <TabsContent value="strategy">
            <StrategyOptimizer scenario={scenario} setScenario={setScenario} />
          </TabsContent>
          <TabsContent value="ssopt">
            <SSOptimizer scenario={scenario} setScenario={setScenario} />
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
            <WhitePaper scenario={scenario} />
          </TabsContent>
          <TabsContent value="montecarlo">
            <MonteCarlo scenario={scenario} onResult={setMcResult} />
          </TabsContent>
          {!sharedInfo && (
            <TabsContent value="inputs">
              <PlanInputs scenario={scenario} setScenario={setScenario} />
            </TabsContent>
          )}
          {!sharedInfo && (
            <TabsContent value="scenarios">
              <Scenarios scenario={scenario} setScenario={setScenario} />
            </TabsContent>
          )}
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
