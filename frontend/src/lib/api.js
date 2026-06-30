import axios from "axios";
import * as XLSX from "xlsx";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const fetchDefaults = () => axios.get(`${API}/defaults`).then((r) => r.data);
export const runProjection = (config) => axios.post(`${API}/projection`, { config }).then((r) => r.data);
export const runSweep = (config) => axios.post(`${API}/sweep`, { config }).then((r) => r.data);
export const optimizeConversion = (inputs, target_rate, max_conversion = 0) =>
  axios.post(`${API}/tax/optimize`, { inputs, target_rate, max_conversion }).then((r) => r.data);
export const computeYearTax = (inputs) => axios.post(`${API}/tax/year`, { inputs }).then((r) => r.data);
export const listScenarios = () => axios.get(`${API}/scenarios`).then((r) => r.data);
export const saveScenario = (name, config) => axios.post(`${API}/scenarios`, { name, config }).then((r) => r.data);
export const deleteScenario = (id) => axios.delete(`${API}/scenarios/${id}`).then((r) => r.data);

export const startMonteCarlo = (config, opts) =>
  axios.post(`${API}/montecarlo`, { config, ...opts }).then((r) => r.data.job_id);
// poll until status is done/error (or timeout)
export const runMonteCarlo = async (config, opts = {}) => {
  const jobId = await startMonteCarlo(config, opts);
  for (let i = 0; i < 60; i++) {
    const job = await axios.get(`${API}/montecarlo/${jobId}`).then((r) => r.data);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "Monte Carlo failed");
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error("Monte Carlo timed out");
};

export const fmtUSD = (v) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

export const pvSeries = (withRoth, noRoth, scenario) => {
  const start = scenario?.projection?.start_year ?? (withRoth?.rows?.[0]?.year || 0);
  const r = pvDiscountRate(scenario);
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
