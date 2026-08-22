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

// Dedicated Roth-conversion schedule — one prominent bar per year showing
// the conversion amount, with a cumulative-converted line overlay so users
// see both the annual size and the running total at a glance. The tiny
// `conversion` bar overlaid inside the Net Worth chart is easy to miss;
// this chart puts the schedule front-and-centre. Optional "headroom" segment
// stacked ABOVE each conversion bar shows dollars still available at the
// target bracket rate — advisors see where the plan left room on the table.
export const ConversionScheduleChart = ({ data }) => {
  const rows = (data || []).map((d) => ({
    year: d.year,
    conversion: Number(d.conversion || 0),
    headroom_unused: Number(d.headroom_unused || 0),
  }));
  const positive = rows.filter((r) => r.conversion > 0);
  const total = positive.reduce((s, r) => s + r.conversion, 0);
  const anyHeadroom = rows.some((r) => r.headroom_unused > 500);
  const maxRow = positive.reduce((m, r) => (r.conversion > (m?.conversion || 0) ? r : m), null);

  // Cumulative running total to give per-year context.
  let running = 0;
  const enriched = rows.map((r) => {
    running += r.conversion;
    // Only show headroom overlay in years where a conversion actually happened
    // (headroom outside the conversion window is confusing — it's not "left on
    // the table" if the plan intentionally didn't convert that year).
    const headroomShown = r.conversion > 0 ? r.headroom_unused : 0;
    return { ...r, headroomShown, cumulative: running };
  });

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="conversion-schedule-chart">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-base font-bold tracking-tight">Roth Conversion Schedule — by year</h3>
          <p className="text-xs text-muted-foreground max-w-3xl mt-1">
            One bar per year showing the Roth conversion amount produced by your current bracket ceiling, start/stop
            years, IRMAA cap and RMD stop toggle. The line overlay is the cumulative amount converted through that year.
            {anyHeadroom && (
              <> The <span className="font-medium">faint sand-coloured segment stacked on top of each bar</span> is <span className="font-medium">unused
              headroom to the target bracket ceiling</span> — dollars the plan could still have converted at your target
              rate. Zero headroom = the plan filled the bracket exactly.</>
            )}
          </p>
        </div>
        {positive.length > 0 && (
          <div className="grid grid-cols-3 gap-3 text-right shrink-0">
            <Stat label="Conversion years" value={String(positive.length)} testid="conv-schedule-count" />
            <Stat label="Largest year" value={maxRow ? `${maxRow.year}` : "—"}
                  sub={maxRow ? fmtUSD(maxRow.conversion) : ""} testid="conv-schedule-max" />
            <Stat label="Total converted" value={fmtUSD(total)} accent testid="conv-schedule-total" />
          </div>
        )}
      </div>
      {positive.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">
          No Roth conversions in the current window &mdash; enable conversions and raise the target bracket ceiling to
          see a schedule.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={enriched}>
            <CartesianGrid strokeOpacity={0.1} vertical={false} />
            <XAxis dataKey="year" tick={AXIS_TICK} />
            <YAxis yAxisId="left" tickFormatter={(v) => `$${(v / 1e3).toFixed(0)}k`}
                   tick={AXIS_TICK} width={55} />
            <YAxis yAxisId="right" orientation="right"
                   tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`}
                   tick={AXIS_TICK} width={55} />
            <Tooltip formatter={ttFmt} />
            <Legend />
            <Bar yAxisId="left" dataKey="conversion" name="Roth conversion (annual)"
                 stackId="conv" fill={C.green} radius={[0, 0, 0, 0]} />
            <Bar yAxisId="left" dataKey="headroomShown" name="Unused headroom to target bracket"
                 stackId="conv" fill={C.sand} fillOpacity={0.6} radius={BAR_RADIUS} />
            <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Cumulative converted"
                  stroke={C.terra} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
};

const Stat = ({ label, value, sub, accent, testid }) => (
  <div data-testid={testid}>
    <p className="label-cap text-muted-foreground text-[9px]">{label}</p>
    <p className={`font-display text-base font-bold leading-tight ${accent ? "text-[#4A6741]" : "text-[#1A1A1A]"}`}>
      {value}
    </p>
    {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
  </div>
);


export const LegacyHorizonChart = ({ rows }) => (
  <ResponsiveContainer width="100%" height={220}>
    <ComposedChart data={rows || []}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} />
      <XAxis dataKey="year_after_death" tick={AXIS_TICK} label={YEARS_AFTER_DEATH_LABEL} />
      <YAxis tickFormatter={mAxis} tick={AXIS_TICK} width={45} />
      <Tooltip formatter={ttFmt} />
      <Legend />
      <Area type="monotone" dataKey="inherited_roth" name="Inherited Roth (income-tax free through SECURE 10-yr window)" stroke={C.green} fill={C.green} fillOpacity={0.75} />
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
