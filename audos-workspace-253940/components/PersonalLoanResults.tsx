/**
 * PersonalLoanResults — how Loanley shows the personal-loan data backend.
 *
 * Every figure on this screen comes from the `personal-loans-data` hook, which
 * serves data/personal_loans.json and decides eligibility server-side from the
 * borrower's own CIBIL, income, amount and employment type.
 *
 * Deliberate constraints, in the founder's words: rank by rate, never
 * recommend. So this component:
 *  • orders lenders by their own published starting rate, lowest first, and
 *    says so in the heading — no "best", no "recommended", no sponsored slot;
 *  • has no Apply Now, no lender referral and no outbound link except the
 *    lender's own official rate card;
 *  • keeps lenders the borrower likely does not qualify for on the screen, in
 *    a collapsed section, each with the published reason, so nothing is hidden;
 *  • shows the cost of the fee next to the rate, because a lower rate with a
 *    5% fee is not the cheaper loan.
 */
import { ChevronDown, Download, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { RupeeAmount, ZeroCommissionStrip, formatINR } from './LoanleyCards';
import {
  PERSONAL_LOANS_DOWNLOAD_URL,
  PERSONAL_LOANS_FILENAME,
  computeCost,
  describeRateBasis,
  fetchPersonalLoanDataset,
  formatMaxAmount,
  formatRateRange,
  formatTenureRange,
} from '../lib/personal-loans';
import type { PersonalLoanRanking, PersonalLoanResult } from '../lib/personal-loans';

const LENDER_TYPE_LABELS: Record<PersonalLoanResult['lenderType'], string> = {
  public_sector_bank: 'Public sector bank',
  private_bank: 'Private bank',
  nbfc: 'NBFC',
};

function SourceLink({ row, tone = 'light' }: { row: PersonalLoanResult; tone?: 'light' | 'muted' }) {
  return (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-0.5 text-[11px] underline underline-offset-2 ${
        tone === 'muted'
          ? 'text-[var(--space-text-muted)] hover:text-[var(--space-text-brand)]'
          : 'text-[var(--space-text-secondary)] hover:text-[var(--space-text-brand)]'
      }`}
      data-testid={`source-${row.lenderId}`}
    >
      Source <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
    </a>
  );
}

function PublishedFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] leading-tight text-[var(--space-text-muted)]">{label}</p>
      <p className="text-[12px] font-semibold leading-tight text-[var(--space-text-primary)]">{value}</p>
    </div>
  );
}

function EligibleCard({
  row,
  amount,
  tenureMonths,
}: {
  row: PersonalLoanResult;
  amount: number;
  tenureMonths: number;
}) {
  const cost = computeCost(row, amount, tenureMonths);
  const fee = cost ? cost.fee : null;

  return (
    <div
      className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-3"
      data-testid={`ranked-lender-${row.lenderId}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--space-surface-accent-soft)] text-[10px] font-bold text-[var(--space-text-brand)]">
          {row.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-[var(--space-text-primary)]">{row.lender}</span>
            <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">
              {LENDER_TYPE_LABELS[row.lenderType]}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
            <div>
              <p className="text-[10px] leading-tight text-[var(--space-text-muted)]">Published rate</p>
              <p
                className="text-base font-bold leading-tight tabular-nums text-[var(--space-text-primary)]"
                data-testid={`rate-${row.lenderId}`}
              >
                {formatRateRange(row)}
              </p>
            </div>
            {cost && (
              <>
                <div>
                  <p className="text-[10px] leading-tight text-[var(--space-text-muted)]">EMI</p>
                  <p className="text-base font-bold leading-tight tabular-nums text-[var(--space-text-primary)]">
                    <RupeeAmount value={cost.emi} suffix="/mo" />
                  </p>
                </div>
                <div>
                  <p className="text-[10px] leading-tight text-[var(--space-text-muted)]">Total cost</p>
                  <p className="text-base font-bold leading-tight tabular-nums text-[var(--space-text-primary)]">
                    {formatINR(cost.totalPayable)}
                  </p>
                </div>
                {cost.effectiveAnnualRatePct != null && (
                  <div>
                    <p className="text-[10px] leading-tight text-[var(--space-text-muted)]">With fee</p>
                    <p className="text-base font-bold leading-tight tabular-nums text-[var(--space-text-primary)]">
                      {cost.effectiveAnnualRatePct}% p.a.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--space-border-default)] pt-2 sm:grid-cols-3">
            <PublishedFact
              label="Processing fee"
              value={
                fee && fee.amount != null
                  ? `${fee.label} ≈ ${formatINR(fee.amount)}`
                  : fee
                    ? fee.label
                    : 'Not published'
              }
            />
            <PublishedFact label="Maximum amount" value={formatMaxAmount(row)} />
            <PublishedFact label="Tenure" value={formatTenureRange(row)} />
          </div>

          {cost && (
            <p className="mt-1.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
              EMI {describeRateBasis(cost)}. Fees exclude GST.
            </p>
          )}

          {row.unverified.map((note, i) => (
            <p key={i} className="mt-1 text-[10px] leading-snug text-[var(--space-text-secondary)]">
              Caveat: {note}
            </p>
          ))}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <SourceLink row={row} />
            <span className="text-[10px] text-[var(--space-text-muted)]">rate card checked {row.updatedAt}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function IneligibleSection({ rows }: { rows: PersonalLoanResult[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <div data-testid="may-not-qualify">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-muted)] px-3 py-2 text-left"
        data-testid="may-not-qualify-toggle"
      >
        <span className="text-[11px] font-semibold text-[var(--space-text-secondary)]">
          You may not qualify — {rows.length} lender{rows.length === 1 ? '' : 's'}, with the published reason
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--space-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
            Kept on the screen so nothing is hidden. These sit outside the ranking because of each lender's own
            published criteria — which are not the final word, since lenders assess full applications individually.
          </p>
          {rows.map((row) => (
            <div
              key={row.lenderId}
              className="rounded-xl border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-muted)] px-3 py-2.5"
              data-testid={`not-qualify-${row.lenderId}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-[var(--space-text-primary)]">{row.lender}</span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">
                  {LENDER_TYPE_LABELS[row.lenderType]}
                </span>
                <span className="text-[10px] text-[var(--space-text-muted)]">{formatRateRange(row)}</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {row.ineligibleReasons.map((reason, i) => (
                  <li key={i} className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
                    {reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                <SourceLink row={row} tone="muted" />
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The dataset download. Deliberately a quiet text link and not a call to
 * action: it exists so a sceptical borrower can take the whole published
 * dataset away and audit the ranking.
 *
 * The hook sandbox can only set Content-Type on a raw response, so the
 * attachment filename cannot arrive as Content-Disposition. It is applied here
 * through the anchor's download attribute, which is what actually names the
 * file in the browser's save dialog.
 */
export function SourceDataDownload() {
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');

  const handleDownload = async () => {
    setStatus('busy');
    try {
      const text = await fetchPersonalLoanDataset();
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = PERSONAL_LOANS_FILENAME;
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
    <div className="text-center">
      <a
        href={PERSONAL_LOANS_DOWNLOAD_URL}
        download={PERSONAL_LOANS_FILENAME}
        onClick={(event) => {
          // Fetch-and-save keeps the borrower on the page; the href stays a real
          // URL so the link works without JavaScript and can be copied.
          event.preventDefault();
          void handleDownload();
        }}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--space-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--space-text-brand)]"
        data-testid="download-source-data"
      >
        {status === 'busy' ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3 w-3" aria-hidden="true" />
        )}
        Download full lender data (JSON)
      </a>
      <p className="mt-0.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
        {status === 'error'
          ? "That download didn't go through. Please try again in a moment — every figure is also cited inline above."
          : 'Every rate, fee and eligibility rule behind these answers, with each lender\u2019s own source link.'}
      </p>
    </div>
  );
}

export function PersonalLoanResults({
  ranking,
  amount,
  tenureMonths,
  profileLine,
}: {
  ranking: PersonalLoanRanking;
  amount: number;
  tenureMonths: number;
  profileLine: string;
}) {
  const eligible = ranking.results.filter((r) => r.eligible);
  const ineligible = ranking.results.filter((r) => !r.eligible);

  let countLine: string;
  if (eligible.length === 0) {
    countLine =
      "No lender in the dataset publishes criteria your figures meet. Every one of them is listed below with the reason — published criteria are not the final word, so your own bank is still worth asking directly.";
  } else {
    countLine = `${eligible.length} of ${ranking.results.length} lenders publish criteria your figures meet, ordered by their own published starting rate — lowest first.`;
  }

  return (
    <div className="space-y-3" data-testid="personal-loan-results">
      <div className="space-y-1.5">
        <ZeroCommissionStrip />
        <p className="text-[11px] leading-snug text-[var(--space-text-secondary)]" data-testid="trust-header">
          Ranked by each lender's own published interest rate, lowest first. No lender has paid for placement, none is
          recommended, and there is nothing to apply for here.
        </p>
      </div>

      <p className="rounded-lg bg-[var(--space-surface-muted)] px-3 py-2 text-[11px] leading-snug text-[var(--space-text-secondary)]">
        Your profile: {profileLine}
      </p>

      <p className="text-[13px] font-semibold leading-snug text-[var(--space-text-primary)]" data-testid="result-count">
        {countLine}
      </p>

      {eligible.length > 0 && (
        <div className="space-y-2">
          {eligible.map((row) => (
            <EligibleCard key={row.lenderId} row={row} amount={amount} tenureMonths={tenureMonths} />
          ))}
        </div>
      )}

      <IneligibleSection rows={ineligible} />

      <div className="space-y-1.5 border-t border-[var(--space-border-default)] pt-2">
        <p className="text-[10px] leading-snug text-[var(--space-text-muted)]">
          Data source: {ranking.lenderCount} Indian lenders' published personal-loan rate cards, last checked{' '}
          {ranking.updatedAt}
          {ranking.liveRateOverrides && ranking.liveRateOverrides.valuesApplied > 0
            ? `, with ${ranking.liveRateOverrides.valuesApplied} figure${
                ranking.liveRateOverrides.valuesApplied === 1 ? '' : 's'
              } refreshed on ${ranking.liveRateOverrides.asOf}`
            : ''}
          . {ranking.disclaimer}
        </p>
        <SourceDataDownload />
      </div>
    </div>
  );
}
