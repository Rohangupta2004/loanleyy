/**
 * GENERATED FILE — the build-time mirror of data/policy_rules.json.
 *
 * Space compilation bundles TypeScript modules rather than raw JSON, so the
 * personal-loan credit policy records are mirrored here for the app to import,
 * exactly as data/personal-loans-data.ts mirrors data/personal_loans.json.
 * Regenerate this file whenever data/policy_rules.json changes — the two must
 * not drift.
 *
 * WHAT THIS DATA IS: the founder's PersonalLoan_RuleEngine sheet — Loanley's
 * own desk record of how each lender actually approves a personal loan (age
 * band, salary floor by company category, employment vintage, company listing
 * and MCA vintage, Form 16, no-history CIBIL, balance-transfer limits). Lenders
 * publish rate cards, not approval rules, so none of this is on a lender's
 * website and none of it may be shown as a published figure. Anything a
 * borrower sees from here is labelled as Loanley's desk policy.
 *
 * `null` always means the sheet leaves that cell blank — never zero.
 */

export type PolicyEmploymentType = 'salaried' | 'self_employed';

/** One lender's personal-loan credit policy, as the sheet records it. */
export interface PolicyRuleRecord {
  /** Lender name as Loanley shows it. */
  lender: string;
  /** The name exactly as typed in the sheet, kept so a cell can be traced back. */
  sheetLabel: string;
  /** Join key into data/lenders.ts. */
  lenderId: string;
  /** False when the lender has policy rules on file but no rate card scraped yet. */
  inLenderDatabase: boolean;
  salariedPersonalLoan: boolean;
  selfEmployedPersonalLoan: boolean;
  /** Derived from the two flags above; null when the sheet allows neither. */
  employmentTypes: PolicyEmploymentType[] | null;
  ageMin: number | null;
  ageMax: number | null;
  loanAmountMin: number | null;
  /** The LOWEST monthly salary floor in the cell — the most permissive band. */
  minSalaryMonthly: number | null;
  /** The salary cell verbatim, because most lenders vary it by company category. */
  minSalaryRule: string;
  /** How salary must reach the account, e.g. 'NEFT'. */
  salaryCreditMode: string | null;
  salarySlipsRequired: boolean | null;
  /** The bachelor / hostel accommodation cell verbatim. */
  accommodationRule: string;
  bachelorAccommodationAllowed: boolean | null;
  hostelAccommodationAllowed: boolean | null;
  listedCompanyAccepted: boolean | null;
  onlyListedCompanyAccepted: boolean | null;
  nonListedCompanyAccepted: boolean | null;
  /** The 'MCA of Company' cell verbatim ('NA' where the lender does not ask). */
  companyMcaVintage: string | null;
  /** Read as years — the sheet leaves the unit unlabelled. */
  companyMcaVintageYears: number | null;
  presentEmploymentMinMonths: number | null;
  totalEmploymentMinYears: number | null;
  form16Mandatory: boolean | null;
  /** Whether an applicant with no credit history (CIBIL -1 / NH) is considered. */
  cibilMinusOneAccepted: boolean | null;
  cibilMinusOneRule: string;
  /** Ceiling for a no-history applicant, where the sheet caps one. */
  cibilMinusOneMaxAmount: number | null;
  tenureMinMonths: number | null;
  tenureMaxMonths: number | null;
  /** Balance transfers accepted: 0 = not allowed, null = no limit recorded. */
  balanceTransferMaxLoans: number | null;
  balanceTransferRule: string;
  remark: string | null;
}

export interface PolicyRuleSheet {
  name: string;
  description: string;
  source: string;
  sourceType: 'loanley_desk_policy_sheet';
  loanType: 'personal';
  currency: 'INR';
  sheetHeaders: string[];
  lenderCount: number;
}

/** Where these rules came from — quote this, never a lender's page. */
export const POLICY_RULE_SHEET: PolicyRuleSheet = {
  name: "Loanley personal-loan credit policy rules (India)",
  description: "Loanley's desk record of each lender's personal-loan credit policy, taken verbatim from the founder's PersonalLoan_RuleEngine workbook. These are NOT figures the lender publishes on its website: banks and NBFCs publish rate cards, not their approval rules, which is exactly why this sheet exists. Every criterion sourced from here is labelled as desk policy wherever a borrower sees it, so it is never passed off as a published number. `null` means the sheet leaves the cell blank, never zero. 'CIBIL -1' is the Indian bureau code for an applicant with no credit history (-1 / NH), so cibilMinusOneAccepted means the lender will consider a first-time borrower with no score.",
  source: "PersonalLoan_RuleEngine workbook supplied by the founder",
  sourceType: "loanley_desk_policy_sheet",
  loanType: "personal",
  currency: "INR",
  sheetHeaders: ["Banks", "Salaried PL", "Self Employed PL", "Minimum Age", "Maximum Age", "Minimum Loan", "Minimum Salary", "Mode of Salary", "Salary Slips Required", "Bachelor /Hostel Accomodation", "Listed", "Only Listed Company required", "Non-Listed", "MCA of Company", "Present Employment (months)", "Total Employment (Years)", "Form 16 Mandatary", "CIBIL -1", "Minimum Tenor", "Maximum Tenor", "Maximum Bt Loans", "Remark"],
  lenderCount: 19,
};

export const POLICY_RULES: PolicyRuleRecord[] = [
  {"lender": "HDFC Bank", "sheetLabel": "HDFC Bank", "lenderId": "hdfc-bank", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 22, "ageMax": 61, "loanAmountMin": 50000, "minSalaryMonthly": 25000, "minSalaryRule": "Cat A : 25000 ; CAT B: 30000 ; CAT C 35000 , CAT D&E: 50000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "YES (Permanent address verification required)", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": true, "nonListedCompanyAccepted": false, "companyMcaVintage": "NA", "companyMcaVintageYears": null, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": true, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 72, "balanceTransferMaxLoans": 4, "balanceTransferRule": "Up to 4 loans", "remark": "Official email-id mandatary"},
  {"lender": "ICICI Bank", "sheetLabel": "ICICI Bank", "lenderId": "icici", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": true, "employmentTypes": ["salaried", "self_employed"], "ageMin": 22, "ageMax": 61, "loanAmountMin": 100000, "minSalaryMonthly": 30000, "minSalaryRule": "For All Listed : 30000 ; Open Market : 40000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "YES", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 2, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 72, "balanceTransferMaxLoans": 5, "balanceTransferRule": "Up to 5 loans", "remark": "FOIR 5 % additonal for owned house"},
  {"lender": "Axis Bank", "sheetLabel": "Axis bank", "lenderId": "axis", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 25000, "minSalaryRule": "SUPER CAT A & Cat A : 25000 ; CAT  B and CAT C : 35000 ; CAT D : 60000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": true, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 3, "balanceTransferRule": "Up to 3 loans", "remark": "For Nth >40k, FOIR 80%. LIC agents and Doctors can also avail PL upto 40 lacs"},
  {"lender": "Yes Bank", "sheetLabel": "YES Bank", "lenderId": "yes-bank", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 50000, "minSalaryMonthly": 28000, "minSalaryRule": "28000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "Bachelor : Yes Yes ( CIBIL 725 & Sal > 35K); Hostel accomodation :NO", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "5", "companyMcaVintageYears": 5, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 0.5, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 5, "balanceTransferRule": "Up to 5 loans", "remark": "Doctor profiles based on certificate can do, CIBIL -1 and less than 700 FOIR is 50%, rental income can be considered"},
  {"lender": "IDFC FIRST Bank", "sheetLabel": "IDFC First Bank", "lenderId": "idfc-first", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": true, "employmentTypes": ["salaried", "self_employed"], "ageMin": 23, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 20000, "minSalaryRule": "20000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "YES", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "3", "companyMcaVintageYears": 3, "presentEmploymentMinMonths": 3, "totalEmploymentMinYears": 2, "form16Mandatory": false, "cibilMinusOneAccepted": false, "cibilMinusOneRule": "NO", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 3, "balanceTransferRule": "Up to 3 loans", "remark": "Lock-in 1 year"},
  {"lender": "Kotak Mahindra Bank", "sheetLabel": "Kotak", "lenderId": "kotak", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 30000, "minSalaryRule": "30000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "Bachelor : YES Hostel NO", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": true, "nonListedCompanyAccepted": false, "companyMcaVintage": "NA", "companyMcaVintageYears": null, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 3, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES (Max 5 lacs)", "cibilMinusOneMaxAmount": 500000, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 4, "balanceTransferRule": "Up to 4 loans", "remark": "Lock-in 1 year, 70% of rental income considered if credited, 50% of Yearly Bonus ; HL EMI will not be obligated if it is in spouse name, provided spouse income documents are provided."},
  {"lender": "IndusInd Bank", "sheetLabel": "IndusInd Bank", "lenderId": "indusind", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 58, "loanAmountMin": 100000, "minSalaryMonthly": 25000, "minSalaryRule": "Listed:25K;OpenMarket:30K", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 2, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 72, "balanceTransferMaxLoans": 5, "balanceTransferRule": "Up to 5 loans", "remark": "FOIR 5 % additonal for owned house, address proof not required for online process"},
  {"lender": "Bandhan Bank", "sheetLabel": "Bankdhan Bank", "lenderId": "bandhan-bank", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 25000, "minSalaryRule": "Govt, CAT A & CAT B (25K) : CAT C 30K: CAT D 40K", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "Bachelor : YES (OHP required) ; Hostel NO", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "5", "companyMcaVintageYears": 5, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES (For CAT A up to 5 lakh; Remaining 3 lakh)", "cibilMinusOneMaxAmount": 300000, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 0, "balanceTransferRule": "Not allowed", "remark": "Rental considered. CIBIL -1 max 5 Lacs"},
  {"lender": "Aditya Birla Finance", "sheetLabel": "Aditya Birla", "lenderId": "aditya-birla-finance", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 23, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 20000, "minSalaryRule": "20000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "Bachelor : YES for CAT A and CAT B ; Hostel NO", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "3", "companyMcaVintageYears": 3, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 3, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES (Max 5 lacs)", "cibilMinusOneMaxAmount": 500000, "tenureMinMonths": 24, "tenureMaxMonths": 84, "balanceTransferMaxLoans": 7, "balanceTransferRule": "Up to 7 loans", "remark": "Employees of Proprietorship , Partnerships & LLP companies can also apply  ; Banking Surrogate : Loan upto 5 lacs can be provided just based on Bank statements with ABB 1.10 ; RTR Product for PL also available ; ABB not required for salary upto 35k if PL HIT SCORE > = 589."},
  {"lender": "Axis Finance", "sheetLabel": "Axis Finance", "lenderId": "axis-finance", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 25, "ageMax": 60, "loanAmountMin": 200000, "minSalaryMonthly": 30000, "minSalaryRule": "30000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "Bachelor : YES for CAT A and CAT B ; Hostel NO", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "3", "companyMcaVintageYears": 3, "presentEmploymentMinMonths": 12, "totalEmploymentMinYears": 3, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES (Max 5 lacs)", "cibilMinusOneMaxAmount": 500000, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 8, "balanceTransferRule": "Up to 8 loans", "remark": "Other sources of income such as Rental Income, Bonus or any other income reflecting considered, All types of BTs allowed such as (CC, PL, Drop line, CD, Jumbo loans, Insta loans, APP loans , AL & GL)"},
  {"lender": "Tata Capital", "sheetLabel": "TATA CAPITAL", "lenderId": "tata-capital", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 22, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 20000, "minSalaryRule": "Super A ,CAT A :20K ;; CAT B & Govt : 25K", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "YES (OHV)", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": true, "nonListedCompanyAccepted": false, "companyMcaVintage": "NA", "companyMcaVintageYears": null, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES (Max 3 lacs)", "cibilMinusOneMaxAmount": 300000, "tenureMinMonths": 24, "tenureMaxMonths": 72, "balanceTransferMaxLoans": 5, "balanceTransferRule": "Up to 5 loans", "remark": "PL-OD is allowed, can Do applicant & Co-applicant."},
  {"lender": "InCred Finance", "sheetLabel": "INCRED", "lenderId": "incred", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": true, "employmentTypes": ["salaried", "self_employed"], "ageMin": 21, "ageMax": 56, "loanAmountMin": 50000, "minSalaryMonthly": 15000, "minSalaryRule": "15000", "salaryCreditMode": "NEFT", "salarySlipsRequired": false, "accommodationRule": "YES", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 3, "totalEmploymentMinYears": 1, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 24, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 3, "balanceTransferRule": "Up to 3 loans", "remark": "Allowed for Zero deduction Employees ; Allowed funding for Proprietor ship, Partnership, LLP, Pvt Ltd, Public Ltd & Govt (class 4) Employees"},
  {"lender": "Finnable", "sheetLabel": "Finnable", "lenderId": "finnable", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 58, "loanAmountMin": 50000, "minSalaryMonthly": 20000, "minSalaryRule": "20000", "salaryCreditMode": "NEFT", "salarySlipsRequired": false, "accommodationRule": "YES", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "0", "companyMcaVintageYears": 0, "presentEmploymentMinMonths": 3, "totalEmploymentMinYears": 2, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 36, "tenureMaxMonths": 60, "balanceTransferMaxLoans": null, "balanceTransferRule": "No published limit", "remark": "PF and PT is not mandate, Address proof not required."},
  {"lender": "Piramal Finance", "sheetLabel": "Piramal", "lenderId": "piramal-finance", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 28000, "minSalaryRule": "28000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 6, "totalEmploymentMinYears": 3, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 0, "balanceTransferRule": "Not allowed", "remark": "Employees of partnership & proprietorship allowed for max 5 lacs with OHP"},
  {"lender": "SMFG India Credit", "sheetLabel": "SMFG", "lenderId": "smfg-india-credit", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 20000, "minSalaryRule": "20000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 2, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES (Max 5 lacs)", "cibilMinusOneMaxAmount": 500000, "tenureMinMonths": 24, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 7, "balanceTransferRule": "Up to 7 loans", "remark": "Lock-in 9 months ; will do propriator and partnership, LLP profiles, sal req 25k; max loan amount 7.5L ; MCA registration 1 month companies also will do."},
  {"lender": "Bajaj Finserv (Bajaj Finance)", "sheetLabel": "Bajaj", "lenderId": "bajaj-finserv", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 23, "ageMax": 55, "loanAmountMin": 100000, "minSalaryMonthly": 36000, "minSalaryRule": "36000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "2", "companyMcaVintageYears": 2, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 3, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES for Listed Companies", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 36, "tenureMaxMonths": 72, "balanceTransferMaxLoans": 4, "balanceTransferRule": "Up to 4 loans", "remark": null},
  {"lender": "Cholamandalam Investment & Finance", "sheetLabel": "Chola", "lenderId": "cholamandalam", "inLenderDatabase": false, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": true, "employmentTypes": ["salaried", "self_employed"], "ageMin": 24, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 25000, "minSalaryRule": "25000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": false, "nonListedCompanyAccepted": true, "companyMcaVintage": "1", "companyMcaVintageYears": 1, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": false, "cibilMinusOneAccepted": false, "cibilMinusOneRule": "NO", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 24, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 0, "balanceTransferRule": "Not allowed", "remark": null},
  {"lender": "Poonawalla Fincorp", "sheetLabel": "Poonawala", "lenderId": "poonawalla-fincorp", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 24, "ageMax": 58, "loanAmountMin": 100000, "minSalaryMonthly": 30000, "minSalaryRule": "30000", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "YES", "bachelorAccommodationAllowed": true, "hostelAccommodationAllowed": null, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": true, "nonListedCompanyAccepted": false, "companyMcaVintage": "NA", "companyMcaVintageYears": null, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": false, "cibilMinusOneAccepted": false, "cibilMinusOneRule": "NO", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 60, "balanceTransferMaxLoans": 3, "balanceTransferRule": "Up to 3 loans", "remark": "Official email-id mandatary"},
  {"lender": "L&T Finance", "sheetLabel": "L&T", "lenderId": "lt-finance", "inLenderDatabase": true, "salariedPersonalLoan": true, "selfEmployedPersonalLoan": false, "employmentTypes": ["salaried"], "ageMin": 21, "ageMax": 60, "loanAmountMin": 100000, "minSalaryMonthly": 25000, "minSalaryRule": "35000 for Age > 30 ; 25000 for Age < 30", "salaryCreditMode": "NEFT", "salarySlipsRequired": true, "accommodationRule": "NO", "bachelorAccommodationAllowed": false, "hostelAccommodationAllowed": false, "listedCompanyAccepted": true, "onlyListedCompanyAccepted": true, "nonListedCompanyAccepted": false, "companyMcaVintage": "NA", "companyMcaVintageYears": null, "presentEmploymentMinMonths": 1, "totalEmploymentMinYears": 1, "form16Mandatory": false, "cibilMinusOneAccepted": true, "cibilMinusOneRule": "YES", "cibilMinusOneMaxAmount": null, "tenureMinMonths": 12, "tenureMaxMonths": 72, "balanceTransferMaxLoans": null, "balanceTransferRule": "No published limit", "remark": "Rental considered"},
];

/** Lenders whose policy rules are on file and whose rate card is still to be scraped. */
export const POLICY_RULES_AWAITING_RATE_CARD: PolicyRuleRecord[] = POLICY_RULES.filter(
  (record) => !record.inLenderDatabase,
);

const BY_LENDER_ID: Map<string, PolicyRuleRecord> = new Map(
  POLICY_RULES.map((record) => [record.lenderId, record]),
);

/** The credit policy on file for a lender, if the sheet covers it. */
export function policyRuleFor(lenderId: string): PolicyRuleRecord | undefined {
  return BY_LENDER_ID.get(lenderId);
}

/** The dataset as the founder's sheet, for the download link. */
export function policyRulesJson(): string {
  return `${JSON.stringify({ ...POLICY_RULE_SHEET, lenders: POLICY_RULES }, null, 2)}\n`;
}
