/**
 * personal-loan-source — makes data/personal_loans.json the source of truth for
 * every personal-loan number Loanley shows.
 *
 * data/personal_loans.json holds the 20 major Indian lenders' published
 * personal-loan terms, each value read off that lender's own official page
 * (data/personal-loans-data.ts is its build-time bundle mirror, because space
 * compilation bundles TypeScript modules rather than raw JSON). This module
 * layers those records over the `personal` product of the wider lender
 * database, so the comparison engine filters and ranks on the freshly scraped
 * figures and the borrower can download the exact dataset behind the answer.
 *
 * Two rules the merge exists to enforce:
 *  1. A published figure always wins. Where the scrape recorded a value, it
 *     replaces the bundled one, and the product's source URL becomes the page
 *     that value was read from, so the "Source" link a borrower clicks shows
 *     the number they were quoted.
 *  2. `null` means the lender does not publish it, never zero and never a
 *     licence to invent one. Those fields keep whatever data/lenders.ts
 *     already carried, and a lender that publishes no rate ceiling keeps a
 *     coherent range rather than an inverted one.
 */
import { PERSONAL_LOANS } from '../data/personal-loans-data';
import type { PersonalLoanRecord } from '../data/personal-loans-data';
import type { Lender, LenderDatabase, LenderProduct } from '../data/lenders';

/**
 * data/personal_loans.json names lenders the way the lender does ('icici-bank');
 * data/lenders.ts uses its own shorter keys. Neither is wrong, so the join is
 * spelled out here rather than by renaming a founder-facing dataset.
 */
const LENDER_ID_ALIASES: Record<string, string> = {
  'icici-bank': 'icici',
  'axis-bank': 'axis',
  'kotak-mahindra-bank': 'kotak',
  'indusind-bank': 'indusind',
  'idfc-first-bank': 'idfc-first',
  'federal-bank': 'federal',
  'rbl-bank': 'rbl',
  'canara-bank': 'canara',
  'bajaj-finance': 'bajaj-finserv',
};

function databaseId(record: PersonalLoanRecord): string {
  return LENDER_ID_ALIASES[record.lenderId] ?? record.lenderId;
}

const BY_DATABASE_ID: Map<string, PersonalLoanRecord> = new Map(
  PERSONAL_LOANS.map((record) => [databaseId(record), record]),
);

/** The scraped record behind a lender's personal-loan row, if we have one. */
export function personalLoanRecordFor(lenderId: string): PersonalLoanRecord | undefined {
  return BY_DATABASE_ID.get(lenderId);
}

/** How many of the 20 scraped lenders publish a starting rate. */
export function personalLoanRateCoverage(): { withRate: number; total: number } {
  return {
    withRate: PERSONAL_LOANS.filter((record) => record.interestRateMin != null).length,
    total: PERSONAL_LOANS.length,
  };
}

/**
 * The caveat a comparison card can carry. The full scrape note is long by
 * design and travels in data/personal_loans.json; what a borrower needs on the
 * card is the headline caveat — above all, that a rate ceiling they are being
 * shown is ours and not the lender's.
 */
function displayNote(record: PersonalLoanRecord): string | undefined {
  const parts: string[] = [];
  if (record.interestRateMax == null && record.interestRateMin != null) {
    parts.push(
      `${record.lender} publishes a starting rate of ${record.interestRateMin}% p.a. and no ceiling — the upper figure shown is from our own rate card, not the lender's.`,
    );
  }
  const opening = firstSentence(record.notes);
  if (opening) parts.push(opening);
  const text = parts.join(' ').trim();
  return text.length > 0 ? text : undefined;
}

/**
 * The opening sentence of a scrape note. A full stop only ends the sentence
 * when a capital letter follows it, so the abbreviations and decimals these
 * notes are full of ('9.70%', 'w.e.f.', 'p.a.') don't cut one in half.
 */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^[\s\S]*?\.(?=\s+[A-Z₹])/);
  const sentence = (match ? match[0] : trimmed).trim();
  if (sentence.length <= 320) return sentence;
  return `${sentence.slice(0, 300).trimEnd()}…`;
}

function mergeProduct(base: LenderProduct, record: PersonalLoanRecord): LenderProduct {
  const rateMin = record.interestRateMin ?? base.interestRateMin;
  // A lender that publishes a floor and no ceiling must not end up with a
  // ceiling below its own floor — that would rank it off a nonsense midpoint.
  const rateMax = record.interestRateMax ?? Math.max(base.interestRateMax, rateMin);

  const merged: LenderProduct = {
    ...base,
    interestRateMin: rateMin,
    interestRateMax: rateMax,
    minLoanAmount: record.loanAmountMin ?? base.minLoanAmount,
    maxLoanAmount: record.loanAmountMax ?? base.maxLoanAmount,
    minTenureMonths: record.tenureMinMonths ?? base.minTenureMonths,
    maxTenureMonths: record.tenureMaxMonths ?? base.maxTenureMonths,
    employmentTypes: record.employmentTypes ?? base.employmentTypes,
    sourceUrl: record.sourceUrl || base.sourceUrl,
    dataNote: displayNote(record) ?? base.dataNote,
    eligibilityCheckedOn: record.updatedAt,
  };

  // Income and score floors: only a published figure filters anyone out.
  if (record.minSalaryMonthly != null) merged.minSalary = record.minSalaryMonthly;
  if (record.cibilScoreMin != null) merged.minCreditScore = record.cibilScoreMin;
  else delete merged.minCreditScore;

  // Fee structure is replaced wholesale when the lender publishes one, so a
  // flat fee can never be left sitting under a newly published percentage.
  if (record.processingFeeFlat != null) {
    merged.processingFeeFlat = record.processingFeeFlat;
    delete merged.processingFeePercent;
    delete merged.processingFeeCapAmount;
  } else if (record.processingFeePercent != null) {
    merged.processingFeePercent = record.processingFeePercent;
    delete merged.processingFeeFlat;
    if (record.processingFeeMax != null) merged.processingFeeCapAmount = record.processingFeeMax;
    else delete merged.processingFeeCapAmount;
  }

  return merged;
}

/**
 * The lender database with every personal-loan product replaced by what the
 * lender publishes today. Lenders we have no scraped record for (and every
 * other loan type) are returned untouched.
 */
export function applyPersonalLoanSource(db: LenderDatabase): LenderDatabase {
  let scrapedLatest = '';
  const lenders: Lender[] = db.lenders.map((lender) => {
    const record = BY_DATABASE_ID.get(lender.id);
    const base = lender.products.personal;
    if (!record || !base) return lender;

    if (record.updatedAt > scrapedLatest) scrapedLatest = record.updatedAt;
    return {
      ...lender,
      lastUpdated: record.updatedAt > lender.lastUpdated ? record.updatedAt : lender.lastUpdated,
      products: { ...lender.products, personal: mergeProduct(base, record) },
    };
  });

  return {
    ...db,
    lenders,
    lastUpdated: scrapedLatest > db.lastUpdated ? scrapedLatest : db.lastUpdated,
  };
}
