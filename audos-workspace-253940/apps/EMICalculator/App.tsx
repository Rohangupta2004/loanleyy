/**
 * EMI Calculator — Loanley's standalone reducing-balance EMI calculator (India, ₹).
 *
 * Design brief: a trusted financial data instrument. Single column, the numbers
 * are the hero (large tabular figures), live recalculation on every keystroke,
 * a two-line plain-English verdict, and a visible source citation. No sidebars,
 * no ads, no lender names, no 'Apply' anything. The maths is the shared
 * reducing-balance engine in lib/lender-compare.ts.
 */
import { useMemo, useState } from 'react';
import { formatINR, RupeeAmount, SourceChip, ZeroCommissionStrip } from '../../components/LoanleyCards';
import { computeEmi, effectiveAnnualRate } from '../../lib/lender-compare';
import {
  RBI_BENCHMARK_RANGES,
  RBI_MASTER_DIRECTIONS_URL,
  rateVerdict,
  formatINRCompact,
} from '../../lib/loan-benchmarks';
import type { LoanProductType } from '../../data/lenders';

const LOAN_TYPES: { value: LoanProductType; label: string }[] = [
  { value: 'personal', label: 'Personal Loan' },
  { value: 'home', label: 'Home Loan' },
  { value: 'business', label: 'Business Loan' },
  { value: 'education', label: 'Education Loan' },
  { value: 'loan_against_property', label: 'Loan Against Property' },
];

const LOAN_TYPE_PHRASE: Record<LoanProductType, string> = {
  personal: 'a personal loan',
  home: 'a home loan',
  business: 'a business loan',
  education: 'an education loan',
  loan_against_property: 'a loan against property',
};

interface Computed {
  months: number;
  emi: number;
  totalRepaid: number;
  totalInterest: number;
  processingFee: number;
  otherFees: number;
  totalFees: number;
  totalPayable: number;
  effectiveAprPct: number;
}

export default function EMICalculator() {
  const [loanType, setLoanType] = useState<LoanProductType>('personal');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [tenureUnit, setTenureUnit] = useState<'years' | 'months'>('years');
  const [feeMode, setFeeMode] = useState<'rupees' | 'percent'>('rupees');
  const [feeValue, setFeeValue] = useState('');
  const [otherFees, setOtherFees] = useState('');

  const amountNum = parseFloat(amount);
  const rateNum = parseFloat(rate);
  const tenureNum = parseFloat(tenure);

  const result: Computed | null = useMemo(() => {
    if (isNaN(amountNum) || amountNum <= 0) return null;
    if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100) return null;
    if (isNaN(tenureNum) || tenureNum <= 0) return null;
    const months = tenureUnit === 'years' ? Math.round(tenureNum * 12) : Math.round(tenureNum);
    if (months < 1 || months > 480) return null;

    const feeNum = parseFloat(feeValue);
    const processingFee = isNaN(feeNum) || feeNum <= 0 ? 0 : feeMode === 'percent' ? (amountNum * feeNum) / 100 : feeNum;
    const otherNum = parseFloat(otherFees);
    const other = isNaN(otherNum) || otherNum <= 0 ? 0 : otherNum;
    const totalFees = processingFee + other;

    const emi = computeEmi(amountNum, rateNum, months);
    const totalRepaid = emi * months;
    return {
      months,
      emi,
      totalRepaid,
      totalInterest: totalRepaid - amountNum,
      processingFee,
      otherFees: other,
      totalFees,
      totalPayable: totalRepaid + totalFees,
      effectiveAprPct: Math.round(effectiveAnnualRate(amountNum, totalFees, emi, months) * 100) / 100,
    };
  }, [amountNum, rateNum, tenureNum, tenureUnit, feeMode, feeValue, otherFees]);

  const verdict = useMemo(
    () => (result && !isNaN(rateNum) ? rateVerdict(loanType, rateNum) : null),
    [result, loanType, rateNum],
  );

  const benchmark = RBI_BENCHMARK_RANGES[loanType];

  const inputCls =
    'w-full min-h-[44px] rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-2.5 text-base text-[var(--space-text-primary)] tabular-nums focus:outline-none focus:border-[var(--space-text-brand)]';
  const labelCls = 'block text-[13px] font-medium text-[var(--space-text-muted)] mb-1.5';
  const toggleCls = (active: boolean) =>
    `min-h-[36px] px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
      active
        ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-[var(--space-brand-primary)]'
        : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)]'
    }`;

  // Two-line plain-English read, per the design brief.
  const verdictLines = useMemo(() => {
    if (!result || !verdict || isNaN(rateNum)) return null;
    const phrase = LOAN_TYPE_PHRASE[loanType];
    const band = `${benchmark.minPct}%–${benchmark.maxPct}%`;
    const line2 = `Published rate cards of major Indian banks and NBFCs show ${band} p.a. for this loan type.`;
    if (verdict.status === 'normal') {
      return { line1: `At ${rateNum}%, ${phrase} of this size is within the normal range.`, line2 };
    }
    if (verdict.status === 'high') {
      return {
        line1: `At ${rateNum}%, ${phrase} of this size is priced above the normal range — worth negotiating before committing.`,
        line2,
      };
    }
    return {
      line1: `At ${rateNum}%, ${phrase} priced this low is usually hiding something — a flat-rate quote, a teaser period, or fees that claw the cost back.`,
      line2,
    };
  }, [result, verdict, rateNum, loanType, benchmark]);

  // Verdict = colored text, per the design brief: green / amber / red.
  const verdictPill =
    verdict?.status === 'normal' ? (
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--space-semantic-success)]">
        Normal
      </span>
    ) : verdict?.status === 'high' ? (
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8a5a00]">High</span>
    ) : (
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--space-semantic-danger)]">
        Too good to be true
      </span>
    );

  return (
    <div className="min-h-full w-full bg-transparent">
      <div className="mx-auto max-w-xl px-4 py-6 sm:px-5">
        {/* header */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[var(--space-text-brand)]">EMI Calculator</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-[var(--space-text-secondary)]">
            Reducing-balance maths for any Indian loan — EMI, total payable, and the effective cost once fees are
            counted. Results update as you type.
          </p>
        </div>

        {/* inputs — single column, large touch targets */}
        <div className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 sm:p-5">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Loan type</label>
              <select className={inputCls} value={loanType} onChange={(e) => setLoanType(e.target.value as LoanProductType)}>
                {LOAN_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Loan amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-medium text-[var(--space-text-muted)]">
                  ₹
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  className={`${inputCls} pl-8`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="5,00,000"
                  data-testid="emi-input-amount"
                />
              </div>
              {!isNaN(amountNum) && amountNum >= 100000 && (
                <p className="mt-1 text-xs text-[var(--space-text-muted)]">= {formatINRCompact(amountNum)}</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Interest rate (% per year)</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 14"
                data-testid="emi-input-rate"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[13px] font-medium text-[var(--space-text-muted)]">Tenure</label>
                <div className="flex gap-1">
                  <button type="button" className={toggleCls(tenureUnit === 'years')} onClick={() => setTenureUnit('years')}>
                    years
                  </button>
                  <button type="button" className={toggleCls(tenureUnit === 'months')} onClick={() => setTenureUnit('months')}>
                    months
                  </button>
                </div>
              </div>
              <input
                type="number"
                className={inputCls}
                value={tenure}
                onChange={(e) => setTenure(e.target.value)}
                placeholder={tenureUnit === 'years' ? 'e.g. 4' : 'e.g. 48'}
                data-testid="emi-input-tenure"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[13px] font-medium text-[var(--space-text-muted)]">Processing fee (optional)</label>
                <div className="flex gap-1">
                  <button type="button" className={toggleCls(feeMode === 'rupees')} onClick={() => setFeeMode('rupees')}>
                    ₹
                  </button>
                  <button type="button" className={toggleCls(feeMode === 'percent')} onClick={() => setFeeMode('percent')}>
                    %
                  </button>
                </div>
              </div>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={feeValue}
                onChange={(e) => setFeeValue(e.target.value)}
                placeholder={feeMode === 'percent' ? 'e.g. 1.5 (% of amount)' : 'e.g. 6000'}
              />
            </div>
            <div>
              <label className={labelCls}>Other one-time fees (₹, optional)</label>
              <input
                type="number"
                className={inputCls}
                value={otherFees}
                onChange={(e) => setOtherFees(e.target.value)}
                placeholder="insurance, documentation…"
              />
            </div>
          </div>
        </div>

        {/* persistent non-promotional strip */}
        <ZeroCommissionStrip className="mt-4" />

        {/* results — three rows, the numbers are the hero */}
        <div
          className="mt-2 overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]"
          style={{ borderLeft: '3px solid var(--space-brand-primary)' }}
        >
          <div className="divide-y divide-[var(--space-border-default)]">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[13px] text-[var(--space-text-muted)]">Monthly EMI</p>
                {result && <p className="mt-0.5 text-[11px] text-[var(--space-text-muted)]">for {result.months} months</p>}
              </div>
              <p
                className="text-2xl font-bold leading-tight text-[var(--space-text-brand)] tabular-nums sm:text-3xl"
                data-testid="emi-out-emi"
              >
                {result ? <RupeeAmount value={result.emi} suffix="/mo" /> : '—'}
              </p>
            </div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[13px] text-[var(--space-text-muted)]">Total amount payable</p>
                <p className="mt-0.5 text-[11px] text-[var(--space-text-muted)]" data-testid="emi-out-interest">
                  {result
                    ? `${formatINR(result.totalInterest)} interest${result.totalFees > 0 ? ` + ${formatINR(result.totalFees)} fees` : ''}`
                    : 'interest + fees'}
                </p>
              </div>
              <p
                className="text-2xl font-bold leading-tight text-[var(--space-text-primary)] tabular-nums sm:text-3xl"
                data-testid="emi-out-total"
              >
                {result ? <RupeeAmount value={result.totalPayable} /> : '—'}
              </p>
            </div>
            <div className="flex items-baseline justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[13px] text-[var(--space-text-muted)]">Effective cost with fees</p>
                {result && result.totalFees > 0 && !isNaN(rateNum) && result.effectiveAprPct > rateNum && (
                  <p className="mt-0.5 text-[11px] text-[var(--space-text-muted)]">
                    fees add {(Math.round((result.effectiveAprPct - rateNum) * 100) / 100).toFixed(2)} points over the
                    quoted {rateNum}%
                  </p>
                )}
              </div>
              <p
                className="text-2xl font-bold leading-tight text-[var(--space-text-primary)] tabular-nums sm:text-3xl"
                data-testid="emi-out-apr"
              >
                {result ? `${result.effectiveAprPct}%` : '—'}
              </p>
            </div>
          </div>

          {/* verdict — two-line plain-English read */}
          {result && verdict && verdictLines ? (
            <div className="border-t border-[var(--space-border-default)] px-4 py-3.5 sm:px-5" data-testid="emi-verdict">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                {verdictPill}
                <SourceChip label="RBI" href={RBI_MASTER_DIRECTIONS_URL} testId="emi-verdict-rbi" />
              </div>
              <p className="text-[15px] leading-relaxed text-[var(--space-text-primary)]">{verdictLines.line1}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--space-text-secondary)]">{verdictLines.line2}</p>
            </div>
          ) : (
            <div className="border-t border-[var(--space-border-default)] px-4 py-3.5 sm:px-5">
              <p className="text-[13px] leading-relaxed text-[var(--space-text-secondary)]">
                Enter the amount, rate and tenure to see the full cost picture. Published benchmark for this loan type:{' '}
                {benchmark.minPct}%–{benchmark.maxPct}% p.a.{' '}
                <SourceChip label="RBI" href={RBI_MASTER_DIRECTIONS_URL} />
              </p>
            </div>
          )}

          {/* source citation — always present */}
          <div className="border-t border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-4 py-2.5 sm:px-5">
            <a
              href={RBI_MASTER_DIRECTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-[var(--space-text-muted)] underline underline-offset-2"
              data-testid="emi-rbi-source"
            >
              Source: RBI Master Direction — Interest Rate on Advances, 2016 (as updated) ↗
            </a>
            <p className="mt-1 text-[11px] leading-snug text-[var(--space-text-muted)]">
              Reducing-balance method: EMI = P × r × (1+r)ⁿ / ((1+r)ⁿ − 1). Effective cost is the annualised rate
              including all one-time fees. Benchmark bands reflect published rate cards of major Indian banks and
              NBFCs.
            </p>
          </div>
        </div>

        {/* global trust footer */}
        <p className="mt-5 border-t border-[var(--space-border-default)] pt-3 text-[12px] leading-relaxed text-[var(--space-text-muted)]">
          No lender has paid for placement. Loanley earns no referral commission. Neutral information, not financial
          advice.
        </p>
      </div>
    </div>
  );
}
