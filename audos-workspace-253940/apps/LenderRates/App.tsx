/**
 * RETIRED — this screen is NOT registered in config.json and no customer can
 * reach it. Do not mistake it for the live surface, and do not fix a rate bug
 * here: the live comparison path is apps/LoanCheck + components/
 * LenderCompareCard, both ranking through lib/lender-compare.ts.
 *
 * The live rate overrides this file used to be the only reader of now belong
 * to lib/lender-rates-live.ts — the one shared loader and validated merge that
 * every customer screen uses. This file keeps rendering only because the merge
 * below now comes from that same module, so it can never drift from what
 * borrowers actually see. Anything new goes in lib/lender-rates-live.ts.
 *
 * Lender Rates — Loanley's neutral rate explorer for Indian banks & NBFCs (₹).
 *
 * Design brief: a scannable financial data table, not a comparison-site page.
 * A navy zero-commission strip sits above everything; filters stick to the
 * top; each row shows the published rate range (large, tabular) with an
 * inline citation chip to the lender's own official page, plus processing fee
 * and last-updated date. Deliberate constraints:
 *   • No 'Apply Now' buttons, no referral or affiliate links, no sponsored slots.
 *   • The 'Best for your profile' callout appears ONLY once the visitor has
 *     picked an employment type — and it is pure published-data maths.
 *   • Lenders filtered out are still listed at the bottom with the reason.
 */
import { useMemo, useState } from 'react';
import { SourceChip, shortLenderName } from '../../components/LoanleyCards';
import { LENDER_DB } from '../../data/lenders';
import type { EmploymentType, Lender, LenderProduct, LoanProductType } from '../../data/lenders';
import { useLiveLenderDb } from '../../lib/lender-rates-live';
import { LENDER_TYPE_LABELS } from '../../lib/lender-compare';
import { formatINRCompact } from '../../lib/loan-benchmarks';

const LOAN_TYPE_OPTIONS: { value: LoanProductType; label: string }[] = [
  { value: 'personal', label: 'Personal Loan' },
  { value: 'home', label: 'Home Loan' },
  { value: 'business', label: 'Business Loan' },
  { value: 'education', label: 'Education Loan' },
  { value: 'loan_against_property', label: 'Loan Against Property' },
];

type EmploymentFilter = 'none' | EmploymentType;

type CibilFilter = 'any' | 'below_650' | '650_700' | '700_750' | '750_800' | '800_plus';

const CIBIL_OPTIONS: { value: CibilFilter; label: string; floor?: number }[] = [
  { value: 'any', label: 'Any CIBIL' },
  { value: 'below_650', label: '<650', floor: 600 },
  { value: '650_700', label: '650–700', floor: 650 },
  { value: '700_750', label: '700–750', floor: 700 },
  { value: '750_800', label: '750–800', floor: 750 },
  { value: '800_plus', label: '800+', floor: 800 },
];

type SortKey = 'min_rate' | 'fee' | 'max_amount';

interface Row {
  lender: Lender;
  product: LenderProduct;
  feeLabel: string;
  /** Fee normalised as % of a ₹5 lakh notional, for sorting only. */
  feeSortPct: number;
  eligibility: string[];
}

interface Excluded {
  name: string;
  reason: string;
}

function feeLabel(p: LenderProduct): string {
  if (p.processingFeeFlat != null) {
    return p.processingFeeFlat === 0 ? 'Nil (published)' : `Flat up to ₹${p.processingFeeFlat.toLocaleString('en-IN')}`;
  }
  const pct = p.processingFeePercent ?? 0;
  if (pct === 0) return 'Nil (published)';
  return p.processingFeeCapAmount != null
    ? `Up to ${pct}% (capped ₹${p.processingFeeCapAmount.toLocaleString('en-IN')})`
    : `Up to ${pct}%`;
}

function feeSortPct(p: LenderProduct): number {
  if (p.processingFeeFlat != null) return (p.processingFeeFlat / 500000) * 100;
  let pct = p.processingFeePercent ?? 0;
  if (p.processingFeeCapAmount != null) pct = Math.min(pct, (p.processingFeeCapAmount / 500000) * 100);
  return pct;
}

function tenureLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12} years`;
  return `${months} months`;
}

function eligibilityNotes(p: LenderProduct): string[] {
  const notes: string[] = [];
  if (p.minSalary != null) notes.push(`Min salary ₹${p.minSalary.toLocaleString('en-IN')}/mo`);
  if (p.minCreditScore != null) notes.push(`Min CIBIL ${p.minCreditScore}`);
  if (p.employmentTypes.length === 1) {
    notes.push(p.employmentTypes[0] === 'salaried' ? 'Salaried only' : 'Self-employed only');
  }
  notes.push(`Loan ${formatINRCompact(p.minLoanAmount)}–${formatINRCompact(p.maxLoanAmount)}`);
  return notes;
}

/** The profile best match — a bold verdict on deep navy, unlike every listing row below. */
function BestRateCard({ row }: { row: Row }) {
  const { lender, product, feeLabel } = row;
  return (
    <div
      className="overflow-hidden rounded-xl bg-[var(--space-brand-primary)] p-4 text-[var(--space-text-on-primary)]"
      data-testid={`rate-card-${lender.id}`}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--space-data-highlight,#f5a623)]"
        data-testid="rates-best-match"
      >
        Verdict — best for your profile
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight sm:text-2xl">{lender.name}</p>
          <p className="mt-0.5 text-[11px] text-[var(--space-brand-primary-100)]">
            {LENDER_TYPE_LABELS[lender.type]} · updated {lender.lastUpdated}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[var(--space-brand-primary-100)]">Published interest rate</p>
          <p className="text-2xl font-bold leading-none tabular-nums sm:text-3xl">
            {product.interestRateMin}%–{product.interestRateMax}%
          </p>
        </div>
      </div>
      <p className="mt-3 border-t border-white/15 pt-2.5 text-[13px] font-semibold leading-snug">
        Why #1: lowest published minimum rate among lenders matching your profile.
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-[var(--space-brand-primary-100)]">
        Processing fee: {feeLabel} · max tenure {tenureLabel(product.maxTenureMonths)} · max amount{' '}
        {formatINRCompact(product.maxLoanAmount)}{' '}
        <SourceChip
          label={`${shortLenderName(lender.name)} official`}
          href={product.sourceUrl || lender.sourceUrl}
          testId={`rate-source-${lender.id}`}
        />
      </p>
      <p className="mt-2 text-[10px] leading-snug text-[var(--space-brand-primary-100)]">
        A conclusion from published data, never a paid slot — Loanley earns nothing if you choose this lender.
      </p>
    </div>
  );
}

function LenderRow({ row }: { row: Row }) {
  const { lender, product, feeLabel, eligibility } = row;
  return (
    <div
      className="rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-3.5"
      data-testid={`rate-card-${lender.id}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[15px] font-semibold text-[var(--space-text-primary)]">{lender.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">
          {LENDER_TYPE_LABELS[lender.type]}
        </span>
        <span className="ml-auto text-[11px] text-[var(--space-text-muted)]">Updated {lender.lastUpdated}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <p className="text-[11px] text-[var(--space-text-muted)]">Interest rate</p>
          <p className="text-lg font-bold leading-tight text-[var(--space-text-brand)] tabular-nums">
            {product.interestRateMin}%–{product.interestRateMax}%{' '}
            <SourceChip
              label={`${shortLenderName(lender.name)} official`}
              href={product.sourceUrl || lender.sourceUrl}
              testId={`rate-source-${lender.id}`}
            />
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--space-text-muted)]">Processing fee</p>
          <p className="text-[13px] font-semibold text-[var(--space-text-primary)] tabular-nums">{feeLabel}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--space-text-muted)]">Max tenure</p>
          <p className="text-[13px] font-semibold text-[var(--space-text-primary)] tabular-nums">
            {tenureLabel(product.maxTenureMonths)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--space-text-muted)]">Max amount</p>
          <p className="text-[13px] font-semibold text-[var(--space-text-primary)] tabular-nums">
            {formatINRCompact(product.maxLoanAmount)}
          </p>
        </div>
      </div>

      <p className="mt-1.5 text-[12px] text-[var(--space-text-secondary)]">{eligibility.join(' · ')}</p>

      {(product.dataNote || lender.dataNote) && (
        <p className="mt-1 text-[11px] leading-snug text-[var(--space-text-muted)]">{product.dataNote || lender.dataNote}</p>
      )}
    </div>
  );
}

export default function LenderRates() {
  // The shared loader + validated merge every customer screen uses. Kept here
  // so this retired screen can never show a different number than the live one.
  const liveDb = useLiveLenderDb();

  const [loanType, setLoanType] = useState<LoanProductType>('personal');
  const [employment, setEmployment] = useState<EmploymentFilter>('none');
  const [cibil, setCibil] = useState<CibilFilter>('any');
  const [sortKey, setSortKey] = useState<SortKey>('min_rate');

  const profileEntered = employment !== 'none';

  const { rows, excluded } = useMemo(() => {
    const rows: Row[] = [];
    const excluded: Excluded[] = [];
    const cibilFloor = CIBIL_OPTIONS.find((o) => o.value === cibil)?.floor;

    for (const lender of liveDb.lenders) {
      const product = lender.products[loanType];
      if (!product) {
        excluded.push({ name: lender.name, reason: 'No published rate card for this loan type in our database yet' });
        continue;
      }
      if (employment !== 'none' && !product.employmentTypes.includes(employment)) {
        excluded.push({
          name: lender.name,
          reason:
            employment === 'salaried'
              ? 'Product is published for self-employed applicants only'
              : 'Product is published for salaried applicants only',
        });
        continue;
      }
      if (cibilFloor != null && product.minCreditScore != null && product.minCreditScore > cibilFloor) {
        excluded.push({
          name: lender.name,
          reason: `Published minimum CIBIL is ${product.minCreditScore} — above the selected band`,
        });
        continue;
      }
      rows.push({
        lender,
        product,
        feeLabel: feeLabel(product),
        feeSortPct: feeSortPct(product),
        eligibility: eligibilityNotes(product),
      });
    }

    rows.sort((a, b) => {
      if (sortKey === 'fee') return a.feeSortPct - b.feeSortPct;
      if (sortKey === 'max_amount') return b.product.maxLoanAmount - a.product.maxLoanAmount;
      return a.product.interestRateMin - b.product.interestRateMin;
    });

    return { rows, excluded };
  }, [loanType, employment, cibil, sortKey, liveDb]);

  // Best match = lowest published minimum rate among rows that fit the
  // entered profile — shown only when a profile exists, marked on its row
  // regardless of the display sort.
  const bestMatchId = useMemo(() => {
    if (!profileEntered || rows.length === 0) return null;
    let best = rows[0];
    for (const r of rows) {
      if (r.product.interestRateMin < best.product.interestRateMin) best = r;
    }
    return best.lender.id;
  }, [rows, profileEntered]);

  const orderedRows = useMemo(() => {
    if (!bestMatchId) return rows;
    const best = rows.find((r) => r.lender.id === bestMatchId);
    if (!best) return rows;
    return [best, ...rows.filter((r) => r.lender.id !== bestMatchId)];
  }, [rows, bestMatchId]);

  const tabCls = (active: boolean) =>
    `min-h-[36px] px-3 py-1.5 rounded-md text-[13px] font-medium border transition-colors ${
      active
        ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-[var(--space-brand-primary)]'
        : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)]'
    }`;
  const selectCls =
    'min-h-[36px] rounded-md border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-2.5 py-1.5 text-[12px] text-[var(--space-text-primary)] focus:outline-none focus:border-[var(--space-text-brand)]';

  return (
    <div className="min-h-full w-full bg-transparent">
      {/* navy trust bar + filter bar — one sticky block, always visible */}
      <div className="sticky top-0 z-20">
        <div className="bg-[var(--space-brand-primary)] px-4 py-2" data-testid="zero-commission-strip">
          <p className="mx-auto max-w-3xl text-center text-[13px] font-medium leading-snug text-[var(--space-text-on-primary)]">
            <span className="font-bold text-[var(--space-data-highlight,#f5a623)] tabular-nums">₹0</span> earned from any
            lender shown here. Ranked by math, not money.
          </p>
        </div>

        <div className="border-b border-[var(--space-border-default)] bg-[var(--space-surface-page)] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap gap-1.5">
            {LOAN_TYPE_OPTIONS.map((t) => (
              <button key={t.value} type="button" className={tabCls(loanType === t.value)} onClick={() => setLoanType(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={tabCls(employment === 'salaried')}
                onClick={() => setEmployment(employment === 'salaried' ? 'none' : 'salaried')}
                data-testid="rates-employment-salaried"
              >
                Salaried
              </button>
              <button
                type="button"
                className={tabCls(employment === 'self_employed')}
                onClick={() => setEmployment(employment === 'self_employed' ? 'none' : 'self_employed')}
                data-testid="rates-employment-self-employed"
              >
                Self-Employed
              </button>
            </div>
            <select className={selectCls} value={cibil} onChange={(e) => setCibil(e.target.value as CibilFilter)}>
              {CIBIL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className={`${selectCls} ml-auto`}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              data-testid="rates-sort"
            >
              <option value="min_rate">Lowest rate first</option>
              <option value="fee">Lowest fee first</option>
              <option value="max_amount">Highest max amount first</option>
            </select>
          </div>
        </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-5">
        {/* header */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-[var(--space-text-brand)]">Lender Rates</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-[var(--space-text-secondary)]">
            Published rates, fees and eligibility for {liveDb.lenders.length} major Indian banks and NBFCs. Every row
            links to the lender's own official rate page. Refreshed weekly from the lenders' official rate cards —
            last updated {liveDb.lastUpdated}.
          </p>
        </div>

        {/* best-match state */}
        {!profileEntered && (
          <p
            className="mb-3 rounded-lg border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-muted)] px-4 py-3 text-[13px] leading-relaxed text-[var(--space-text-secondary)]"
            data-testid="rates-profile-hint"
          >
            Enter your profile above to see your best match — pick Salaried or Self-Employed and, if you know it, your
            CIBIL band.
          </p>
        )}

        <p className="mb-2 text-[12px] text-[var(--space-text-muted)]">
          Showing {rows.length} of {liveDb.lenders.length} lenders
          {sortKey === 'fee' ? ' · fee sort compares fees on a ₹5 lakh notional' : ''}
        </p>

        <div className="space-y-2.5">
          {orderedRows.map((row) =>
            row.lender.id === bestMatchId ? (
              <BestRateCard key={row.lender.id} row={row} />
            ) : (
              <LenderRow key={row.lender.id} row={row} />
            ),
          )}
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--space-border-strong)] px-4 py-6 text-center text-sm text-[var(--space-text-secondary)]">
              No lender in our published database matches these filters — the excluded list below shows exactly why.
            </p>
          )}
        </div>

        {/* likely out of reach — greyed, clearly separated, never hidden */}
        {excluded.length > 0 && (
          <div className="mt-5" data-testid="rates-out-of-reach">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
              Likely out of reach for your profile
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--space-text-muted)]">
              Based on each lender's own published criteria and your filters — shown so nothing is hidden.
            </p>
            <ul className="mt-2 space-y-1.5 rounded-lg border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-muted)] px-4 py-3 opacity-75">
              {excluded.map((e) => (
                <li key={e.name} className="text-[12px] leading-snug text-[var(--space-text-muted)]">
                  <span className="font-semibold text-[var(--space-text-secondary)]">{e.name}</span> — {e.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* methodology + source */}
        <p className="mt-5 border-t border-[var(--space-border-default)] pt-3 text-[12px] leading-relaxed text-[var(--space-text-muted)]">
          {LENDER_DB.methodology} Processing fees exclude GST. {LENDER_DB.disclaimer}
        </p>

        {/* global trust footer */}
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--space-text-muted)]">
          No lender has paid for placement. Loanley earns no referral commission.
        </p>
      </div>
    </div>
  );
}
