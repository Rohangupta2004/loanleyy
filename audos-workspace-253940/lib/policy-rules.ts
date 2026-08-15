/**
 * policy-rules — layers Loanley's desk credit policy over the lender database.
 *
 * data/policy_rules.json (mirrored for the bundle in data/policy-rules-data.ts)
 * is the founder's PersonalLoan_RuleEngine sheet: how each lender actually
 * approves a personal loan. It exists because a lender publishes a rate card
 * and almost never its approval rules — which is why so many rows in
 * data/personal_loans.json carry `unpublishedFields` for exactly the criteria a
 * borrower's answer turns on (age band, salary floor, employment vintage,
 * company type, no-history CIBIL, balance transfers).
 *
 * Two rules this module exists to enforce:
 *  1. A desk-policy criterion is NEVER presented as a published one. Every
 *     field this layer sets is named in the product's `criteriaFromDeskPolicy`,
 *     and lib/lender-compare.ts reads that list to say where the rule came from
 *     in the reason a borrower is shown.
 *  2. It binds only where the sheet actually records a figure, and never leaves
 *     an incoherent product behind — a desk minimum above the lender's own
 *     maximum is dropped rather than applied, so no borrower is refused by an
 *     inverted range.
 *
 * A desk figure that matches what the lender already publishes changes nothing
 * and is NOT marked as desk-sourced: the published page corroborates it, so the
 * borrower should be pointed at the stronger of the two sources.
 *
 * Ranking is untouched: this layer sets no rate and no fee, so it cannot move a
 * lender up or down the list. It only changes who qualifies, and says why.
 */
import { POLICY_RULES, POLICY_RULES_AWAITING_RATE_CARD, POLICY_RULE_SHEET, policyRuleFor } from '../data/policy-rules-data';
import type { PolicyRuleRecord } from '../data/policy-rules-data';
import type { Lender, LenderDatabase, LenderProduct } from '../data/lenders';

export { POLICY_RULES, POLICY_RULES_AWAITING_RATE_CARD, POLICY_RULE_SHEET, policyRuleFor };
export type { PolicyRuleRecord };

/** How a desk-policy criterion must be described wherever a borrower sees it. */
export const DESK_POLICY_LABEL = "Loanley's desk credit-policy record";

/** The caveat that belongs on any screen showing these rules. */
export const DESK_POLICY_CAVEAT =
  "These approval rules come from Loanley's own desk record of each lender's credit policy, not from the lender's website — lenders publish rate cards, not their approval rules. Rates, fees and costs on this screen are still the lender's own published figures.";

/**
 * Layer one lender's desk policy over its published personal-loan product.
 * Only the criteria the sheet records are touched, and each one is named so the
 * comparison engine can attribute it.
 */
function mergeProduct(base: LenderProduct, record: PolicyRuleRecord): LenderProduct {
  const merged: LenderProduct = { ...base };
  const fromDesk: string[] = [];

  if (record.employmentTypes && record.employmentTypes.length > 0) {
    const desk = [...record.employmentTypes].sort().join('+');
    if (desk !== [...base.employmentTypes].sort().join('+')) {
      merged.employmentTypes = [...record.employmentTypes];
      fromDesk.push('employmentTypes');
    }
  }

  // A desk minimum above the lender's own published maximum would refuse every
  // borrower for a reason the lender never set. Drop it instead.
  if (
    record.loanAmountMin != null &&
    record.loanAmountMin !== base.minLoanAmount &&
    record.loanAmountMin <= base.maxLoanAmount
  ) {
    merged.minLoanAmount = record.loanAmountMin;
    fromDesk.push('minLoanAmount');
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
 * from the desk policy sheet. Lenders the sheet does not cover, and every other
 * loan type, are returned untouched.
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

/** Which criteria on a product came from the desk sheet rather than a rate card. */
export function isDeskPolicyCriterion(product: LenderProduct, field: string): boolean {
  return product.criteriaFromDeskPolicy?.includes(field) ?? false;
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

function yesNo(value: boolean | null, yes = 'Yes', no = 'No'): string | null {
  if (value == null) return null;
  return value ? yes : no;
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

/** What kind of employer the lender will fund, in one line. */
function companyRule(record: PolicyRuleRecord): string | null {
  if (record.onlyListedCompanyAccepted === true) return 'Listed companies only';
  if (record.nonListedCompanyAccepted === true) return 'Listed and non-listed companies';
  if (record.listedCompanyAccepted === true) return 'Listed companies';
  return null;
}

/** The no-credit-history rule, spelled out rather than left as 'CIBIL -1'. */
function noHistoryRule(record: PolicyRuleRecord): string | null {
  if (record.cibilMinusOneAccepted == null) return null;
  if (!record.cibilMinusOneAccepted) return 'Not considered';
  if (record.cibilMinusOneMaxAmount != null) {
    return `Considered, up to ${rupees(record.cibilMinusOneMaxAmount)}`;
  }
  return `Considered — ${record.cibilMinusOneRule}`;
}

/**
 * The lender's approval rules as a borrower reads them. Blank cells are left
 * out entirely rather than shown as a guess.
 */
export function policyRuleLines(record: PolicyRuleRecord): PolicyRuleLine[] {
  const candidates: Array<[string, string | null]> = [
    ['Age', record.ageMin != null && record.ageMax != null ? `${record.ageMin}–${record.ageMax} years` : null],
    ['Minimum loan', record.loanAmountMin != null ? rupees(record.loanAmountMin) : null],
    ['Minimum salary', record.minSalaryRule || null],
    ['Salary must be credited by', record.salaryCreditMode],
    ['Salary slips', yesNo(record.salarySlipsRequired, 'Required', 'Not required')],
    [
      'Tenure',
      record.tenureMinMonths != null && record.tenureMaxMonths != null
        ? `${record.tenureMinMonths}–${record.tenureMaxMonths} months`
        : null,
    ],
    ['Time in current job', months(record.presentEmploymentMinMonths)],
    ['Total work experience', years(record.totalEmploymentMinYears)],
    ['Employer', companyRule(record)],
    ['Employer registered (MCA)', record.companyMcaVintageYears != null ? years(record.companyMcaVintageYears) : null],
    ['Form 16', yesNo(record.form16Mandatory, 'Mandatory', 'Not mandatory')],
    ['No credit history (CIBIL -1)', noHistoryRule(record)],
    ['Balance transfers', record.balanceTransferRule || null],
    ['Rented / bachelor accommodation', record.accommodationRule || null],
  ];

  return candidates
    .filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== '')
    .map(([label, value]) => ({ label, value }));
}

/** How much of the lender database the desk sheet now covers. */
export function policyRuleCoverage(): { withPolicy: number; awaitingRateCard: number; total: number } {
  return {
    withPolicy: POLICY_RULES.filter((record) => record.inLenderDatabase).length,
    awaitingRateCard: POLICY_RULES_AWAITING_RATE_CARD.length,
    total: POLICY_RULES.length,
  };
}
