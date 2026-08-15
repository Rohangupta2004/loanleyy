/**
 * lender-compare — Loanley's neutral lender comparison engine (India, ₹).
 *
 * Pure, deterministic maths over the published lender database
 * (data/lenders.ts, mirrored from data/lenders.json — or that bundle with the
 * weekly refresh's validated overrides layered on top, which customer screens
 * pass in as the optional second argument to compareLenders; see
 * lib/lender-rates-live.ts). No lender is favoured:
 * every qualifying lender is ranked purely by effective total cost for the
 * borrower's requirements, computed at the midpoint of the lender's own
 * published rate range plus its published processing fee. Lenders where the
 * borrower likely does not qualify are still returned, labelled with the
 * concrete reason, so nothing is hidden. There are no referral links — each
 * row carries the lender's official source URL for verification.
 *
 * Eligibility is filtered on whatever each lender actually publishes for the
 * product: amount, tenure and employment type everywhere; minimum income and
 * CIBIL for personal, home and loan-against-property; business vintage and
 * annual turnover for business loans; and the collateral threshold plus the
 * mandatory co-borrower for education loans. Where a criterion is published
 * but the borrower hasn't given us the matching figure, the row carries an
 * explicit "unverified" caveat instead of quietly passing the check.
 *
 * A personal-loan criterion may instead come from Loanley's desk credit-policy
 * record (lib/policy-rules.ts), because lenders publish rate cards rather than
 * approval rules. Those criteria are named on the product in
 * `criteriaFromDeskPolicy`, and every reason below says which of the two a rule
 * came from, so a desk rule is never read as one the lender published.
 */
import { LENDER_DB } from '../data/lenders';
import type { EmploymentType, Lender, LenderProduct, LoanProductType } from '../data/lenders';
import { isDeskPolicyCriterion } from './policy-rules';

export type CreditBand = 'below_650' | '650_700' | '700_750' | '750_plus' | 'unknown';

export interface BorrowerRequirements {
  loanType: LoanProductType;
  /** Loan amount in plain rupees. */
  amount: number;
  tenureMonths: number;
  employmentType: EmploymentType;
  /** Net monthly income in ₹ (for self-employed, annual income / 12). */
  monthlyIncome?: number;
  creditBand?: CreditBand;
  /** Business loans: months the business has been running. */
  businessVintageMonths?: number;
  /** Business loans: annual turnover in ₹. */
  annualTurnover?: number;
  /** Education loans: net monthly income in ₹ of the parent/guardian co-applicant. */
  coApplicantMonthlyIncome?: number;
  /**
   * Education loans: whether tangible collateral can be pledged. Only `false`
   * disqualifies a lender — `undefined` means unknown, which is disclosed as a
   * caveat rather than assumed either way.
   */
  canPledgeCollateral?: boolean;
}

export interface ComparisonRow {
  lenderId: string;
  lenderName: string;
  lenderType: Lender['type'];
  rateMin: number;
  rateMax: number;
  /** Midpoint of the published range — the rate used for ranking. */
  midRate: number;
  feeAmount: number;
  feeLabel: string;
  emi: number;
  totalPayable: number;
  totalInterest: number;
  /** All-in annual cost % including the processing fee (reducing-balance IRR). */
  effectiveAnnualRatePct: number;
  /** Caveats that apply even though the borrower likely qualifies. */
  eligibilityNotes: string[];
  /** Concrete reasons the borrower is likely out of range (empty if eligible). */
  reasons: string[];
  sourceUrl: string;
  dataNote?: string;
  lastUpdated: string;
}

export interface ComparisonResult {
  requirements: BorrowerRequirements;
  eligible: ComparisonRow[];
  outOfRange: ComparisonRow[];
  /** Lenders in the database with no published data for this loan type. */
  notCovered: string[];
  lastUpdated: string;
  methodology: string;
  disclaimer: string;
}

export const CREDIT_BAND_LABELS: Record<CreditBand, string> = {
  below_650: 'Below 650',
  '650_700': '650–699',
  '700_750': '700–749',
  '750_plus': '750+',
  unknown: 'Not sure',
};

const CREDIT_BAND_FLOOR: Record<Exclude<CreditBand, 'unknown'>, number> = {
  below_650: 600,
  '650_700': 650,
  '700_750': 700,
  '750_plus': 750,
};

export const LOAN_TYPE_LABELS: Record<LoanProductType, string> = {
  personal: 'Personal loan',
  home: 'Home loan',
  business: 'Business loan',
  education: 'Education loan',
  loan_against_property: 'Loan against property',
};

export const LENDER_TYPE_LABELS: Record<Lender['type'], string> = {
  public_sector_bank: 'Public sector bank',
  private_bank: 'Private bank',
  nbfc: 'NBFC',
};

/** Published vintage figures are whole years, so read them back that way. */
function describeMonths(months: number): string {
  if (months >= 12 && months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${months} months`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Where one criterion came from. A borrower has to be able to tell a figure the
 * lender printed from one on Loanley's desk record, because only the first can
 * be checked against the source link on the row.
 */
function criterionSource(product: LenderProduct, field: string): string {
  return isDeskPolicyCriterion(product, field)
    ? "Loanley's desk policy record"
    : "the lender's published criteria";
}

/** Standard reducing-balance EMI. */
export function computeEmi(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 12 / 100;
  if (r <= 0) return principal / months;
  const pow = Math.pow(1 + r, months);
  return (principal * r * pow) / (pow - 1);
}

/** Upfront processing fee in ₹ per the lender's published structure (GST excluded). */
export function computeFee(product: LenderProduct, amount: number): { amount: number; label: string } {
  if (product.processingFeeFlat != null) {
    return {
      amount: product.processingFeeFlat,
      label: product.processingFeeFlat === 0 ? 'Nil (published)' : `Flat up to ₹${product.processingFeeFlat.toLocaleString('en-IN')}`,
    };
  }
  const pct = product.processingFeePercent ?? 0;
  let fee = (amount * pct) / 100;
  let label = `Up to ${pct}%`;
  if (product.processingFeeCapAmount != null && fee > product.processingFeeCapAmount) {
    fee = product.processingFeeCapAmount;
    label += ` (capped ₹${product.processingFeeCapAmount.toLocaleString('en-IN')})`;
  }
  return { amount: Math.round(fee), label };
}

/**
 * Effective annual cost % including the upfront fee: the IRR of receiving
 * (principal − fee) and repaying the EMI for `months`, solved by bisection.
 */
export function effectiveAnnualRate(principal: number, fee: number, emi: number, months: number): number {
  const net = principal - fee;
  if (net <= 0) return Infinity;
  const pv = (monthlyRate: number) => {
    if (monthlyRate === 0) return emi * months;
    return (emi * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate;
  };
  let lo = 0;
  let hi = 0.2; // 240% annualised — far above any regulated product
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > net) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 12 * 100;
}

function buildRow(lender: Lender, product: LenderProduct, req: BorrowerRequirements): ComparisonRow {
  const midRate = (product.interestRateMin + product.interestRateMax) / 2;
  const fee = computeFee(product, req.amount);
  const emi = computeEmi(req.amount, midRate, req.tenureMonths);
  const totalPayable = emi * req.tenureMonths + fee.amount;
  return {
    lenderId: lender.id,
    lenderName: lender.name,
    lenderType: lender.type,
    rateMin: product.interestRateMin,
    rateMax: product.interestRateMax,
    midRate: Math.round(midRate * 100) / 100,
    feeAmount: fee.amount,
    feeLabel: fee.label,
    emi: Math.round(emi),
    totalPayable: Math.round(totalPayable),
    totalInterest: Math.round(emi * req.tenureMonths - req.amount),
    effectiveAnnualRatePct: Math.round(effectiveAnnualRate(req.amount, fee.amount, emi, req.tenureMonths) * 100) / 100,
    eligibilityNotes: [],
    reasons: [],
    sourceUrl: product.sourceUrl || lender.sourceUrl,
    dataNote: product.dataNote || lender.dataNote,
    lastUpdated: lender.lastUpdated,
  };
}

/**
 * The lender database to rank: the static bundle by default, or the bundle
 * with the weekly refresh's validated overrides layered on top (see
 * lib/lender-rates-live.ts). Structural on purpose — the engine stays pure and
 * has no idea where the numbers came from.
 */
export interface LenderSource {
  lenders: Lender[];
  lastUpdated: string;
}

export function compareLenders(req: BorrowerRequirements, source: LenderSource = LENDER_DB): ComparisonResult {
  const eligible: ComparisonRow[] = [];
  const outOfRange: ComparisonRow[] = [];
  const notCovered: string[] = [];

  for (const lender of source.lenders) {
    const product = lender.products[req.loanType];
    if (!product) {
      notCovered.push(lender.name);
      continue;
    }

    const row = buildRow(lender, product, req);
    const reasons: string[] = [];
    const notes: string[] = [];

    if (!product.employmentTypes.includes(req.employmentType)) {
      const onlyFor = req.employmentType === 'self_employed' ? 'salaried' : 'self-employed';
      reasons.push(
        `This product is for ${onlyFor} applicants only, per ${criterionSource(product, 'employmentTypes')}`,
      );
    }
    if (req.amount < product.minLoanAmount) {
      reasons.push(
        `Amount below the minimum on ${criterionSource(product, 'minLoanAmount')} (₹${product.minLoanAmount.toLocaleString('en-IN')})`,
      );
    }
    if (req.amount > product.maxLoanAmount) {
      reasons.push(`Amount above the published maximum (₹${product.maxLoanAmount.toLocaleString('en-IN')})`);
    }
    if (req.tenureMonths < product.minTenureMonths) {
      reasons.push(
        `Tenure shorter than the minimum on ${criterionSource(product, 'minTenureMonths')} (${product.minTenureMonths} months)`,
      );
    }
    if (req.tenureMonths > product.maxTenureMonths) {
      reasons.push(
        `Tenure longer than the maximum on ${criterionSource(product, 'maxTenureMonths')} (${product.maxTenureMonths} months)`,
      );
    }

    // Income eligibility applies to BOTH salaried and self-employed applicants:
    // a published minimum income is a minimum income, whichever way it is earned.
    if (product.minSalary != null) {
      const incomeWord = req.employmentType === 'salaried' ? 'salary' : 'income';
      const floor = `minimum monthly ${incomeWord} ₹${product.minSalary.toLocaleString('en-IN')} per ${criterionSource(product, 'minSalary')}`;
      if (req.monthlyIncome == null) {
        notes.push(`Requires ${floor} — you haven't shared your income, so this is unverified`);
      } else if (req.monthlyIncome < product.minSalary) {
        reasons.push(
          `Requires ${floor} — your income is ₹${req.monthlyIncome.toLocaleString('en-IN')}`,
        );
      }
    }

    if (product.minCreditScore != null) {
      const band = req.creditBand ?? 'unknown';
      if (band === 'unknown') {
        notes.push(
          `Requires minimum CIBIL ${product.minCreditScore} — you haven't shared your score, so this is unverified`,
        );
      } else if (CREDIT_BAND_FLOOR[band] < product.minCreditScore) {
        reasons.push(
          `Requires minimum CIBIL ${product.minCreditScore} — your range is ${CREDIT_BAND_LABELS[band]}`,
        );
      }
    }

    // Education loans: lenders publish a security threshold, a mandatory
    // co-borrower and a course/institution condition instead of a student
    // salary or score. Filter on what is checkable and disclose the rest.
    if (product.collateralRequiredAboveAmount != null && req.amount > product.collateralRequiredAboveAmount) {
      const threshold = `₹${product.collateralRequiredAboveAmount.toLocaleString('en-IN')}`;
      if (req.canPledgeCollateral === false) {
        reasons.push(
          `Published scheme requires tangible collateral security above ${threshold} — you've said you have none to pledge`,
        );
      } else {
        notes.push(
          `Above ${threshold} the published scheme requires tangible collateral security (typically 100% of the loan amount)`,
        );
      }
    }
    if (product.coApplicantRequired) {
      notes.push('The published scheme requires a parent or guardian as joint borrower (co-applicant)');
    }
    if (product.minCoApplicantMonthlyIncome != null) {
      const min = `₹${product.minCoApplicantMonthlyIncome.toLocaleString('en-IN')}`;
      if (req.coApplicantMonthlyIncome == null) {
        notes.push(
          `Requires a co-applicant earning at least ${min} a month — you haven't shared their income, so this is unverified`,
        );
      } else if (req.coApplicantMonthlyIncome < product.minCoApplicantMonthlyIncome) {
        reasons.push(
          `Requires a co-applicant earning at least ${min} a month — theirs is ₹${req.coApplicantMonthlyIncome.toLocaleString('en-IN')}`,
        );
      }
    }
    if (product.institutionRequirement) {
      notes.push(`Published course and institution condition: ${product.institutionRequirement}`);
    }

    // Business loans: the published floors are business vintage and annual
    // turnover, not a salary. Filter on them when the borrower has shared the
    // figures; say plainly that they are unverified when they haven't.
    const unverifiedBusiness: string[] = [];
    if (product.minBusinessVintageMonths != null) {
      const min = describeMonths(product.minBusinessVintageMonths);
      if (req.businessVintageMonths == null) {
        unverifiedBusiness.push(`${min} of business vintage`);
      } else if (req.businessVintageMonths < product.minBusinessVintageMonths) {
        reasons.push(
          `Requires ${min} of business vintage — yours is ${describeMonths(req.businessVintageMonths)}`,
        );
      }
    }
    if (product.minAnnualTurnover != null) {
      const min = `₹${product.minAnnualTurnover.toLocaleString('en-IN')}`;
      if (req.annualTurnover == null) {
        unverifiedBusiness.push(`annual turnover of ${min}`);
      } else if (req.annualTurnover < product.minAnnualTurnover) {
        reasons.push(
          `Requires annual turnover of ${min} — yours is ₹${req.annualTurnover.toLocaleString('en-IN')}`,
        );
      }
    }
    if (unverifiedBusiness.length > 0) {
      notes.push(
        `Published eligibility also needs ${joinWithAnd(unverifiedBusiness)} — you haven't shared ${
          unverifiedBusiness.length === 1 ? 'that' : 'those'
        }, so this is unverified`,
      );
    }

    row.reasons = reasons;
    row.eligibilityNotes = notes;
    if (reasons.length > 0) outOfRange.push(row);
    else eligible.push(row);
  }

  eligible.sort((a, b) => a.totalPayable - b.totalPayable);
  outOfRange.sort((a, b) => a.totalPayable - b.totalPayable);

  // "Rates as of" must describe the numbers on this screen: the freshest rate
  // card among the lenders actually shown, not a database-level stamp that
  // could claim a refresh the borrower isn't looking at.
  const shown = [...eligible, ...outOfRange];
  const lastUpdated = shown.reduce(
    (latest, row) => (row.lastUpdated > latest ? row.lastUpdated : latest),
    shown.length > 0 ? shown[0].lastUpdated : source.lastUpdated,
  );

  return {
    requirements: req,
    eligible,
    outOfRange,
    notCovered,
    lastUpdated,
    methodology: LENDER_DB.methodology,
    disclaimer: LENDER_DB.disclaimer,
  };
}
