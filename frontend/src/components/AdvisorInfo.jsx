import { useState } from "react";
import { User, Building2, Mail, Phone, IdCard, Save, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAdvisorInfo, defaultAdvisorInfo } from "@/lib/advisorInfo";
import { AdvisorLogoUploader, useAdvisorLogo, LogoHeader } from "@/lib/advisorLogo";
import { GeminiKeyCard } from "./GeminiKeyCard";

// ============================================================================
// Advisor Info — top-level tab that owns the advisor's identity (name, firm,
// contact info, and firm logo). Client Report and Presentation read from
// this store so a firm's details populate automatically on every report.
// ============================================================================
export const AdvisorInfo = () => {
  const [info, setInfo] = useAdvisorInfo();
  const [logo] = useAdvisorLogo();
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState(info);

  const upd = (k, v) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); };
  const save = () => { setInfo(draft); setDirty(false); toast.success("Advisor info saved."); };
  const revert = () => { setDraft(info); setDirty(false); };
  const resetAll = () => {
    setInfo(defaultAdvisorInfo);
    setDraft(defaultAdvisorInfo);
    setDirty(false);
    toast.info("Advisor info cleared.");
  };

  return (
    <div className="space-y-6" data-testid="advisor-info-root">
      {/* Preview strip — how the advisor's branding will appear on reports */}
      <div className="rounded-xl border border-[#EBE8E0] bg-gradient-to-r from-[#F9F8F6] to-white shadow-sm p-5" data-testid="advisor-info-preview">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-[#4A6741] mb-2">
          Preview — appears on Client Report + Presentation covers
        </div>
        <div className="flex items-center gap-4">
          <LogoHeader logo={logo} testid="advisor-info-preview-logo" />
          <div>
            {draft.advisor_name && <div className="font-display text-xl font-bold text-[#1A1A1A]">{draft.advisor_name}</div>}
            {draft.advisor_firm && <div className="text-sm text-[#5A5A5A] font-medium">{draft.advisor_firm}</div>}
            <div className="text-[11px] text-muted-foreground mt-1 space-x-3">
              {draft.advisor_email && <span data-testid="advisor-info-preview-email">✉ {draft.advisor_email}</span>}
              {draft.advisor_phone && <span data-testid="advisor-info-preview-phone">☎ {draft.advisor_phone}</span>}
            </div>
            {!draft.advisor_name && !draft.advisor_firm && !draft.advisor_email && !draft.advisor_phone && !logo && (
              <p className="text-[12px] italic text-muted-foreground">Add your details below — this preview updates live.</p>
            )}
          </div>
        </div>
      </div>

      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="advisor-info-form">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
            <IdCard className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-bold tracking-tight text-[#1A1A1A]">Advisor Information</h3>
            <p className="text-[12px] text-muted-foreground max-w-2xl leading-relaxed">
              Your identity as it appears on every report you deliver. Set it once here — it will populate the cover
              pages, footer, and (optionally) a watermark on both the Client Report and Presentation exports.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {dirty && (
              <Button size="sm" variant="outline" onClick={revert}
                data-testid="advisor-info-revert"
                className="h-9 gap-1 text-xs">
                <RotateCcw className="h-3.5 w-3.5" /> Revert
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!dirty}
              data-testid="advisor-info-save"
              className="h-9 gap-1 bg-[#4A6741] hover:bg-[#3B5234] text-white text-xs">
              <Save className="h-3.5 w-3.5" /> Save changes
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-[11px] label-cap flex items-center gap-1 mb-1">
              <User className="h-3 w-3" /> Advisor / preparer name
            </Label>
            <Input value={draft.advisor_name}
              data-testid="advisor-info-name"
              onChange={(e) => upd("advisor_name", e.target.value)}
              placeholder="e.g. Jane Smith, CFP®"
              className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[11px] label-cap flex items-center gap-1 mb-1">
              <Building2 className="h-3 w-3" /> Firm
            </Label>
            <Input value={draft.advisor_firm}
              data-testid="advisor-info-firm"
              onChange={(e) => upd("advisor_firm", e.target.value)}
              placeholder="e.g. Cedar Ridge Wealth Advisors"
              className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[11px] label-cap flex items-center gap-1 mb-1">
              <Mail className="h-3 w-3" /> Email
            </Label>
            <Input value={draft.advisor_email}
              data-testid="advisor-info-email"
              onChange={(e) => upd("advisor_email", e.target.value)}
              placeholder="you@firm.com"
              className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[11px] label-cap flex items-center gap-1 mb-1">
              <Phone className="h-3 w-3" /> Phone
            </Label>
            <Input value={draft.advisor_phone}
              data-testid="advisor-info-phone"
              onChange={(e) => upd("advisor_phone", e.target.value)}
              placeholder="(555) 555-0100"
              className="h-9 text-sm" />
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-[#EBE8E0]">
          <AdvisorLogoUploader testidPrefix="advisor-info-logo" />
        </div>

        <GeminiKeyCard />

        <div className="mt-6 pt-4 border-t border-[#EBE8E0] flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Advisor info is stored on this device (browser localStorage). It syncs instantly to open Client Report
            and Presentation tabs.
          </p>
          <Button size="sm" variant="ghost" onClick={resetAll}
            data-testid="advisor-info-clear-all"
            className="h-8 text-[11px] text-[#B84A4A] hover:bg-[#B84A4A]/5">
            Clear all
          </Button>
        </div>
      </Card>

      {/* Advisor talking points — Estate/GST case for Roth conversions */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="advisor-talking-points-estate">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-bold tracking-tight text-[#1A1A1A]">Advisor talking points — The Estate + GST case for Roth conversions</h3>
            <p className="text-[12px] text-muted-foreground max-w-3xl leading-relaxed">
              Client-ready phrasing for the toughest question in the recommendation: <em>&quot;Why should I fund a trust
              with Roth assets instead of just leaving everything to my spouse?&quot;</em> The full narrative also lives in
              the Client Report (dedicated page before Estate Planning) and in the White Paper (§6.2). Use this card as
              a &quot;cheat sheet&quot; when the conversation moves faster than a printed report allows.
            </p>
          </div>
        </div>

        <div className="space-y-4 text-[13px] leading-relaxed text-[#2A2A2A]">
          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-[#4A6741] mb-1">1. The pre-conversion dilemma (the elevator pitch)</div>
            <p>
              &quot;Trusts are terrible at receiving ordinary income — an accumulation trust hits the 37% + 3.8% NIIT
              ceiling at only <strong>~$16,000 of retained income</strong>. So sending a Traditional IRA into a trust
              through the SECURE 10-year window turns a 24–36% family tax problem into a ~41% one. The historical
              workaround — a conduit trust — pushes distributions straight out to beneficiaries at their individual
              rates, but that empties the entire IRA out of the trust within a decade. No creditor protection, no
              divorce protection, no spendthrift control, no GST leverage. It&apos;s a forced choice: tax efficiency
              or asset control, never both.&quot;
            </p>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-[#4A6741] mb-1">2. Why the Roth changes everything</div>
            <p>
              &quot;A Roth flowing into an accumulation trust still faces the 10-year payout — but the distributions
              <strong> arrive tax-free</strong>, so the compressed trust brackets have nothing to bite. The trustee
              retains and reinvests the full proceeds behind the trust&apos;s protections. Ongoing income inside the
              trust is then taxed at trust rates OR carried out to beneficiaries via DNI at their individual rates —
              trustee discretion, year by year.&quot;
            </p>
            <p className="mt-2">
              &quot;And here&apos;s the character split that actually matters at each annual trustee meeting:
              <strong> ordinary income</strong> — dividends, interest, other DNI — gets distributed out, because the
              trust&apos;s 37% top ordinary rate versus your beneficiaries&apos; 24–32% is a 5–13 point saving every
              year (bigger if a child is in peak-earning years). But <strong>capital gains</strong> are typically
              retained: the trust&apos;s 20% top LTCG rate is only about 5 points above the individual 15% LTCG rate,
              so the retention penalty is small compared to the creditor protection, spendthrift control, and
              compounding gained by keeping the corpus inside the trust. Distribute ordinary, retain LTCG — that
              flexibility is itself a form of control the old conduit structure never offered.&quot;
            </p>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-[#4A6741] mb-1">3. The GST asymmetry (the technical clincher)</div>
            <p>
              &quot;A frequently overlooked technical point: the <strong>estate tax exemption is portable</strong> via
              DSUE, but the <strong>GST exemption is not</strong>. If we rely on portability at first death,
              your entire GST exemption is <strong>not utilized</strong> and cannot be recovered later. Funding a bypass/GST trust at the first death
              and allocating your GST exemption to it via Form 706 Schedule R is what preserves it. That trust then
              shelters every subsequent generation&apos;s transfers from the 40% GST tax, on top of the estate-tax
              shelter — for as long as your state&apos;s Rule Against Perpetuities allows.&quot;
            </p>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-[#4A6741] mb-1">4. Tying it to the conversion program</div>
            <p>
              &quot;Every dollar we convert during your life is a dollar that can go to the trust with <strong>full
              control AND full tax efficiency</strong>. Every un-converted Traditional dollar forces the old bad choice
              at your death — spousal rollover (deferral, but no trust protection and back into the survivor&apos;s
              estate), or trust funding at those punitive compressed rates. That&apos;s a distinct reason to finish
              conversions before the first death, on top of the lifetime tax-bracket arbitrage we&apos;ve already
              analyzed.&quot;
            </p>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-[#4A6741] mb-1">5. The closing recommendation</div>
            <p>
              &quot;Whatever else changes in this plan, the single recommendation I&apos;d hold onto most firmly is
              this: get your <strong>CFP and your estate attorney in the same room with your current beneficiary
              designation forms</strong> on the table. A model output and a trust document can silently diverge in
              small drafting details — accumulation vs. conduit language, disclaimer cascade order, see-through
              qualification, GST allocation on Schedule R. That meeting is the one that reconciles them.&quot;
            </p>
          </div>

          <div className="rounded-lg border border-[#8A5A20]/40 bg-[#FEFAF1] p-3">
            <div className="text-[11px] uppercase tracking-widest font-semibold text-[#8A5A20] mb-1">Drafting cautions to name explicitly</div>
            <ul className="list-disc pl-5 space-y-1 text-[12px] text-[#1A1A1A]">
              <li>Trust must use <strong>accumulation</strong> (not conduit) language for the Roth strategy to keep the control benefit.</li>
              <li>Beneficiary designation forms must name the trust with the <strong>disclaimer cascade correctly ordered</strong> (spouse as primary, trust as contingent).</li>
              <li>Trust must qualify as a <strong>see-through trust</strong> so the 10-year (not 5-year) window applies.</li>
              <li>Form 706 <strong>Schedule R</strong> must correctly allocate the decedent&apos;s GST exemption to the trust at first death.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AdvisorInfo;
