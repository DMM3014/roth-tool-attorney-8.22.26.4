import axios from "axios";
import * as XLSX from "xlsx";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Anonymous per-browser session token (SEC-002): scopes saved scenarios so one
// visitor cannot read or delete another's plans. Minted once on first load,
// persisted in localStorage. UUIDv4 format required by the backend.
const SESSION_KEY = "roth-planner-session-token";
const uuidv4 = () => {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  // Cryptographically strong fallback for browsers lacking randomUUID.
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  throw new Error("Secure random generator unavailable");
};
export const getSessionToken = () => {
  if (typeof window === "undefined") return "";
  let tok = window.localStorage.getItem(SESSION_KEY);
  if (!tok) {
    tok = uuidv4();
    window.localStorage.setItem(SESSION_KEY, tok);
  }
  return tok;
};
// ---- Advisor PIN gate (SEC-003) ----
// The PIN-derived bearer token (30-day TTL, epoch-checked server-side) unlocks the
// advisor surface. Shared read-only links (?share=...) bypass the PIN: the share
// token itself is sent as X-Share-Token and unlocks just the compute endpoints.
const ADVISOR_KEY = "roth-planner-advisor-token";
const ROLE_KEY = "roth-planner-role";           // "master" | "licensee"
const EMAIL_KEY = "roth-planner-license-email"; // display-only, set for licensees
export const getAdvisorToken = () =>
  typeof window === "undefined" ? "" : window.localStorage.getItem(ADVISOR_KEY) || "";
export const setAdvisorToken = (t) => window.localStorage.setItem(ADVISOR_KEY, t);
export const clearAdvisorToken = () => {
  window.localStorage.removeItem(ADVISOR_KEY);
  window.localStorage.removeItem(ROLE_KEY);
  window.localStorage.removeItem(EMAIL_KEY);
};
export const getRole = () =>
  typeof window === "undefined" ? "" : window.localStorage.getItem(ROLE_KEY) || "";
export const setRole = (r) => window.localStorage.setItem(ROLE_KEY, r || "");
export const getLicenseEmail = () =>
  typeof window === "undefined" ? "" : window.localStorage.getItem(EMAIL_KEY) || "";
export const setLicenseEmail = (e) =>
  e ? window.localStorage.setItem(EMAIL_KEY, e) : window.localStorage.removeItem(EMAIL_KEY);
export const getShareTokenFromUrl = () =>
  typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("share") || "";
// Streaming calls (AI Insights) use raw fetch — same auth headers, built here.
export const authHeaders = () => {
  const h = {};
  const adv = getAdvisorToken();
  if (adv) h["Authorization"] = `Bearer ${adv}`;
  const share = getShareTokenFromUrl();
  if (share) h["X-Share-Token"] = share;
  return h;
};
// Dedicated axios instance so the session-token interceptor is scoped to our API
// calls only — never leaks onto third-party axios usage (or usage from other tabs
// / packages that also import axios). Every helper below uses `http` instead of
// the global `axios`.
const http = axios.create({ baseURL: API });
http.interceptors.request.use((cfg) => {
  cfg.headers = cfg.headers || {};
  cfg.headers["X-Session-Token"] = getSessionToken();
  Object.assign(cfg.headers, authHeaders());
  return cfg;
});
// A 401 carrying an auth detail means the token expired (30-day TTL) or the
// passcode was rotated / license was revoked — clear it and relock the app.
http.interceptors.response.use(
  (r) => r,
  (err) => {
    const detail = err?.response?.data?.detail;
    if (err?.response?.status === 401 &&
        (detail === "Advisor authentication required" ||
         detail === "Master authentication required")) {
      clearAdvisorToken();
      window.dispatchEvent(new Event("advisor-auth-required"));
    }
    return Promise.reject(err);
  }
);

export const verifyPin = (pin) => http.post(`/auth/pin/verify`, { pin }).then((r) => r.data);
export const changePin = (current_pin, new_pin) =>
  http.post(`/auth/pin/change`, { current_pin, new_pin }).then((r) => r.data);
export const pinStatus = () => http.get(`/auth/pin/status`).then((r) => r.data);

// ---- Licensee login ----
export const verifyLicense = (email, pin) =>
  http.post(`/auth/license/verify`, { email, pin }).then((r) => r.data);

// ---- Master-only admin (license CRUD) ----
export const adminListLicenses = () =>
  http.get(`/admin/licenses`).then((r) => r.data);
export const adminCreateLicense = (email, expires_at) =>
  http.post(`/admin/licenses`, { email, expires_at }).then((r) => r.data);
export const adminRotateLicensePin = (license_id) =>
  http.post(`/admin/licenses/${license_id}/rotate-pin`).then((r) => r.data);
export const adminRevokeLicense = (license_id) =>
  http.post(`/admin/licenses/${license_id}/revoke`).then((r) => r.data);
export const adminRenewLicense = (license_id, expires_at) =>
  http.post(`/admin/licenses/${license_id}/renew`, { expires_at }).then((r) => r.data);

export const fetchDefaults = () => http.get(`/defaults`).then((r) => r.data);
export const saveAsDefaults = (config) => http.post(`/defaults/save`, { config }).then((r) => r.data);
export const revertDefaults = () => http.delete(`/defaults/save`).then((r) => r.data);
// Per-license "these are MY defaults" — persists in Mongo, scoped to the caller's
// license id (or the master seat). Load order on GET /defaults: per-advisor doc →
// shared user_defaults.json → hard-coded DEFAULT_SCENARIO.
export const saveMyDefaults = (config) => http.post(`/defaults/mine`, { config }).then((r) => r.data);
export const revertMyDefaults = () => http.delete(`/defaults/mine`).then((r) => r.data);
export const fetchStates = () => http.get(`/states`).then((r) => r.data);
export const fetchMarketScenarios = () => http.get(`/market-scenarios`).then((r) => r.data);

// Estate planning — GST-exempt trust + DSUE portability + state estate tax.
export const fetchEstateStateMetadata = () =>
  http.get(`/estate/state-metadata`).then((r) => r.data);
export const analyzeEstate = (opts) =>
  http.post(`/estate/analyze`, opts).then((r) => r.data);
export const fetSensitivity = (opts) =>
  http.post(`/estate/fet-sensitivity`, opts).then((r) => r.data);
export const runEpFlowchart = (opts) =>
  http.post(`/estate/ep-flowchart`, opts).then((r) => r.data);

// Runs the same MC simulation across every market-scenario preset. Returns a
// compact per-regime table (success, P10/P50/P90 legacy, depleted %). Synchronous;
// backend is rate-limited to 6/minute given the 6× workload of each call.
export const runRegimeCompare = (opts) => http.post(`/montecarlo/regime-compare`, opts).then((r) => r.data);
// Audit Mode — compare a third-party planner's config against the review plan.
export const runAuditCompare = (review_config, planner_config) =>
  http.post(`/audit/compare`, { review_config, planner_config }).then((r) => r.data);
// Deterministic (single-path) projection under every named regime, both branches.
export const runRegimeDeterministicCompare = (config) =>
  http.post(`/regime-deterministic-compare`, { config }).then((r) => r.data);
// Two-way sensitivity heat surface: heir marginal rate x market regime.
export const runTwoWaySensitivity = (config) =>
  http.post(`/two-way-sensitivity`, { config }).then((r) => r.data);

// Two configs for the "deplete IRA now vs. leave it for the children" comparison:
// fund the conversion tax / spending IRA-first (deplete) vs Taxable-first (leave IRA).
// Optional gainPct overrides each taxable account's cost basis (drives the step-up forfeited).
export const fundingCompareConfigs = (scenario, gainPct) => {
  const mk = (order) => {
    const c = JSON.parse(JSON.stringify(scenario));
    c.withdrawal.funding_order = order;
    if (gainPct != null) {
      c.accounts.forEach((a) => {
        if (a.tax_type === "Taxable") a.cost_basis = Math.round((a.beginning_balance || 0) * (1 - gainPct));
      });
    }
    return c;
  };
  return {
    depleteIra: mk("Cash → IRA → Taxable → Roth"),
    leaveIra: mk("Cash → Taxable → IRA → Roth"),
  };
};
export const runProjection = (config) => http.post(`/projection`, { config }).then((r) => r.data);
// After-tax inheritance across a low / middle / high beneficiary marginal-rate
// band. Only the heirs' SECURE-10 horizon is re-priced per rate.
export const runHeirRateSensitivity = (config, heir_rates) =>
  http.post(`/legacy/heir-rate-sensitivity`, { config, heir_rates }).then((r) => r.data);
// Funding-order trade-off as the surviving spouse lives longer (same strategy,
// three withdrawal orders, several survivor life expectancies).
export const runFundingOrderLongevity = (config, extra_years) =>
  http.post(`/longevity/funding-order`, { config, extra_years }).then((r) => r.data);
// "Funding Order — The Hidden Lever": run the SAME configured plan (conversions
// unchanged) under 1-3 withdrawal funding orders and compare estate/heir outcomes.
export const compareFundingOrders = (config, orders) =>
  http.post(`/funding-order-compare`, { config, orders }).then((r) => r.data);
// Statutory single-source-of-truth figures (value, indexing, citation) for the report appendix + footer.
export const getLawConstants = () => http.get(`/law-constants`).then((r) => r.data);
export const runSweep = (config) => http.post(`/sweep`, { config }).then((r) => r.data);
// Sequence-of-returns stress test — 8 return paths x (with / without conversions).
export const runSequenceStress = (config, params = {}) =>
  http.post(`/sequence-stress`, { config, params }).then((r) => r.data);
export const runStrategySweep = (config, opts = {}) =>
  http.post(`/strategy-sweep`, { config, ...opts }).then((r) => r.data);
export const runStrategyStress = (config, strategies, opts = {}) =>
  http.post(`/strategy-stress`, { config, strategies, ...opts }).then((r) => r.data);
export const runSsOptimizer = (config, ages) =>
  http.post(`/ss-optimizer`, { config, ages }).then((r) => r.data);
export const optimizeConversion = (inputs, target_rate, max_conversion = 0, opts = {}) =>
  http.post(`/tax/optimize`, {
    inputs,
    target_rate,
    max_conversion,
    irmaa_aware: !!opts.irmaa_aware,
    irmaa_cliff_buffer: opts.irmaa_cliff_buffer ?? 3000,
  }).then((r) => r.data);
export const computeYearTax = (inputs) => http.post(`/tax/year`, { inputs }).then((r) => r.data);
export const listScenarios = (workspaceId) =>
  http.get(`/scenarios`, workspaceId ? { params: { workspace_id: workspaceId } } : undefined).then((r) => r.data);
export const saveScenario = (name, config, workspace_id) =>
  http.post(`/scenarios`, { name, config, workspace_id: workspace_id || null }).then((r) => r.data);
export const deleteScenario = (id) => http.delete(`/scenarios/${id}`).then((r) => r.data);
export const moveScenario = (id, workspace_id) =>
  http.patch(`/scenarios/${id}/workspace`, { workspace_id: workspace_id || null }).then((r) => r.data);
export const enableScenarioShare = (id) => http.post(`/scenarios/${id}/share`).then((r) => r.data.share_token);
export const revokeScenarioShare = (id) => http.delete(`/scenarios/${id}/share`).then((r) => r.data);
// Public read-only fetch — no session token required (the share_token IS the capability).
export const fetchSharedScenario = (shareToken) =>
  http.get(`/scenarios/share/${shareToken}`).then((r) => r.data);

// ---- Client workspaces ----
// Each workspace is a named folder that groups saved scenarios (one folder per
// client household). Scoped to the anonymous browser session like scenarios.
export const listWorkspaces = () => http.get(`/workspaces`).then((r) => r.data);
export const createWorkspace = (name, notes) =>
  http.post(`/workspaces`, { name, notes: notes || null }).then((r) => r.data);
export const updateWorkspace = (id, updates) =>
  http.patch(`/workspaces/${id}`, updates).then((r) => r.data);
export const deleteWorkspace = (id) => http.delete(`/workspaces/${id}`).then((r) => r.data);

export const startMonteCarlo = (config, opts) =>
  http.post(`/montecarlo`, { config, ...opts }).then((r) => r.data.job_id);
// poll until status is done/error (or timeout)
export const runMonteCarlo = async (config, opts = {}) => {
  const jobId = await startMonteCarlo(config, opts);
  for (let i = 0; i < 86; i++) {
    const job = await http.get(`/montecarlo/${jobId}`).then((r) => r.data);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "Monte Carlo failed");
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error("Monte Carlo timed out");
};

// Build the `assets` payload for Monte Carlo from a scenario's household allocation
// (`scenario.allocation = {stocks, bonds, cash}`). Returns null when the scenario has
// no allocation set — the backend then falls back to DEFAULT_ASSETS (60/30/10). Uses
// the same class means/vols as DEFAULT_ASSETS in montecarlo.py so only the WEIGHTS
// come from the user; return/vol assumptions remain centrally managed.
export const ASSET_CLASS_DEFAULTS = {
  stocks: { mean: 0.08, vol: 0.18 },
  bonds: { mean: 0.04, vol: 0.06 },
  cash: { mean: 0.03, vol: 0.01 },
};
export const allocationToAssets = (allocation) => {
  if (!allocation) return null;
  const w = {
    stocks: Number(allocation.stocks ?? 0),
    bonds: Number(allocation.bonds ?? 0),
    cash: Number(allocation.cash ?? 0),
  };
  const sum = w.stocks + w.bonds + w.cash;
  if (!(sum > 0)) return null;
  return {
    stocks: { weight: w.stocks / sum, ...ASSET_CLASS_DEFAULTS.stocks },
    bonds: { weight: w.bonds / sum, ...ASSET_CLASS_DEFAULTS.bonds },
    cash: { weight: w.cash / sum, ...ASSET_CLASS_DEFAULTS.cash },
  };
};

export const fmtUSD = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export const downloadCSV = (rows, filename) => {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  rows.forEach((r) => lines.push(cols.map((c) => (r[c] == null ? "" : r[c])).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// sheets: [{ name, rows: [{...}] }] -> single multi-sheet .xlsx workbook
export const downloadWorkbook = (sheets, filename) => {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows && rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
};

// ---- Present-value analytics ----
// Discount future nominal dollars to the plan's start year at the plan inflation rate.
export const pvDiscountRate = (scenario) => scenario?.projection?.general_inflation ?? 0.03;

export const pvSeries = (withRoth, noRoth, scenario, overrideRate = null) => {
  const start = scenario?.projection?.start_year ?? (withRoth?.rows?.[0]?.year || 0);
  // `overrideRate` (0..1) lets the Client Report Legacy toolbar slider override the
  // scenario-derived rate without mutating the scenario itself.
  const r = (overrideRate != null && Number.isFinite(overrideRate))
    ? overrideRate : pvDiscountRate(scenario);
  const factor = (year) => 1 / Math.pow(1 + r, Math.max(0, year - start));
  const rows = withRoth?.rows || [];
  const series = rows.map((row, i) => {
    const nwNo = noRoth?.rows?.[i]?.net_worth;
    const f = factor(row.year);
    return {
      year: row.year,
      conversion: Math.round(row.roth_conversion || 0),
      nominalWith: Math.round(row.net_worth || 0),
      pvWith: Math.round((row.net_worth || 0) * f),
      pvNo: nwNo != null ? Math.round(nwNo * f) : null,
    };
  });
  const finalYear = rows.length ? rows[rows.length - 1].year : start;
  const horizon = withRoth?.legacy?.horizon_years || 10;
  const deliverYear = finalYear + horizon;
  const ff = factor(deliverYear);
  const lw = withRoth?.legacy || {};
  const ln = noRoth?.legacy || {};
  const ntf = {
    deliverYear,
    horizon,
    discountRate: r,
    nominalWith: Math.round(lw.after_tax_estate_to_heirs || 0),
    nominalNo: Math.round(ln.after_tax_estate_to_heirs || 0),
    pvWith: Math.round((lw.after_tax_estate_to_heirs || 0) * ff),
    pvNo: Math.round((ln.after_tax_estate_to_heirs || 0) * ff),
    pvRothWith: Math.round((lw.tax_free_roth_to_heirs || 0) * ff),
    pvRothNo: Math.round((ln.tax_free_roth_to_heirs || 0) * ff),
  };
  return { series, ntf };
};

// Build verification spreadsheet rows from the PV series + net-to-family summary.
export const buildPvSheets = (series, ntf) => {
  const yearly = series.map((d) => ({
    Year: d.year,
    "Roth Conversion": d.conversion,
    "Net Worth (Nominal, With Conv)": d.nominalWith,
    "Net Worth PV (With Conv)": d.pvWith,
    "Net Worth PV (No Conv)": d.pvNo,
  }));
  const summary = [
    { Metric: "Discount rate (plan inflation)", Value: ntf.discountRate },
    { Metric: "Delivery year (2nd death + SECURE horizon)", Value: ntf.deliverYear },
    { Metric: "Net to family — nominal (With Conv)", Value: ntf.nominalWith },
    { Metric: "Net to family — nominal (No Conv)", Value: ntf.nominalNo },
    { Metric: "Net to family — PV (With Conv)", Value: ntf.pvWith },
    { Metric: "Net to family — PV (No Conv)", Value: ntf.pvNo },
    { Metric: "Net to family — PV delta (With − No)", Value: ntf.pvWith - ntf.pvNo },
    { Metric: "Tax-free inherited Roth — PV (With Conv)", Value: ntf.pvRothWith },
    { Metric: "Tax-free inherited Roth — PV (No Conv)", Value: ntf.pvRothNo },
  ];
  return { yearly, summary };
};
