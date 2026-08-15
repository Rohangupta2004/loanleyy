/**
 * loan-benchmarks — shared "is this rate normal?" benchmark bands (India, ₹).
 *
 * Indicative annual-rate bands per loan type, reflecting where the published
 * rate cards of major Indian banks and NBFCs sit within the RBI's
 * interest-rate framework. Used by the EMI Calculator and Compare Offers apps
 * for a plain, neutral verdict — never to recommend a lender. The in-chat
 * agent uses the server-side loan_benchmark tool; keep these bands aligned
 * with it and with the published ranges in data/lenders.json.
 */
import type { LoanProductType } from '../data/lenders';

export interface BenchmarkRange {
  minPct: number;
  maxPct: number;
}

/** RBI-framed benchmark bands (published rate cards of major banks/NBFCs). */
export const RBI_BENCHMARK_RANGES: Record<LoanProductType, BenchmarkRange> = {
  personal: { minPct: 10, maxPct: 24 },
  home: { minPct: 8, maxPct: 12 },
  business: { minPct: 11, maxPct: 26 },
  education: { minPct: 8, maxPct: 14 },
  loan_against_property: { minPct: 9, maxPct: 14 },
};

export const BENCHMARK_BASIS =
  "Benchmark bands reflect the published rate cards of major Indian banks and NBFCs within the RBI's interest-rate framework. They are indicative, not a rate promise — your sanctioned rate depends on your credit profile.";

export const RBI_MASTER_DIRECTIONS_URL = 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10295';
export const RBI_MASTER_DIRECTIONS_LABEL =
  'RBI Master Direction — Interest Rate on Advances Directions, 2016 (as updated)';

export type VerdictStatus = 'normal' | 'high' | 'too_good';

export interface RateVerdict {
  status: VerdictStatus;
  headline: string;
  detail: string;
  range: BenchmarkRange;
}

/** Plain, neutral read of an annual rate against the benchmark band. */
export function rateVerdict(loanType: LoanProductType, annualRatePct: number): RateVerdict {
  const range = RBI_BENCHMARK_RANGES[loanType];
  const band = `${range.minPct}%–${range.maxPct}% p.a.`;
  if (annualRatePct < range.minPct) {
    return {
      status: 'too_good',
      headline: 'Too good to be true?',
      detail: `${annualRatePct}% is below the ${band} band that major Indian banks and NBFCs publish for this loan type. A quote this low usually hides a flat-rate calculation, a short teaser period, or fees that claw the cost back — read the Key Facts Statement line by line before believing it.`,
      range,
    };
  }
  if (annualRatePct > range.maxPct) {
    return {
      status: 'high',
      headline: 'High',
      detail: `${annualRatePct}% is above the ${band} band that major Indian banks and NBFCs publish for this loan type. Worth negotiating, and worth checking the lender's own published rate card before committing.`,
      range,
    };
  }
  return {
    status: 'normal',
    headline: 'Normal range',
    detail: `${annualRatePct}% sits inside the ${band} band that major Indian banks and NBFCs publish for this loan type.`,
    range,
  };
}

/** Compact Indian wording for large amounts: ₹5 lakh, ₹1.2 crore. */
export function formatINRCompact(n: number): string {
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e7) {
    const v = (abs / 1e7).toFixed(2).replace(/\.?0+$/, '');
    return `${neg}₹${v} crore`;
  }
  if (abs >= 1e5) {
    const v = (abs / 1e5).toFixed(2).replace(/\.?0+$/, '');
    return `${neg}₹${v} lakh`;
  }
  return `${neg}₹${Math.round(abs).toLocaleString('en-IN')}`;
}
