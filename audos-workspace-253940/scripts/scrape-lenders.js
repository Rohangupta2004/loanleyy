#!/usr/bin/env node
/**
 * scrape-lenders.js — weekly refresh for Loanley's lender database.
 *
 * What it does:
 *   1. Reads data/scrape-config.json (one target per lender product page) and
 *      data/lenders.json (the canonical database).
 *   2. Fetches each enabled target's official rate-card page.
 *   3. Extracts rate ranges / fees with regex patterns (per-target `patterns`
 *      override the config's `defaultPatterns`). Pages that render rates with
 *      client-side JS won't match — swap the fetch for cheerio/puppeteer per
 *      target when needed; the diff/write pipeline stays the same.
 *   4. Fetches each enabled eligibility target and extracts the published
 *      minimum income, minimum CIBIL, business vintage, annual turnover and
 *      education collateral threshold. These decide who the app tells a
 *      borrower to apply to, so a changed value is never written silently: it
 *      is reported and held for review (see ELIGIBILITY below).
 *   5. Diffs extracted values against lenders.json, applies sane rate/fee
 *      changes, bumps `lastUpdated` (per lender and global), writes
 *      lenders.json and regenerates data/lenders.ts (the bundle mirror).
 *   6. Prints a change log for review. Rate changes bigger than
 *      sanity.reviewThresholdPct are flagged REVIEW.
 *
 * ELIGIBILITY (minSalary / minCreditScore / minBusinessVintageMonths /
 * minAnnualTurnover / collateralRequiredAboveAmount): the ranking filters
 * borrowers out on these fields, so a wrong minimum means someone is told to
 * apply where they will be rejected — or is hidden from a lender that would
 * have said yes. They are therefore HELD by default: every difference between
 * the page and the database is printed under "Eligibility drift" and written
 * to data/eligibility-drift.json for review, and nothing is overwritten. Pass
 * --apply-eligibility once a diff has been eyeballed to write the new values.
 * `eligibilityCheckedOn` on a product only moves when the page still agrees
 * with the stored value (a real re-verification), never while a drift is
 * outstanding — otherwise the stamp would claim a stale minimum was just
 * verified. "no plausible X found" in the issues list means the stored value
 * could NOT be verified from the page, not that it is fine.
 *
 * Usage:
 *   node scripts/scrape-lenders.js                     # fetch, diff, write
 *   node scripts/scrape-lenders.js --dry-run           # fetch + diff, write nothing
 *   node scripts/scrape-lenders.js --rates-only        # skip eligibility pages
 *   node scripts/scrape-lenders.js --eligibility-only  # skip rate-card pages
 *   node scripts/scrape-lenders.js --apply-eligibility # write reviewed eligibility drift
 *   node scripts/scrape-lenders.js --sync              # no fetching; rewrite
 *                                                      # data/lenders.json and
 *                                                      # regenerate data/lenders.ts
 *
 * LIVE AUTOMATION (wired 2026-08-06): the weekly refresh now runs on the
 * platform task-scheduler — the recurring schedule 'Weekly lender rate
 * refresh' (Wednesdays 06:30 IST) triggers the 'weekly-lender-refresh'
 * server-function hook. The hook applies the same enabled targets, patterns
 * and sanity guards as data/scrape-config.json and writes fresh values into
 * the WorkspaceDB table 'lender_rate_overrides'. Changes bigger than
 * sanity.reviewThresholdPct (or rates far outside the lib/loan-benchmarks
 * band) are HELD for founder review in 'lender_rate_updates' and surfaced in
 * the founder's chat, never auto-applied. Eligibility drift must be held the
 * same way and never auto-applied. After editing targets in
 * data/scrape-config.json, mirror the change into the hook (PATCH
 * /api/workspaces/253940/hooks/{hookId}).
 *
 * REACHES CUSTOMERS (wired 2026-08-12): what the hook writes into
 * 'lender_rate_overrides' is read by lib/lender-rates-live.ts, which loads the
 * rows once per page (shared read — they are workspace-owned, session_id
 * NULL) and layers them over the static data/lenders.ts bundle. Both live
 * surfaces — apps/LoanCheck and the loanley-compare chat card
 * (components/LenderCompareCard.tsx) — hand that merged database to
 * compareLenders(), so a weekly write reaches borrowers on their next page
 * load with no republish. The merge re-applies the same sanity band as this
 * script (a rate outside minPlausibleRatePct..maxPlausibleRatePct, a fee
 * outside (0%, 10%], or a pair that would invert a published range is dropped
 * in favour of the bundled value), keeps the newest row per lender+product,
 * and falls back to exactly the bundled rates when the table is empty or
 * unreachable. apps/LenderRates is retired and unregistered — it is not
 * the customer path.
 *
 * This script remains the local/manual path for refreshing the static
 * baseline files (data/lenders.json + data/lenders.ts) ahead of a publish —
 * that baseline is what an override is layered onto, and what customers see
 * whenever there is no override for a field.
 * Requires Node 18+ (global fetch). No third-party dependencies.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LENDERS_JSON = path.join(ROOT, 'data', 'lenders.json');
const LENDERS_TS = path.join(ROOT, 'data', 'lenders.ts');
const CONFIG_JSON = path.join(ROOT, 'data', 'scrape-config.json');
const DRIFT_JSON = path.join(ROOT, 'data', 'eligibility-drift.json');

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC_ONLY = process.argv.includes('--sync');
const RATES_ONLY = process.argv.includes('--rates-only');
const ELIGIBILITY_ONLY = process.argv.includes('--eligibility-only');
const APPLY_ELIGIBILITY = process.argv.includes('--apply-eligibility');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeLendersJson(db) {
  fs.writeFileSync(LENDERS_JSON, JSON.stringify(db, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, LENDERS_JSON)} (lastUpdated ${db.lastUpdated})`);
}

/** Regenerate the TypeScript bundle mirror from the canonical JSON. */
function regenerateTsMirror(db) {
  const header = `/**
 * GENERATED FILE — keep in sync with data/lenders.json.
 *
 * Regenerated by scripts/scrape-lenders.js on ${today()}. Edit
 * data/lenders.json (the canonical database), then run:
 *   node scripts/scrape-lenders.js --sync
 */

export type LoanProductType = 'personal' | 'home' | 'business' | 'education' | 'loan_against_property';
export type EmploymentType = 'salaried' | 'self_employed';
export type LenderType = 'public_sector_bank' | 'private_bank' | 'nbfc';

export interface LenderProduct {
  interestRateMin: number;
  interestRateMax: number;
  /** Fee as % of loan amount (use with optional processingFeeCapAmount). */
  processingFeePercent?: number;
  /** Absolute cap in ₹ for a percentage fee. */
  processingFeeCapAmount?: number;
  /** Flat fee in ₹ (used instead of a percentage). */
  processingFeeFlat?: number;
  minLoanAmount: number;
  maxLoanAmount: number;
  minTenureMonths: number;
  maxTenureMonths: number;
  /** Minimum net monthly income in ₹ the lender publishes for this product. */
  minSalary?: number;
  employmentTypes: EmploymentType[];
  /** Minimum CIBIL score per the lender's published criteria. */
  minCreditScore?: number;
  /**
   * Business loans: minimum months the business must have been operating, per
   * the lender's own published eligibility page. Absent when unpublished.
   */
  minBusinessVintageMonths?: number;
  /** Business loans: minimum published annual turnover in ₹. */
  minAnnualTurnover?: number;
  /**
   * Education loans: loan amount in ₹ above which the lender's published
   * scheme requires tangible collateral security. Absent when the lender
   * publishes security types but no amount threshold.
   */
  collateralRequiredAboveAmount?: number;
  /** Education loans: a parent/guardian co-borrower is published as mandatory. */
  coApplicantRequired?: boolean;
  /** Education loans: minimum published co-applicant monthly income in ₹. */
  minCoApplicantMonthlyIncome?: number;
  /** Education loans: the published course / institution requirement. */
  institutionRequirement?: string;
  /** Date the eligibility fields above were last verified on the lender's page. */
  eligibilityCheckedOn?: string;
  sourceUrl: string;
  dataNote?: string;
}

export interface Lender {
  id: string;
  name: string;
  type: LenderType;
  sourceUrl: string;
  lastUpdated: string;
  dataNote?: string;
  productTypes: LoanProductType[];
  products: Partial<Record<LoanProductType, LenderProduct>>;
}

export interface LenderDatabase {
  name: string;
  description: string;
  version: number;
  lastUpdated: string;
  currency: string;
  rateContext: { rbiRepoRatePct: number; asOf: string; sourceUrl: string; note: string };
  methodology: string;
  disclaimer: string;
  lenders: Lender[];
}

`;
  const body = `export const LENDER_DB: LenderDatabase = ${JSON.stringify(db, null, 2)};\n`;
  if (DRY_RUN) {
    console.log(`[dry-run] would regenerate ${path.relative(ROOT, LENDERS_TS)}`);
    return;
  }
  fs.writeFileSync(LENDERS_TS, header + body);
  console.log(`regenerated ${path.relative(ROOT, LENDERS_TS)}`);
}

/** Extract a { min, max } rate pair from page text using configured patterns. */
function extractRates(text, patterns, sanity) {
  const plausible = (n) => n >= sanity.minPlausibleRatePct && n <= sanity.maxPlausibleRatePct;

  const rangeRe = new RegExp(patterns.rateRange, 'gi');
  let best = null;
  let m;
  while ((m = rangeRe.exec(text)) !== null) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    if (plausible(lo) && plausible(hi) && lo < hi) {
      // Prefer the widest plausible range on the page (rate cards usually
      // publish the full band; narrower matches tend to be examples).
      if (!best || hi - lo > best.max - best.min) best = { min: lo, max: hi };
    }
  }
  if (best) return best;

  const onwardsRe = new RegExp(patterns.rateOnwards, 'gi');
  while ((m = onwardsRe.exec(text)) !== null) {
    const lo = parseFloat(m[1]);
    if (plausible(lo)) return { min: lo, max: null }; // keep existing max
  }
  return null;
}

function extractFeePercent(text, patterns, sanity) {
  const feeRe = new RegExp(patterns.processingFeePercent, 'gi');
  const m = feeRe.exec(text);
  if (!m) return null;
  const pct = parseFloat(m[1]);
  return pct > 0 && pct <= 10 ? pct : null;
}

/* ============================================================================
 * Eligibility extraction — minimum income, CIBIL, vintage, turnover, security.
 * Indian lenders write these as "₹25,000 per month", "CIBIL score of 685 or
 * higher", "at least 3 years", "turnover of ₹40 lakh", "no collateral up to
 * ₹7.50 lakh", so each field needs its own unit handling. Anything outside the
 * configured plausible band is discarded rather than guessed at.
 * ==========================================================================*/

const AMOUNT_MULTIPLIERS = {
  lakh: 100000,
  lakhs: 100000,
  lac: 100000,
  lacs: 100000,
  crore: 10000000,
  crores: 10000000,
  cr: 10000000,
};

function parseAmount(digits, unit) {
  const n = parseFloat(String(digits).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  if (!unit) return Math.round(n);
  const mult = AMOUNT_MULTIPLIERS[unit.toLowerCase().replace(/\.$/, '')];
  return mult ? Math.round(n * mult) : null;
}

/**
 * First match of `pattern` mapped through `map`, or null. A field may carry
 * several patterns (lenders phrase the same criterion half a dozen ways); they
 * are tried in order, most specific first.
 */
function firstMatch(text, pattern, map) {
  if (!pattern) return null;
  for (const source of Array.isArray(pattern) ? pattern : [pattern]) {
    const re = new RegExp(source, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = map(m);
      if (value != null) return value;
    }
  }
  return null;
}

function extractEligibility(text, fields, patterns, sanity) {
  const found = {};
  const within = (n, lo, hi) => n != null && n >= lo && n <= hi;

  if (fields.includes('minSalary')) {
    const value = firstMatch(text, patterns.minSalary, (m) => {
      const amount = parseAmount(m[1], m[2]);
      return within(amount, sanity.minPlausibleSalary, sanity.maxPlausibleSalary) ? amount : null;
    });
    if (value != null) found.minSalary = value;
  }

  if (fields.includes('minCreditScore')) {
    const value = firstMatch(text, patterns.minCreditScore, (m) => {
      const score = parseInt(m[1], 10);
      return within(score, sanity.minPlausibleCreditScore, sanity.maxPlausibleCreditScore) ? score : null;
    });
    if (value != null) found.minCreditScore = value;
  }

  if (fields.includes('minBusinessVintageMonths')) {
    const value = firstMatch(text, patterns.minBusinessVintageMonths, (m) => {
      const n = parseFloat(m[1]);
      if (!isFinite(n)) return null;
      const months = /month/i.test(m[2]) ? Math.round(n) : Math.round(n * 12);
      return within(months, sanity.minPlausibleVintageMonths, sanity.maxPlausibleVintageMonths) ? months : null;
    });
    if (value != null) found.minBusinessVintageMonths = value;
  }

  if (fields.includes('collateralRequiredAboveAmount')) {
    const value = firstMatch(text, patterns.collateralRequiredAboveAmount, (m) => {
      const amount = parseAmount(m[1], m[2]);
      return within(amount, sanity.minPlausibleCollateralThreshold, sanity.maxPlausibleCollateralThreshold)
        ? amount
        : null;
    });
    if (value != null) found.collateralRequiredAboveAmount = value;
  }

  if (fields.includes('minAnnualTurnover')) {
    const value = firstMatch(text, patterns.minAnnualTurnover, (m) => {
      const amount = parseAmount(m[1], m[2]);
      return within(amount, sanity.minPlausibleTurnover, sanity.maxPlausibleTurnover) ? amount : null;
    });
    if (value != null) found.minAnnualTurnover = value;
  }

  return found;
}

async function fetchPage(url, userAgent) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Cheap HTML → text: drop scripts/styles/tags, collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Rate-card + fee refresh. Mutates `db`; returns log lines. */
async function refreshRates(db, config) {
  const sanity = config.sanity;
  const changes = [];
  const failures = [];

  for (const target of config.targets) {
    if (target.enabled === false) continue;
    const fields = target.fields || config.defaults.fields;
    const lender = db.lenders.find((l) => l.id === target.lenderId);
    const product = lender && lender.products[target.product];
    if (!product) {
      failures.push(`${target.lenderId}/${target.product}: not present in lenders.json`);
      continue;
    }

    const patterns = { ...config.defaultPatterns, ...(target.patterns || {}) };
    let text;
    try {
      text = await fetchPage(target.url, config.userAgent);
    } catch (err) {
      failures.push(`${target.lenderId}/${target.product}: fetch failed (${err.message}) — kept existing values`);
      await sleep(config.requestDelayMs);
      continue;
    }

    const applyChange = (field, oldVal, newVal) => {
      if (newVal == null || newVal === oldVal) return;
      const delta = Math.abs(newVal - (oldVal ?? newVal));
      const flag = delta > sanity.reviewThresholdPct ? '  << REVIEW: large change' : '';
      changes.push(`${lender.name} [${target.product}] ${field}: ${oldVal} -> ${newVal}${flag}`);
      product[field] = newVal;
      lender.lastUpdated = today();
    };

    if (fields.includes('interestRateMin') || fields.includes('interestRateMax')) {
      const rates = extractRates(text, patterns, sanity);
      if (rates) {
        applyChange('interestRateMin', product.interestRateMin, rates.min);
        if (rates.max != null) applyChange('interestRateMax', product.interestRateMax, rates.max);
      } else {
        failures.push(`${target.lenderId}/${target.product}: no plausible rate found on page — kept existing values`);
      }
    }
    if (fields.includes('processingFeePercent') && product.processingFeePercent != null) {
      applyChange('processingFeePercent', product.processingFeePercent, extractFeePercent(text, patterns, sanity));
    }

    await sleep(config.requestDelayMs);
  }

  return { changes, failures };
}

/**
 * Every eligibility target this config monitors. `eligibility.targets` names
 * the page that actually publishes the criteria (most business and education
 * criteria never appear on a rate card) and wins over the rate targets, which
 * then fill in the products whose rate card also carries the minimum income
 * and CIBIL — personal, home and loan-against-property.
 */
function resolveEligibilityTargets(config) {
  const eligibility = config.eligibility || {};
  const defaultFields = eligibility.fields || [];
  const resolved = [];
  const seen = new Set();

  const add = (target, url, fields) => {
    const key = `${target.lenderId}/${target.product}`;
    if (seen.has(key)) return;
    seen.add(key);
    resolved.push({
      lenderId: target.lenderId,
      product: target.product,
      url,
      fields,
      patterns: { ...(eligibility.patterns || {}), ...(target.eligibilityPatterns || target.patterns || {}) },
      note: target.note || target.patternNote,
    });
  };

  for (const target of eligibility.targets || []) {
    if (target.enabled === false) {
      // A disabled eligibility target is a deliberate "do not monitor this
      // product", so don't let the rate target silently take its place.
      seen.add(`${target.lenderId}/${target.product}`);
      continue;
    }
    add(target, target.url, target.fields || defaultFields);
  }
  if (eligibility.reuseRateTargets !== false) {
    for (const target of config.targets) {
      const url = target.eligibilityUrl || target.url;
      const enabled = target.eligibilityEnabled != null ? target.eligibilityEnabled : target.enabled !== false;
      if (!enabled) continue;
      add(target, url, target.eligibilityFields || defaultFields);
    }
  }
  return resolved;
}

/**
 * Eligibility refresh. Never overwrites by default: differences are returned
 * as drift records for review. Only re-verifications (page still agrees with
 * the database) touch `eligibilityCheckedOn`.
 */
async function refreshEligibility(db, config) {
  const eligibility = config.eligibility || {};
  const sanity = eligibility.sanity || {};
  const drift = [];
  const confirmed = [];
  const failures = [];
  const stamp = today();

  for (const target of resolveEligibilityTargets(config)) {
    const lender = db.lenders.find((l) => l.id === target.lenderId);
    const product = lender && lender.products[target.product];
    if (!product) {
      failures.push(`${target.lenderId}/${target.product}: not present in lenders.json`);
      continue;
    }
    // Only fields the database already tracks for this product are monitored: a
    // lender that publishes no turnover keeps the field absent on purpose, and
    // the scraper must not invent one out of loose page copy.
    const fields = target.fields.filter((f) => product[f] != null);
    if (fields.length === 0) continue;

    let text;
    try {
      text = await fetchPage(target.url, config.userAgent);
    } catch (err) {
      failures.push(
        `${target.lenderId}/${target.product}: eligibility fetch failed (${err.message}) — kept existing values`,
      );
      await sleep(config.requestDelayMs);
      continue;
    }

    const found = extractEligibility(text, fields, target.patterns, sanity);
    let allConfirmed = true;
    for (const field of fields) {
      const scraped = found[field];
      if (scraped == null) {
        allConfirmed = false;
        failures.push(
          `${target.lenderId}/${target.product}: no plausible ${field} found on ${target.url} — kept ${product[field]} (unverified)`,
        );
        continue;
      }
      if (scraped === product[field]) continue;
      allConfirmed = false;
      drift.push({
        lenderId: lender.id,
        lenderName: lender.name,
        product: target.product,
        field,
        current: product[field],
        scraped,
        url: target.url,
        detectedOn: stamp,
        status: APPLY_ELIGIBILITY ? 'applied' : 'held_for_review',
      });
      if (APPLY_ELIGIBILITY) {
        product[field] = scraped;
        product.eligibilityCheckedOn = stamp;
        lender.lastUpdated = stamp;
      }
    }
    // A page that still agrees with every stored value is a real
    // re-verification, so the stamp moves. An outstanding drift leaves it
    // alone — it would otherwise claim a stale value was just checked.
    if (allConfirmed) {
      confirmed.push(`${lender.name} [${target.product}] ${fields.join(', ')} unchanged (${target.url})`);
      if (!DRY_RUN) product.eligibilityCheckedOn = stamp;
    }

    await sleep(config.requestDelayMs);
  }

  return { drift, confirmed, failures };
}

function reportEligibility({ drift, confirmed, failures }) {
  console.log('\n=== Eligibility summary ===');
  console.log(`re-verified: ${confirmed.length}, drift: ${drift.length}, issues: ${failures.length}\n`);
  if (drift.length) {
    console.log(
      APPLY_ELIGIBILITY
        ? 'Eligibility drift (APPLIED — --apply-eligibility was passed):'
        : 'Eligibility drift (HELD — nothing written, review then re-run with --apply-eligibility):',
    );
    for (const d of drift) {
      console.log(`  ${d.lenderName} [${d.product}] ${d.field}: ${d.current} -> ${d.scraped}`);
      console.log(`      published at ${d.url}`);
    }
    console.log(
      '\n  These decide who the app tells a borrower to apply to. Confirm each on the\n' +
        '  lender page above before applying: a wrong minimum either sends someone to a\n' +
        '  lender that will reject them, or hides one that would have said yes.',
    );
  }
  if (confirmed.length) {
    console.log('\nRe-verified (page still matches the database):');
    for (const c of confirmed) console.log('  ' + c);
  }
  if (failures.length) {
    console.log('\nIssues (existing values kept, now unverified — review or add per-target eligibility patterns):');
    for (const f of failures) console.log('  ' + f);
  }
}

function writeDriftFile(drift) {
  if (DRY_RUN) {
    console.log(`\n[dry-run] would write ${path.relative(ROOT, DRIFT_JSON)} (${drift.length} record(s))`);
    return;
  }
  const payload = {
    note: APPLY_ELIGIBILITY
      ? 'Eligibility values that differed from data/lenders.json and were applied by scripts/scrape-lenders.js --apply-eligibility. Kept as the audit trail of what the ranking now filters on.'
      : 'Eligibility values that differ from data/lenders.json, written by scripts/scrape-lenders.js. Held for review — the ranking keeps using the "current" value until someone confirms the lender page and re-runs with --apply-eligibility.',
    generatedOn: today(),
    applied: APPLY_ELIGIBILITY,
    records: drift,
  };
  fs.writeFileSync(DRIFT_JSON, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(ROOT, DRIFT_JSON)} (${drift.length} record(s))`);
}

async function main() {
  const db = readJson(LENDERS_JSON);

  if (SYNC_ONLY) {
    // Sync writes both halves of the database: the canonical JSON (normalised)
    // and the TypeScript mirror the space bundle imports.
    if (DRY_RUN) console.log(`[dry-run] would rewrite ${path.relative(ROOT, LENDERS_JSON)}`);
    else writeLendersJson(db);
    regenerateTsMirror(db);
    return;
  }

  const config = readJson(CONFIG_JSON);
  let rateResult = { changes: [], failures: [] };
  let eligibilityResult = { drift: [], confirmed: [], failures: [] };

  if (!ELIGIBILITY_ONLY) rateResult = await refreshRates(db, config);
  if (!RATES_ONLY) eligibilityResult = await refreshEligibility(db, config);

  if (!ELIGIBILITY_ONLY) {
    console.log('\n=== Rate summary ===');
    console.log(
      `targets: ${config.targets.filter((t) => t.enabled !== false).length}, changes: ${
        rateResult.changes.length
      }, issues: ${rateResult.failures.length}\n`,
    );
    if (rateResult.changes.length) {
      console.log('Changes:');
      for (const c of rateResult.changes) console.log('  ' + c);
    }
    if (rateResult.failures.length) {
      console.log('\nIssues (existing data kept — review or add per-target patterns):');
      for (const f of rateResult.failures) console.log('  ' + f);
    }
  }
  if (!RATES_ONLY) {
    reportEligibility(eligibilityResult);
    if (eligibilityResult.drift.length) writeDriftFile(eligibilityResult.drift);
  }

  db.lastUpdated = today();
  if (DRY_RUN) {
    console.log('\n[dry-run] no files written');
    return;
  }
  writeLendersJson(db);
  regenerateTsMirror(db);
  console.log('Done. Redeploy/publish the space so the bundle picks up the refreshed data.');
}

main().catch((err) => {
  console.error('scrape-lenders failed:', err);
  process.exit(1);
});
