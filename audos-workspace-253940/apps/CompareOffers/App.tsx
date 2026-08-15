/**
 * Compare Offers — Loanley's honest two-offer comparator (India, ₹).
 *
 * The borrower has two concrete offers; this app puts them side by side and
 * lets the maths decide: EMI, total interest, all-in total cost, effective
 * annualised cost including fees, and the break-even month when a lower EMI
 * overtakes higher upfront fees. Everything recomputes reactively as inputs
 * change — shared reducing-balance engine from lib/lender-compare.ts.
 * Loanley is neutral by design: no Apply Now, no referral links, no lender
 * recommendations — the winner gets a subtle border, nothing more.
 */
import { useMemo, useState } from 'react';
import { Scale, AlertTriangle, Info } from 'lucide-react';
import { formatINR, RupeeAmount, SourceChip, ZeroCommissionStrip } from '../../components/LoanleyCards';
import { computeEmi, effectiveAnnualRate } from '../../lib/lender-compare';
import {
  RBI_MASTER_DIRECTIONS_URL,
  RBI_MASTER_DIRECTIONS_LABEL,
  rateVerdict,
  formatINRCompact,
} from '../../lib/loan-benchmarks';
import type { RateVerdict } from '../../lib/loan-benchmarks';
import type { LoanProductType } from '../../data/lenders';

const LOAN_TYPES: { value: LoanProductType; label: string }[] = [
  { value: 'personal', label: 'Personal Loan' },
  { value: 'home', label: 'Home Loan' },
  { value: 'business', label: 'Business Loan' },
  { value: 'education', label: 'Education Loan' },
  { value: 'loan_against_property', label: 'Loan Against Property' },
];

interface OfferState {
  label: string;
  amount: string;
  rate: string;
  tenure: string;
  feeMode: 'rupees' | 'percent';
  feeValue: string;
  otherFees: string;
  prepayMode: 'percent' | 'rupees';
  prepayValue: string;
}

const EMPTY_OFFER: OfferState = {
  label: '',
  amount: '',
  rate: '',
  tenure: '',
  feeMode: 'rupees',
  feeValue: '',
  otherFees: '',
  prepayMode: 'percent',
  prepayValue: '',
};

interface OfferMetrics {
  name: string;
  amount: number;
  ratePct: number;
  months: number;
  emi: number;
  totalInterest: number;
  upfrontFees: number;
  totalCost: number;
  effectiveAprPct: number;
  verdict: RateVerdict;
  prepayNote: string | null;
}

function computeOffer(o: OfferState, fallbackName: string, loanType: LoanProductType): OfferMetrics | null {
  const amount = parseFloat(o.amount);
  const rate = parseFloat(o.rate);
  const months = Math.round(parseFloat(o.tenure));
  if (isNaN(amount) || amount <= 0) return null;
  if (isNaN(rate) || rate <= 0 || rate > 100) return null;
  if (isNaN(months) || months < 1 || months > 480) return null;

  const feeNum = parseFloat(o.feeValue);
  const processingFee = isNaN(feeNum) || feeNum <= 0 ? 0 : o.feeMode === 'percent' ? (amount * feeNum) / 100 : feeNum;
  const otherNum = parseFloat(o.otherFees);
  const upfrontFees = processingFee + (isNaN(otherNum) || otherNum <= 0 ? 0 : otherNum);

  const emi = computeEmi(amount, rate, months);
  const totalRepaid = emi * months;

  const prepayNum = parseFloat(o.prepayValue);
  const prepayNote =
    !isNaN(prepayNum) && prepayNum > 0
      ? o.prepayMode === 'percent'
        ? `Prepayment penalty: ${prepayNum}% (≈ ${formatINR((amount * prepayNum) / 100)} on the full principal)`
        : `Prepayment penalty: ${formatINR(prepayNum)}`
      : null;

  return {
    name: o.label.trim() || fallbackName,
    amount,
    ratePct: rate,
    months,
    emi,
    totalInterest: totalRepaid - amount,
    upfrontFees,
    totalCost: totalRepaid + upfrontFees,
    effectiveAprPct: Math.round(effectiveAnnualRate(amount, upfrontFees, emi, months) * 100) / 100,
    verdict: rateVerdict(loanType, rate),
    prepayNote,
  };
}

/** Month when the lower-EMI offer's savings cover its extra upfront fees. */
function breakEven(a: OfferMetrics, b: OfferMetrics): string | null {
  const [low, high] = a.emi < b.emi ? [a, b] : [b, a];
  if (high.emi - low.emi < 1) return null; // EMIs effectively equal
  if (low.upfrontFees <= high.upfrontFees) return null; // lower EMI AND lower fees — no crossover
  const m = Math.ceil((low.upfrontFees - high.upfrontFees) / (high.emi - low.emi));
  const horizon = Math.min(a.months, b.months);
  if (m > horizon) {
    return `${low.name} has the lower EMI but pays ${formatINR(low.upfrontFees - high.upfrontFees)} more upfront — and the EMI saving never covers that within the tenure.`;
  }
  return `${low.name} pays ${formatINR(low.upfrontFees - high.upfrontFees)} more upfront, but its lower EMI recovers that by month ${m} — from then on it is the cheaper path.`;
}

interface OfferFormProps {
  title: string;
  offer: OfferState;
  onChange: (o: OfferState) => void;
  highlight: boolean;
}

function OfferForm({ title, offer, onChange, highlight }: OfferFormProps) {
  const set = (patch: Partial<OfferState>) => onChange({ ...offer, ...patch });
  const inputCls =
    'w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-2 text-sm text-[var(--space-text-primary)] focus:outline-none focus:border-[var(--space-border-strong)]';
  const labelCls = 'block text-[11px] font-medium text-[var(--space-text-muted)] mb-1';
  const toggleCls = (active: boolean) =>
    `px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
      active
        ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-[var(--space-brand-primary)]'
        : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)]'
    }`;

  return (
    <div
      className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4"
      style={highlight ? { borderLeft: '3px solid var(--space-data-highlight, #f5a623)' } : undefined}
    >
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">{title}</p>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Lender name (label only, optional)</label>
          <input
            type="text"
            className={inputCls}
            value={offer.label}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="e.g. Bank quote / DSA quote"
          />
        </div>
        <div>
          <label className={labelCls}>Loan amount (₹)</label>
          <input
            type="number"
            inputMode="numeric"
            className={inputCls}
            value={offer.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="e.g. 500000 for ₹5 lakh"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Rate (% p.a.)</label>
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={offer.rate}
              onChange={(e) => set({ rate: e.target.value })}
              placeholder="e.g. 14"
            />
          </div>
          <div>
            <label className={labelCls}>Tenure (months)</label>
            <input
              type="number"
              className={inputCls}
              value={offer.tenure}
              onChange={(e) => set({ tenure: e.target.value })}
              placeholder="e.g. 48"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--space-text-muted)]">Processing fee</label>
            <div className="flex gap-1">
              <button type="button" className={toggleCls(offer.feeMode === 'rupees')} onClick={() => set({ feeMode: 'rupees' })}>
                ₹
              </button>
              <button type="button" className={toggleCls(offer.feeMode === 'percent')} onClick={() => set({ feeMode: 'percent' })}>
                %
              </button>
            </div>
          </div>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            value={offer.feeValue}
            onChange={(e) => set({ feeValue: e.target.value })}
            placeholder={offer.feeMode === 'percent' ? 'e.g. 1.5 (% of amount)' : 'e.g. 6000'}
          />
        </div>
        <div>
          <label className={labelCls}>Other one-time fees (₹, optional)</label>
          <input
            type="number"
            className={inputCls}
            value={offer.otherFees}
            onChange={(e) => set({ otherFees: e.target.value })}
            placeholder="insurance, documentation…"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--space-text-muted)]">Prepayment penalty (optional)</label>
            <div className="flex gap-1">
              <button type="button" className={toggleCls(offer.prepayMode === 'percent')} onClick={() => set({ prepayMode: 'percent' })}>
                %
              </button>
              <button type="button" className={toggleCls(offer.prepayMode === 'rupees')} onClick={() => set({ prepayMode: 'rupees' })}>
                ₹
              </button>
            </div>
          </div>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            value={offer.prepayValue}
            onChange={(e) => set({ prepayValue: e.target.value })}
            placeholder={offer.prepayMode === 'percent' ? 'e.g. 2 (% of outstanding)' : 'e.g. 5000'}
          />
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  amount,
  suffix,
  hint,
}: {
  label: string;
  value?: string;
  amount?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="bg-[var(--space-surface-card)] px-4 py-3">
      <p className="text-[11px] text-[var(--space-text-muted)]">{label}</p>
      <p className="text-xl font-bold leading-tight text-[var(--space-text-primary)] tabular-nums">
        {amount != null ? <RupeeAmount value={amount} suffix={suffix} /> : value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--space-text-muted)]">{hint}</p>}
    </div>
  );
}

export default function CompareOffers() {
  const [loanType, setLoanType] = useState<LoanProductType>('personal');
  const [offerA, setOfferA] = useState<OfferState>(EMPTY_OFFER);
  const [offerB, setOfferB] = useState<OfferState>(EMPTY_OFFER);

  const a = useMemo(() => computeOffer(offerA, 'Offer A', loanType), [offerA, loanType]);
  const b = useMemo(() => computeOffer(offerB, 'Offer B', loanType), [offerB, loanType]);
  const both = a !== null && b !== null;

  const verdict = useMemo(() => {
    if (!a || !b) return null;
    const diff = Math.abs(a.totalCost - b.totalCost);
    // 'Effectively equivalent' when the gap is under 1% of the smaller total
    // cost — at that margin the published numbers can't separate the offers.
    const nearlyIdentical = diff <= Math.max(1000, 0.01 * Math.min(a.totalCost, b.totalCost));
    const winner = a.totalCost <= b.totalCost ? a : b;
    const loser = winner === a ? b : a;
    const emiEquivNum = winner.emi > 0 ? diff / winner.emi : 0;
    const emiEquiv = emiEquivNum >= 1 ? String(Math.round(emiEquivNum)) : emiEquivNum.toFixed(1);

    const interestGap = loser.totalInterest - winner.totalInterest;
    const feeGap = loser.upfrontFees - winner.upfrontFees;
    let driver: string;
    if (nearlyIdentical) {
      driver = 'Rate and fee differences cancel out over the full tenure — pick on service terms, prepayment flexibility, or the lender you already bank with.';
    } else if (Math.abs(interestGap) >= Math.abs(feeGap)) {
      driver = `The key driver is the interest rate: ${winner.name} accrues ${formatINR(Math.abs(interestGap))} ${interestGap >= 0 ? 'less' : 'more'} interest over the tenure, which outweighs the ${formatINR(Math.abs(feeGap))} difference in one-time fees.`;
    } else {
      driver = `The key driver is fees: ${winner.name} charges ${formatINR(Math.abs(feeGap))} ${feeGap >= 0 ? 'less' : 'more'} upfront, which outweighs the ${formatINR(Math.abs(interestGap))} difference in interest.`;
    }

    const flags: string[] = [];
    for (const o of [a, b]) {
      if (o.verdict.status !== 'normal') {
        flags.push(
          `${o.name}: ${o.ratePct}% is ${o.verdict.status === 'high' ? 'above' : 'below'} the ${o.verdict.range.minPct}%–${o.verdict.range.maxPct}% band published by major lenders for this loan type${o.verdict.status === 'too_good' ? ' — too good to be true? Check for a flat-rate quote or hidden fees' : ''}.`,
        );
      }
    }
    if (a.amount !== b.amount) {
      flags.push('The two offers are for different loan amounts, so totals are not like-for-like — the effective annual cost is the fairer comparison.');
    }
    if (a.months !== b.months) {
      flags.push('The two offers have different tenures — a longer tenure lowers the EMI but usually raises total interest.');
    }
    const prepayAsymmetric = (a.prepayNote === null) !== (b.prepayNote === null);
    if (prepayAsymmetric) {
      const withPenalty = a.prepayNote ? a : b;
      flags.push(`Only ${withPenalty.name} carries a prepayment penalty — that matters if you might close the loan early.`);
    }

    return {
      winner,
      loser,
      diff,
      nearlyIdentical,
      emiEquiv,
      driver,
      flags,
      breakEvenNote: breakEven(a, b),
    };
  }, [a, b]);

  const selectCls =
    'rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-2.5 py-1.5 text-xs text-[var(--space-text-primary)] focus:outline-none focus:border-[var(--space-border-strong)]';

  const columns: { metrics: OfferMetrics | null; title: string }[] = [
    { metrics: a, title: a?.name || 'Offer A' },
    { metrics: b, title: b?.name || 'Offer B' },
  ];

  return (
    <div className="min-h-full w-full bg-transparent">
      <div className="mx-auto max-w-3xl px-5 py-6">
        {/* header */}
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--space-surface-accent-soft)]">
            <Scale className="h-5 w-5 text-[var(--space-text-brand)]" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-[var(--space-text-brand)]">Compare Offers</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-[var(--space-text-secondary)]">
              Two offers in hand? Enter both and let the maths decide — EMI, total interest, all-in cost and effective
              annual cost, side by side. Results update as you type. No lender is recommended, ever.
            </p>
          </div>
          <div className="shrink-0">
            <select className={selectCls} value={loanType} onChange={(e) => setLoanType(e.target.value as LoanProductType)}>
              {LOAN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* two offer forms */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <OfferForm title="Offer A" offer={offerA} onChange={setOfferA} highlight={Boolean(both && verdict && !verdict.nearlyIdentical && verdict.winner === a)} />
          <OfferForm title="Offer B" offer={offerB} onChange={setOfferB} highlight={Boolean(both && verdict && !verdict.nearlyIdentical && verdict.winner === b)} />
        </div>

        {/* persistent non-promotional strip on the results view */}
        {both && <ZeroCommissionStrip className="mt-4" />}

        {/* side-by-side breakdown */}
        {both ? (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            {columns.map(({ metrics, title }, i) => {
              const m = metrics as OfferMetrics;
              const isWinner = Boolean(verdict && !verdict.nearlyIdentical && verdict.winner === m);
              return (
                <div
                  key={i}
                  className="overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]"
                  style={isWinner ? { borderLeft: '3px solid var(--space-data-highlight, #f5a623)' } : undefined}
                  data-testid={`compare-result-${i === 0 ? 'a' : 'b'}`}
                >
                  <div className="flex items-center gap-2 border-b border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-4 py-2.5">
                    <p className="truncate text-sm font-semibold text-[var(--space-text-primary)]">{title}</p>
                    {isWinner && (
                      <span className="ml-auto shrink-0 rounded-full bg-[var(--space-data-highlight-soft,#fdf3e2)] px-2 py-0.5 text-[10px] font-semibold text-[#8a5a00]">
                        Lower total cost
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-[var(--space-border-default)]">
                    <MetricCell label="Monthly EMI" amount={m.emi} suffix="/mo" hint={`for ${m.months} months`} />
                    <MetricCell label="Total interest" amount={m.totalInterest} />
                    <MetricCell
                      label="Total cost"
                      amount={m.totalCost}
                      hint={`principal + interest + ${formatINR(m.upfrontFees)} fees`}
                    />
                    <MetricCell label="Effective annual cost" value={`${m.effectiveAprPct}% p.a.`} hint="incl. all one-time fees" />
                  </div>
                  {m.prepayNote && (
                    <p className="border-t border-[var(--space-border-default)] px-4 py-2 text-[10px] text-[var(--space-text-muted)]">
                      {m.prepayNote} — not included in totals; applies only if you close early.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-[var(--space-surface-muted)] px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-text-muted)]" />
            <p className="text-xs leading-relaxed text-[var(--space-text-secondary)]">
              Fill in amount, rate and tenure for both offers — the full side-by-side breakdown and an honest verdict
              appear here instantly.
            </p>
          </div>
        )}

        {/* verdict */}
        {both && verdict && (
          <div
            className="mt-4 overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]"
            style={{ borderLeft: '3px solid var(--space-brand-primary)' }}
            data-testid="compare-verdict"
          >
            <div className="border-b border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--space-text-muted)]">Verdict</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-base font-semibold leading-relaxed text-[var(--space-text-primary)]">
                {verdict.nearlyIdentical
                  ? 'These offers are effectively equivalent. Choose based on lender reputation and service.'
                  : `${verdict.winner.name} costs ${formatINR(verdict.diff)} less over the loan term${verdict.diff >= 100000 ? ` (≈ ${formatINRCompact(verdict.diff)})` : ''}. That's the equivalent of ${verdict.emiEquiv} extra EMI${verdict.emiEquiv === '1' ? '' : 's'}.`}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--space-text-secondary)]">{verdict.driver}</p>
              {verdict.breakEvenNote && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--space-text-secondary)]">{verdict.breakEvenNote}</p>
              )}
              {verdict.flags.length > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {verdict.flags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--space-text-secondary)]">
                      <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[var(--space-semantic-warning)]" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* trust footnote */}
            <div className="border-t border-[var(--space-border-default)] px-4 py-3">
              <p className="text-[10px] leading-snug text-[var(--space-text-muted)]">
                Comparison uses reducing-balance EMI calculation; the effective annual cost includes all one-time fees.
              </p>
              <p className="mt-1.5 text-[12px] leading-snug text-[var(--space-text-muted)]">
                <SourceChip label="RBI" href={RBI_MASTER_DIRECTIONS_URL} testId="compare-rbi-source" />{' '}
                {RBI_MASTER_DIRECTIONS_LABEL}
              </p>
            </div>
          </div>
        )}

        {/* global trust footer */}
        <p className="mt-5 border-t border-[var(--space-border-default)] pt-3 text-[12px] leading-relaxed text-[var(--space-text-muted)]">
          No lender has paid for placement. Loanley earns no referral commission. Neutral information, not financial
          advice.
        </p>
      </div>
    </div>
  );
}
