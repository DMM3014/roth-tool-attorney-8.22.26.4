import { Plus, Trash2, Coins, Receipt, PiggyBank, Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const Cell = ({ children, w }) => <td className={`px-2 py-1.5 ${w || ""}`}>{children}</td>;

const parseField = (raw, type) => {
  if (type !== "number") return raw;
  return raw === "" ? null : parseFloat(raw);
};

const Txt = ({ value, onChange, type = "text", testid, step }) => (
  <Input type={type} step={step} value={value ?? ""} data-testid={testid}
    onChange={(e) => onChange(parseField(e.target.value, type))}
    className="h-8 bg-[#F9F8F6] text-xs px-2" />
);

const Sel = ({ value, onChange, options, testid }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="h-8 bg-[#F9F8F6] text-xs" data-testid={testid}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
  </Select>
);

// Date input — boundary years prorate by exact day-count in the engine
const DateInput = ({ value, onChange, testid }) => (
  <Input type="date" value={value ?? ""} data-testid={testid}
    onChange={(e) => onChange(e.target.value || null)}
    className="h-8 bg-[#F9F8F6] text-xs px-2 w-[140px]" />
);

const yearOf = (d) => (d ? parseInt(String(d).slice(0, 4), 10) : null);

const OWNERS = ["Client", "Spouse", "Joint"];
const FREQS = ["Annual", "Monthly"];
const TAX_CHARS = ["Ordinary", "SS", "Annuity", "QDiv/LTCG"];

export const PlanInputs = ({ scenario, setScenario }) => {
  const mut = (key, idx, field, value) => {
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      next[key][idx][field] = value;
      return next;
    });
  };
  // set a date field and keep the matching *_year in sync (engine uses the date for proration)
  const mutDate = (key, idx, dateField, yearField, value) => {
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      next[key][idx][dateField] = value;
      next[key][idx][yearField] = yearOf(value);
      return next;
    });
  };
  const addRow = (key, template) => setScenario((p) => ({ ...p, [key]: [...p[key], template] }));
  const delRow = (key, idx) => setScenario((p) => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));

  return (
    <div className="space-y-6">
      {/* Income streams */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="income-streams-editor">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Income Streams</h3>
          </div>
          <Button size="sm" onClick={() => addRow("income_streams", {
            id: `INC${Date.now()}`, owner: "Joint", type: "Other", description: "New income",
            start_date: `${scenario.projection.start_year}-01-01`, stop_date: null,
            start_year: scenario.projection.start_year, stop_year: null, amount: 0, frequency: "Annual",
            cola: 0.03, tax_character: "Ordinary", taxable_pct: 1, survivor_pct: 1, use: true,
          })} className="bg-[#4A6741] hover:bg-[#3B5234] text-white" data-testid="add-income-button">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-1">Description</th><th className="px-2">Owner</th><th className="px-2">Tax Character</th>
                <th className="px-2">Amount</th><th className="px-2">Freq</th><th className="px-2">COLA</th>
                <th className="px-2">Start Date</th><th className="px-2">Stop Date</th><th className="px-2">Surv%</th><th className="px-2">Use</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scenario.income_streams.map((s, i) => (
                <tr key={s.id} className="border-b border-[#F3F1EC]" data-testid={`income-row-${i}`}>
                  <Cell w="min-w-[160px]"><Txt value={s.description} onChange={(v) => mut("income_streams", i, "description", v)} testid={`inc-desc-${i}`} /></Cell>
                  <Cell><Sel value={s.owner} onChange={(v) => mut("income_streams", i, "owner", v)} options={OWNERS} testid={`inc-owner-${i}`} /></Cell>
                  <Cell><Sel value={s.tax_character} onChange={(v) => mut("income_streams", i, "tax_character", v)} options={TAX_CHARS} testid={`inc-char-${i}`} /></Cell>
                  <Cell w="w-24"><Txt type="number" value={s.amount} onChange={(v) => mut("income_streams", i, "amount", v)} testid={`inc-amt-${i}`} /></Cell>
                  <Cell><Sel value={s.frequency} onChange={(v) => mut("income_streams", i, "frequency", v)} options={FREQS} testid={`inc-freq-${i}`} /></Cell>
                  <Cell w="w-16"><Txt type="number" step={0.01} value={s.cola} onChange={(v) => mut("income_streams", i, "cola", v)} testid={`inc-cola-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={s.start_date} onChange={(v) => mutDate("income_streams", i, "start_date", "start_year", v)} testid={`inc-start-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={s.stop_date} onChange={(v) => mutDate("income_streams", i, "stop_date", "stop_year", v)} testid={`inc-stop-${i}`} /></Cell>
                  <Cell w="w-16"><Txt type="number" step={0.1} value={s.survivor_pct} onChange={(v) => mut("income_streams", i, "survivor_pct", v)} testid={`inc-surv-${i}`} /></Cell>
                  <Cell><Switch checked={s.use} onCheckedChange={(v) => mut("income_streams", i, "use", v)} data-testid={`inc-use-${i}`} /></Cell>
                  <Cell><button onClick={() => delRow("income_streams", i)} data-testid={`inc-del-${i}`}><Trash2 className="h-4 w-4 text-[#B84A4A]" /></button></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Expenses */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="expenses-editor">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-[#C87941]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Expenses</h3>
          </div>
          <Button size="sm" onClick={() => addRow("expenses", {
            id: `EXP${Date.now()}`, owner: "Joint", category: "New expense",
            start_date: `${scenario.projection.start_year}-01-01`, stop_date: null,
            start_year: scenario.projection.start_year, stop_year: null, amount: 0,
            frequency: "Annual", inflation: 0.03, use: true,
          })} className="bg-[#4A6741] hover:bg-[#3B5234] text-white" data-testid="add-expense-button">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-1">Category</th><th className="px-2">Owner</th><th className="px-2">Amount</th>
                <th className="px-2">Freq</th><th className="px-2">Inflation</th><th className="px-2">Start Date</th><th className="px-2">Stop Date</th><th className="px-2">Use</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scenario.expenses.map((e, i) => (
                <tr key={e.id} className="border-b border-[#F3F1EC]" data-testid={`expense-row-${i}`}>
                  <Cell w="min-w-[160px]"><Txt value={e.category} onChange={(v) => mut("expenses", i, "category", v)} testid={`exp-cat-${i}`} /></Cell>
                  <Cell><Sel value={e.owner} onChange={(v) => mut("expenses", i, "owner", v)} options={OWNERS} testid={`exp-owner-${i}`} /></Cell>
                  <Cell w="w-24"><Txt type="number" value={e.amount} onChange={(v) => mut("expenses", i, "amount", v)} testid={`exp-amt-${i}`} /></Cell>
                  <Cell><Sel value={e.frequency} onChange={(v) => mut("expenses", i, "frequency", v)} options={FREQS} testid={`exp-freq-${i}`} /></Cell>
                  <Cell w="w-16"><Txt type="number" step={0.01} value={e.inflation} onChange={(v) => mut("expenses", i, "inflation", v)} testid={`exp-infl-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={e.start_date} onChange={(v) => mutDate("expenses", i, "start_date", "start_year", v)} testid={`exp-start-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={e.stop_date} onChange={(v) => mutDate("expenses", i, "stop_date", "stop_year", v)} testid={`exp-stop-${i}`} /></Cell>
                  <Cell><Switch checked={e.use} onCheckedChange={(v) => mut("expenses", i, "use", v)} data-testid={`exp-use-${i}`} /></Cell>
                  <Cell><button onClick={() => delRow("expenses", i)} data-testid={`exp-del-${i}`}><Trash2 className="h-4 w-4 text-[#B84A4A]" /></button></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Accounts */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="accounts-editor">
        <div className="flex items-center gap-2 mb-1">
          <PiggyBank className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Accounts</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
          Enter each <span className="font-medium">taxable account's Expected Return as the GROSS total return</span> (e.g. 0.07).
          The engine pays out the dividend yield below as taxable cash income each year and grows the account at the
          <span className="font-medium"> appreciation rate = gross return − dividend yield</span> (so set the return gross; appreciation is computed net of dividends automatically).
          Tax-deferred, Roth, cash and real-estate accounts grow at their full return.
        </p>
        <div className="mb-4 max-w-xs">
          <Label className="text-xs text-muted-foreground">Taxable Dividend Yield</Label>
          <Input type="number" step={0.005} value={scenario.dividend_yield ?? 0.02} data-testid="dividend-yield"
            onChange={(e) => setScenario((p) => ({ ...p, dividend_yield: parseFloat(e.target.value) || 0 }))}
            className="mt-1 bg-[#F9F8F6]" />
          <p className="text-[10px] text-muted-foreground mt-1">Paid to cash as qualified dividends (taxed at LTCG rates). 0 = pure appreciation, makes taxable behave like a Roth via step-up.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-1">Account</th><th className="px-2">Tax Type</th><th className="px-2">Beginning Balance</th>
                <th className="px-2">Cost Basis</th><th className="px-2">Expected Return</th>
              </tr>
            </thead>
            <tbody>
              {scenario.accounts.map((a, i) => (
                <tr key={a.id} className="border-b border-[#F3F1EC]" data-testid={`account-row-${i}`}>
                  <Cell w="min-w-[180px]"><Txt value={a.name} onChange={(v) => mut("accounts", i, "name", v)} testid={`acc-name-${i}`} /></Cell>
                  <Cell><span className="text-muted-foreground">{a.tax_type}</span></Cell>
                  <Cell w="w-32"><Txt type="number" step={10000} value={a.beginning_balance} onChange={(v) => mut("accounts", i, "beginning_balance", v)} testid={`acc-bal-${i}`} /></Cell>
                  <Cell w="w-32"><Txt type="number" step={10000} value={a.cost_basis} onChange={(v) => mut("accounts", i, "cost_basis", v)} testid={`acc-basis-${i}`} /></Cell>
                  <Cell w="w-24"><Txt type="number" step={0.005} value={a.return} onChange={(v) => mut("accounts", i, "return", v)} testid={`acc-return-${i}`} /></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {/* Tax assumptions & heirs */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="tax-heirs-editor">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Tax Assumptions & Heirs</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          The heir tax rate is what your beneficiaries pay to draw down an <span className="font-medium">inherited Traditional IRA</span> (SECURE 10-year). It drives the "Find Optimal Bracket" result — converting at a rate <span className="font-medium">higher</span> than your heirs' rate destroys value, so set this to your beneficiaries' real bracket.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Your State Income Tax Rate</Label>
            <Input type="number" step={0.001} value={scenario.tax.state_rate} data-testid="tax-state-rate"
              onChange={(e) => setScenario((p) => ({ ...p, tax: { ...p.tax, state_rate: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">e.g. 0.0399 = 3.99%. Set 0 to disable.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Heirs' Federal Tax Rate</Label>
            <Input type="number" step={0.01} value={scenario.legacy.heir_federal_rate} data-testid="heir-fed-rate"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_federal_rate: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Heirs' marginal federal bracket.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Heirs' State Tax Rate</Label>
            <Input type="number" step={0.01} value={scenario.legacy.heir_state_rate} data-testid="heir-state-rate"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_state_rate: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Heirs' state bracket (0 if none).</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Estate Settlement Cost</Label>
            <Input type="number" step={0.005} value={scenario.legacy.estate_settlement_pct} data-testid="estate-settlement-pct"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, estate_settlement_pct: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">% of gross estate at 2nd death.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Post-Death Horizon (years)</Label>
            <Input type="number" step={1} value={scenario.legacy.post_death_years ?? 10} data-testid="post-death-years"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, post_death_years: parseInt(e.target.value, 10) || 10 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">SECURE drawdown window (default 10).</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Heirs' Reinvestment Return</Label>
            <Input type="number" step={0.005} value={scenario.legacy.heir_reinvest_return ?? ""} placeholder="auto (account return)" data-testid="heir-reinvest-return"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_reinvest_return: e.target.value === "" ? null : parseFloat(e.target.value) } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Growth heirs earn post-death. Blank = use account returns.</p>
          </div>
          <div className="md:col-span-2 flex items-end">
            <div className="rounded-lg border border-[#4A6741]/30 bg-[#4A6741]/5 p-3 w-full" data-testid="blended-heir-rate">
              <p className="label-cap text-[#4A6741] text-[10px] mb-1">Blended Heir Rate on Inherited IRA</p>
              <p className="font-display text-2xl font-bold text-[#4A6741]">
                {(((scenario.legacy.heir_federal_rate || 0) + (scenario.legacy.heir_state_rate || 0)) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};
