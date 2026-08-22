import { useEffect, useMemo, useState } from "react";
import {
  Save, Trash2, FolderInput, FolderPlus, FolderOpen, FileSpreadsheet, FileDown, Share2, Copy, Check,
  Link2Off, Users, Pencil, X, ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  listScenarios, saveScenario, deleteScenario, fmtUSD,
  enableScenarioShare, revokeScenarioShare, moveScenario,
  listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace,
  runProjection, pvSeries, buildPvSheets, downloadWorkbook, downloadCSV,
} from "@/lib/api";
import { PvNetWorthChart, RothConversionsChart, PvNetToFamilyChart } from "@/components/AnalyticsCharts";

const UNFILED = "unfiled";

export const Scenarios = ({ scenario, setScenario }) => {
  const [items, setItems] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [activeWs, setActiveWs] = useState(UNFILED); // "all" | "unfiled" | workspace id
  const [name, setName] = useState("");
  // Where a newly-saved plan lands. Defaults to the currently-viewed folder.
  const [saveTargetWs, setSaveTargetWs] = useState(UNFILED);
  const [newWsName, setNewWsName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [pv, setPv] = useState(null);

  const refreshAll = async () => {
    const [wsData, sc] = await Promise.all([
      listWorkspaces().catch(() => ({ workspaces: [], unfiled_count: 0 })),
      listScenarios().catch(() => []),
    ]);
    setWorkspaces(wsData.workspaces || []);
    setUnfiledCount(wsData.unfiled_count || 0);
    setItems(sc);
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the "save into" target in sync with the currently-viewed folder for
  // one-click filing. Users can still override via the dropdown in the save row.
  useEffect(() => { setSaveTargetWs(activeWs === "all" ? UNFILED : activeWs); }, [activeWs]);

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

  const visibleItems = useMemo(() => {
    if (activeWs === "all") return items;
    if (activeWs === UNFILED) return items.filter((s) => !s.workspace_id);
    return items.filter((s) => s.workspace_id === activeWs);
  }, [items, activeWs]);

  const activeWsMeta = useMemo(() => workspaces.find((w) => w.id === activeWs), [workspaces, activeWs]);
  const wsNameFor = (id) => workspaces.find((w) => w.id === id)?.name || "";

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

  const save = async () => {
    if (!name.trim()) return toast.error("Enter a scenario name");
    const wid = saveTargetWs === UNFILED ? null : saveTargetWs;
    await saveScenario(name.trim(), scenario, wid);
    setName("");
    toast.success(wid ? `Scenario saved to "${wsNameFor(wid)}"` : "Scenario saved to Unfiled");
    refreshAll();
  };
  const load = (sc) => { setScenario(sc.config); toast.success(`Loaded "${sc.name}"`); };
  const del = async (id) => { await deleteScenario(id); toast.success("Deleted"); refreshAll(); };
  const move = async (sid, wid) => {
    try {
      await moveScenario(sid, wid);
      toast.success(wid ? `Moved to "${wsNameFor(wid)}"` : "Moved to Unfiled");
      refreshAll();
    } catch {
      toast.error("Could not move scenario");
    }
  };
  const enableShare = async (id) => {
    try {
      const token = await enableScenarioShare(id);
      const url = `${window.location.origin}/?share=${token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Read-only share link copied", { description: "Anyone with this link can view (not edit) the plan." });
      refreshAll();
    } catch {
      toast.error("Could not generate share link");
    }
  };
  const revokeShare = async (id) => {
    try {
      await revokeScenarioShare(id);
      toast.success("Share link revoked", { description: "The old link no longer works." });
      refreshAll();
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

  const addWorkspace = async () => {
    const trimmed = newWsName.trim();
    if (!trimmed) return toast.error("Enter a workspace name");
    try {
      const ws = await createWorkspace(trimmed);
      setNewWsName("");
      toast.success(`Created "${ws.name}"`);
      await refreshAll();
      setActiveWs(ws.id);
    } catch {
      toast.error("Could not create workspace");
    }
  };
  const commitRename = async (id) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return toast.error("Name cannot be blank");
    try {
      await updateWorkspace(id, { name: trimmed });
      toast.success("Workspace renamed");
      setRenamingId(null);
      refreshAll();
    } catch {
      toast.error("Could not rename workspace");
    }
  };
  const removeWorkspace = async (ws) => {
    try {
      const res = await deleteWorkspace(ws.id);
      toast.success(`Deleted "${ws.name}"`, {
        description: res.unfiled_scenarios
          ? `${res.unfiled_scenarios} scenario${res.unfiled_scenarios === 1 ? "" : "s"} moved to Unfiled — none lost.`
          : "No scenarios were affected.",
      });
      if (activeWs === ws.id) setActiveWs(UNFILED);
      refreshAll();
    } catch {
      toast.error("Could not delete workspace");
    }
  };

  return (
    <div className="space-y-6">
      {/* ---------- Client workspaces ---------- */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="workspaces-card">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Client Workspaces</h3>
          </div>
          <span className="text-[10px] label-cap text-muted-foreground">One folder per household</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Group saved scenarios by client household. Deleting a workspace never deletes its plans — they move to <span className="font-medium">Unfiled</span>.
        </p>

        <div className="flex flex-wrap gap-2 mb-4" data-testid="workspaces-tabs">
          <WsChip label="All" count={items.length} active={activeWs === "all"} onClick={() => setActiveWs("all")}
                  testid="ws-chip-all" />
          <WsChip label="Unfiled" count={unfiledCount} active={activeWs === UNFILED} onClick={() => setActiveWs(UNFILED)}
                  testid="ws-chip-unfiled" />
          {workspaces.map((ws) => (
            <WsChip key={ws.id} label={ws.name} count={ws.scenario_count} active={activeWs === ws.id}
                    onClick={() => setActiveWs(ws.id)} testid={`ws-chip-${ws.id}`} />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Input placeholder="New client workspace name…" value={newWsName} onChange={(e) => setNewWsName(e.target.value)}
                 className="bg-[#F9F8F6] max-w-xs" data-testid="new-workspace-input"
                 onKeyDown={(e) => e.key === "Enter" && addWorkspace()} />
          <Button onClick={addWorkspace} className="bg-[#7A9B76] hover:bg-[#5F7A5C] text-white" data-testid="create-workspace-button">
            <FolderPlus className="h-4 w-4 mr-2" /> Create workspace
          </Button>
          {activeWsMeta && (
            <div className="flex items-center gap-1 ml-auto">
              {renamingId === activeWsMeta.id ? (
                <>
                  <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                         className="bg-[#F9F8F6] max-w-[220px] h-9"
                         data-testid={`rename-input-${activeWsMeta.id}`}
                         onKeyDown={(e) => e.key === "Enter" && commitRename(activeWsMeta.id)} />
                  <Button size="sm" variant="outline" onClick={() => commitRename(activeWsMeta.id)}
                          data-testid={`rename-save-${activeWsMeta.id}`}
                          className="border-[#4A6741] text-[#4A6741]">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}
                          data-testid={`rename-cancel-${activeWsMeta.id}`}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline"
                          onClick={() => { setRenamingId(activeWsMeta.id); setRenameValue(activeWsMeta.name); }}
                          data-testid={`rename-workspace-${activeWsMeta.id}`}
                          className="border-[#4A6741] text-[#4A6741] gap-1">
                    <Pencil className="h-3.5 w-3.5" /> Rename
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" data-testid={`delete-workspace-${activeWsMeta.id}`}
                              className="border-[#B84A4A] text-[#B84A4A] gap-1">
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete workspace "{activeWsMeta.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The folder is removed, but every saved scenario inside it moves to <span className="font-medium">Unfiled</span> — no plans are lost.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeWorkspace(activeWsMeta)}
                                           className="bg-[#B84A4A] hover:bg-[#973B3B]"
                                           data-testid={`confirm-delete-workspace-${activeWsMeta.id}`}>
                          Delete workspace
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ---------- Saved scenarios ---------- */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="scenarios-card">
        <div className="flex items-center gap-2 mb-4">
          <FolderInput className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Saved Scenarios</h3>
          <span className="text-[11px] rounded-full bg-[#F1F5EF] text-[#4A6741] px-2 py-0.5"
                data-testid="active-workspace-label">
            {activeWs === "all" ? "All clients" : activeWs === UNFILED ? "Unfiled" : wsNameFor(activeWs)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Save and reload named plan variants. Edit household, income, expenses, accounts and tax assumptions on the <span className="font-medium">Plan Inputs</span> tab.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mb-5">
          <Input placeholder="Scenario name…" value={name} onChange={(e) => setName(e.target.value)}
            className="bg-[#F9F8F6]" data-testid="scenario-name-input" />
          <Select value={saveTargetWs} onValueChange={setSaveTargetWs}>
            <SelectTrigger className="bg-[#F9F8F6] sm:w-[220px]" data-testid="save-target-workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNFILED}>Unfiled</SelectItem>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={save} className="bg-[#4A6741] hover:bg-[#3B5234] text-white shrink-0" data-testid="save-scenario-button">
            <Save className="h-4 w-4 mr-2" /> Save
          </Button>
        </div>
        <div className="space-y-2" data-testid="scenarios-list">
          {visibleItems.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="scenarios-empty-state">
              {activeWs === "all"
                ? "No saved scenarios yet."
                : activeWs === UNFILED
                  ? "No unfiled scenarios."
                  : `No scenarios in "${wsNameFor(activeWs)}" yet — save one from the box above.`}
            </p>
          )}
          {visibleItems.map((sc) => (
            <div key={sc.id} className="rounded-lg border border-[#EBE8E0] p-3 hover:-translate-y-0.5 transition-transform duration-200">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-medium text-sm truncate">{sc.name}</p>
                    {sc.workspace_id && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[#7A9B76]/40 bg-[#F1F5EF] px-1.5 py-0.5 text-[10px] text-[#4A6741]"
                            data-testid={`ws-badge-${sc.id}`}>
                        <FolderOpen className="h-2.5 w-2.5" /> {wsNameFor(sc.workspace_id) || "workspace"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{sc.config?.household?.client_name} · ends {fmtUSD(sc.config?.accounts?.reduce((a, x) => a + x.beginning_balance, 0))}</p>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  <Select value={sc.workspace_id || UNFILED}
                          onValueChange={(v) => move(sc.id, v === UNFILED ? null : v)}>
                    <SelectTrigger className="h-8 w-[160px] bg-[#F9F8F6] text-xs" data-testid={`move-${sc.id}`}
                                   title="Move this scenario to another workspace">
                      <SelectValue placeholder="Move…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNFILED} className="text-xs">
                        <span className="inline-flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" /> Unfiled</span>
                      </SelectItem>
                      {workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id} className="text-xs">{ws.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

const WsChip = ({ label, count, active, onClick, testid }) => (
  <button type="button" onClick={onClick} data-testid={testid}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors
            ${active
              ? "border-[#4A6741] bg-[#4A6741] text-white"
              : "border-[#EBE8E0] bg-white text-[#4A6741] hover:bg-[#F1F5EF]"}`}>
    <FolderOpen className="h-3 w-3" />
    <span className="truncate max-w-[160px]">{label}</span>
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/25 text-white" : "bg-[#F1F5EF] text-[#4A6741]"}`}>{count ?? 0}</span>
  </button>
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
