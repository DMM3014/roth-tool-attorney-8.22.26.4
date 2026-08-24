import { useEffect, useState } from "react";
import { Leaf, TrendingUp, FolderOpen, Table2, ListTree, GitCompareArrows, BarChart3, Dices, Lightbulb, BadgeCheck, ScrollText, Trophy, CalendarClock, Share2, LogOut, RotateCcw, Save, ShieldCheck, User, Presentation as PresentationIcon, Users, Receipt, Wallet, FileText, Scale, IdCard, Landmark, ClipboardCheck, Workflow, Layers, Waves, Shuffle, ScanSearch } from "lucide-react";
import SequenceRisk from "@/components/SequenceRisk";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fetchDefaults, fetchSharedScenario, saveAsDefaults, clearAdvisorToken } from "@/lib/api";
import { Optimizer } from "@/components/Optimizer";
import { Projection } from "@/components/Projection";
import { Scenarios } from "@/components/Scenarios";
import { PlanInputs } from "@/components/PlanInputs";
import { DetailCashflow } from "@/components/DetailCashflow";
import { TaxDetail } from "@/components/TaxDetail";
import { Cashflow } from "@/components/Cashflow";
import { Compare } from "@/components/Compare";
import { Analytics } from "@/components/Analytics";
import { Presentation } from "@/components/Presentation";
import { ClientReport } from "@/components/ClientReport";
import { SSReport } from "@/components/SSReport";
import { ConvertCompare } from "@/components/ConvertCompare";
import { Estate } from "@/components/Estate";
import { AuditMode } from "@/components/AuditMode";
import { EpFlowchart } from "@/components/EpFlowchart";
import { DsueChecklist } from "@/components/DsueChecklist";
import { AdvisorInfo } from "@/components/AdvisorInfo";
import { MonteCarlo } from "@/components/MonteCarlo";
import { Concepts } from "@/components/Concepts";
import { WhitePaper } from "@/components/WhitePaper";
import { StrategyOptimizer } from "@/components/StrategyOptimizer";
import { SSOptimizer } from "@/components/SSOptimizer";
import { FundingOrderLever } from "@/components/FundingOrderLever";
import { BracketVisualizer } from "@/components/BracketVisualizer";
import { AdminPanel } from "@/components/AdminPanel";
import { TabDownloadMenu } from "@/components/shared/TabDownloadMenu";
import { GridPrefsProvider } from "@/lib/useGridPrefs";
import { mcScenarioSig } from "@/lib/mcSignature";

export const Planner = ({ session = {} }) => {
  const role = session.role || "master";  // fallback for legacy loads
  const isMaster = role === "master";
  const licenseEmail = session.email || "";
  const [scenario, setScenario] = useState(null);
  const [mcResult, setMcResult] = useState(null);
  const [mcForEstate, setMcForEstate] = useState(null);
  const [stressResult, setStressResult] = useState(null);
  const [regimeResult, setRegimeResult] = useState(null);
  // Sequence-of-returns stress test — produced on the Sequence Risk tab, printed
  // by the deck when the advisor switches that page on.
  const [seqResult, setSeqResult] = useState(null);
  // Cross-tab preset auto-run bridge — Plan Inputs presets can offer a
  // "Run sweep now" toast action that jumps to the Strategy Analyzer tab
  // and kicks off the sweep on landing. `autoRunPending` is the one-shot flag
  // StrategyOptimizer consumes on mount; `activeTab` makes Tabs controlled so
  // we can programmatically switch to `strategy` when the action fires.
  const initialTab = (typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("share")) ? "optimizer" : "inputs";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [autoRunPending, setAutoRunPending] = useState(false);
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

  // Stress-test result (Strategy Analyzer) — consumed by Presentation.
  const handleStressResult = (r) => setStressResult(r);

  // Persistent MC copy for the Estate rebasis — unlike mcResult (cleared on any
  // scenario edit), this survives edits and carries the scenario signature it
  // was run against so Estate can flag it as stale instead of silently losing it.
  const handleMcResult = (r) => {
    setMcResult(r);
    if (r) setMcForEstate({ ...r, _scenarioSig: mcScenarioSig(scenario) });
  };

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

  // Plan Inputs → Strategy Analyzer bridge. Fired by the "Run sweep now"
  // toast action on a goal-preset click. Bumps the auto-run flag first so it
  // is set BEFORE StrategyOptimizer mounts on the tab switch, then flips the
  // active tab. StrategyOptimizer consumes the flag on mount and resets it via
  // `onAutoRunConsumed`, keeping this a strict one-shot trigger.
  const handleRequestRunSweep = () => {
    setAutoRunPending(true);
    setActiveTab("strategy");
  };
  const handleAutoRunConsumed = () => setAutoRunPending(false);

  // Promote the current in-memory scenario to be the app's baked-in defaults. The
  // backend persists it to user_defaults.json, so every future page load AND every
  // future "Reset to defaults" click restores to THIS state.
  const saveCurrentAsDefaults = () => {
    if (!scenario) return;
    saveAsDefaults(scenario)
      .then(() => toast.success("Current inputs and switches saved as the new defaults."))
      .catch(() => toast.error("Could not save defaults. Please try again."));
  };

  if (!scenario) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse label-cap">Loading tax engine…</div>
      </div>
    );
  }

  return (
    <GridPrefsProvider>
    <div className="min-h-screen grain">
      <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-[#EBE8E0]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[#4A6741] flex items-center justify-center">
              <Leaf className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight leading-none">Retirement & Wealth-Transfer Illustration — Attorney Edition</h1>
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
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="save-defaults-btn"
                      className="gap-1.5 rounded-full border-[#4A6741]/50 text-[#4A6741] hover:bg-[#4A6741]/10 hover:text-[#3B5234]">
                      <Save className="h-3.5 w-3.5" /> Save as defaults
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent data-testid="save-defaults-dialog">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Save current inputs as the new defaults?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Every input and switch currently loaded — household, income streams, expenses,
                        accounts, taxes, Roth conversion controls, funding order, and legacy/heir
                        settings — will become the new baked-in defaults for the app. Future page loads
                        and "Reset to defaults" clicks will restore to THIS state. Saved scenarios are
                        untouched.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="save-defaults-cancel">Cancel</AlertDialogCancel>
                      <AlertDialogAction data-testid="save-defaults-confirm" onClick={saveCurrentAsDefaults}
                        className="bg-[#4A6741] hover:bg-[#3B5234]">
                        Save as defaults
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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
                {/* Master PIN is now env-controlled and cannot be rotated in-UI. Licensee
                    self-service PIN change is planned for a future release. */}
              </>
            )}
            {!sharedInfo && (
              <div className="flex items-center gap-2" data-testid="session-badge">
                {isMaster ? (
                  <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-[#4A6741]/40 bg-[#4A6741]/10 px-2.5 py-1 text-[10px] font-semibold text-[#4A6741]"
                        title="You are signed in as the master owner. Only you can manage licenses.">
                    <ShieldCheck className="h-3 w-3" /> Master
                  </span>
                ) : (
                  <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-[#7A9B76]/40 bg-[#7A9B76]/10 px-2.5 py-1 text-[10px] font-medium text-[#3B5234] max-w-[220px] truncate"
                        title={licenseEmail}>
                    <User className="h-3 w-3" /> {licenseEmail || "Licensee"}
                  </span>
                )}
                <Button size="sm" variant="outline"
                        onClick={() => { clearAdvisorToken(); window.location.reload(); }}
                        data-testid="sign-out-btn"
                        className="gap-1 rounded-full border-[#B84A4A]/40 text-[#B84A4A] hover:bg-[#B84A4A]/10">
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </Button>
              </div>
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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-[#EBE8E0] mb-8 flex flex-wrap h-auto p-1 gap-1 justify-start" data-testid="main-tabs">
            {!sharedInfo && (
              <TabsTrigger value="inputs" data-testid="tab-inputs" className="gap-2 data-[state=active]:bg-white">
                <Table2 className="h-4 w-4" /> Plan Inputs
              </TabsTrigger>
            )}
            <TabsTrigger value="projection" data-testid="tab-projection" className="gap-2 data-[state=active]:bg-white">
              <TrendingUp className="h-4 w-4" /> Conversion and Plan Controls
            </TabsTrigger>
            {!sharedInfo && (
              <TabsTrigger value="scenarios" data-testid="tab-scenarios" className="gap-2 data-[state=active]:bg-white">
                <FolderOpen className="h-4 w-4" /> Scenarios
              </TabsTrigger>
            )}
            {/* Single-Year Analyzer trigger hidden per advisor request (2026-08-21).
                The tab CONTENT is still mounted below so any saved deep link keeps
                working — only the navigation button is withdrawn. */}
            <TabsTrigger value="strategy" data-testid="tab-strategy" className="gap-2 data-[state=active]:bg-white">
              <Trophy className="h-4 w-4" /> Strategy Analyzer
            </TabsTrigger>
            <TabsTrigger value="ssopt" data-testid="tab-ssopt" className="gap-2 data-[state=active]:bg-white">
              <CalendarClock className="h-4 w-4" /> SS Analyzer
            </TabsTrigger>
            {!sharedInfo && isMaster && (
              <TabsTrigger value="admin" data-testid="tab-admin" className="gap-2 data-[state=active]:bg-white">
                <Users className="h-4 w-4" /> Admin
              </TabsTrigger>
            )}
            {/* Force wrap: everything below starts on Row 2 (Analyze & Present) */}
            <div aria-hidden="true" className="basis-full h-0" data-testid="main-tabs-row-break" />
            <TabsTrigger value="cashflow" data-testid="tab-cashflow" className="gap-2 data-[state=active]:bg-white">
              <ListTree className="h-4 w-4" /> Accounts & Cashflow
            </TabsTrigger>
            <TabsTrigger value="tax" data-testid="tab-tax" className="gap-2 data-[state=active]:bg-white">
              <Receipt className="h-4 w-4" /> Tax Detail
            </TabsTrigger>
            <TabsTrigger value="bracket-viz" data-testid="tab-bracket-viz" className="gap-2 data-[state=active]:bg-white">
              <Layers className="h-4 w-4" /> Bracket Visualizer
            </TabsTrigger>
            <TabsTrigger value="cashflow-detail" data-testid="tab-cashflow-detail" className="gap-2 data-[state=active]:bg-white">
              <Wallet className="h-4 w-4" /> Cashflow
            </TabsTrigger>
            <TabsTrigger value="analytics" data-testid="tab-analytics" className="gap-2 data-[state=active]:bg-white">
              <BarChart3 className="h-4 w-4" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="montecarlo" data-testid="tab-montecarlo" className="gap-2 data-[state=active]:bg-white">
              <Dices className="h-4 w-4" /> Monte Carlo
            </TabsTrigger>
            <TabsTrigger value="sequence-risk" data-testid="tab-sequence-risk" className="gap-2 data-[state=active]:bg-white">
              <Waves className="h-4 w-4" /> Sequence Risk
            </TabsTrigger>
            <TabsTrigger value="compare" data-testid="tab-compare" className="gap-2 data-[state=active]:bg-white">
              <GitCompareArrows className="h-4 w-4" /> Compare
            </TabsTrigger>
            <TabsTrigger value="presentation" data-testid="tab-presentation" className="gap-2 data-[state=active]:bg-white">
              <PresentationIcon className="h-4 w-4" /> Presentation
            </TabsTrigger>
            <TabsTrigger value="client-deck" data-testid="tab-client-deck" className="gap-2 data-[state=active]:bg-white">
              <Layers className="h-4 w-4" /> Client Deck
            </TabsTrigger>
            <TabsTrigger value="client-report" data-testid="tab-client-report" className="gap-2 data-[state=active]:bg-white">
              <FileText className="h-4 w-4" /> Client Report
            </TabsTrigger>
            <TabsTrigger value="ss-report" data-testid="tab-ss-report" className="gap-2 data-[state=active]:bg-white">
              <CalendarClock className="h-4 w-4" /> SS Report
            </TabsTrigger>
            <TabsTrigger value="convert-compare" data-testid="tab-convert-compare" className="gap-2 data-[state=active]:bg-white">
              <Scale className="h-4 w-4" /> Convert vs Skip
            </TabsTrigger>
            <TabsTrigger value="funding-order" data-testid="tab-funding-order" className="gap-2 data-[state=active]:bg-white">
              <Shuffle className="h-4 w-4" /> Funding Order
            </TabsTrigger>
            <TabsTrigger value="estate" data-testid="tab-estate" className="gap-2 data-[state=active]:bg-white">
              <Landmark className="h-4 w-4" /> Estate
            </TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit" className="gap-2 data-[state=active]:bg-white">
              <ScanSearch className="h-4 w-4" /> Audit Mode
            </TabsTrigger>
            <TabsTrigger value="ep-flowchart" data-testid="tab-ep-flowchart" className="gap-2 data-[state=active]:bg-white">
              <Workflow className="h-4 w-4" /> EP Flowchart
            </TabsTrigger>
            <TabsTrigger value="dsue" data-testid="tab-dsue" className="gap-2 data-[state=active]:bg-white">
              <ClipboardCheck className="h-4 w-4" /> DSUE Checklist
            </TabsTrigger>
            <TabsTrigger value="concepts" data-testid="tab-concepts" className="gap-2 data-[state=active]:bg-white">
              <Lightbulb className="h-4 w-4" /> Concepts
            </TabsTrigger>
            <TabsTrigger value="whitepaper" data-testid="tab-whitepaper" className="gap-2 data-[state=active]:bg-white">
              <ScrollText className="h-4 w-4" /> White Paper
            </TabsTrigger>
            <TabsTrigger value="advisor-info" data-testid="tab-advisor-info" className="gap-2 data-[state=active]:bg-white">
              <IdCard className="h-4 w-4" /> Advisor Info
            </TabsTrigger>
          </TabsList>

          <TabsContent value="optimizer">
            <Optimizer scenario={scenario} />
          </TabsContent>
          <TabsContent value="projection">
            <Projection scenario={scenario} setScenario={setScenario} mcResult={mcResult} />
          </TabsContent>
          <TabsContent value="strategy" forceMount hidden={activeTab !== "strategy"}>
            <StrategyOptimizer scenario={scenario} setScenario={setScenario}
              onStressResult={handleStressResult}
              autoRunPending={autoRunPending} onAutoRunConsumed={handleAutoRunConsumed} />
          </TabsContent>
          <TabsContent value="ssopt">
            <SSOptimizer scenario={scenario} setScenario={setScenario} />
          </TabsContent>
          <TabsContent value="cashflow">
            <DetailCashflow scenario={scenario} />
          </TabsContent>
          <TabsContent value="tax">
            <TaxDetail scenario={scenario} />
          </TabsContent>
          <TabsContent value="bracket-viz">
            <BracketVisualizer scenario={scenario} />
          </TabsContent>
          <TabsContent value="cashflow-detail">
            <Cashflow scenario={scenario} />
          </TabsContent>
          <TabsContent value="analytics">
            <Analytics scenario={scenario} />
          </TabsContent>
          <TabsContent value="presentation">
            <Presentation scenario={scenario} setScenario={setScenario}
              stressResult={stressResult} regimeResult={regimeResult} seqResult={seqResult} />
          </TabsContent>
          <TabsContent value="client-deck">
            <Presentation scenario={scenario} setScenario={setScenario}
              stressResult={stressResult} regimeResult={regimeResult} seqResult={seqResult} curated />
          </TabsContent>
          <TabsContent value="client-report">
            <ClientReport scenario={scenario} setScenario={setScenario} />
          </TabsContent>
          <TabsContent value="ss-report">
            <SSReport scenario={scenario} setScenario={setScenario} />
          </TabsContent>
          <TabsContent value="convert-compare">
            <ConvertCompare scenario={scenario} />
          </TabsContent>
          <TabsContent value="funding-order">
            <FundingOrderLever scenario={scenario} />
          </TabsContent>
          <TabsContent value="estate">
            <Estate scenario={scenario} mcResult={mcForEstate} />
          </TabsContent>
          <TabsContent value="audit">
            <AuditMode scenario={scenario} />
          </TabsContent>
          <TabsContent value="ep-flowchart">
            <EpFlowchart scenario={scenario} />
          </TabsContent>
          <TabsContent value="dsue">
            <DsueChecklist />
          </TabsContent>
          <TabsContent value="advisor-info">
            <AdvisorInfo />
          </TabsContent>
          <TabsContent value="concepts">
            <Concepts scenario={scenario} />
          </TabsContent>
          <TabsContent value="whitepaper">
            <WhitePaper scenario={scenario} />
          </TabsContent>
          {!sharedInfo && isMaster && (
            <TabsContent value="admin">
              <AdminPanel />
            </TabsContent>
          )}
          <TabsContent value="montecarlo">
            <MonteCarlo scenario={scenario} setScenario={setScenario} onResult={handleMcResult} onRegimeResult={setRegimeResult} />
          </TabsContent>
          <TabsContent value="sequence-risk">
            <SequenceRisk scenario={scenario} seqResult={seqResult} setSeqResult={setSeqResult} />
          </TabsContent>
          {!sharedInfo && (
            <TabsContent value="inputs">
              <PlanInputs scenario={scenario} setScenario={setScenario}
                onRequestRunSweep={handleRequestRunSweep} />
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

      <TabDownloadMenu activeTab={activeTab} />
    </div>
    </GridPrefsProvider>
  );
};
