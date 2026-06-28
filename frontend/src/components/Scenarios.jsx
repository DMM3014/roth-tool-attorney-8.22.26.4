import { useEffect, useState } from "react";
import { Save, Trash2, FolderInput, Users } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listScenarios, saveScenario, deleteScenario, fmtUSD } from "@/lib/api";

export const Scenarios = ({ scenario, setScenario }) => {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const h = scenario.household;

  const refresh = () => listScenarios().then(setItems);
  useEffect(() => { refresh(); }, []);

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

  return (
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
            <div key={sc.id} className="flex items-center justify-between rounded-lg border border-[#EBE8E0] p-3 hover:-translate-y-0.5 transition-transform duration-200">
              <div>
                <p className="font-medium text-sm">{sc.name}</p>
                <p className="text-xs text-muted-foreground">{sc.config?.household?.client_name} · ends {fmtUSD(sc.config?.accounts?.reduce((a, x) => a + x.beginning_balance, 0))}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => load(sc)} data-testid={`load-${sc.id}`}>Load</Button>
                <Button size="sm" variant="ghost" onClick={() => del(sc.id)} data-testid={`del-${sc.id}`}>
                  <Trash2 className="h-4 w-4 text-[#B84A4A]" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
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
