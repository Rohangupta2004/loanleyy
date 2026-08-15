/**
 * personal-loans — the client for Loanley's personal-loan data backend.
 *
 * Every personal-loan number a borrower sees comes from here: the
 * `personal-loans-data` server hook, which serves data/personal_loans.json (20
 * major Indian lenders' published rates, fees and eligibility, each with the
 * lender's own official source URL) and applies the eligibility filter and the
 * ranking server-side.
 *
 * Two rules this module exists to enforce:
 *  1. The SERVER decides who is eligible. The app never re-derives eligibility
 *     from a local copy of the data — it passes the borrower's CIBIL, income,
 *     amount and employment type as filter params and renders the verdict it
 *     gets back, so the ranking a borrower sees is the ranking the published
 *     dataset produces.
 *  2. Ranking is by the lender's own published starting rate, lowest first,
 *     and nothing else. No lender pays for placement, and there is no
 *     recommendation anywhere in this file.
 *
 * Money maths (EMI, total cost, effective cost with the fee) is computed here
 * from the published figures using the same deterministic functions the rest
 * of Loanley uses. Where a lender publishes no maximum rate, the EMI is
 * computed at its published STARTING rate and labelled as such — it is a floor,
 * never a quote.
 */
import { computeEmi, effectiveAnnualRate } from './lender-compare';

/** The hook that serves data/personal_loans.json. */
export const PERSONAL_LOANS_ENDPOINT = '/api/hooks/execute/workspace-253940/personal-loans-data';

/** Same dataset, as a file the browser saves rather than renders. */
export const PERSONAL_LOANS_DOWNLOAD_URL = `${PERSONAL_LOANS_ENDPOINT}?download=true`;

/** Filename the browser saves the dataset under. */
export const PERSONAL_LOANS_FILENAME = 'loanley-personal-loans.json';

export type EmploymentType = 'salaried' | 'self_employed';

/** One lender's published personal-loan record. `null` always means the lender does not publish it. */
export interface PersonalLoanLender {
  lender: string;
  code: string;
  lenderId: string;
  lenderType: 'public_sector_bank' | 'private_bank' | 'nbfc';
  employmentTypes: EmploymentType[] | null;
  ageMin: number | null;
  ageMax: number | null;
  loanAmountMin: number | null;
  loanAmountMax: number | null;
  tenureMinMonths: number | null;
  tenureMaxMonths: number | null;
  interestRateMin: number | null;
  interestRateMax: number | null;
  processingFeePercent: number | null;
  processingFeeFlat: number | null;
  processingFeeMin: number | null;
  processingFeeMax: number | null;
  cibilScoreMin: number | null;
  foirMax: number | null;
  minSalary: number | null;
  prepaymentCharges: string | null;
  moratoriumAccepted: boolean | null;
  negativeIndustries: string[] | null;
  documents: string[] | null;
  sourceUrl: string;
  eligibilitySourceUrl: string | null;
  notes: string | null;
  updatedAt: string;
  unpublishedFields?: string[];
}

/** A lender plus the server's verdict for this borrower. */
export interface PersonalLoanResult extends PersonalLoanLender {
  eligible: boolean;
  /** Null when eligible; the joined published reasons when not. */
  ineligibleReason: string | null;
  ineligibleReasons: string[];
  /** Criteria that could not be checked, e.g. a floor the borrower gave no figure for. */
  unverified: string[];
  /** 1-based position among eligible lenders; null for the rest. */
  rank: number | null;
}

export interface PersonalLoanRanking {
  results: PersonalLoanResult[];
  eligible: PersonalLoanResult[];
  ineligible: PersonalLoanResult[];
  eligibleCount: number;
  ineligibleCount: number;
  lenderCount: number;
  rankedBy: string;
  rankingNote: string;
  updatedAt: string;
  servedAt: string;
  disclaimer: string;
  liveRateOverrides?: { valuesApplied: number; asOf: string | null; note: string };
}

export interface PersonalLoanFilters {
  cibilScore?: number | null;
  monthlyIncome?: number | null;
  amount?: number | null;
  employment?: EmploymentType | null;
  tenureMonths?: number | null;
}

function queryString(filters: PersonalLoanFilters): string {
  const params = new URLSearchParams();
  if (filters.cibilScore != null) params.set('cibil', String(Math.round(filters.cibilScore)));
  if (filters.monthlyIncome != null) params.set('salary', String(Math.round(filters.monthlyIncome)));
  if (filters.amount != null) params.set('amount', String(Math.round(filters.amount)));
  if (filters.employment) params.set('employment', filters.employment);
  if (filters.tenureMonths != null) params.set('tenure', String(Math.round(filters.tenureMonths)));
  return params.toString();
}

/**
 * Ask the data backend which lenders this borrower's own figures qualify for.
 * Throws rather than returning a partial answer: Loanley shows the published
 * numbers or it shows nothing, never an estimate.
 */
export async function fetchPersonalLoanRanking(filters: PersonalLoanFilters): Promise<PersonalLoanRanking> {
  const qs = queryString(filters);
  const res = await fetch(qs ? `${PERSONAL_LOANS_ENDPOINT}?${qs}` : PERSONAL_LOANS_ENDPOINT, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`personal-loan data unavailable (HTTP ${res.status})`);
  const data = (await res.json()) as PersonalLoanRanking;
  if (!data || !Array.isArray(data.results)) throw new Error('personal-loan data returned an unexpected shape');
  return data;
}

/** The whole dataset, unfiltered — used by the download link. */
export async function fetchPersonalLoanDataset(): Promise<string> {
  const res = await fetch(PERSONAL_LOANS_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`personal-loan data unavailable (HTTP ${res.status})`);
  return res.text();
}

/* ============================================================================
 * Presentation helpers — published figures only, never an inferred one.
 * ==========================================================================*/

export function formatRateRange(row: PersonalLoanLender): string {
  if (row.interestRateMin == null && row.interestRateMax == null) return 'Not published';
  if (row.interestRateMin == null) return `Up to ${row.interestRateMax}%`;
  if (row.interestRateMax == null) return `${row.interestRateMin}% onwards`;
  if (row.interestRateMax === row.interestRateMin) return `${row.interestRateMin}% flat`;
  return `${row.interestRateMin}%–${row.interestRateMax}%`;
}

export function formatAmount(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function formatMaxAmount(row: PersonalLoanLender): string {
  return row.loanAmountMax == null ? 'Not published' : `Up to ${formatAmount(row.loanAmountMax)}`;
}

export function formatTenureRange(row: PersonalLoanLender): string {
  if (row.tenureMinMonths == null && row.tenureMaxMonths == null) return 'Not published';
  if (row.tenureMinMonths == null) return `Up to ${row.tenureMaxMonths} months`;
  if (row.tenureMaxMonths == null) return `From ${row.tenureMinMonths} months`;
  return `${row.tenureMinMonths}–${row.tenureMaxMonths} months`;
}

export interface PersonalLoanFee {
  amount: number | null;
  label: string;
}

/** Upfront processing fee in ₹ per the lender's published structure (GST excluded). */
export function computeProcessingFee(row: PersonalLoanLender, amount: number): PersonalLoanFee {
  if (row.processingFeeFlat != null) {
    return { amount: row.processingFeeFlat, label: `Flat up to ${formatAmount(row.processingFeeFlat)}` };
  }
  if (row.processingFeePercent == null) return { amount: null, label: 'Not published' };

  let fee = (amount * row.processingFeePercent) / 100;
  let label = `Up to ${row.processingFeePercent}%`;
  if (row.processingFeeMin != null && fee < row.processingFeeMin) {
    fee = row.processingFeeMin;
    label += ` (min ${formatAmount(row.processingFeeMin)})`;
  }
  if (row.processingFeeMax != null && fee > row.processingFeeMax) {
    fee = row.processingFeeMax;
    label += ` (capped ${formatAmount(row.processingFeeMax)})`;
  }
  return { amount: Math.round(fee), label };
}

export interface PersonalLoanCost {
  /** The published rate the EMI was computed at. */
  ratePct: number;
  /** 'midpoint' of a published range, or the published 'starting' rate when no ceiling is published. */
  rateBasis: 'midpoint' | 'starting' | 'flat';
  emi: number;
  totalPayable: number;
  totalInterest: number;
  fee: PersonalLoanFee;
  /** All-in annual cost % including the upfront fee. Null when no fee is published. */
  effectiveAnnualRatePct: number | null;
}

/**
 * What this loan actually costs at the lender's published pricing. Null when
 * the lender publishes no rate at all — Loanley leaves the cell empty rather
 * than inventing a number.
 */
export function computeCost(row: PersonalLoanLender, amount: number, tenureMonths: number): PersonalLoanCost | null {
  if (row.interestRateMin == null || amount <= 0 || tenureMonths <= 0) return null;

  let ratePct = row.interestRateMin;
  let rateBasis: PersonalLoanCost['rateBasis'] = 'starting';
  if (row.interestRateMax != null) {
    if (row.interestRateMax === row.interestRateMin) rateBasis = 'flat';
    else {
      ratePct = Math.round(((row.interestRateMin + row.interestRateMax) / 2) * 100) / 100;
      rateBasis = 'midpoint';
    }
  }

  const fee = computeProcessingFee(row, amount);
  const emi = computeEmi(amount, ratePct, tenureMonths);
  const feeAmount = fee.amount ?? 0;
  return {
    ratePct,
    rateBasis,
    emi: Math.round(emi),
    totalPayable: Math.round(emi * tenureMonths + feeAmount),
    totalInterest: Math.round(emi * tenureMonths - amount),
    fee,
    effectiveAnnualRatePct:
      fee.amount == null
        ? null
        : Math.round(effectiveAnnualRate(amount, fee.amount, emi, tenureMonths) * 100) / 100,
  };
}

/** How the EMI figure should be read, in the borrower's words. */
export function describeRateBasis(cost: PersonalLoanCost): string {
  switch (cost.rateBasis) {
    case 'flat':
      return `at the published flat ${cost.ratePct}%`;
    case 'midpoint':
      return `at ${cost.ratePct}%, the midpoint of the published range`;
    default:
      return `at ${cost.ratePct}%, the published starting rate — this lender publishes no ceiling, so your rate can be higher`;
  }
}
