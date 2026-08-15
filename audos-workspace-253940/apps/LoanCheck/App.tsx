/**
 * Loan Check — Loanley's self-contained loan advisory chat (India, ₹).
 *
 * The chat IS the product. A borrower types what they need in plain language
 * (English or Hinglish); the chat detects loan-seeking intent, collects the
 * six criteria it needs — loan type, amount, tenure, employment, monthly
 * income, CIBIL range — and answers INLINE in the thread.
 *
 * Three deliberate constraints hold this file together:
 *  1. Intent → collection is never skipped. If any of the six fields is
 *     missing the chat asks for it; it never falls silent and never produces
 *     a partial result. Anything the borrower already said is pre-filled and
 *     never re-asked.
 *  2. Nothing here navigates anywhere. No links to other Loanley apps, no
 *     "Apply Now", no CTAs. The only outbound links are plain-text citations
 *     to each lender's own official rate card.
 *  3. Eligibility filters BEFORE ranking. Lenders whose published minimum
 *     income or minimum CIBIL the borrower does not meet are pulled out of
 *     the ranking into "Likely out of reach for your profile" with the plain
 *     reason, so the #1 recommendation is always a lender the borrower has a
 *     realistic shot at — ranked by effective cost (EMI + processing fee).
 *
 * All maths is deterministic (lib/lender-compare.ts over data/lenders.ts, with
 * the weekly refresh's live rate overrides layered on via
 * lib/lender-rates-live.ts); offer checks run server-side via the loan-math
 * hook. Nothing is estimated.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Download, Info, Loader2, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import {
  LoanleyResultCard,
  RupeeAmount,
  ZeroCommissionStrip,
  formatINR,
  shortLenderName,
} from '../../components/LoanleyCards';
import {
  CREDIT_BAND_LABELS,
  LENDER_TYPE_LABELS,
  LOAN_TYPE_LABELS,
  compareLenders,
} from '../../lib/lender-compare';
import type { BorrowerRequirements, ComparisonResult, ComparisonRow, CreditBand } from '../../lib/lender-compare';
import { useLiveLenderDb } from '../../lib/lender-rates-live';
import {
  DESK_POLICY_CAVEAT,
  POLICY_RULES_AWAITING_RATE_CARD,
  policyRuleFor,
  policyRuleLines,
} from '../../lib/policy-rules';
import { PERSONAL_LOANS, personalLoansJson } from '../../data/personal-loans-data';
import { RBI_BENCHMARK_RANGES, RBI_MASTER_DIRECTIONS_URL } from '../../lib/loan-benchmarks';
import { LENDER_DB } from '../../data/lenders';
import type { EmploymentType, LoanProductType } from '../../data/lenders';

const LOAN_MATH_ENDPOINT = '/api/hooks/execute/workspace-253940/loan-math';

/**
 * The neutral personal-loan source dataset behind the ranking:
 * data/personal_loans.json — 20 lenders' published rates, fees and eligibility,
 * every value read off that lender's own official page. The ranking is
 * computed from these records (lib/personal-loan-source.ts) and the download
 * below hands over the same array, so the file a borrower audits is the file
 * the answer came from.
 */

/** Filename the browser saves the source dataset under. */
const PL_DATA_FILENAME = 'personal_loans.json';

const TRUST_HEADER =
  'No lender has paid for placement. Ranked by effective cost for your profile. Rates sourced from official lender rate cards.';

/* ============================================================================
 * 1. Thread model
 * ==========================================================================*/

interface QuickReply {
  label: string;
  value: string;
}

interface UserItem {
  id: string;
  role: 'user';
  text: string;
}
interface BotTextItem {
  id: string;
  role: 'bot';
  kind: 'text';
  text: string;
  quickReplies?: QuickReply[];
  source?: { label: string; href: string };
}
interface BotResultItem {
  id: string;
  role: 'bot';
  kind: 'result';
  result: ComparisonResult;
}
interface BotOfferItem {
  id: string;
  role: 'bot';
  kind: 'offer';
  cardJson: string;
}
type ThreadItem = UserItem | BotTextItem | BotResultItem | BotOfferItem;

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

const userSays = (text: string): UserItem => ({ id: nextId(), role: 'user', text });
const bot = (text: string, quickReplies?: QuickReply[], source?: { label: string; href: string }): BotTextItem => ({
  id: nextId(),
  role: 'bot',
  kind: 'text',
  text,
  quickReplies,
  source,
});

/* ============================================================================
 * 2. The six required criteria
 * ==========================================================================*/

interface Profile {
  loanType: LoanProductType;
  amount: number;
  tenureMonths: number;
  employment: EmploymentType;
  monthlyIncome: number;
  creditBand: CreditBand;
}
type FieldKey = keyof Profile;

const FIELD_ORDER: FieldKey[] = [
  'loanType',
  'amount',
  'tenureMonths',
  'employment',
  'monthlyIncome',
  'creditBand',
];

const FIELD_LABELS: Record<FieldKey, string> = {
  loanType: 'loan type',
  amount: 'loan amount',
  tenureMonths: 'tenure',
  employment: 'employment type',
  monthlyIncome: 'monthly income',
  creditBand: 'CIBIL range',
};

/* ============================================================================
 * 3. Plain-language parsing (English + Hinglish)
 * ==========================================================================*/

const MONEY_UNITS: Record<string, number> = {
  k: 1000,
  thousand: 1000,
  l: 100000,
  lakh: 100000,
  lakhs: 100000,
  lac: 100000,
  lacs: 100000,
  cr: 10000000,
  crore: 10000000,
  crores: 10000000,
};

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/,(?=\d)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Any money-ish token: "3l", "₹5 lakh", "40k", "300000". */
function parseMoney(text: string): number | null {
  const t = normalize(text);
  const withUnit = t.match(
    /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(thousand|lakhs?|lacs?|crores?|cr|k|l)\b/,
  );
  if (withUnit) {
    const n = parseFloat(withUnit[1]) * (MONEY_UNITS[withUnit[2]] ?? 1);
    if (n > 0) return Math.round(n);
  }
  const withSymbol = t.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/);
  if (withSymbol) return Math.round(parseFloat(withSymbol[1]));
  const bare = t.match(/\b(\d{4,9})\b/);
  if (bare) return parseInt(bare[1], 10);
  return null;
}

function bandFromScore(score: number): CreditBand {
  if (score < 650) return 'below_650';
  if (score < 700) return '650_700';
  if (score < 750) return '700_750';
  return '750_plus';
}

function detectLoanType(text: string): LoanProductType | null {
  const t = normalize(text);
  if (/\b(home|house|ghar|flat|apartment|makaan|housing)\b/.test(t)) return 'home';
  if (/\b(education|study|student|studies|padhai|college|university|abroad|tuition)\b/.test(t)) return 'education';
  if (/\b(business|vyapar|dukaan|shop|msme|working capital|udyam)\b/.test(t)) return 'business';
  if (/\b(property|lap|mortgage|against property)\b/.test(t)) return 'loan_against_property';
  if (/\bpersonal\b/.test(t)) return 'personal';
  return null;
}

function detectEmployment(text: string): EmploymentType | null {
  const t = normalize(text);
  if (/self[\s-]?employ|business owner|own business|freelanc|businessman|self employed|apna business|shopkeeper|consultant|proprietor/.test(t))
    return 'self_employed';
  if (/salaried|salary|monthly pay|job\b|naukri|employee|payslip|service class/.test(t)) return 'salaried';
  return null;
}

function detectCreditBand(text: string): CreditBand | null {
  const t = normalize(text);
  if (/(don'?t know|do not know|not sure|no idea|dunno|nahi pata|never checked|unknown|haven'?t checked)/.test(t))
    return 'unknown';
  if (/below\s*650|less than 650|under 650|<\s*650/.test(t)) return 'below_650';
  const range = t.match(/(\d{3})\s*(?:-|to)\s*(\d{3})/);
  if (range) return bandFromScore(parseInt(range[1], 10));
  const plus = t.match(/(\d{3})\s*\+/);
  if (plus) return bandFromScore(parseInt(plus[1], 10));
  const single = t.match(/\b(\d{3})\b/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (n >= 300 && n <= 900) return bandFromScore(n);
  }
  return null;
}

/** Interest rate as a percentage — "14%", "14 percent", "rate of 14". */
function detectRatePct(text: string): number | null {
  const t = normalize(text);
  const pct = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent|per cent|pct)/);
  if (pct) return parseFloat(pct[1]);
  const worded = t.match(/(?:rate|interest|roi)\s*(?:is|of|:|=|at)?\s*(\d{1,2}(?:\.\d+)?)\b/);
  if (worded) return parseFloat(worded[1]);
  return null;
}

/**
 * Harvest whatever the borrower already told us so we never re-ask for it.
 * Numeric fields are consumed left-to-right (CIBIL, then income, then tenure,
 * then amount) so "salary ₹20,000" is never mistaken for the loan amount.
 */
function extractCriteria(raw: string): Partial<Profile> {
  const original = normalize(raw);
  let t = original;
  const out: Partial<Profile> = {};

  const type = detectLoanType(original);
  if (type) out.loanType = type;
  const employment = detectEmployment(original);
  if (employment) out.employment = employment;

  const cibil =
    t.match(/(?:cibil|credit\s*score|score)[^0-9]{0,15}(\d{3})\s*(?:-|to)\s*(\d{3})/) ||
    t.match(/(?:cibil|credit\s*score|score)[^0-9]{0,15}(\d{3})\s*\+/) ||
    t.match(/(?:cibil|credit\s*score|score)[^0-9]{0,15}(\d{3})/);
  if (cibil) {
    out.creditBand = bandFromScore(parseInt(cibil[1], 10));
    t = t.replace(cibil[0], ' ');
  } else if (/(?:cibil|credit\s*score)[^.]{0,25}(?:don'?t know|not sure|no idea|nahi pata|never checked)/.test(t)) {
    out.creditBand = 'unknown';
  }

  const income =
    t.match(
      /(?:salary|income|earnings?|earn|take[\s-]?home|in[\s-]?hand)\s*(?:is|of|:|=|per month|monthly)?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(thousand|lakhs?|lacs?|k|l)?\b/,
    ) ||
    t.match(
      /(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(thousand|lakhs?|lacs?|k|l)?\s*(?:per month|monthly|pm|a month|\/month)?\s*(?:salary|income)/,
    );
  if (income) {
    const n = parseFloat(income[1]) * (income[2] ? MONEY_UNITS[income[2]] ?? 1 : 1);
    if (n > 0) {
      out.monthlyIncome = Math.round(n);
      t = t.replace(income[0], ' ');
    }
  }

  const tenure = t.match(/(\d+(?:\.\d+)?)\s*(months?|mos?|years?|yrs?|yr|saal|sal)\b/);
  if (tenure) {
    const n = parseFloat(tenure[1]);
    const months = /^(y|s)/.test(tenure[2]) ? Math.round(n * 12) : Math.round(n);
    if (months >= 3 && months <= 480) out.tenureMonths = months;
    t = t.replace(tenure[0], ' ');
  } else {
    const worded = t.match(/(?:tenure|term|repay(?:ment)?(?: over| in)?)\D{0,10}(\d{1,3})\b/);
    if (worded) {
      const months = parseInt(worded[1], 10);
      if (months >= 3 && months <= 480) {
        out.tenureMonths = months;
        t = t.replace(worded[0], ' ');
      }
    }
  }

  // Only read an amount when the sentence actually talks about borrowing —
  // a naked number in a reply belongs to the question being answered.
  const amountCue = /(₹|rs\.?|inr|lakh|lakhs|lac|lacs|crore|crores|\bcr\b|\d\s*l\b|\d\s*k\b|\bloan\b|\bamount\b|\bborrow\b|\bneed\b|\bwant\b|\bchahiye\b|\bchaiye\b)/;
  if (amountCue.test(t)) {
    const amt = parseMoney(t);
    if (amt != null && amt >= 10000) out.amount = amt;
  }

  return out;
}

/** Field-specific parse for a direct answer to the question just asked. */
function parseAnswer(field: FieldKey, raw: string): Partial<Profile> {
  const t = normalize(raw);
  switch (field) {
    case 'loanType': {
      const v = detectLoanType(t);
      return v ? { loanType: v } : {};
    }
    case 'amount': {
      const v = parseMoney(t);
      return v != null && v >= 10000 ? { amount: v } : {};
    }
    case 'tenureMonths': {
      const unit = t.match(/(\d+(?:\.\d+)?)\s*(months?|mos?|years?|yrs?|yr|saal|sal)\b/);
      if (unit) {
        const n = parseFloat(unit[1]);
        const months = /^(y|s)/.test(unit[2]) ? Math.round(n * 12) : Math.round(n);
        return months >= 3 && months <= 480 ? { tenureMonths: months } : {};
      }
      const bare = t.match(/\b(\d{1,3})\b/);
      if (bare) {
        const months = parseInt(bare[1], 10);
        if (months >= 3 && months <= 480) return { tenureMonths: months };
      }
      return {};
    }
    case 'employment': {
      const v = detectEmployment(t);
      return v ? { employment: v } : {};
    }
    case 'monthlyIncome': {
      const v = parseMoney(t);
      return v != null && v > 0 ? { monthlyIncome: v } : {};
    }
    case 'creditBand': {
      const v = detectCreditBand(t);
      return v ? { creditBand: v } : {};
    }
    default:
      return {};
  }
}

/* ============================================================================
 * 4. Intent detection
 * ==========================================================================*/

const SEEK_PATTERNS: RegExp[] = [
  /\b(want|need|require|looking for|searching for|take|get|chahta|chahti)\b[^.?!]{0,45}\b(loan|loans|karza|karz|udhaar|udhar|funding|finance)\b/,
  /\b(loan|karza|udhaar|paisa|paise)\b[^.?!]{0,30}\b(chahiye|chaahiye|chaiye|chahie|lena hai|leni hai|lena h|lena|milega|milegi|mil sakta)\b/,
  /\b(chahiye|chaahiye|chaiye|lena hai|leni hai)\b/,
  /\b(best|cheapest|lowest|sasta|sabse sasta|top|good|right|suitable)\b[^.?!]{0,45}\b(loan|loans|lender|lenders|bank|banks|offer|offers|rate|rates|deal|deals|option|options)\b/,
  /\b(loan|loans)\b[^.?!]{0,30}\b(offers?|options?|deals?|for me|ke liye)\b/,
  /\b(suggest|recommend|find|show|compare|dikhao|batao|bata do)\b[^.?!]{0,45}\b(loan|loans|lender|lenders|offer|offers|option|options|bank|banks|rate|rates)\b/,
  /\bshow me\b[^.?!]{0,25}\b(offers?|options?|rates?)\b/,
  /\bcompare\b[^.?!]{0,30}\b(loans?|lenders?|offers?|banks?|rates?)\b/,
  /\bwhich\b[^.?!]{0,25}\b(bank|lender|nbfc)s?\b/,
  /\b(eligible|eligibility|qualify|qualifies|approval chances)\b/,
  /\bapply(ing)?\b[^.?!]{0,25}\b(loan|loans)\b/,
  /\b(karza|udhaar|udhar)\b/,
  /\bhow much\b[^.?!]{0,25}\b(can i borrow|loan|will i get)\b/,
];

function detectLoanIntent(text: string): boolean {
  const t = normalize(text);
  if (t.length < 3) return false;
  return SEEK_PATTERNS.some((re) => re.test(t));
}

function isDefinitionQuestion(text: string): boolean {
  const t = normalize(text);
  return /^(what|whats|what's|explain|how|why|when|define|meaning|difference|is there|kya|kaise)\b/.test(t) || /\bwhat is\b|\bwhat does\b|\bmeaning of\b/.test(t);
}

/* ============================================================================
 * 5. Concept answers — plain questions get a plain answer, not a form.
 * ==========================================================================*/

const RBI_SOURCE = { label: 'RBI Master Direction — Interest Rate on Advances', href: RBI_MASTER_DIRECTIONS_URL };

interface FaqEntry {
  test: RegExp;
  answer: string;
  source?: { label: string; href: string };
}

const FAQ: FaqEntry[] = [
  {
    test: /processing fee|processing charge|pf charge/,
    answer:
      'A processing fee is a one-time charge the lender deducts (or adds) when your loan is sanctioned — usually 0.5%–3.5% of the amount, plus GST, sometimes capped at a flat figure.\n\nIt matters more than most people think: because it comes off the money you actually receive, a "cheap" 10.5% loan with a 3.5% fee can cost you more than an 11.5% loan with a 0.5% fee. That is why every ranking here is by effective cost (EMI plus fee), not by the advertised rate.',
  },
  {
    test: /\bemi\b|equated monthly|monthly instal/,
    answer:
      'EMI is the fixed amount you pay every month — part interest, part principal — calculated on a reducing balance. Early EMIs are mostly interest; later ones are mostly principal.\n\nA longer tenure lowers the EMI but raises the total interest you pay. A shorter tenure does the opposite. I show both numbers so the trade-off is visible.',
  },
  {
    test: /cibil|credit score|credit report|credit history/,
    answer:
      'CIBIL is a 300–900 credit score. Most Indian lenders publish a minimum: roughly 650 at the more flexible NBFCs and public sector banks, 700+ at most private banks, and the lowest advertised rates usually need 750+.\n\nThis is exactly why I ask for your range instead of assuming it. Ranking a lender at #1 that your score rules out is not a recommendation, it is a rejection waiting to happen.',
  },
  {
    test: /foreclos|prepay|pre-pay|part payment|part-payment|close early|preclos/,
    answer:
      'Foreclosure means closing the loan early in full; part-prepayment means paying a lump sum against the principal. Both cut your total interest, but lenders may charge a penalty — typically 0%–5% of the outstanding principal, and often nil after a set number of EMIs.\n\nFloating-rate loans to individual borrowers generally cannot carry foreclosure charges under RBI rules. Always check the Key Facts Statement for the exact clause before you sign.',
    source: RBI_SOURCE,
  },
  {
    test: /fixed vs floating|floating vs fixed|fixed or floating|floating rate|fixed rate|eblr|repo linked|repo-linked/,
    answer:
      'A fixed rate stays the same for the agreed period. A floating rate moves with an external benchmark — for retail loans at banks this is usually the RBI repo rate (EBLR), which RBI mandates as the benchmark.\n\nWhen the repo rate falls your floating EMI or tenure falls with it; when it rises, it rises. Fixed rates are usually priced a little higher for that certainty.',
    source: RBI_SOURCE,
  },
  {
    test: /effective cost|effective rate|all-in cost|apr|annual percentage|real cost/,
    answer:
      'Effective cost is the true annual cost of the loan once the processing fee is taken into account. I compute it as the internal rate of return on what you actually receive (loan amount minus fee) against the EMIs you actually pay.\n\nIt is the only number that lets you compare two offers fairly, which is why every lender here is ranked by it rather than by the headline rate.',
  },
  {
    test: /key facts|kfs|fact statement|sanction letter/,
    answer:
      'The Key Facts Statement is the standardised one-page summary every regulated lender in India must give you before you sign: the all-in annualised rate, every fee, the recovery and grievance contacts, and the prepayment terms.\n\nIf a lender will not hand you one, treat that as the answer.',
    source: RBI_SOURCE,
  },
  {
    test: /repo rate|policy rate|rbi rate/,
    answer: `The repo rate is the rate at which RBI lends to banks — currently ${LENDER_DB.rateContext.rbiRepoRatePct}% as of ${LENDER_DB.rateContext.asOf}. Most floating retail loans at banks are benchmarked to it, so it sets the floor under what you will be quoted.`,
    source: { label: 'RBI policy statement', href: LENDER_DB.rateContext.sourceUrl },
  },
  {
    test: /secured|unsecured|collateral|guarantor|mortgage/,
    answer:
      'A secured loan is backed by an asset — a home, a property, gold. An unsecured loan (most personal loans) is not, so the lender prices the extra risk into the rate. That is why a loan against property sits around 9%–14% while a personal loan can run past 20%.',
  },
  {
    test: /how (do|does) (you|loanley) (make|earn) money|commission|affiliate|paid by|sponsor/,
    answer:
      'Loanley earns nothing from any lender. No affiliate links, no referral commission, no paid placement, no "Apply Now". Nothing you type here is sent to a lender.\n\nThe ranking you see is arithmetic over published rate cards. That is the whole product.',
  },
  {
    test: /tenure|how long|repayment period|kitne saal|kitne mahine/,
    answer:
      'Tenure is how long you take to repay. Stretching it lowers the monthly EMI but increases the total interest — often by a lot. Shortening it raises the EMI but saves interest. Lenders also publish minimum and maximum tenures per product, and asking for one outside that window is a straight rejection.',
  },
];

function matchFaq(text: string): FaqEntry | null {
  const t = normalize(text);
  return FAQ.find((entry) => entry.test.test(t)) ?? null;
}

/* ============================================================================
 * 6. Copy for each question
 * ==========================================================================*/

function questionFor(field: FieldKey, profile: Partial<Profile>): BotTextItem {
  switch (field) {
    case 'loanType':
      return bot('What kind of loan are you looking for?', [
        { label: 'Personal', value: 'personal loan' },
        { label: 'Home', value: 'home loan' },
        { label: 'Education', value: 'education loan' },
        { label: 'Business', value: 'business loan' },
        { label: 'Against property', value: 'loan against property' },
      ]);
    case 'amount':
      return bot('How much do you need to borrow?', [
        { label: '₹1,00,000', value: '100000' },
        { label: '₹3,00,000', value: '300000' },
        { label: '₹5,00,000', value: '500000' },
        { label: '₹10,00,000', value: '1000000' },
        { label: '₹25,00,000', value: '2500000' },
      ]);
    case 'tenureMonths':
      return bot('Over how many months would you like to repay it?', [
        { label: '12 months', value: '12 months' },
        { label: '24 months', value: '24 months' },
        { label: '36 months', value: '36 months' },
        { label: '48 months', value: '48 months' },
        { label: '60 months', value: '60 months' },
        { label: '84 months', value: '84 months' },
      ]);
    case 'employment':
      return bot('How do you earn? Lenders publish different criteria for each.', [
        { label: 'Salaried', value: 'salaried' },
        { label: 'Self-employed', value: 'self-employed' },
      ]);
    case 'monthlyIncome':
      return bot(
        profile.employment === 'self_employed'
          ? "What's your average monthly income? Almost every lender publishes a minimum, so I need the real figure to tell you honestly who will consider you."
          : "What's your net monthly salary? Almost every lender publishes a minimum, so I need the real figure to tell you honestly who will consider you.",
        [
          { label: '₹15,000', value: '15000' },
          { label: '₹25,000', value: '25000' },
          { label: '₹40,000', value: '40000' },
          { label: '₹75,000', value: '75000' },
          { label: '₹1,50,000', value: '150000' },
        ],
      );
    case 'creditBand':
      return bot(
        "Last one — which range is your CIBIL score in? I won't assume it: guessing a high score is exactly how borrowers get pointed at lenders who reject them.",
        [
          { label: 'Below 650', value: 'below 650' },
          { label: '650–699', value: 'cibil 650-699' },
          { label: '700–749', value: 'cibil 700-749' },
          { label: '750–799', value: 'cibil 750-799' },
          { label: '800+', value: 'cibil 800+' },
          { label: "I don't know", value: "i don't know my cibil" },
        ],
      );
    default:
      return bot('Could you tell me a little more?');
  }
}

function retryFor(field: FieldKey, profile: Partial<Profile>): BotTextItem {
  const q = questionFor(field, profile);
  const hints: Record<FieldKey, string> = {
    loanType: "I didn't catch which kind of loan you mean.",
    amount: "I didn't catch an amount there. You can type it as 3L, ₹3,00,000 or 300000.",
    tenureMonths: "I didn't catch a tenure. You can type it as 24 months or 2 years.",
    employment: "I need to know how you earn — lenders publish separate criteria for salaried and self-employed applicants.",
    monthlyIncome:
      "I do need a figure here. Lenders publish minimum income rules, and without your income I'd have to either guess or quietly skip the check — I won't do either. You can type it as 20000 or 20k.",
    creditBand:
      "I need your CIBIL range before I rank anything — assuming 750+ is exactly the mistake that surfaces lenders you'd be rejected by. If you genuinely don't know, say so and I'll flag every score-based criterion as unverified.",
  };
  return bot(`${hints[field]}\n\n${q.text}`, q.quickReplies);
}

function describeRequirements(req: BorrowerRequirements): string {
  return describeProfile({
    loanType: req.loanType,
    amount: req.amount,
    tenureMonths: req.tenureMonths,
    employment: req.employmentType,
    monthlyIncome: req.monthlyIncome,
    creditBand: req.creditBand,
  });
}

function describeProfile(p: Partial<Profile>): string {
  const parts: string[] = [];
  if (p.loanType) parts.push(LOAN_TYPE_LABELS[p.loanType].toLowerCase());
  if (p.amount != null) parts.push(formatINR(p.amount));
  if (p.tenureMonths != null) parts.push(`${p.tenureMonths} months`);
  if (p.employment) parts.push(p.employment === 'salaried' ? 'salaried' : 'self-employed');
  if (p.monthlyIncome != null) parts.push(`monthly income ${formatINR(p.monthlyIncome)}`);
  if (p.creditBand) parts.push(`CIBIL ${CREDIT_BAND_LABELS[p.creditBand]}`);
  return parts.join(' · ');
}

/* ============================================================================
 * 7. Inline result rendering — everything stays in the thread.
 * ==========================================================================*/

function SourceCitation({ row, tone = 'light' }: { row: ComparisonRow; tone?: 'light' | 'dark' }) {
  return (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[11px] underline underline-offset-2 ${
        tone === 'dark' ? 'text-[var(--space-brand-primary-100)]' : 'text-[var(--space-text-muted)] hover:text-[var(--space-text-brand)]'
      }`}
      data-testid={`source-${row.lenderId}`}
    >
      Source: {shortLenderName(row.lenderName)} official page ↗
    </a>
  );
}

/**
 * The lender's approval rules, from Loanley's desk credit-policy record
 * (data/policy_rules.json). Behind a disclosure because it is long, and
 * labelled at the top because these are NOT figures the lender publishes — the
 * Source link on this row cannot verify them, and the borrower has to know
 * which of the two they are reading. Personal loans only: the sheet records
 * personal-loan policy, so it must never be shown against another product.
 */
function PolicyRuleCard({
  lenderId,
  loanType,
  tone = 'light',
}: {
  lenderId: string;
  loanType: LoanProductType;
  tone?: 'light' | 'dark';
}) {
  if (loanType !== 'personal') return null;
  const record = policyRuleFor(lenderId);
  if (!record) return null;
  const lines = policyRuleLines(record);
  if (lines.length === 0) return null;

  const dark = tone === 'dark';
  const muted = dark ? 'text-[var(--space-brand-primary-100)]' : 'text-[var(--space-text-muted)]';
  const strong = dark ? 'text-[var(--space-text-on-primary)]' : 'text-[var(--space-text-primary)]';

  return (
    <details
      className={`mt-2 rounded-lg border px-2.5 py-1.5 ${
        dark
          ? 'border-white/20 bg-white/10'
          : 'border-[var(--space-border-default)] bg-[var(--space-surface-muted)]'
      }`}
      data-testid={`policy-rules-${lenderId}`}
    >
      <summary
        className={`cursor-pointer text-[11px] font-semibold ${
          dark ? 'text-[var(--space-text-on-primary)]' : 'text-[var(--space-text-brand)]'
        }`}
      >
        Approval rules — what {shortLenderName(record.lender)} actually asks for
      </summary>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
        {lines.map((line) => (
          <div key={line.label}>
            <dt className={`text-[10px] ${muted}`}>{line.label}</dt>
            <dd className={`text-[11px] font-medium leading-snug ${strong}`}>{line.value}</dd>
          </div>
        ))}
      </dl>
      {record.specialFeatures.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {record.specialFeatures.map((feature, i) => (
            <li
              key={i}
              className={`text-[10px] leading-snug ${dark ? muted : 'text-[var(--space-text-secondary)]'}`}
            >
              • {feature}
            </li>
          ))}
        </ul>
      )}
      <p className={`mt-1.5 text-[10px] leading-snug ${muted}`}>{DESK_POLICY_CAVEAT}</p>
    </details>
  );
}

function BestMatchCard({
  row,
  tied,
  asOf,
  loanType,
}: {
  row: ComparisonRow;
  tied: boolean;
  asOf: string;
  loanType: LoanProductType;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-[var(--space-brand-primary)] p-4 text-[var(--space-text-on-primary)]"
      data-testid={`best-match-${row.lenderId}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--space-data-highlight,#f5a623)]">
        {tied ? 'Tied best match for your profile' : 'Best match for your profile'}
      </p>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight sm:text-2xl">{row.lenderName}</p>
          <p className="mt-0.5 text-[11px] text-[var(--space-brand-primary-100)]">
            {LENDER_TYPE_LABELS[row.lenderType]} · published rate {row.rateMin}%–{row.rateMax}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[var(--space-brand-primary-100)]">Estimated EMI (at {row.midRate}%)</p>
          <p className="text-2xl font-bold leading-none sm:text-3xl">
            <RupeeAmount value={row.emi} suffix="/mo" />
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-3">
        <div>
          <p className="text-[10px] text-[var(--space-brand-primary-100)]">Total repayment cost</p>
          <p className="text-sm font-bold tabular-nums">{formatINR(row.totalPayable)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--space-brand-primary-100)]">Effective cost with fees</p>
          <p className="text-sm font-bold tabular-nums">{row.effectiveAnnualRatePct}% p.a.</p>
        </div>
      </div>

      <p className="mt-3 text-[13px] font-semibold leading-snug">
        Why #1: lowest effective cost for your profile — {row.effectiveAnnualRatePct}% p.a. all-in, {formatINR(row.totalPayable)}{' '}
        total including the processing fee, among lenders whose published criteria you meet.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--space-brand-primary-100)]">
        Processing fee: {row.feeLabel}
        {row.feeAmount > 0 ? ` (≈ ${formatINR(row.feeAmount)}, before GST)` : ''} · rate card last checked {row.lastUpdated} ·
        published rates as of {asOf}
      </p>
      {row.eligibilityNotes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {row.eligibilityNotes.map((note, i) => (
            <li key={i} className="text-[10px] leading-snug text-[var(--space-brand-primary-100)]">
              Caveat: {note}
            </li>
          ))}
        </ul>
      )}
      <PolicyRuleCard lenderId={row.lenderId} loanType={loanType} tone="dark" />
      <p className="mt-2">
        <SourceCitation row={row} tone="dark" />
      </p>
    </div>
  );
}

function RankedRow({ row, rank, loanType }: { row: ComparisonRow; rank: number; loanType: LoanProductType }) {
  return (
    <div
      className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-2.5"
      data-testid={`ranked-lender-${row.lenderId}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--space-surface-accent-soft)] text-[10px] font-bold text-[var(--space-text-brand)]">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-[var(--space-text-primary)]">{row.lenderName}</span>
            <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">
              {LENDER_TYPE_LABELS[row.lenderType]}
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
            <div>
              <p className="text-[10px] text-[var(--space-text-muted)]">Published rate</p>
              <p className="text-sm font-bold tabular-nums text-[var(--space-text-primary)]">
                {row.rateMin}%–{row.rateMax}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--space-text-muted)]">EMI at {row.midRate}%</p>
              <p className="text-sm font-bold tabular-nums text-[var(--space-text-primary)]">
                <RupeeAmount value={row.emi} suffix="/mo" />
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--space-text-muted)]">Total cost</p>
              <p className="text-sm font-bold tabular-nums text-[var(--space-text-primary)]">{formatINR(row.totalPayable)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--space-text-muted)]">Effective cost</p>
              <p className="text-sm font-bold tabular-nums text-[var(--space-text-primary)]">{row.effectiveAnnualRatePct}% p.a.</p>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-[var(--space-text-muted)]">
            Processing fee: {row.feeLabel}
            {row.feeAmount > 0 ? ` (≈ ${formatINR(row.feeAmount)}, before GST)` : ''}
          </p>
          {row.eligibilityNotes.map((note, i) => (
            <p key={i} className="mt-0.5 text-[10px] leading-snug text-[var(--space-text-secondary)]">
              Caveat: {note}
            </p>
          ))}
          <PolicyRuleCard lenderId={row.lenderId} loanType={loanType} />
          <p className="mt-1">
            <SourceCitation row={row} />
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Where the published data genuinely cannot filter on the borrower's own
 * income or score, say so rather than letting the ranking imply it did.
 * Each entry is removed only once every lender for that loan type publishes
 * the criteria the decision actually turns on.
 */
const COVERAGE_CAVEATS: Partial<Record<LoanProductType, string>> = {
  education:
    "Honest limit: education lenders publish no minimum salary or CIBIL for the student — they assess the course, the institution and the co-applicant. We now filter on each bank's published collateral threshold and flag the mandatory parent or guardian co-borrower, but none of them publishes a minimum co-applicant income and we cannot check your institution tier, so this ranking still cannot tell you who will approve you.",
  business:
    "Honest limit: business lenders publish business vintage — and some of them a minimum annual turnover — rather than a salary floor, and both are now in our database per lender and filtered on when you share your figures. Several NBFCs publish no turnover minimum at all, and banking history and profitability are assessed case by case rather than published as thresholds, so this ranking still cannot tell you who will approve you.",
};

function ResultBlock({ result }: { result: ComparisonResult }) {
  const eligible = result.eligible;
  const best = eligible[0] ?? null;
  const tiedGroup = best ? eligible.filter((r) => r.effectiveAnnualRatePct - best.effectiveAnnualRatePct <= 0.1) : [];
  const band = RBI_BENCHMARK_RANGES[result.requirements.loanType];

  let countLine: string;
  if (eligible.length === 0) {
    countLine =
      "No lenders in our current database match your profile exactly. The closest options are in the 'out of reach' section below — you may want to check with your own bank directly, or improve your CIBIL score first.";
  } else if (eligible.length < 3) {
    countLine = `Only ${eligible.length} lender${eligible.length === 1 ? '' : 's'} in our database meet your eligibility criteria. Here's what we found:`;
  } else {
    countLine = `${eligible.length} lenders in our database meet the eligibility criteria we hold for you, ranked by effective cost (EMI plus processing fee).`;
  }

  return (
    <div className="space-y-3" data-testid="loan-check-results">
      <div className="space-y-1.5">
        <ZeroCommissionStrip />
        <p className="text-[11px] leading-snug text-[var(--space-text-secondary)]" data-testid="trust-header">
          {TRUST_HEADER}
        </p>
      </div>

      <p className="rounded-lg bg-[var(--space-surface-muted)] px-3 py-2 text-[11px] leading-snug text-[var(--space-text-secondary)]">
        Your profile: {describeRequirements(result.requirements)}
      </p>

      <p className="text-[13px] font-semibold leading-snug text-[var(--space-text-primary)]">{countLine}</p>

      {tiedGroup.length > 0 && (
        <div className="space-y-2">
          {tiedGroup.map((row) => (
            <BestMatchCard
              key={row.lenderId}
              row={row}
              tied={tiedGroup.length > 1}
              asOf={result.lastUpdated}
              loanType={result.requirements.loanType}
            />
          ))}
          {tiedGroup.length > 1 && (
            <p className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
              These lenders are within 0.1% effective cost of each other for your inputs — the published data can't
              honestly separate them, so they share the top spot.
            </p>
          )}
        </div>
      )}

      {eligible.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
            Lenders you qualify for — lowest effective cost first
          </h4>
          <div className="space-y-2">
            {eligible.map((row, i) => (
              <RankedRow key={row.lenderId} row={row} rank={i + 1} loanType={result.requirements.loanType} />
            ))}
          </div>
        </div>
      )}

      {result.outOfRange.length > 0 && (
        <div data-testid="out-of-reach">
          <h4 className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
            Likely out of reach for your profile
          </h4>
          <p className="mb-2 text-[11px] leading-snug text-[var(--space-text-secondary)]">
            Shown so nothing is hidden — these are excluded from the ranking by each lender's own criteria, and every
            reason below says whether it came from the lender's published page or from Loanley's desk record of its
            credit policy. Neither is the final word; lenders assess full applications individually.
          </p>
          <div className="space-y-2 opacity-70">
            {result.outOfRange.map((row) => (
              <div
                key={row.lenderId}
                className="rounded-xl border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-muted)] px-3 py-2.5"
                data-testid={`not-qualify-${row.lenderId}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-[var(--space-text-primary)]">{row.lenderName}</span>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">
                    {LENDER_TYPE_LABELS[row.lenderType]}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {row.reasons.map((reason, i) => (
                    <li key={i} className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
                      {reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  <SourceCitation row={row} />
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {COVERAGE_CAVEATS[result.requirements.loanType] && (
        <p className="rounded-lg bg-[var(--space-surface-muted)] px-3 py-2 text-[11px] leading-snug text-[var(--space-text-secondary)]">
          {COVERAGE_CAVEATS[result.requirements.loanType]}
        </p>
      )}

      {result.notCovered.length > 0 && (
        <p className="text-[10px] leading-snug text-[var(--space-text-muted)]">
          Not compared (no published rate-card data for this loan type in our database yet): {result.notCovered.join(', ')}.
        </p>
      )}

      {result.requirements.loanType === 'personal' && POLICY_RULES_AWAITING_RATE_CARD.length > 0 && (
        <p className="text-[10px] leading-snug text-[var(--space-text-muted)]">
          We also hold approval rules for {POLICY_RULES_AWAITING_RATE_CARD.map((record) => record.lender).join(', ')},
          but they are not ranked here yet: a lender only enters the ranking once its own published rate card has been
          scraped, and those are still to be collected.
        </p>
      )}

      <p className="border-t border-[var(--space-border-default)] pt-2 text-[10px] leading-snug text-[var(--space-text-muted)]">
        For context, major Indian banks and NBFCs publish {LOAN_TYPE_LABELS[result.requirements.loanType].toLowerCase()}{' '}
        rates in a {band.minPct}%–{band.maxPct}% p.a. band, within RBI's interest-rate framework; the policy repo rate is{' '}
        {LENDER_DB.rateContext.rbiRepoRatePct}% as of {LENDER_DB.rateContext.asOf}, and floating retail bank rates are
        benchmarked to it (EBLR).{' '}
        <a
          href={RBI_MASTER_DIRECTIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Source: RBI Master Direction — Interest Rate on Advances
        </a>
      </p>

      <p className="text-[10px] leading-snug text-[var(--space-text-muted)]">
        EMI and totals use the midpoint of each lender's published range — your sanctioned rate depends on your full
        profile and can sit anywhere in that range. Processing fees exclude GST. {result.disclaimer}
      </p>
    </div>
  );
}

/* ============================================================================
 * 8. Offer check — "is this offer I already have any good?"
 * ==========================================================================*/

interface OfferDraft {
  loanType: LoanProductType;
  amount: number;
  ratePct: number;
  tenureMonths: number;
  processingFee: number;
}
type OfferFieldKey = keyof OfferDraft;
const OFFER_ORDER: OfferFieldKey[] = ['loanType', 'amount', 'ratePct', 'tenureMonths', 'processingFee'];

function offerQuestion(field: OfferFieldKey): BotTextItem {
  switch (field) {
    case 'loanType':
      return bot('Which kind of loan is this offer for?', [
        { label: 'Personal', value: 'personal loan' },
        { label: 'Home', value: 'home loan' },
        { label: 'Education', value: 'education loan' },
        { label: 'Business', value: 'business loan' },
        { label: 'Against property', value: 'loan against property' },
      ]);
    case 'amount':
      return bot('What loan amount are they offering?');
    case 'ratePct':
      return bot('What interest rate have they quoted, per year?');
    case 'tenureMonths':
      return bot('Over how many months?', [
        { label: '12 months', value: '12 months' },
        { label: '24 months', value: '24 months' },
        { label: '36 months', value: '36 months' },
        { label: '48 months', value: '48 months' },
        { label: '60 months', value: '60 months' },
      ]);
    case 'processingFee':
      return bot('And the processing fee in ₹? Say "none" if there isn\'t one.', [
        { label: 'No fee', value: 'none' },
      ]);
    default:
      return bot('Could you tell me a little more?');
  }
}

function parseOfferAnswer(field: OfferFieldKey, raw: string): Partial<OfferDraft> {
  const t = normalize(raw);
  switch (field) {
    case 'loanType': {
      const v = detectLoanType(t);
      return v ? { loanType: v } : {};
    }
    case 'amount': {
      const v = parseMoney(t);
      return v != null && v >= 1000 ? { amount: v } : {};
    }
    case 'ratePct': {
      const v = detectRatePct(t) ?? (/^\d{1,2}(\.\d+)?$/.test(t) ? parseFloat(t) : null);
      return v != null && v > 0 && v < 100 ? { ratePct: v } : {};
    }
    case 'tenureMonths': {
      const patch = parseAnswer('tenureMonths', t);
      return patch.tenureMonths != null ? { tenureMonths: patch.tenureMonths } : {};
    }
    case 'processingFee': {
      if (/^(none|nil|no|zero|0|nothing|no fee)\b/.test(t)) return { processingFee: 0 };
      const v = parseMoney(t);
      return v != null && v >= 0 ? { processingFee: v } : {};
    }
    default:
      return {};
  }
}

function extractOffer(raw: string): Partial<OfferDraft> {
  const t = normalize(raw);
  const out: Partial<OfferDraft> = {};
  const type = detectLoanType(t);
  if (type) out.loanType = type;
  const rate = detectRatePct(t);
  if (rate != null) out.ratePct = rate;

  let rest = t;
  if (rate != null) rest = rest.replace(new RegExp(`${rate}\\s*(?:%|percent|per cent|pct)?`), ' ');

  const fee = rest.match(/(?:fee|charges?|processing)\D{0,12}(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(thousand|lakhs?|k|l)?/) ||
    rest.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(thousand|lakhs?|k|l)?\s*(?:processing\s*)?fee/);
  if (fee) {
    const n = parseFloat(fee[1]) * (fee[2] ? MONEY_UNITS[fee[2]] ?? 1 : 1);
    if (n >= 0) {
      out.processingFee = Math.round(n);
      rest = rest.replace(fee[0], ' ');
    }
  }

  const tenure = rest.match(/(\d+(?:\.\d+)?)\s*(months?|mos?|years?|yrs?|yr|saal)\b/);
  if (tenure) {
    const n = parseFloat(tenure[1]);
    const months = /^(y|s)/.test(tenure[2]) ? Math.round(n * 12) : Math.round(n);
    if (months >= 3 && months <= 480) out.tenureMonths = months;
    rest = rest.replace(tenure[0], ' ');
  }

  const amt = parseMoney(rest);
  if (amt != null && amt >= 10000) out.amount = amt;

  return out;
}

/* ============================================================================
 * 9. The chat
 * ==========================================================================*/

const WELCOME =
  "Namaste — I'm Loan Check by Loanley.\n\nTell me what you need in plain language (English or Hinglish) and I'll tell you honestly which lenders will actually consider you, and which one costs the least once fees are counted. No lender pays us a rupee, and nothing you type is sent to any lender.";

const WELCOME_REPLIES: QuickReply[] = [
  { label: 'I want a personal loan', value: 'I want a personal loan' },
  { label: 'Best loan for me', value: 'best loan for me' },
  { label: 'Loan chahiye', value: 'loan chahiye' },
  { label: 'What is a processing fee?', value: 'what is a processing fee?' },
];

const AFTER_RESULT_REPLIES: QuickReply[] = [
  { label: 'Change my details', value: 'change my details' },
  { label: 'Start over', value: 'start over' },
  { label: 'What is effective cost?', value: 'what is effective cost?' },
];

/* ============================================================================
 * 10. About — the founder's origin story, verbatim.
 * ==========================================================================*/

type Route = 'chat' | 'about';

const ABOUT_HEADLINE = 'Why I Built This';

const ABOUT_PARAGRAPHS: string[] = [
  'Every loan app, every loan website, every "best personal loan" article — it\'s all promotion dressed up as advice. Everyone\'s pushing something. Nobody\'s just telling you the truth.',
  'I built this because I wanted a place where loan seekers get real answers, not sales pitches. No "Apply Now" banners hiding behind fake articles. No rankings paid for by the lender. Just real people sharing what actually happened when they took a loan — the good, the bad, the hidden charges nobody warns you about.',
  "I'm not neutral because I have nothing at stake — I do. But my rule is simple: if a lender is bad for you, this app will say so, even if it costs me. Trust only works if it's earned honestly, not manufactured.",
];

const ABOUT_TRUST_LINE =
  'Loanley earns zero referral commissions. No lender has paid for placement — ever.';

/**
 * The space shell owns window.location.hash for its own panel deep-links, so
 * /about is carried as a ?view=about history entry instead: the shell ignores
 * the query string, and browser back returns to the chat exactly like the
 * in-header Back control does.
 */
function readRouteFromUrl(): Route {
  try {
    if (/\/about\/?$/i.test(window.location.pathname)) return 'about';
    const view = new URLSearchParams(window.location.search).get('view');
    if ((view || '').toLowerCase() === 'about') return 'about';
  } catch {
    // Location unreadable (sandboxed preview) — the chat is the safe default.
  }
  return 'chat';
}

function urlForRoute(route: Route): string | null {
  try {
    const url = new URL(window.location.href);
    if (route === 'about') url.searchParams.set('view', 'about');
    else url.searchParams.delete('view');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function AboutPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--space-surface-page)]" data-testid="about-page">
      <div className="mx-auto w-full max-w-[680px] px-6 py-10 sm:px-8 sm:py-14">
        <h1
          className="text-[28px] font-bold leading-[1.15] tracking-[-0.01em] text-[var(--space-text-brand)] sm:text-[36px]"
          data-testid="about-headline"
        >
          {ABOUT_HEADLINE}
        </h1>

        <div className="mt-6 space-y-5 sm:mt-7">
          {ABOUT_PARAGRAPHS.map((paragraph, i) => (
            <p
              key={i}
              className="text-[15px] leading-[1.6] text-[var(--space-text-primary)] sm:text-[16px]"
            >
              {paragraph}
            </p>
          ))}
        </div>

        <p
          className="mt-9 border-t border-[var(--space-border-default)] pt-5 text-[13px] leading-[1.6] text-[var(--space-text-muted)] sm:mt-11"
          data-testid="about-trust-line"
        >
          {ABOUT_TRUST_LINE}
        </p>
      </div>
    </div>
  );
}

const NAV_BUTTON_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1 text-[11px] font-medium text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)] hover:text-[var(--space-text-brand)]';

/* ============================================================================
 * 10b. Source-data download — check our numbers without taking our word.
 *
 * Deliberately a quiet text link and not a call to action: it exists so a
 * sceptical borrower (or a journalist, or a regulator) can take the whole
 * published dataset away and audit the ranking, which is the opposite of the
 * pitch every other Indian loan site makes.
 *
 * The file is built from the very records the ranking above was computed from,
 * so what a borrower saves cannot drift from what they were shown. The
 * attachment filename is applied through the anchor's download attribute,
 * which is what actually names the file in the browser's save dialog.
 * ==========================================================================*/

function SourceDataDownload() {
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');

  const handleDownload = () => {
    setStatus('busy');
    try {
      const url = URL.createObjectURL(new Blob([personalLoansJson()], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = PL_DATA_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking immediately can cancel the save in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus('idle');
    } catch (err) {
      console.warn('[loanley] source-data download failed', err);
      setStatus('error');
    }
  };

  return (
    <div className="mt-1.5 text-center">
      <button
        type="button"
        onClick={handleDownload}
        disabled={status === 'busy'}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--space-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--space-text-brand)] disabled:no-underline disabled:opacity-60"
        data-testid="download-source-data"
      >
        {status === 'busy' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        Download source data (JSON) →
      </button>
      <p className="mt-0.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
        {status === 'error'
          ? "That download didn't go through. Please try again in a moment — every figure is also cited inline above."
          : `${PERSONAL_LOANS.length} lenders — every figure read off the lender's own official page.`}
      </p>
    </div>
  );
}

/* ============================================================================
 * 11. The app
 * ==========================================================================*/

export default function LoanCheck() {
  const [items, setItems] = useState<ThreadItem[]>(() => [bot(WELCOME, WELCOME_REPLIES)]);
  const [route, setRoute] = useState<Route>(readRouteFromUrl);
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [pendingField, setPendingField] = useState<FieldKey | null>(null);
  const [offer, setOffer] = useState<Partial<OfferDraft>>({});
  const [pendingOfferField, setPendingOfferField] = useState<OfferFieldKey | null>(null);
  const [busy, setBusy] = useState(false);
  // Bundled rate card with the weekly refresh's validated overrides layered on
  // top. Falls back to exactly the bundle when there is nothing live to apply.
  const lenderData = useLiveLenderDb();

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items, busy, route]);

  const navigate = (next: Route) => {
    if (next === route) return;
    const url = urlForRoute(next);
    if (url) {
      try {
        window.history.pushState({ loanleyRoute: next }, '', url);
      } catch {
        // History unavailable — the view still switches.
      }
    }
    setRoute(next);
  };

  useEffect(() => {
    const syncFromUrl = () => setRoute(readRouteFromUrl());
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  const push = (...added: ThreadItem[]) => setItems((prev) => [...prev, ...added]);

  /* ---- eligibility flow ---- */

  const advance = (p: Partial<Profile>, out: ThreadItem[]) => {
    const missing = FIELD_ORDER.find((k) => p[k] === undefined);
    if (missing) {
      out.push(questionFor(missing, p));
      setProfile(p);
      setPendingField(missing);
      push(...out);
      return;
    }

    const req: BorrowerRequirements = {
      loanType: p.loanType as LoanProductType,
      amount: p.amount as number,
      tenureMonths: p.tenureMonths as number,
      employmentType: p.employment as EmploymentType,
      monthlyIncome: p.monthlyIncome,
      creditBand: p.creditBand,
    };
    const result = compareLenders(req, lenderData);
    out.push(bot(`Here's the honest read for ${describeProfile(p)}.`));
    out.push({ id: nextId(), role: 'bot', kind: 'result', result });
    out.push(bot('Anything you want to change?', AFTER_RESULT_REPLIES));
    setProfile(p);
    setPendingField(null);
    push(...out);
  };

  const startCriteria = (harvest: Partial<Profile>, out: ThreadItem[], withIntro = true) => {
    const known = FIELD_ORDER.filter((k) => harvest[k] !== undefined);
    if (!withIntro) {
      advance(harvest, out);
      return;
    }
    if (known.length > 0 && known.length < FIELD_ORDER.length) {
      out.push(
        bot(
          `Got it — I've noted ${describeProfile(harvest)}. I need all six details before I rank anything, because eligibility (not just the lowest advertised rate) decides who will actually approve you. Just ${
            FIELD_ORDER.filter((k) => harvest[k] === undefined)
              .map((k) => FIELD_LABELS[k])
              .join(', ')
          } to go.`,
        ),
      );
    } else if (known.length === 0) {
      out.push(
        bot(
          "Happy to help. I'll ask six quick things — loan type, amount, tenure, how you earn, monthly income and CIBIL range. I need all six before I rank anything: the lowest advertised rate is worthless if that lender would reject you.",
        ),
      );
    }
    advance(harvest, out);
  };

  /* ---- offer-check flow ---- */

  const runOfferMath = async (draft: OfferDraft, out: ThreadItem[]) => {
    out.push(bot('Running the real maths on that offer…'));
    push(...out);
    setBusy(true);
    try {
      const res = await fetch(LOAN_MATH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loan_type: draft.loanType,
          principal: draft.amount,
          annual_rate_pct: draft.ratePct,
          tenure_months: draft.tenureMonths,
          processing_fee: draft.processingFee,
          other_fees: 0,
        }),
      });
      const data = await res.json();
      if (data?.ok && data.resultCard) {
        push(
          { id: nextId(), role: 'bot', kind: 'offer', cardJson: JSON.stringify(data.resultCard) },
          bot('Want me to check which lenders would actually approve you, and whether any of them beats this?', [
            { label: 'Yes — find my best loan', value: 'find the best loan for me' },
            { label: 'Check another offer', value: 'check another offer' },
          ]),
        );
      } else if (Array.isArray(data?.validation_errors) && data.validation_errors.length > 0) {
        push(
          bot(
            `Those numbers don't add up, so I won't pretend they do:\n\n${data.validation_errors
              .map((m: string) => `• ${m}`)
              .join('\n')}\n\nSay "check another offer" and we'll redo it.`,
          ),
        );
      } else {
        push(bot("Loanley's calculator is unavailable right now. I won't estimate the numbers — please try again in a moment."));
      }
    } catch {
      push(bot("Loanley's calculator is unavailable right now. I won't estimate the numbers — please try again in a moment."));
    } finally {
      setBusy(false);
      setOffer({});
      setPendingOfferField(null);
    }
  };

  const advanceOffer = (d: Partial<OfferDraft>, out: ThreadItem[]) => {
    const missing = OFFER_ORDER.find((k) => d[k] === undefined);
    if (missing) {
      out.push(offerQuestion(missing));
      setOffer(d);
      setPendingOfferField(missing);
      push(...out);
      return;
    }
    setOffer(d);
    setPendingOfferField(null);
    void runOfferMath(d as OfferDraft, out);
  };

  /* ---- routing ---- */

  const handleSend = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');

    const out: ThreadItem[] = [userSays(text)];
    const t = normalize(text);

    // Global commands always win, even mid-question.
    if (/^(start over|restart|reset|clear|shuru se)\b/.test(t) || /\bstart over\b/.test(t)) {
      setProfile({});
      setOffer({});
      setPendingOfferField(null);
      out.push(
        bot(
          "Starting fresh — six quick things again: loan type, amount, tenure, how you earn, monthly income and CIBIL range.",
        ),
      );
      startCriteria({}, out, false);
      return;
    }
    if (/change (my )?(details|answers|inputs)|edit (my )?(details|answers)|different (details|numbers)/.test(t)) {
      setOffer({});
      setPendingOfferField(null);
      out.push(bot("No problem — let's redo the six details from the top."));
      startCriteria({}, out, false);
      return;
    }
    if (/check (another|an|my) offer|i have an offer|got an offer/.test(t) && !pendingField) {
      const seeded = extractOffer(text);
      out.push(bot("Sure — paste what they've quoted and I'll run the real maths on it."));
      advanceOffer(seeded, out);
      return;
    }

    // Mid-flow: an answer to the question just asked.
    if (pendingOfferField) {
      const patch = parseOfferAnswer(pendingOfferField, text);
      const merged: Partial<OfferDraft> = { ...offer, ...extractOffer(text), ...patch };
      if (merged[pendingOfferField] === undefined) {
        out.push(bot("I didn't catch that. Could you give me just that number?"), offerQuestion(pendingOfferField));
        push(...out);
        return;
      }
      advanceOffer(merged, out);
      return;
    }

    if (pendingField) {
      const direct = parseAnswer(pendingField, text);
      const harvest = extractCriteria(text);
      const merged: Partial<Profile> = { ...profile };
      // Never let a harvested guess overwrite something already confirmed, and
      // never let it speak for the field currently being asked.
      FIELD_ORDER.forEach((k) => {
        if (k !== pendingField && merged[k] === undefined && harvest[k] !== undefined) {
          (merged as Record<string, unknown>)[k] = harvest[k];
        }
      });
      if (direct[pendingField] !== undefined) {
        (merged as Record<string, unknown>)[pendingField] = direct[pendingField];
      } else if (harvest[pendingField] !== undefined) {
        (merged as Record<string, unknown>)[pendingField] = harvest[pendingField];
      }

      if (merged[pendingField] === undefined) {
        // A concept question mid-flow gets answered, then we resume — we never
        // drop the thread and never skip ahead with a missing field.
        const faq = matchFaq(text);
        if (faq && isDefinitionQuestion(text)) {
          out.push(bot(faq.answer, undefined, faq.source));
          out.push(bot('Back to it —'));
          out.push(questionFor(pendingField, profile));
          push(...out);
          return;
        }
        out.push(retryFor(pendingField, profile));
        push(...out);
        return;
      }
      advance(merged, out);
      return;
    }

    /* ---- cold start: classify ---- */

    const seeking = detectLoanIntent(text);
    const harvest = extractCriteria(text);
    const rate = detectRatePct(text);
    const faq = matchFaq(text);

    // "Is 18% normal?" — a rate with no amount is a benchmark question, not an
    // offer and not an eligibility check.
    if (rate != null && !seeking && harvest.amount == null) {
      const type = harvest.loanType ?? 'personal';
      const band = RBI_BENCHMARK_RANGES[type];
      const label = LOAN_TYPE_LABELS[type].toLowerCase();
      let read: string;
      if (rate < band.minPct) {
        read = `${rate}% is BELOW the ${band.minPct}%–${band.maxPct}% p.a. band that major Indian banks and NBFCs publish for a ${label}. A quote that low usually hides a flat-rate calculation, a teaser period, or fees that claw the cost back — read the Key Facts Statement line by line before believing it.`;
      } else if (rate > band.maxPct) {
        read = `${rate}% is ABOVE the ${band.minPct}%–${band.maxPct}% p.a. band that major Indian banks and NBFCs publish for a ${label}. Not automatically wrong, but worth negotiating and worth asking what the processing fee adds on top.`;
      } else {
        read = `${rate}% sits INSIDE the ${band.minPct}%–${band.maxPct}% p.a. band that major Indian banks and NBFCs publish for a ${label}. Normal — though the fee can still make a "normal" rate expensive.`;
      }
      out.push(
        bot(
          `${read}\n\nThe policy repo rate is ${LENDER_DB.rateContext.rbiRepoRatePct}% as of ${LENDER_DB.rateContext.asOf}, and floating retail bank rates are benchmarked to it.`,
          [
            { label: 'Check this whole offer', value: 'check an offer' },
            { label: 'Find the best loan for me', value: 'find the best loan for me' },
          ],
          RBI_SOURCE,
        ),
      );
      push(...out);
      return;
    }

    // A concrete offer on the table: amount + quoted rate.
    if (rate != null && !seeking && harvest.amount != null) {
      out.push(bot("Let me run the real maths on that offer — I'll use the server-side calculator, never a guess."));
      advanceOffer(extractOffer(text), out);
      return;
    }

    // Concept questions answer directly — they never force the eligibility flow.
    if (faq && isDefinitionQuestion(text) && !seeking) {
      out.push(bot(faq.answer, undefined, faq.source));
      out.push(
        bot('Want me to check which lenders would actually consider you, and which costs least?', [
          { label: 'Yes — find my best loan', value: 'find the best loan for me' },
          { label: 'Not now', value: 'not now' },
        ]),
      );
      push(...out);
      return;
    }

    // Loan-seeking intent ALWAYS starts collection. So does a message that
    // already carries real criteria, even without an obvious intent phrase.
    const carriesCriteria = FIELD_ORDER.filter((k) => harvest[k] !== undefined).length >= 2;
    if (seeking || carriesCriteria) {
      startCriteria(harvest, out);
      return;
    }

    if (/^(no|not now|nahi|nope|thanks|thank you|thanx|ok|okay)\b/.test(t)) {
      out.push(
        bot('No problem. I\'m here whenever you want the numbers — ask me anything about loans, or say "find me a loan" and we\'ll go through it.', WELCOME_REPLIES),
      );
      push(...out);
      return;
    }

    if (faq) {
      out.push(bot(faq.answer, undefined, faq.source));
      out.push(
        bot('Want me to check which lenders would actually consider you?', [
          { label: 'Yes — find my best loan', value: 'find the best loan for me' },
          { label: 'Not now', value: 'not now' },
        ]),
      );
      push(...out);
      return;
    }

    // Never go quiet.
    out.push(
      bot(
        "I want to make sure I answer the right question. I can do two things: work out which lenders will actually approve you and which is cheapest for your profile, or run the real maths on an offer you've already been given.",
        [
          { label: 'Find my best loan', value: 'find the best loan for me' },
          { label: 'Check an offer I have', value: 'check an offer' },
          { label: 'What is a processing fee?', value: 'what is a processing fee?' },
        ],
      ),
    );
    push(...out);
  };

  const resetAll = () => {
    setProfile({});
    setOffer({});
    setPendingField(null);
    setPendingOfferField(null);
    setInput('');
    setItems([bot(WELCOME, WELCOME_REPLIES)]);
  };

  const lastId = items.length > 0 ? items[items.length - 1].id : '';

  return (
    <div className="flex h-full min-h-[560px] w-full flex-col bg-transparent">
      {/* header */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--space-border-default)] px-5 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--space-surface-accent-soft)]">
          <ShieldCheck className="h-5 w-5 text-[var(--space-text-brand)]" />
        </div>
        <div className="min-w-[9.5rem] flex-1">
          <h2 className="text-base font-bold text-[var(--space-text-brand)]">Loan Check</h2>
          <p className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
            Honest answers about Indian loans, in this conversation. No lender pays for placement.
          </p>
        </div>
        <nav className="ml-auto flex shrink-0 items-center gap-1.5">
          {route === 'about' ? (
            <button
              type="button"
              onClick={() => navigate('chat')}
              className={NAV_BUTTON_CLASS}
              data-testid="nav-back-to-chat"
            >
              <ChevronLeft className="h-3 w-3" /> Back to chat
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate('about')}
                className={NAV_BUTTON_CLASS}
                data-testid="nav-about"
              >
                <Info className="h-3 w-3" /> About
              </button>
              <button
                type="button"
                onClick={resetAll}
                className={NAV_BUTTON_CLASS}
                data-testid="chat-reset"
              >
                <RotateCcw className="h-3 w-3" /> New chat
              </button>
            </>
          )}
        </nav>
      </div>

      {route === 'about' ? (
        <AboutPage />
      ) : (
        <>
      {/* thread */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {items.map((item) => {
            if (item.role === 'user') {
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-sm bg-[var(--space-brand-primary)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--space-text-on-primary)]">
                    {item.text}
                  </div>
                </div>
              );
            }
            if (item.kind === 'result') {
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3.5"
                >
                  <ResultBlock result={item.result} />
                </div>
              );
            }
            if (item.kind === 'offer') {
              return <LoanleyResultCard key={item.id} raw={item.cardJson} />;
            }
            const isLast = item.id === lastId;
            return (
              <div key={item.id} className="max-w-[92%]">
                <div className="whitespace-pre-line rounded-2xl rounded-bl-sm bg-[var(--space-surface-muted)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--space-text-primary)]">
                  {item.text}
                  {item.source && (
                    <span className="mt-1.5 block">
                      <a
                        href={item.source.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] underline underline-offset-2 text-[var(--space-text-muted)] hover:text-[var(--space-text-brand)]"
                      >
                        Source: {item.source.label}
                      </a>
                    </span>
                  )}
                </div>
                {isLast && item.quickReplies && item.quickReplies.length > 0 && !busy && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.quickReplies.map((qr) => (
                      <button
                        key={qr.label}
                        type="button"
                        onClick={() => handleSend(qr.value)}
                        className="rounded-full border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-1.5 text-[12px] font-medium text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[var(--space-surface-accent-soft)]"
                        data-testid={`quick-reply-${qr.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      >
                        {qr.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {busy && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--space-text-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running the real maths…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-[var(--space-border-default)] px-4 py-3 sm:px-5">
        <div className="mx-auto max-w-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Try “I want a ₹5L personal loan” or “loan chahiye”…'
              className="min-w-0 flex-1 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3.5 py-2.5 text-sm text-[var(--space-text-primary)] focus:border-[var(--space-border-strong)] focus:outline-none"
              data-testid="chat-input"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] transition-opacity disabled:opacity-40"
              data-testid="chat-send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="mt-1.5 text-center text-[10px] leading-snug text-[var(--space-text-muted)]">
            No lender has paid for placement. Loanley earns no referral commission. Neutral information, not financial
            advice.
          </p>
          <SourceDataDownload />
        </div>
      </div>
        </>
      )}
    </div>
  );
}
