import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const fetchDefaults = () => axios.get(`${API}/defaults`).then((r) => r.data);
export const runProjection = (config) => axios.post(`${API}/projection`, { config }).then((r) => r.data);
export const optimizeConversion = (inputs, target_rate, max_conversion = 0) =>
  axios.post(`${API}/tax/optimize`, { inputs, target_rate, max_conversion }).then((r) => r.data);
export const computeYearTax = (inputs) => axios.post(`${API}/tax/year`, { inputs }).then((r) => r.data);
export const listScenarios = () => axios.get(`${API}/scenarios`).then((r) => r.data);
export const saveScenario = (name, config) => axios.post(`${API}/scenarios`, { name, config }).then((r) => r.data);
export const deleteScenario = (id) => axios.delete(`${API}/scenarios/${id}`).then((r) => r.data);

export const fmtUSD = (v) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
