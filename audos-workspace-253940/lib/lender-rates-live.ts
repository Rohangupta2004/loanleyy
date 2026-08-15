/**
 * lender-rates-live — the ONE place a customer screen gets live lender rates.
 *
 * The weekly 'weekly-lender-refresh' server function (schedule: 'Weekly lender
 * rate refresh'; targets and guards mirrored in data/scrape-config.json) writes
 * fresh rate-card values into the WorkspaceDB table `lender_rate_overrides`.
 * This module loads those rows once per page and layers them over the static
 * data/lenders.ts bundle, so a weekly refresh reaches borrowers on their next
 * page load with no republish.
 *
 * The personal-loan half of that bundle is itself replaced first, by
 * data/personal_loans.json (via lib/personal-loan-source.ts) — the scraped
 * dataset of 20 lenders' published terms that borrowers can download and check
 * the ranking against. A weekly override refreshes a value inside that
 * dataset; it never stands in for it.
 *
 * The approval criteria are then set from Loanley's desk credit-policy record
 * (data/policy_rules.json, via lib/policy-rules.ts), because lenders publish
 * rate cards rather than approval rules. That layer sets no rate and no fee, so
 * it cannot reorder the ranking — it only decides who qualifies, and every
 * criterion it sets is labelled as desk policy where the borrower reads it.
 *
 * Every customer surface must get its lenders from here (`useLiveLenderDb()`)
 * and hand the result to `compareLenders(req, data)` — never read
 * `lender_rate_overrides` directly, or the validation below is bypassed and the
 * two screens can disagree.
 *
 * Safety rules, in order:
 *   1. The read is best-effort. Empty table, missing SDK, revoked token,
 *      offline — anything that is not a clean row set falls back to exactly the
 *      bundled rate card. Customers never see a blank or an error because of it.
 *   2. Values are coerced (the data API returns numerics as strings) and each
 *      field is validated on its own. An absent/NULL column means "no override
 *      — keep the bundled value".
 *   3. A rate outside the plausibility band the weekly hook itself applies
 *      (data/scrape-config.json `sanity`), or one that would invert a lender's
 *      published range, is dropped and the bundled value for that field
 *      stands. A bad scrape can therefore never show nonsense pricing.
 *   4. The newest row wins per lender+product, so a stale duplicate can't
 *      resurrect an old rate.
 */
import { useEffect, useMemo, useState } from 'react';
import { LENDER_DB } from '../data/lenders';
import type { Lender, LenderProduct, LoanProductType } from '../data/lenders';
import { applyPersonalLoanSource } from './personal-loan-source';
import { applyPolicyRules } from './policy-rules';

/** WorkspaceDB table the weekly refresh writes. */
export const RATE_OVERRIDE_TABLE = 'lender_rate_overrides';

/**
 * The plausibility band the weekly hook applies before it writes anything
 * (data/scrape-config.json → `sanity`). Re-applied here so the merge and the
 * scrape agree on what "a possible Indian retail lending rate" means, even if
 * a row was written by an older version of the hook.
 */
export const RATE_PLAUSIBLE_MIN_PCT = 4;
export const RATE_PLAUSIBLE_MAX_PCT = 40;
/** The hook only accepts an extracted processing fee in (0%, 10%]. */
export const FEE_PLAUSIBLE_MAX_PCT = 10;

/** Generous ceiling: 27 rows today, one per lender+product that is scraped. */
const OVERRIDE_ROW_LIMIT = 200;

/**
 * A row of `lender_rate_overrides`. The data API serialises numerics as
 * strings, and every override column is nullable — NULL means "no override for
 * this field".
 */
export interface RateOverrideRow {
  id?: number | string | null;
  lender_id: string;
  product: string;
  interest_rate_min?: string | number | null;
  interest_rate_max?: string | number | null;
  processing_fee_percent?: string | number | null;
  /** ISO date (YYYY-MM-DD) the refresh last wrote this row. */
  last_updated?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** The lender database a customer screen should rank off. */
export interface LiveLenderData {
  lenders: Lender[];
  lastUpdated: string;
  /** How many individual field values came from the override table. */
  overriddenFields: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toNum(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function plausibleRate(value: string | number | null | undefined): number | null {
  const n = toNum(value);
  if (n == null) return null;
  return n >= RATE_PLAUSIBLE_MIN_PCT && n <= RATE_PLAUSIBLE_MAX_PCT ? n : null;
}

function plausibleFeePct(value: string | number | null | undefined): number | null {
  const n = toNum(value);
  if (n == null) return null;
  return n > 0 && n <= FEE_PLAUSIBLE_MAX_PCT ? n : null;
}

function isoDate(value: string | null | undefined): string | null {
  return typeof value === 'string' && ISO_DATE_RE.test(value) ? value : null;
}

/** ISO dates compare correctly as strings — keep the later one. */
function laterDate(a: string, b: string | null): string {
  return b != null && b > a ? b : a;
}

/** Milliseconds for "which of these two rows was written last". */
function rowWrittenAt(row: RateOverrideRow): number {
  for (const candidate of [row.updated_at, row.created_at]) {
    if (typeof candidate === 'string') {
      const t = Date.parse(candidate);
      if (Number.isFinite(t)) return t;
    }
  }
  const day = isoDate(row.last_updated);
  if (day) {
    const t = Date.parse(`${day}T00:00:00Z`);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/** Positive when `a` is the newer row; ties break on the higher row id. */
function compareRowRecency(a: RateOverrideRow, b: RateOverrideRow): number {
  const byTime = rowWrittenAt(a) - rowWrittenAt(b);
  if (byTime !== 0) return byTime;
  return (toNum(a.id) ?? 0) - (toNum(b.id) ?? 0);
}

interface ProductMerge {
  product: LenderProduct;
  /** Fields whose displayed value now comes from the override row. */
  fieldsApplied: number;
  /** Fields the refresh re-confirmed at the value the bundle already had. */
  fieldsConfirmed: number;
}

/**
 * Layer one override row over one bundled product. Each field is validated
 * independently, and a pair of rates that would invert the published range is
 * discarded wholesale — the bundled range is always a coherent one.
 */
function mergeProduct(base: LenderProduct, row: RateOverrideRow): ProductMerge {
  const patch: Partial<LenderProduct> = {};
  let fieldsApplied = 0;
  let fieldsConfirmed = 0;

  const overrideMin = plausibleRate(row.interest_rate_min);
  const overrideMax = plausibleRate(row.interest_rate_max);
  if (overrideMin != null || overrideMax != null) {
    const nextMin = overrideMin ?? base.interestRateMin;
    const nextMax = overrideMax ?? base.interestRateMax;
    // An inverted range (min above max) would show as "12%–9%" and would rank
    // the lender off a nonsense midpoint. Keep the bundled pair instead.
    if (nextMin <= nextMax) {
      if (overrideMin != null) {
        if (overrideMin !== base.interestRateMin) {
          patch.interestRateMin = overrideMin;
          fieldsApplied += 1;
        } else {
          fieldsConfirmed += 1;
        }
      }
      if (overrideMax != null) {
        if (overrideMax !== base.interestRateMax) {
          patch.interestRateMax = overrideMax;
          fieldsApplied += 1;
        } else {
          fieldsConfirmed += 1;
        }
      }
    }
  }

  // Only percentage fees are refreshed. A product the lender prices as a flat
  // fee keeps its published flat fee — computeFee() reads that first, so
  // writing a percentage over it would be silently dead anyway.
  const overrideFee = plausibleFeePct(row.processing_fee_percent);
  if (overrideFee != null && base.processingFeeFlat == null && base.processingFeePercent != null) {
    if (overrideFee !== base.processingFeePercent) {
      patch.processingFeePercent = overrideFee;
      fieldsApplied += 1;
    } else {
      fieldsConfirmed += 1;
    }
  }

  if (fieldsApplied === 0) return { product: base, fieldsApplied: 0, fieldsConfirmed };
  return { product: { ...base, ...patch }, fieldsApplied, fieldsConfirmed };
}

/**
 * Pure merge: bundled lender database + override rows → the database customer
 * screens should rank off. Safe with `null`, `[]`, malformed rows or rows for
 * lenders and products the bundle doesn't carry.
 */
export function mergeRateOverrides(rows: RateOverrideRow[] | null | undefined): LiveLenderData {
  const source = applyPolicyRules(applyPersonalLoanSource(LENDER_DB));
  const bundled: LiveLenderData = {
    lenders: source.lenders,
    lastUpdated: source.lastUpdated,
    overriddenFields: 0,
  };
  if (!Array.isArray(rows) || rows.length === 0) return bundled;

  // Newest row per lender+product — a stale duplicate must never win.
  const newest = new Map<string, RateOverrideRow>();
  for (const row of rows) {
    if (!row || typeof row.lender_id !== 'string' || typeof row.product !== 'string') continue;
    const key = `${row.lender_id}|${row.product}`;
    const existing = newest.get(key);
    if (!existing || compareRowRecency(row, existing) >= 0) newest.set(key, row);
  }
  if (newest.size === 0) return bundled;

  let overriddenFields = 0;
  let touchedLenders = 0;
  let lastUpdated = source.lastUpdated;

  const lenders = source.lenders.map((lender) => {
    const products = { ...lender.products };
    let lenderFields = 0;
    let lenderTouched = false;
    let lenderUpdated = lender.lastUpdated;

    for (const productType of Object.keys(products) as LoanProductType[]) {
      const base = products[productType];
      if (!base) continue;
      const row = newest.get(`${lender.id}|${productType}`);
      if (!row) continue;
      const merged = mergeProduct(base, row);
      // A refresh that re-read the page and confirmed the bundled number is a
      // real re-verification, so it moves the date even with nothing to apply.
      // A row whose values were all rejected moves nothing.
      if (merged.fieldsApplied === 0 && merged.fieldsConfirmed === 0) continue;
      products[productType] = merged.product;
      lenderFields += merged.fieldsApplied;
      lenderTouched = true;
      lenderUpdated = laterDate(lenderUpdated, isoDate(row.last_updated));
    }

    if (!lenderTouched) return lender;
    touchedLenders += 1;
    overriddenFields += lenderFields;
    lastUpdated = laterDate(lastUpdated, lenderUpdated);
    return { ...lender, products, lastUpdated: lenderUpdated };
  });

  if (touchedLenders === 0) return bundled;
  return { lenders, lastUpdated, overriddenFields };
}

/*
 * One read per page, shared by every screen.
 *
 * The refresh writes workspace-owned rows with session_id = NULL, so the read
 * has to be a shared one — a session-scoped read returns nothing for a
 * signed-out borrower. The `window.__workspaceDb` reference is also what tells
 * the platform to inject the WorkspaceDB SDK into this bundle.
 */
let cachedRows: RateOverrideRow[] | null = null;
let inFlight: Promise<RateOverrideRow[] | null> | null = null;

export function loadRateOverrides(): Promise<RateOverrideRow[] | null> {
  if (cachedRows) return Promise.resolve(cachedRows);
  if (inFlight) return inFlight;

  const db = typeof window !== 'undefined' ? (window as any).__workspaceDb : undefined;
  if (!db || typeof db.from !== 'function') return Promise.resolve(null);

  inFlight = Promise.resolve()
    .then(() => db.from(RATE_OVERRIDE_TABLE, { shared: true }).limit(OVERRIDE_ROW_LIMIT).get())
    .then((res: any) => {
      const rows: RateOverrideRow[] = Array.isArray(res?.data) ? res.data : [];
      cachedRows = rows;
      inFlight = null;
      return rows;
    })
    .catch((err: unknown) => {
      // Table missing, token revoked, offline: borrowers keep the bundled rate
      // card rather than an error.
      console.warn('[loanley] live lender rates unavailable — using the bundled rate card', err);
      inFlight = null;
      return null;
    });

  return inFlight;
}

/** Test/diagnostic seam: forget the cached read so the next call refetches. */
export function resetRateOverrideCache(): void {
  cachedRows = null;
  inFlight = null;
}

/**
 * The lender database to rank off: the bundle until the override read lands,
 * the merged database afterwards. Never throws and never renders empty.
 */
export function useLiveLenderDb(): LiveLenderData {
  const [rows, setRows] = useState<RateOverrideRow[] | null>(cachedRows);

  useEffect(() => {
    let active = true;
    loadRateOverrides().then((loaded) => {
      if (active && loaded) setRows(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return useMemo(() => mergeRateOverrides(rows), [rows]);
}
