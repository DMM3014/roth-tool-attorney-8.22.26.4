// Audit Mode — review a third-party financial planner's projection against the
// current workspace plan. Side-by-side assumption editor (Review vs. Planner),
// a Run Comparison action, the assumption diff, outcome-delta cards, and a
// single-variable attribution waterfall.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ScanSearch, Upload, Play } from "lucide-react";
import { toast } from "sonner";
import { runAuditCompare, fmtUSD, fmtPct } from "@/lib/api";

const PLANNER_KEY = "audit_planner_config_v1";

// Curated quick-edit assumption levers (path tokens + label + kind).
const LEVERS = [
  { path: ["projection", "general_inflation"], label: "General inflation (CPI)", pct: true },
  { path: ["legacy", "heir_federal_rate"], label: "Heir federal marginal rate", pct: true },
  { path: ["legacy", "heir_state_rate"], label: "Heir state rate", pct: true },
  { path: ["roth", "target_bracket"], label: "Roth target bracket", pct: true },
  { path: ["tax", "state_rate"], label: "State income tax rate", pct: true },
  { path: ["dividend_yield"], label: "Dividend yield (taxable)", pct: true },
];

const getPath = (o, tokens) => tokens.reduce((c, t) => (c == null ? c : c[t]), o);
const setPath = (o, tokens, val) => {
  const copy = structuredClone(o);
  let c = copy;
  for (let i = 0; i < tokens.length - 1; i++) { c[tokens[i]] = c[tokens[i]] ?? {}; c = c[tokens[i]]; }
  c[tokens[tokens.length - 1]] = val;
  return copy;
};

const OutcomeCard = ({ id, label, d }) => {
  if (!d) return null;
  const dn = d.delta_nominal || 0;
  const tone = Math.abs(dn) < 1 ? "#5A5A5A" : dn > 0 ? "#4A6741" : "#B84A4A";
  return (
    <div className="rounded-lg border border-[#EBE8E0] bg-white p-3" data-testid={`audit-card-${id}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="mt-1 text-lg font-display font-bold tabular-nums" style={{ color: tone }}>
        {dn >= 0 ? "+" : "−"}{fmtUSD(Math.abs(dn))}
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
        {dn >= 0 ? "+" : "−"}{fmtUSD(Math.abs(d.delta_today || 0))} today&apos;s $
      </div>
      <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
        Review {fmtUSD(d.review)} · Planner {fmtUSD(d.planner)}
      </div>
    </div>
  );
};

export const AuditMode = ({ scenario }) => {
  const [planner, setPlanner] = useState(() => {
    try {
      const raw = window.localStorage.getItem(PLANNER_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        // Only reuse the stored planner if its account structure still matches the
        // current review plan — otherwise per-index account rows would misalign.
        if (stored && Array.isArray(stored.accounts) &&
            stored.accounts.length === (scenario?.accounts?.length || 0)) {
          return stored;
        }
      }
    } catch { /* noop */ }
    return structuredClone(scenario);
  });
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const persist = (p) => { try { window.localStorage.setItem(PLANNER_KEY, JSON.stringify(p)); } catch { /* noop */ } };
  const updPlanner = (tokens, val) => setPlanner((p) => { const np = setPath(p, tokens, val); persist(np); return np; });
  const resetToReview = () => { const c = structuredClone(scenario); setPlanner(c); persist(c); toast.success("Planner reset to a copy of the review plan"); };

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== "object" || !parsed.accounts) throw new Error("bad");
      setPlanner(parsed); persist(parsed); setShowImport(false); setImportText("");
      toast.success("Planner config imported");
    } catch { toast.error("Invalid JSON — expected a full plan config"); }
  };

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await runAuditCompare(scenario, planner);
      setResult(res);
      try { window.localStorage.setItem("audit_last_result_v1", JSON.stringify(res)); } catch { /* noop */ }
      toast.success(`Compared — ${res.assumption_diff.count} assumption difference${res.assumption_diff.count === 1 ? "" : "s"}`);
    } catch (e) { setErr("Audit comparison failed. Check that both configs are complete."); }
    finally { setLoading(false); }
  };

  const accounts = planner?.accounts || [];
  const revAccounts = scenario?.accounts || [];
  const wf = result?.attribution?.waterfall || [];
  const maxCum = wf.length ? Math.max(...wf.map((w) => Math.abs(w.cumulative || 0)), 1) : 1;

  return (
    <div className="space-y-6" data-testid="audit-mode">
      <Card className="p-6 border-[#EBE8E0] shadow-none">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <ScanSearch className="h-5 w-5 text-[#4A6741] mt-0.5" />
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight">Audit Mode</h2>
              <p className="text-[11px] text-muted-foreground max-w-2xl mt-1 leading-relaxed">
                Review a third-party planner&apos;s projection against this workspace&apos;s plan. Edit the Planner column
                to match their assumptions (or import their full config as JSON), then run the comparison to see exactly
                which assumptions differ and how much each one moves the outcome.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowImport((v) => !v)} data-testid="audit-import-toggle">
              <Upload className="h-3.5 w-3.5 mr-1" /> Import JSON
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetToReview} data-testid="audit-reset">Reset to review</Button>
            <Button size="sm" className="h-8 text-xs bg-[#4A6741] hover:bg-[#3d5636]" onClick={run} disabled={loading} data-testid="audit-run">
              {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              Run Comparison
            </Button>
          </div>
        </div>

        {showImport && (
          <div className="mt-4 rounded-lg border border-[#EBE8E0] bg-[#FAFAF8] p-3">
            <p className="text-[11px] text-muted-foreground mb-2">Paste the planner&apos;s full plan config (JSON), then Import.</p>
            <Textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
              className="font-mono text-[11px]" placeholder='{ "accounts": [...], "projection": {...}, ... }' data-testid="audit-import-text" />
            <div className="flex justify-end mt-2">
              <Button size="sm" className="h-7 text-xs" onClick={doImport} data-testid="audit-import-apply">Import</Button>
            </div>
          </div>
        )}
        {err && <p className="text-sm text-[#B84A4A] mt-3" data-testid="audit-error">{err}</p>}

        {/* Side-by-side assumption editor */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm" data-testid="audit-editor">
            <thead>
              <tr className="text-[11px] text-muted-foreground border-b border-[#EBE8E0]">
                <th className="text-left px-2 py-1.5 font-semibold">Assumption</th>
                <th className="text-right px-2 py-1.5 font-semibold">Review (this plan)</th>
                <th className="text-right px-2 py-1.5 font-semibold">Planner (under review)</th>
              </tr>
            </thead>
            <tbody>
              {LEVERS.map((lv) => {
                const rv = getPath(scenario, lv.path);
                const pv = getPath(planner, lv.path);
                const diff = Number(rv) !== Number(pv);
                return (
                  <tr key={lv.path.join(".")} className="border-b border-[#F3F1EC]" style={{ background: diff ? "#C879410D" : undefined }}>
                    <td className="px-2 py-1.5">{lv.label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{lv.pct ? fmtPct(rv || 0) : fmtUSD(rv || 0)}</td>
                    <td className="px-2 py-1 text-right">
                      <Input type="number" step={lv.pct ? 0.005 : 1000}
                        value={lv.pct ? Math.round((pv || 0) * 10000) / 100 : (pv || 0)}
                        onChange={(e) => { const n = parseFloat(e.target.value) || 0; updPlanner(lv.path, lv.pct ? n / 100 : n); }}
                        className="h-7 text-xs text-right w-28 ml-auto bg-white" data-testid={`audit-lever-${lv.path.join("-")}`} />
                    </td>
                  </tr>
                );
              })}
              {accounts.map((a, i) => {
                const rv = revAccounts[i]?.return;
                const pv = a.return;
                const diff = Number(rv) !== Number(pv);
                return (
                  <tr key={`acct-${i}`} className="border-b border-[#F3F1EC]" style={{ background: diff ? "#C879410D" : undefined }}>
                    <td className="px-2 py-1.5">{a.name || a.tax_type} — return</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(rv || 0)}</td>
                    <td className="px-2 py-1 text-right">
                      <Input type="number" step={0.005} value={Math.round((pv || 0) * 10000) / 100}
                        onChange={(e) => { const n = parseFloat(e.target.value) || 0; updPlanner(["accounts", i, "return"], n / 100); }}
                        className="h-7 text-xs text-right w-28 ml-auto bg-white" data-testid={`audit-acct-return-${i}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-2">
            Quick levers above cover the common assumptions; use <strong>Import JSON</strong> to load a planner&apos;s full config
            (any field that differs is picked up by the comparison, not just these rows).
          </p>
        </div>
      </Card>

      {result && (
        <>
          {/* Outcome deltas */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="audit-outcomes">
            <h3 className="font-display text-base font-bold tracking-tight mb-1">Outcome deltas — Review minus Planner</h3>
            <p className="text-[11px] text-muted-foreground mb-4">Positive = the review plan delivers more; today&apos;s-dollar figures discount to plan start.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <OutcomeCard id="after-tax-to-heirs" label="After-tax to heirs" d={result.outcomes.deltas.after_tax_to_heirs_secure10} />
              <OutcomeCard id="net-worth-2nd-death" label="Net worth @ 2nd death" d={result.outcomes.deltas.net_worth_at_second_death} />
              <OutcomeCard id="lifetime-tax-nominal" label="Lifetime tax (nominal)" d={result.outcomes.deltas.lifetime_tax_nominal} />
              <OutcomeCard id="lifetime-tax-npv" label="Lifetime tax (NPV)" d={result.outcomes.deltas.lifetime_tax_npv} />
              <OutcomeCard id="total-conversions" label="Total conversions" d={result.outcomes.deltas.total_conversions} />
              <OutcomeCard id="federal-estate-tax" label="Federal estate tax" d={result.outcomes.deltas.federal_estate_tax_no_trust} />
            </div>
          </Card>

          {/* Attribution waterfall */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="audit-waterfall">
            <h3 className="font-display text-base font-bold tracking-tight mb-1">Attribution — what explains the gap in after-tax wealth to heirs</h3>
            <p className="text-[11px] text-muted-foreground mb-4">
              Each row re-runs the planner&apos;s plan changing only that one assumption to the review value. Steps plus the
              interaction residual reconstruct the full gap ({result.attribution.total_gap >= 0 ? "+" : "−"}{fmtUSD(Math.abs(result.attribution.total_gap))}).
            </p>
            <div className="space-y-1.5">
              {wf.map((w, i) => {
                const isEnd = w.type === "start" || w.type === "end";
                const val = isEnd ? w.cumulative : w.value;
                const barPct = Math.min(100, (Math.abs(w.cumulative || 0) / maxCum) * 100);
                const color = w.type === "start" ? "#5A5A5A" : w.type === "end" ? "#1A1A1A"
                  : w.type === "residual" ? "#8A5A20" : ((w.value || 0) >= 0 ? "#4A6741" : "#B84A4A");
                return (
                  <div key={i} className="flex items-center gap-3" data-testid={`audit-wf-row-${i}`}>
                    <div className="w-56 shrink-0 text-[11px] truncate" title={w.label}>
                      <span className={isEnd || w.type === "residual" ? "font-semibold" : ""}>{w.label}</span>
                    </div>
                    <div className="flex-1 h-5 bg-[#F3F1EC] rounded-sm relative">
                      <div className="h-full rounded-sm" style={{ width: `${barPct}%`, background: color, opacity: isEnd ? 1 : 0.85 }} />
                    </div>
                    <div className="w-32 shrink-0 text-right text-[11px] tabular-nums font-semibold" style={{ color }}>
                      {isEnd ? fmtUSD(val) : `${(w.value || 0) >= 0 ? "+" : "−"}${fmtUSD(Math.abs(w.value || 0))}`}
                    </div>
                    <div className="w-28 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                      {fmtUSD(w.cumulative)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Assumption diff table */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="audit-diff">
            <h3 className="font-display text-base font-bold tracking-tight mb-3">
              Assumption differences ({result.assumption_diff.count})
            </h3>
            {result.assumption_diff.count === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="audit-diff-empty">No differences — the two plans use identical assumptions.</p>
            ) : (
              Object.entries(result.assumption_diff.grouped).map(([section, items]) => (
                <div key={section} className="mb-4">
                  <div className="text-[11px] uppercase tracking-wide text-[#4A6741] font-bold mb-1">{section}</div>
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i} className="border-b border-[#F3F1EC]" data-testid={`audit-diff-row`}>
                          <td className="px-2 py-1.5 font-mono text-[11px] text-[#5A5A5A]">{it.path}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">Review: <strong>{String(it.review)}</strong></td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-[#8A5A20]">Planner: <strong>{String(it.planner)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
};

export default AuditMode;
