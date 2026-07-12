import { useEffect, useState } from "react";
import { Save, Trash2, FolderInput, Users, FileSpreadsheet, FileDown, Share2, Copy, Check, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  listScenarios, saveScenario, deleteScenario, fmtUSD,
  enableScenarioShare, revokeScenarioShare,
  runProjection, pvSeries, buildPvSheets, downloadWorkbook, downloadCSV,
} from "@/lib/api";
import { PvNetWorthChart, RothConversionsChart, PvNetToFamilyChart } from "@/components/AnalyticsCharts";

export const Scenarios = ({ scenario, setScenario }) => {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [pv, setPv] = useState(null);
  const h = scenario.household;

  const refresh = () => listScenarios().then(setItems);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const tasks = [runProjection(scenario)];
      if (scenario.roth?.enabled) {
        const noCfg = JSON.parse(JSON.stringify(scenario));
        noCfg.roth.enabled = false;
        tasks.push(runProjection(noCfg));
      }
      Promise.all(tasks).then(([a, b]) => {
        if (alive) setPv(pvSeries(a, b || a, scenario));
      });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const downloadData = (fmt) => {
    if (!pv) return;
    const { yearly, summary } = buildPvSheets(pv.series, pv.ntf);
    if (fmt === "xlsx") {
      downloadWorkbook([
        { name: "PV Net Worth & Conversions", rows: yearly },
        { name: "Net to Family (PV)", rows: summary },
      ], "scenario-pv-results.xlsx");
    } else {
      downloadCSV(yearly, "scenario-pv-results.csv");
    }
  };

  const updH = (k, v) => setScenario((p) => ({ ...p, household: { ...p.household, [k]: v } }));

  const save = async () => {
    if (!name.trim()) return toast.error("Enter a scenario name");
    await saveScenario(name.trim(), scenario);
    setName("");
    toast.success("Scenario saved");
    refresh();
  };
  const load = (sc) => { setScenario(sc.config); toast.success(`Loaded "${sc.name}"`); };
  const del = async (id) => { await deleteScenario(id); toast.success("Deleted"); refresh(); };
  const enableShare = async (id) => {
    try {
      const token = await enableScenarioShare(id);
      const url = `${window.location.origin}/?share=${token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Read-only share link copied", { description: "Anyone with this link can view (not edit) the plan." });
      refresh();
    } catch {
      toast.error("Could not generate share link");
    }
  };
  const revokeShare = async (id) => {
    try {
      await revokeScenarioShare(id);
      toast.success("Share link revoked", { description: "The old link no longer works." });
      refresh();
    } catch {
      toast.error("Could not revoke share link");
    }
  };
  const copyShareUrl = async (token) => {
    const url = `${window.location.origin}/?share=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed — select the URL manually");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="household-card">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Household & Longevity</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Life expectancies drive the death-of-spouse transition from MFJ to the survivor filing status.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Client name" value={h.client_name} onChange={(v) => updH("client_name", v)} testid="hh-client-name" />
          <Field label="Spouse name" value={h.spouse_name} onChange={(v) => updH("spouse_name", v)} testid="hh-spouse-name" />
          <Field label="Client birth year" type="number" value={h.client_dob_year} onChange={(v) => updH("client_dob_year", +v)} testid="hh-client-dob" />
          <Field label="Spouse birth year" type="number" value={h.spouse_dob_year} onChange={(v) => updH("spouse_dob_year", +v)} testid="hh-spouse-dob" />
          <Field label="Client life expectancy (age)" type="number" value={h.client_life_expectancy} onChange={(v) => updH("client_life_expectancy", +v)} testid="hh-client-le" />
          <Field label="Spouse life expectancy (age)" type="number" value={h.spouse_life_expectancy} onChange={(v) => updH("spouse_life_expectancy", +v)} testid="hh-spouse-le" />
          <Field label="Projection start year" type="number" value={scenario.projection.start_year}
            onChange={(v) => setScenario((p) => ({ ...p, projection: { ...p.projection, start_year: +v } }))} testid="hh-start-year" />
          <Field label="Projection end year" type="number" value={scenario.projection.end_year}
            onChange={(v) => setScenario((p) => ({ ...p, projection: { ...p.projection, end_year: +v } }))} testid="hh-end-year" />
        </div>
      </Card>

      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="scenarios-card">
        <div className="flex items-center gap-2 mb-4">
          <FolderInput className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Saved Scenarios</h3>
        </div>
        <div className="flex gap-2 mb-5">
          <Input placeholder="Scenario name…" value={name} onChange={(e) => setName(e.target.value)}
            className="bg-[#F9F8F6]" data-testid="scenario-name-input" />
          <Button onClick={save} className="bg-[#4A6741] hover:bg-[#3B5234] text-white shrink-0" data-testid="save-scenario-button">
            <Save className="h-4 w-4 mr-2" /> Save
          </Button>
        </div>
        <div className="space-y-2" data-testid="scenarios-list">
          {items.length === 0 && <p className="text-sm text-muted-foreground">No saved scenarios yet.</p>}
          {items.map((sc) => (
            <div key={sc.id} className="rounded-lg border border-[#EBE8E0] p-3 hover:-translate-y-0.5 transition-transform duration-200">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{sc.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{sc.config?.household?.client_name} · ends {fmtUSD(sc.config?.accounts?.reduce((a, x) => a + x.beginning_balance, 0))}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => load(sc)} data-testid={`load-${sc.id}`}>Load</Button>
                  {sc.share_token
                    ? <Button size="sm" variant="ghost" onClick={() => revokeShare(sc.id)} data-testid={`unshare-${sc.id}`}
                        title="Revoke share link" className="text-[#4A6741]">
                        <Link2Off className="h-4 w-4" />
                      </Button>
                    : <Button size="sm" variant="ghost" onClick={() => enableShare(sc.id)} data-testid={`share-${sc.id}`}
                        title="Create read-only share link" className="text-[#4A6741]">
                        <Share2 className="h-4 w-4" />
                      </Button>}
                  <Button size="sm" variant="ghost" onClick={() => del(sc.id)} data-testid={`del-${sc.id}`}>
                    <Trash2 className="h-4 w-4 text-[#B84A4A]" />
                  </Button>
                </div>
              </div>
              {sc.share_token && (
                <ShareLinkRow token={sc.share_token} onCopy={() => copyShareUrl(sc.share_token)} testid={`share-url-${sc.id}`} />
              )}
            </div>
          ))}
        </div>
      </Card>
      </div>

      {pv && (
        <>
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] px-5 py-4" data-testid="scenario-pv-toolbar">
            <div>
              <p className="font-display text-sm font-bold tracking-tight">Present-value results for this scenario</p>
              <p className="text-[11px] text-muted-foreground">Future net worth, planned conversions & net-to-family in today&apos;s dollars. Download the data to reconcile against your source spreadsheet.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadData("xlsx")} data-testid="scenario-download-xlsx"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <FileSpreadsheet className="h-4 w-4" /> Download Excel
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadData("csv")} data-testid="scenario-download-csv"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <FileDown className="h-4 w-4" /> Download CSV
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="scenario-pv-grid">
            <PvNetWorthChart data={pv.series} />
            <RothConversionsChart data={pv.series} span={1} />
            <PvNetToFamilyChart ntf={pv.ntf} span={1} />
          </div>
        </>
      )}
    </div>
  );
};

const Field = ({ label, value, onChange, type = "text", testid }) => (
  <div>
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <Input type={type} value={value} data-testid={testid}
      onChange={(e) => onChange(e.target.value)} className="mt-1 bg-[#F9F8F6]" />
  </div>
);

const ShareLinkRow = ({ token, onCopy, testid }) => {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/?share=${token}`;
  const handle = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-[#EBE8E0] bg-[#F1F5EF] px-2 py-1.5" data-testid={testid}>
      <Share2 className="h-3 w-3 text-[#4A6741] shrink-0" />
      <span className="text-[11px] font-mono text-muted-foreground truncate flex-1" title={url}>{url}</span>
      <Button size="sm" variant="ghost" onClick={handle} className="h-6 gap-1 px-2 text-[11px] text-[#4A6741]">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
};
