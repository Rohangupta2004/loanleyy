/**
 * policy-rules — layers Loanley's desk credit policy over the lender database.
 *
 * data/policy_rules.json (mirrored for the bundle in data/policy-rules-data.ts)
 * is the founder's lender policy document: how each of 29 lenders actually
 * approves a personal loan. It exists because a lender publishes a rate card
 * and almost never its approval rules — which is why so many rows in
 * data/personal_loans.json carry `unpublishedFields` for exactly the criteria a
 * borrower's answer turns on (age band, salary floor, employment vintage,
 * company type, FOIR, no-history CIBIL, balance transfers).
 *
 * Two rules this module exists to enforce:
 *  1. A desk-policy criterion is NEVER presented as a published one. Every
 *     field this layer sets is named in the product's `criteriaFromDeskPolicy`,
 *     and lib/lender-compare.ts reads that list to say where the rule came from
 *     in the reason a borrower is shown.
 *  2. It binds only where the policy actually states a figure, and never leaves
 *     an incoherent product behind — a desk minimum above the lender's own
 *     maximum, or a desk maximum below its minimum, is dropped rather than
 *     applied, so no borrower is refused by an inverted range.
 *
 * A desk figure that matches what the lender already publishes changes nothing
 * and is NOT marked as desk-sourced: the published page corroborates it, so the
 * borrower should be pointed at the stronger of the two sources.
 *
 * Ranking is untouched: this layer sets no rate and no fee, so it cannot move a
 * lender up or down the list. It only changes who qualifies, and says why.
 */
import {
  POLICY_RULES,
  POLICY_RULES_AWAITING_RATE_CARD,
  POLICY_RULE_SOURCE,
  policyRuleFor,
} from '../data/policy-rules-data';
import type { PolicyRuleRecord } from '../data/policy-rules-data';
import type { Lender, LenderDatabase, LenderProduct } from '../data/lenders';

export { POLICY_RULES, POLICY_RULES_AWAITING_RATE_CARD, POLICY_RULE_SOURCE, policyRuleFor };
export type { PolicyRuleRecord };

/**
 * LenderProduct plus the provenance marker this layer writes.
 *
 * Declared here rather than leaned on from data/lenders.ts because that file is
 * a generated mirror: `scripts/scrape-lenders.js --sync` rewrites it from the
 * interface template inside that script, so a field declared only in the mirror
 * can vanish on the next refresh and take the compile with it. The copy in
 * data/lenders.ts documents the field for anyone reading the database; this one
 * is what the code type-checks against.
 */
type DeskPolicyProduct = LenderProduct & { criteriaFromDeskPolicy?: string[] };

/** How a desk-policy criterion must be described wherever a borrower sees it. */
export const DESK_POLICY_LABEL = "Loanley's desk credit-policy record";

/** The caveat that belongs on any screen showing these rules. */
export const DESK_POLICY_CAVEAT =
  "These approval rules come from Loanley's own desk record of each lender's credit policy, not from the lender's website — lenders publish rate cards, not their approval rules. Rates, fees and costs on this screen are still the lender's own published figures.";

/**
 * Layer one lender's desk policy over its published personal-loan product.
 * Only the criteria the policy states are touched, and each one is named so the
 * comparison engine can attribute it.
 */
function mergeProduct(base: LenderProduct, record: PolicyRuleRecord): LenderProduct {
  const merged: DeskPolicyProduct = { ...base };
  const fromDesk: string[] = [];

  if (record.employmentTypes && record.employmentTypes.length > 0) {
    const desk = [...record.employmentTypes].sort().join('+');
    if (desk !== [...base.employmentTypes].sort().join('+')) {
      merged.employmentTypes = [...record.employmentTypes];
      fromDesk.push('employmentTypes');
    }
  }

  // A desk floor above the lender's own published ceiling (or a desk ceiling
  // below its floor) would refuse every borrower for a reason the lender never
  // set. Drop it instead.
  if (
    record.loanAmountMin != null &&
    record.loanAmountMin !== base.minLoanAmount &&
    record.loanAmountMin <= base.maxLoanAmount
  ) {
    merged.minLoanAmount = record.loanAmountMin;
    fromDesk.push('minLoanAmount');
  }
  if (
    record.loanAmountMax != null &&
    record.loanAmountMax !== base.maxLoanAmount &&
    record.loanAmountMax >= merged.minLoanAmount
  ) {
    merged.maxLoanAmount = record.loanAmountMax;
    fromDesk.push('maxLoanAmount');
  }

  const tenureMin = record.tenureMinMonths ?? base.minTenureMonths;
  const tenureMax = record.tenureMaxMonths ?? base.maxTenureMonths;
  if (tenureMin <= tenureMax) {
    if (record.tenureMinMonths != null && record.tenureMinMonths !== base.minTenureMonths) {
      merged.minTenureMonths = record.tenureMinMonths;
      fromDesk.push('minTenureMonths');
    }
    if (record.tenureMaxMonths != null && record.tenureMaxMonths !== base.maxTenureMonths) {
      merged.maxTenureMonths = record.tenureMaxMonths;
      fromDesk.push('maxTenureMonths');
    }
  }

  if (record.minSalaryMonthly != null && record.minSalaryMonthly !== base.minSalary) {
    merged.minSalary = record.minSalaryMonthly;
    fromDesk.push('minSalary');
  }

  if (fromDesk.length === 0) return base;
  merged.criteriaFromDeskPolicy = fromDesk;
  return merged;
}

/**
 * The lender database with each personal-loan product's approval criteria set
 * from the desk policy record. Lenders the policy does not cover, and every
 * other loan type, are returned untouched.
 */
export function applyPolicyRules(db: LenderDatabase): LenderDatabase {
  const lenders: Lender[] = db.lenders.map((lender) => {
    const record = policyRuleFor(lender.id);
    const base = lender.products.personal;
    if (!record || !base) return lender;

    const personal = mergeProduct(base, record);
    if (personal === base) return lender;
    return { ...lender, products: { ...lender.products, personal } };
  });

  return { ...db, lenders };
}

/** Which criteria on a product came from the desk record rather than a rate card. */
export function isDeskPolicyCriterion(product: LenderProduct, field: string): boolean {
  return (product as DeskPolicyProduct).criteriaFromDeskPolicy?.includes(field) ?? false;
}

/* ============================================================================
 * Presentation — the rule card a borrower can open on a lender.
 * ==========================================================================*/

export interface PolicyRuleLine {
  label: string;
  value: string;
}

function rupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function years(value: number | null): string | null {
  if (value == null) return null;
  if (value === 1) return '1 year';
  return `${value} years`;
}

function months(value: number | null): string | null {
  if (value == null) return null;
  return value === 1 ? '1 month' : `${value} months`;
}

function range(min: number | null, max: number | null, unit: string): string | null {
  if (min == null && max == null) return null;
  if (min == null) return `Up to ${max} ${unit}`;
  if (max == null) return `From ${min} ${unit}`;
  return `${min}–${max} ${unit}`;
}

function amountRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null) return `Up to ${rupees(max as number)}`;
  if (max == null) return `From ${rupees(min)}`;
  return `${rupees(min)} – ${rupees(max)}`;
}

/** The credit-history rule, spelled out rather than left as 'CIBIL -1'. */
function creditHistoryRule(record: PolicyRuleRecord): string | null {
  const noHistory: string[] = [];
  if (record.cibilMinusOneAccepted === true) {
    noHistory.push(
      record.cibilMinusOneMaxAmount != null
        ? `no credit history considered up to ${rupees(record.cibilMinusOneMaxAmount)}`
        : 'no credit history considered',
    );
  } else if (record.cibilMinusOneAccepted === false) {
    noHistory.push('an applicant with no credit history is not considered');
  }

  if (record.cibilMinScore != null) {
    const tail = noHistory.length > 0 ? `; ${noHistory.join('; ')}` : '';
    return `Minimum CIBIL ${record.cibilMinScore}${tail}`;
  }
  if (noHistory.length === 0) return null;
  const sentence = noHistory.join('; ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

/** What this lender asks for on top of the standard document set. */
function documentsRule(record: PolicyRuleRecord): string | null {
  const parts = [...POLICY_RULE_SOURCE.standardDocuments.slice(0, 1)];
  if (record.bankStatementMonths != null) parts.push(`${record.bankStatementMonths} months' bank statements`);
  parts.push('PAN and Aadhaar');
  if (record.form16Required) parts.push('Form 16');
  return parts.join(', ');
}

/**
 * The lender's approval rules as a borrower reads them. Anything the policy
 * leaves blank is left out entirely rather than shown as a guess.
 */
export function policyRuleLines(record: PolicyRuleRecord): PolicyRuleLine[] {
  const candidates: Array<[string, string | null]> = [
    ['Age', range(record.ageMin, record.ageMax, 'years')],
    ['Loan amount', amountRange(record.loanAmountMin, record.loanAmountMax)],
    ['Minimum salary (₹ a month)', record.minSalaryRule || null],
    ['Tenure', range(record.tenureMinMonths, record.tenureMaxMonths, 'months')],
    ['Time in current job', months(record.presentEmploymentMinMonths)],
    ['Total work experience', years(record.totalEmploymentMinYears)],
    ['Employer', record.companyRule],
    ['FOIR — share of income EMIs may use', record.foirRule],
    ['Credit history', creditHistoryRule(record)],
    ['Lock-in', record.lockingPeriod],
    ['Foreclosure', record.foreclosureRule],
    ['Part payment', record.partPaymentRule],
    ['Top-up', record.topUpRule],
    ['Balance transfers', record.balanceTransferRule],
    ['Rented / bachelor accommodation', record.accommodationRule],
    ['Documents', documentsRule(record)],
  ];

  return candidates
    .filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== '')
    .map(([label, value]) => ({ label, value }));
}

/** How much of the lender database the desk policy record now covers. */
export function policyRuleCoverage(): { withPolicy: number; awaitingRateCard: number; total: number } {
  return {
    withPolicy: POLICY_RULES.filter((record) => record.inLenderDatabase).length,
    awaitingRateCard: POLICY_RULES_AWAITING_RATE_CARD.length,
    total: POLICY_RULES.length,
  };
}
