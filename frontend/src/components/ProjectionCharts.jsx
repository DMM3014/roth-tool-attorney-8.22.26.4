import { Area, AreaChart, Bar, BarChart, Line, ComposedChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Card } from "@/components/ui/card";
import { fmtUSD } from "@/lib/api";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94" };
const AXIS_TICK = { fontSize: 11 };
const BAR_RADIUS = [3, 3, 0, 0];
const YEARS_AFTER_DEATH_LABEL = { value: "Years after death", position: "insideBottom", offset: -2, fontSize: 10 };
const ttFmt = (v) => fmtUSD(v);
const mAxis = (v) => `$${(v / 1e6).toFixed(0)}M`;

export const NetWorthChart = ({ data, loading }) => (
  <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-3" data-testid="networth-chart">
    <h3 className="font-display text-base font-bold tracking-tight mb-4">
      Net Worth — Conversions vs. No Conversions {loading && <span className="text-xs text-muted-foreground animate-pulse">updating…</span>}
    </h3>
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS_TICK} />
        <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} tick={AXIS_TICK} width={50} />
        <Tooltip formatter={ttFmt} />
        <Legend />
        <Bar dataKey="conversion" name="Roth Conversion" fill={C.sand} barSize={6} />
        <Line type="monotone" dataKey="netRoth" name="With Conversions" stroke={C.green} strokeWidth={2.5} dot={false} />
        <Line type="monotone" dataKey="netNo" name="No Conversions" stroke={C.terra} strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </Card>
);

export const CompositionChart = ({ data }) => (
  <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="composition-chart">
    <h3 className="font-display text-base font-bold tracking-tight mb-4">Account Composition Over Time</h3>
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS_TICK} />
        <YAxis tickFormatter={mAxis} tick={AXIS_TICK} width={45} />
        <Tooltip formatter={ttFmt} />
        <Legend />
        <Area type="monotone" stackId="1" dataKey="Cash" stroke={C.blue} fill={C.blue} fillOpacity={0.7} />
        <Area type="monotone" stackId="1" dataKey="Taxable" stroke={C.sage} fill={C.sage} fillOpacity={0.7} />
        <Area type="monotone" stackId="1" dataKey="Traditional" stroke={C.terra} fill={C.terra} fillOpacity={0.7} />
        <Area type="monotone" stackId="1" dataKey="Roth" stroke={C.green} fill={C.green} fillOpacity={0.8} />
      </AreaChart>
    </ResponsiveContainer>
  </Card>
);

export const TaxChart = ({ data }) => (
  <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="tax-chart">
    <h3 className="font-display text-base font-bold tracking-tight mb-4">Annual Tax Burden</h3>
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS_TICK} />
        <YAxis tickFormatter={(v) => `$${(v / 1e3).toFixed(0)}k`} tick={AXIS_TICK} width={45} />
        <Tooltip formatter={ttFmt} />
        <Bar dataKey="tax" name="Total Tax" fill={C.terra} radius={BAR_RADIUS} />
      </BarChart>
    </ResponsiveContainer>
  </Card>
);

export const LegacyHorizonChart = ({ rows }) => (
  <ResponsiveContainer width="100%" height={220}>
    <ComposedChart data={rows || []}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} />
      <XAxis dataKey="year_after_death" tick={AXIS_TICK} label={YEARS_AFTER_DEATH_LABEL} />
      <YAxis tickFormatter={mAxis} tick={AXIS_TICK} width={45} />
      <Tooltip formatter={ttFmt} />
      <Legend />
      <Area type="monotone" dataKey="inherited_roth" name="Inherited Roth (tax-free)" stroke={C.green} fill={C.green} fillOpacity={0.75} />
      <Area type="monotone" dataKey="inherited_traditional" name="Inherited Traditional (depleting)" stroke={C.terra} fill={C.terra} fillOpacity={0.65} />
      <Line type="monotone" dataKey="total_to_heirs" name="Total to Heirs" stroke={C.blue} strokeWidth={2.5} dot={false} />
    </ComposedChart>
  </ResponsiveContainer>
);

export const ConvertCompareChart = ({ data, targetPct }) => (
  <ResponsiveContainer width="100%" height={260}>
    <ComposedChart data={data}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} />
      <XAxis dataKey="year" tick={AXIS_TICK} label={YEARS_AFTER_DEATH_LABEL} />
      <YAxis tickFormatter={mAxis} tick={AXIS_TICK} width={45} />
      <Tooltip formatter={ttFmt} />
      <Legend />
      <Line type="monotone" dataKey="Convert" name={`Convert (${targetPct}%)`} stroke={C.green} strokeWidth={2.5} dot={false} />
      <Line type="monotone" dataKey="NoConvert" name="No conversions" stroke={C.terra} strokeWidth={2.5} dot={false} />
      <Line type="monotone" dataKey="ConvertRoth" name="Convert — Roth only" stroke={C.green} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
      <Line type="monotone" dataKey="NoConvertRoth" name="No-convert — Roth only" stroke={C.terra} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
    </ComposedChart>
  </ResponsiveContainer>
);
