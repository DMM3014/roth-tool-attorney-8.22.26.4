/**
 * DSUE Portability & Form 706 Filing Checklist — advisor reference tab.
 *
 * One-page reference for the Form 706 DSUE election workflow. Not sent to
 * clients — this is a resource for the advisor to walk through with the
 * surviving spouse (or her estate-planning attorney) in the 15 months after
 * a first spouse's death. Includes the extended 5-year simplified filing
 * window under Rev. Proc. 2022-32, the specific IRS forms and boxes to
 * complete, common traps (last-deceased-spouse rule, remarriage), and the
 * PLR fallback for late elections.
 */
import React from "react";
import { Card } from "@/components/ui/card";
import { ClipboardCheck, ScrollText, AlertTriangle, Calendar, FileWarning, Landmark, ExternalLink } from "lucide-react";

const CheckItem = ({ label, sub, testid }) => (
  <li className="flex gap-3 items-start" data-testid={testid}>
    <span className="shrink-0 mt-0.5 h-4 w-4 rounded border-2 border-[#4A6741] inline-block" aria-hidden />
    <div className="flex-1">
      <p className="text-sm text-[#1A1A1A] leading-snug">{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{sub}</p>}
    </div>
  </li>
);

const Section = ({ icon: Icon, title, tone = "green", children, testid }) => {
  const bg = tone === "amber" ? "#FEFAF1" : tone === "gray" ? "#F9F8F6" : "#F1F5EF";
  const border = tone === "amber" ? "#C87941" : tone === "gray" ? "#B8B4A8" : "#4A6741";
  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid={testid}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4" style={{ color: border }} />
        <h3 className="font-display text-base font-bold tracking-tight">{title}</h3>
      </div>
      <div className="rounded-md p-3 space-y-3" style={{ background: bg, border: `1px solid ${border}20` }}>
        {children}
      </div>
    </Card>
  );
};

export const DsueChecklist = () => {
  return (
    <div className="space-y-5 max-w-5xl" data-testid="dsue-checklist-panel">
      {/* Header + concept overview */}
      <Card className="p-6 border-[#EBE8E0] shadow-none">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="h-6 w-6 text-[#4A6741] mt-1 shrink-0" />
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#1A1A1A]">
              DSUE Portability &amp; Form 706 Filing Checklist
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Advisor reference for the Deceased Spousal Unused Exclusion (DSUE) election workflow after a first
              spouse&apos;s death. Portability preserves the deceased spouse&apos;s unused federal exclusion — up to <strong>$15M
              (2026, OBBBA)</strong> — for the surviving spouse. Together with the surviving spouse&apos;s own exclusion, a couple can
              shield up to ~<strong>$30M</strong> from federal estate tax. Portability must be <em>affirmatively elected</em> on a timely
              filed Form 706. This checklist is a workflow reference, not legal advice.
            </p>
          </div>
        </div>
      </Card>

      {/* Deadline rules */}
      <Section icon={Calendar} title="Filing deadlines" testid="dsue-deadlines">
        <ul className="space-y-2">
          <CheckItem
            label="Estates ABOVE the filing threshold ($15M 2026): Form 706 due 9 months from date of death"
            sub="Automatic 6-month extension via Form 4768 (total 15 months). Late filing = interest + failure-to-file penalties on any tax due."
            testid="dsue-deadline-standard"
          />
          <CheckItem
            label="Estates BELOW the filing threshold: 5-year simplified election under Rev. Proc. 2022-32"
            sub="Executor files a complete Form 706 within 5 years of date of death solely to elect portability. No penalty. This replaces the earlier 2-year window from Rev. Proc. 2017-34 (superseded July 8, 2022)."
            testid="dsue-deadline-5year"
          />
          <CheckItem
            label="Beyond 5 years: only Private Letter Ruling (PLR) relief under Reg. §301.9100-3"
            sub="See the PLR fallback section below. Expensive ($10K+ user fee) and takes 6+ months."
            testid="dsue-deadline-plr"
          />
        </ul>
      </Section>

      {/* Filing checklist */}
      <Section icon={ScrollText} title="Form 706 preparation checklist" testid="dsue-checklist-steps">
        <ol className="space-y-2 list-none">
          <CheckItem
            label="Confirm eligibility"
            sub="U.S. citizen or resident decedent, valid marriage at date of death, surviving spouse still living. Non-citizen spouses require a QDOT and don't get portability without the extra QDOT machinery."
            testid="dsue-step-eligibility" />
          <CheckItem
            label="Model whether DSUE is worth electing"
            sub="If the surviving spouse's own exclusion + inflation growth to her death year clearly exceeds her taxable estate, DSUE may add nothing. Run the Estate Planning tab with `use_portability` toggled both ways to see the delta. Rule of thumb: elect it anyway unless the estate is small AND the survivor is very young — DSUE is 'free insurance' for future appreciation."
            testid="dsue-step-model" />
          <CheckItem
            label="Complete Form 706 (all Parts 1–6, Schedule A–U as applicable)"
            sub="For portability-only filings under Rev. Proc. 2022-32, IRS accepts a simplified valuation on hard-to-value assets — good-faith 'estimated' values with 'Estate elects portability under Section 2010(c)(5)(A)' noted at top of page 1."
            testid="dsue-step-706" />
          <CheckItem
            label="Complete Part 6 Section D: DSUE Amount Portable"
            sub="This is the actual DSUE calculation. DSUE = min(basic exclusion, applicable exclusion − taxable estate − adjusted taxable gifts). The result is the amount the surviving spouse can use on her Form 709 (gifts) or her future Form 706."
            testid="dsue-step-part6d" />
          <CheckItem
            label="Report ALL prior taxable gifts on Schedule G"
            sub="Adjusted taxable gifts reduce DSUE dollar-for-dollar. Missing a lifetime gift means overstating the DSUE and can be audited years later."
            testid="dsue-step-schedule-g" />
          <CheckItem
            label="Consider a QTIP election (Part 4 line 6a) if any assets pass to spouse in trust"
            sub="Rev. Proc. 2016-49 clarified: a QTIP election made SOLELY to enable portability is respected. This lets you preserve DSUE while still keeping assets in a marital trust for creditor / remarriage protection."
            testid="dsue-step-qtip" />
          <CheckItem
            label="File with IRS Center — mail to: Kansas City, MO 64999-0002 (Form 706 processing center)"
            sub="No e-file for Form 706. Certified mail with return receipt is standard. Also file a separate copy with the surviving spouse's records — she'll need it when SHE files her own 706 or a Form 709 gift return that uses DSUE."
            testid="dsue-step-file" />
          <CheckItem
            label="Retain: filed copy of Form 706 + IRS acknowledgment"
            sub="Surviving spouse's estate attorney will need it decades from now. Best practice: give her attorney a signed original, keep a scanned copy in the client file, and note the DSUE amount + filing date in the client's estate-planning binder."
            testid="dsue-step-retain" />
        </ol>
      </Section>

      {/* Rev. Procs & authorities */}
      <Section icon={FileWarning} title="Rev. Procs &amp; IRS authorities" tone="gray" testid="dsue-authorities">
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
            <div>
              <strong>Rev. Proc. 2022-32</strong> (July 2022) — <em>current authority</em>. Extends the simplified
              portability election window from 2 to <strong>5 years</strong> for estates under the filing threshold.
              Executor states at top of Form 706: <em>&ldquo;FILED PURSUANT TO REV. PROC. 2022-32 TO ELECT
              PORTABILITY UNDER § 2010(c)(5)(A).&rdquo;</em>
            </div>
          </li>
          <li className="flex gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
            <div>
              <strong>Rev. Proc. 2017-34</strong> (June 2017) — superseded by 2022-32. Original 2-year simplified
              relief window. Still cited in older PLRs for context.
            </div>
          </li>
          <li className="flex gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
            <div>
              <strong>Rev. Proc. 2016-49</strong> — QTIP elections made solely to enable portability are respected
              (fixes the earlier &ldquo;wasted election&rdquo; problem from Rev. Proc. 2001-38).
            </div>
          </li>
          <li className="flex gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
            <div>
              <strong>Reg. § 20.2010-2(a)(1)</strong> — governs portability election. Requires a complete and
              properly-prepared Form 706 to be timely filed.
            </div>
          </li>
          <li className="flex gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
            <div>
              <strong>Reg. § 20.2010-3</strong> — surviving spouse&apos;s use of DSUE. Governs which DSUE amount applies
              when there have been multiple deceased spouses (last-deceased-spouse rule).
            </div>
          </li>
          <li className="flex gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
            <div>
              <strong>IRC § 2010(c)(4) &amp; § 2010(c)(5)</strong> — statutory basis for DSUE.
            </div>
          </li>
        </ul>
      </Section>

      {/* Common traps */}
      <Section icon={AlertTriangle} title="Common traps &amp; pitfalls" tone="amber" testid="dsue-traps">
        <ul className="space-y-2 text-sm">
          <li>
            <strong>Portability is NEVER automatic.</strong> If you don&apos;t file Form 706, you don&apos;t get DSUE.
            &ldquo;My estate is too small to owe tax&rdquo; is the #1 way clients lose $6M+ of transferable exclusion.
          </li>
          <li>
            <strong>Last-Deceased-Spouse Rule</strong>: If the surviving spouse remarries and the new spouse dies
            FIRST, only the second deceased spouse&apos;s DSUE counts. The first spouse&apos;s DSUE is lost — unless
            it has already been consumed via lifetime gifts before the second marriage. Under Reg. § 20.2010-3(b),
            the surviving spouse can &ldquo;spend&rdquo; DSUE on gifts to lock it in.
          </li>
          <li>
            <strong>DSUE is frozen at Y1&apos;s exclusion value</strong>, not indexed forward. Federal exclusion at
            death of survivor in 2050 is indexed to that year, but the DSUE portion is the exact $ amount
            calculated on the first-spouse Form 706.
          </li>
          <li>
            <strong>State estate taxes are (almost universally) NOT portable</strong>. Only Hawaii (2020+)
            and Maryland offer portability. Massachusetts, Oregon, Washington, New York, etc. do not — you
            need a bypass/credit-shelter trust at first death to preserve the state exclusion.
          </li>
          <li>
            <strong>Gifts during survivor&apos;s life consume DSUE first</strong>, then her own exclusion.
            This is generally advantageous (DSUE is use-it-or-lose-it on remarriage) but changes lifetime
            gifting math.
          </li>
          <li>
            <strong>Prior gifts made BEFORE first spouse&apos;s death reduce DSUE</strong>. Include gifts on
            Schedule G — under-reporting is an audit magnet 20 years later when the surviving spouse&apos;s
            estate closes.
          </li>
          <li>
            <strong>Non-citizen spouses need a QDOT</strong>. The unlimited marital deduction and portability
            both require a Qualified Domestic Trust or the spouse to be a U.S. citizen at the time of the
            estate tax return filing.
          </li>
        </ul>
      </Section>

      {/* PLR fallback */}
      <Section icon={Landmark} title="Private Letter Ruling (PLR) — late-election fallback" tone="gray" testid="dsue-plr">
        <p className="text-sm mb-2">
          When the 5-year window has elapsed, the only path to elect portability is a Private Letter Ruling
          under <strong>Reg. § 301.9100-3</strong> (&ldquo;9100 relief&rdquo;).
        </p>
        <ul className="space-y-2 text-sm">
          <li><strong>Fee</strong>: $10,000+ per <strong>Rev. Proc. 2024-1</strong> user fee schedule (updated annually — check current year).</li>
          <li><strong>Standard</strong>: Executor must demonstrate the failure was due to reasonable cause (usually attorney or executor error) and that granting relief will not prejudice the government&apos;s interests.</li>
          <li><strong>Timeline</strong>: IRS Chief Counsel Estate &amp; Gift Tax division reviews. Typical 90–180 days, sometimes longer.</li>
          <li><strong>Filing address</strong>: IRS Office of Associate Chief Counsel (Passthroughs &amp; Special Industries), Room 5314, 1111 Constitution Ave NW, Washington DC 20224.</li>
          <li><strong>Required contents</strong>: complete Form 706 + affidavits from executor and preparer explaining the failure + all supporting workpapers.</li>
          <li><strong>Approval rate</strong>: high (~95%) for genuine reasonable-cause cases, but the process is expensive enough that Rev. Proc. 2022-32&apos;s 5-year window should be used whenever possible.</li>
        </ul>
      </Section>

      {/* Final caveat */}
      <Card className="p-4 border-[#EBE8E0] shadow-none bg-[#FAFAF8]">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong>Legal caveat:</strong> This checklist is a workflow reference for advisors, not legal advice. Estate-tax
          filings require a qualified estate-planning attorney or CPA experienced in Form 706 preparation. Rules,
          Rev. Procs, thresholds, and rates change — verify current authority before relying on any deadline or user fee.
          Federal exclusion figures are 2025 tax-year amounts; state rules vary widely.
        </p>
      </Card>
    </div>
  );
};

export default DsueChecklist;
