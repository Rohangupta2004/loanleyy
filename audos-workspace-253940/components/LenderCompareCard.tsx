/**
 * LoanleyCompareCard — the neutral, zero-affiliate lender comparison card.
 *
 * Rendered inside agent messages via a ```loanley-compare fenced block (the
 * agent prefIlls whatever the borrower already said). The card collects the
 * borrower's requirements inline, then ranks every lender in the published
 * database (data/lenders.ts, with the weekly refresh's live rate overrides
 * layered on via lib/lender-rates-live.ts) by effective total cost — computed at the
 * midpoint of each lender's own published rate range plus its published
 * processing fee. Deliberate design constraints:
 *   • No 'Apply Now' buttons, no referral or affiliate links, no sponsored slots.
 *   • Every row links only to the lender's official rate card for verification.
 *   • Lenders where the borrower likely does NOT qualify are shown too,
 *     clearly labelled with the reason — nothing is silently hidden.
 *   • Personal-loan approval criteria come from Loanley's desk credit-policy
 *     record (lib/policy-rules.ts), because lenders publish rate cards rather
 *     than approval rules. Those are labelled as desk policy on the row and in
 *     the reason, never shown as figures the lender published.
 */
import { useMemo, useRef, useState } from 'react';
import { Scale, Info, CheckCircle2 } from 'lucide-react';
import { formatINR, RupeeAmount, SourceChip, ZeroCommissionStrip, shortLenderName } from './LoanleyCards';
import {
  compareLenders,
  CREDIT_BAND_LABELS,
  LENDER_TYPE_LABELS,
  LOAN_TYPE_LABELS,
} from '../lib/lender-compare';
import type { BorrowerRequirements, ComparisonResult, ComparisonRow, CreditBand } from '../lib/lender-compare';
import { useLiveLenderDb } from '../lib/lender-rates-live';
import { DESK_POLICY_CAVEAT, policyRuleFor, policyRuleLines } from '../lib/policy-rules';
import type { EmploymentType, LoanProductType } from '../data/lenders';

const LOAN_TYPE_OPTIONS: { value: LoanProductType; label: string }[] = [
  { value: 'personal', label: 'Personal Loan' },
  { value: 'home', label: 'Home Loan' },
  { value: 'business', label: 'Business Loan' },
  { value: 'education', label: 'Education Loan' },
  { value: 'loan_against_property', label: 'Loan Against Property' },
];

const CREDIT_BAND_OPTIONS: { value: CreditBand; label: string }[] = (
  ['below_650', '650_700', '700_750', '750_plus', 'unknown'] as CreditBand[]
).map((value) => ({ value, label: CREDIT_BAND_LABELS[value] }));

function parsePrefill(raw: string): Record<string, any> {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const last = text.lastIndexOf('}');
    if (last > 0) {
      try {
        return JSON.parse(text.slice(0, last + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function describeRequirements(req: BorrowerRequirements): string {
  const parts = [
    LOAN_TYPE_LABELS[req.loanType],
    formatINR(req.amount),
    `${req.tenureMonths} months`,
    req.employmentType === 'salaried' ? 'salaried' : 'self-employed',
  ];
  if (req.monthlyIncome != null) parts.push(`monthly income ${formatINR(req.monthlyIncome)}`);
  parts.push(`CIBIL ${CREDIT_BAND_LABELS[req.creditBand ?? 'unknown']}`);
  return parts.join(', ');
}

function buildAgentSummary(result: ComparisonResult): string {
  const top = result.eligible
    .slice(0, 3)
    .map(
      (r, i) =>
        `${i + 1}) ${r.lenderName} — published ${r.rateMin}%–${r.rateMax}%, EMI ${formatINR(r.emi)} at midpoint, total ${formatINR(r.totalPayable)}, effective ${r.effectiveAnnualRatePct}% incl. fee`,
    )
    .join('; ');
  return [
    '[SYSTEM: lender-comparison-displayed]',
    'The borrower just ran the neutral lender comparison card in this chat. The full ranked table (with source links) is already on their screen.',
    `Requirements: ${describeRequirements(result.requirements)}.`,
    `Result: ${result.eligible.length} lenders likely eligible, ${result.outOfRange.length} likely out of range, ${result.notCovered.length} without published data for this loan type. Lender data last updated ${result.lastUpdated}.`,
    top ? `Top 3 by effective total cost: ${top}.` : 'No lender in the database matched all requirements.',
    'Respond with 2–3 short sentences of neutral interpretation only: what drives this ranking (published rates + fees, midpoint maths), one honest caveat (published ranges are wide; the sanctioned rate depends on their profile), and a reminder to verify on the linked official rate cards. Do NOT repeat the table, do NOT emit another card, and do NOT single out one lender as a recommendation.',
  ].join('\n');
}

/**
 * The lender's approval rules from Loanley's desk credit-policy record. Behind a
 * disclosure, and labelled, because the row's source link goes to the lender's
 * rate card — which does not carry these rules. Personal loans only: the sheet
 * records personal-loan policy and must not be shown against another product.
 */
function PolicyRulesDisclosure({ lenderId, loanType }: { lenderId: string; loanType: LoanProductType }) {
  if (loanType !== 'personal') return null;
  const record = policyRuleFor(lenderId);
  if (!record) return null;
  const lines = policyRuleLines(record);
  if (lines.length === 0) return null;

  return (
    <details
      className="mt-1.5 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-2.5 py-1.5"
      data-testid={`compare-policy-rules-${lenderId}`}
    >
      <summary className="cursor-pointer text-[11px] font-semibold text-[var(--space-text-brand)]">
        Approval rules — what {shortLenderName(record.lender)} actually asks for
      </summary>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
        {lines.map((line) => (
          <div key={line.label}>
            <dt className="text-[10px] text-[var(--space-text-muted)]">{line.label}</dt>
            <dd className="text-[11px] font-medium leading-snug text-[var(--space-text-primary)]">{line.value}</dd>
          </div>
        ))}
      </dl>
      {record.remark && (
        <p className="mt-1.5 text-[10px] leading-snug text-[var(--space-text-secondary)]">Also on file: {record.remark}</p>
      )}
      <p className="mt-1.5 text-[10px] leading-snug text-[var(--space-text-muted)]">{DESK_POLICY_CAVEAT}</p>
    </details>
  );
}

function RowCard({ row, rank, loanType }: { row: ComparisonRow; rank?: number; loanType: LoanProductType }) {
  const likelyOut = row.reasons.length > 0;
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        likelyOut
          ? 'border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-muted)]'
          : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)]'
      }`}
      data-testid={`lender-row-${row.lenderId}`}
    >
      <div className="flex items-start gap-2">
        {rank != null && (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--space-surface-accent-soft)] text-[10px] font-bold text-[var(--space-text-brand)]">
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-[var(--space-text-primary)]">{row.lenderName}</span>
            <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">
              {LENDER_TYPE_LABELS[row.lenderType]}
            </span>
          </div>

          {likelyOut ? (
            <div className="mt-1">
              <ul className="mt-1 space-y-0.5">
                {row.reasons.map((reason, i) => (
                  <li key={i} className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
              <div>
                <p className="text-[10px] text-[var(--space-text-muted)]">Published rate</p>
                <p className="text-sm font-bold text-[var(--space-text-primary)] tabular-nums">
                  {row.rateMin}%–{row.rateMax}%{' '}
                  <SourceChip
                    label={`${shortLenderName(row.lenderName)} official`}
                    href={row.sourceUrl}
                    testId={`lender-source-${row.lenderId}`}
                  />
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--space-text-muted)]">EMI at midpoint ({row.midRate}%)</p>
                <p className="text-sm font-bold text-[var(--space-text-primary)] tabular-nums">
                  <RupeeAmount value={row.emi} suffix="/mo" />
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--space-text-muted)]">Total payable</p>
                <p className="text-sm font-bold text-[var(--space-text-primary)] tabular-nums">{formatINR(row.totalPayable)}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--space-text-muted)]">Effective cost incl. fee</p>
                <p className="text-sm font-bold text-[var(--space-text-primary)] tabular-nums">{row.effectiveAnnualRatePct}% p.a.</p>
              </div>
            </div>
          )}

          <p className="mt-1 text-[10px] text-[var(--space-text-muted)]">
            Processing fee: {row.feeLabel}
            {row.feeAmount > 0 && !likelyOut ? ` (≈ ${formatINR(row.feeAmount)}, before GST)` : ''}
          </p>

          {row.eligibilityNotes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {row.eligibilityNotes.map((note, i) => (
                <li key={i} className="flex items-start gap-1 text-[10px] leading-snug text-[var(--space-text-secondary)]">
                  <Info className="mt-[1px] h-3 w-3 shrink-0 text-[var(--space-text-muted)]" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          {row.dataNote && (
            <p className="mt-1 text-[10px] leading-snug text-[var(--space-text-muted)]">{row.dataNote}</p>
          )}

          <PolicyRulesDisclosure lenderId={row.lenderId} loanType={loanType} />

          {likelyOut && (
            <p className="mt-1.5 text-[11px]">
              <SourceChip
                label={`${shortLenderName(row.lenderName)} official`}
                href={row.sourceUrl}
                testId={`lender-source-${row.lenderId}`}
              />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The #1 result — rendered as a bold verdict, visually nothing like a listing. */
function CompareVerdictCard({ row, asOf }: { row: ComparisonRow; asOf: string }) {
  return (
    <div
      className="overflow-hidden rounded-xl bg-[var(--space-brand-primary)] p-4 text-[var(--space-text-on-primary)]"
      data-testid={`compare-verdict-${row.lenderId}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--space-data-highlight,#f5a623)]">
        Verdict — best match for your profile
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight">{row.lenderName}</p>
          <p className="mt-0.5 text-[11px] text-[var(--space-brand-primary-100)]">
            {LENDER_TYPE_LABELS[row.lenderType]} · published rate {row.rateMin}%–{row.rateMax}%{' '}
            <SourceChip
              label={`${shortLenderName(row.lenderName)} official`}
              href={row.sourceUrl}
              testId={`lender-source-${row.lenderId}`}
            />
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[var(--space-brand-primary-100)]">EMI at midpoint ({row.midRate}%)</p>
          <p className="text-2xl font-bold leading-none">
            <RupeeAmount value={row.emi} suffix="/mo" />
          </p>
        </div>
      </div>
      <p className="mt-3 border-t border-white/15 pt-2.5 text-[12px] font-semibold leading-snug">
        Why #1: lowest effective cost for your profile — {row.effectiveAnnualRatePct}% p.a. all-in,{' '}
        {formatINR(row.totalPayable)} total incl. fee.
      </p>
      <p className="mt-1 text-[10px] leading-snug text-[var(--space-brand-primary-100)]">
        A conclusion from the published maths, not a listing — Loanley earns nothing if you choose this lender.
        Rates as of {asOf}.
      </p>
    </div>
  );
}

interface LoanleyCompareCardProps {
  raw: string;
  onSubmit: (message: string) => void;
}

export function LoanleyCompareCard({ raw, onSubmit }: LoanleyCompareCardProps) {
  const prefill = useMemo(() => parsePrefill(raw), [raw]);
  // Bundled rate card with the weekly refresh's validated overrides on top.
  // Falls back to exactly the bundle when there is nothing live to apply.
  const lenderData = useLiveLenderDb();

  const [loanType, setLoanType] = useState<LoanProductType>(
    LOAN_TYPE_OPTIONS.some((t) => t.value === prefill.loan_type) ? prefill.loan_type : 'personal',
  );
  const [amount, setAmount] = useState<string>(prefill.amount != null ? String(prefill.amount) : '');
  const [tenure, setTenure] = useState<string>(
    prefill.tenure_months != null ? String(prefill.tenure_months) : prefill.tenure_years != null ? String(prefill.tenure_years) : '',
  );
  const [tenureUnit, setTenureUnit] = useState<'months' | 'years'>(prefill.tenure_months != null ? 'months' : 'years');
  const [employment, setEmployment] = useState<EmploymentType>(
    prefill.employment_type === 'self_employed' ? 'self_employed' : 'salaried',
  );
  const [income, setIncome] = useState<string>(
    prefill.monthly_income != null
      ? String(prefill.monthly_income)
      : prefill.annual_income != null
        ? String(prefill.annual_income)
        : '',
  );
  // Deliberately NOT defaulted: a silently-assumed credit band is how a
  // borrower ends up ranked #1 against a lender that would reject them.
  const [creditBand, setCreditBand] = useState<CreditBand | null>(
    CREDIT_BAND_OPTIONS.some((b) => b.value === prefill.credit_band) ? prefill.credit_band : null,
  );

  const [result, setResult] = useState<ComparisonResult | null>(null);
  const notifiedAgent = useRef(false);

  const amountNum = parseFloat(amount);
  const tenureNum = parseFloat(tenure);
  const incomeNumRaw = parseFloat(income);
  // Income and credit band are required: eligibility filtering is the whole
  // point of the ranking, and it cannot run on fields left blank.
  const canCompare =
    !isNaN(amountNum) &&
    amountNum > 0 &&
    !isNaN(tenureNum) &&
    tenureNum > 0 &&
    !isNaN(incomeNumRaw) &&
    incomeNumRaw > 0 &&
    creditBand !== null;

  const runCompare = () => {
    if (!canCompare) return;
    const tenureMonths = tenureUnit === 'years' ? Math.round(tenureNum * 12) : Math.round(tenureNum);
    const incomeNum = parseFloat(income);
    const req: BorrowerRequirements = {
      loanType,
      amount: Math.round(amountNum),
      tenureMonths,
      employmentType: employment,
      monthlyIncome: !isNaN(incomeNum) && incomeNum > 0
        ? Math.round(employment === 'self_employed' ? incomeNum / 12 : incomeNum)
        : undefined,
      creditBand: creditBand ?? 'unknown',
    };
    const res = compareLenders(req, lenderData);
    setResult(res);
    if (!notifiedAgent.current) {
      notifiedAgent.current = true;
      onSubmit(buildAgentSummary(res));
    }
  };

  const inputCls =
    'w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-2.5 py-2 text-sm text-[var(--space-text-primary)] focus:outline-none focus:border-[var(--space-border-strong)]';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--space-text-muted)] mb-1';
  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
      active
        ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-[var(--space-brand-primary)]'
        : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)]'
    }`;

  return (
    // Professional intake form, not a chatbot widget: formal navy header,
    // uppercase field labels, quiet reassurance line.
    <div className="not-prose my-2 overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]">
      {/* header */}
      <div className="flex items-center gap-2.5 bg-[var(--space-brand-primary)] px-4 py-3">
        <Scale className="h-4 w-4 shrink-0 text-[var(--space-text-on-primary)]" />
        <div className="min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--space-brand-primary-200)]">
            Loanley · requirements intake
          </span>
          <span className="text-sm font-semibold text-[var(--space-text-on-primary)]">Compare all lenders — neutrally</span>
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--space-brand-primary-200)]">no lender pays to appear here</span>
      </div>

      {/* requirements form */}
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Loan type</label>
          <select className={inputCls} value={loanType} onChange={(e) => setLoanType(e.target.value as LoanProductType)}>
            {LOAN_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Loan amount (₹)</label>
          <input
            type="number"
            inputMode="numeric"
            className={inputCls}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500000 for ₹5 lakh"
            data-testid="compare-input-amount"
          />
        </div>
        <div>
          <label className={labelCls}>Preferred tenure</label>
          <div className="flex gap-2">
            <input
              type="number"
              className={inputCls}
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
              placeholder={tenureUnit === 'years' ? 'e.g. 4' : 'e.g. 48'}
            />
            <select
              className={`${inputCls} w-28 shrink-0`}
              value={tenureUnit}
              onChange={(e) => setTenureUnit(e.target.value as 'months' | 'years')}
            >
              <option value="years">years</option>
              <option value="months">months</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>
            {employment === 'self_employed' ? 'Annual income (₹)' : 'Monthly salary (₹)'}
          </label>
          <input
            type="number"
            inputMode="numeric"
            className={inputCls}
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            placeholder={employment === 'self_employed' ? 'e.g. 900000' : 'e.g. 60000'}
          />
        </div>
        <div>
          <label className={labelCls}>Employment</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEmployment('salaried')} className={chipCls(employment === 'salaried')}>
              Salaried
            </button>
            <button
              type="button"
              onClick={() => setEmployment('self_employed')}
              className={chipCls(employment === 'self_employed')}
            >
              Self-employed
            </button>
          </div>
        </div>
        <div>
          <label className={labelCls}>Approximate CIBIL score</label>
          <div className="flex flex-wrap gap-1.5">
            {CREDIT_BAND_OPTIONS.map((b) => (
              <button key={b.value} type="button" onClick={() => setCreditBand(b.value)} className={chipCls(creditBand === b.value)}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={runCompare}
          disabled={!canCompare}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--space-brand-primary)] px-4 py-2 text-sm font-medium text-[var(--space-text-on-primary)] transition-opacity disabled:opacity-40"
          data-testid="button-loanley-compare-submit"
        >
          {result ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Compare again
            </>
          ) : (
            <>
              <Scale className="h-4 w-4" /> Compare lenders
            </>
          )}
        </button>
        <p className="mt-2 text-[10px] leading-snug text-[var(--space-text-muted)]">
          Income and CIBIL range are required — without them the ranking can't tell you who would actually approve you,
          and a lender you'd be rejected by could land at #1. Pick “Not sure” for CIBIL if you genuinely don't know and
          every score-based criterion will be flagged unverified instead of assumed. Nothing is sent to any lender.
        </p>
      </div>

      {/* results */}
      {result && (
        <div className="border-t border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-4">
          {/* persistent non-promotional strip */}
          <div className="mb-3 space-y-1.5">
            <ZeroCommissionStrip />
            <p className="text-[10px] leading-snug text-[var(--space-text-muted)]">
              Rates sourced directly from each lender's published rate card · last updated {result.lastUpdated} ·{' '}
              {describeRequirements(result.requirements)}
            </p>
          </div>

          {/* eligible ranking — the #1 renders as a verdict, the rest as the list */}
          {result.eligible.length > 0 ? (
            <div className="space-y-2">
              <CompareVerdictCard row={result.eligible[0]} asOf={result.lastUpdated} />
              {result.eligible.length > 1 && (
                <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
                  The rest of the ranking — lowest effective cost first
                </p>
              )}
              {result.eligible.slice(1).map((row, i) => (
                <RowCard key={row.lenderId} row={row} rank={i + 2} loanType={result.requirements.loanType} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--space-text-secondary)]">
              No lender in our published database matches all of these requirements. The closest misses are listed
              below with the exact reason — adjusting the amount or tenure may open up options.
            </p>
          )}

          {/* likely out of reach — visually distinct, never hidden */}
          {result.outOfRange.length > 0 && (
            <div className="mt-4" data-testid="out-of-reach-section">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
                Likely out of reach for your profile
              </p>
              <p className="mb-2 mt-0.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
                Based on each lender's own criteria — shown anyway, so nothing is hidden. Each reason says whether it
                came from the lender's published page or from Loanley's desk record of its credit policy.
              </p>
              <div className="space-y-2 opacity-70">
                {result.outOfRange.map((row) => (
                  <RowCard key={row.lenderId} row={row} loanType={result.requirements.loanType} />
                ))}
              </div>
            </div>
          )}

          {result.notCovered.length > 0 && (
            <p className="mt-3 text-[10px] leading-snug text-[var(--space-text-muted)]">
              Not compared (no published rate-card data for this loan type in our database yet):{' '}
              {result.notCovered.join(', ')}.
            </p>
          )}

          <p className="mt-3 border-t border-[var(--space-border-default)] pt-2.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
            EMI and totals use the midpoint of each lender's published range — your sanctioned rate depends on your
            profile and can sit anywhere in the range. Processing fees exclude GST. {result.disclaimer}
          </p>
        </div>
      )}
    </div>
  );
}
