/**
 * LoanleyCards — inline conversation cards for the Loanley Guide chat.
 *
 * Two cards render inside agent messages via fenced code blocks:
 *   ```loanley-calc   → interactive loan-input card (prefilled from the JSON body)
 *   ```loanley-result → structured result card produced by the loan_math /
 *                       loan_benchmark server tools (agent pastes the tool's
 *                       resultCard JSON verbatim)
 *
 * Loanley is neutral by design: these cards never name, link to, or recommend
 * a lender. Sources are shown so the borrower can verify every claim.
 */
import { useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  BookOpen,
  Loader2,
  Send,
  Scale,
} from 'lucide-react';
import { RBI_MASTER_DIRECTIONS_URL } from '../lib/loan-benchmarks';

/* ---------------------------------- shared ---------------------------------- */

const LOAN_TYPES: { value: string; label: string }[] = [
  { value: 'personal', label: 'Personal Loan' },
  { value: 'home', label: 'Home Loan' },
  { value: 'business', label: 'Business Loan' },
  { value: 'education', label: 'Education Loan' },
  { value: 'loan_against_property', label: 'Loan Against Property' },
];

/* --------------------------- trust primitives ---------------------------
 * Shared, visual-only building blocks of the Loanley trust language:
 *   SourceChip          — inline citation chip that sits WITH the number it
 *                         backs (never a footnote); amber = trust accent.
 *   ZeroCommissionStrip — the persistent non-promotional strip every results
 *                         screen carries.
 *   RupeeAmount         — hero money figure with a large, prominent ₹ and
 *                         Indian digit grouping.
 * ------------------------------------------------------------------------ */

/** Display-only short names for long lender names inside source chips. */
const LENDER_SHORT_NAMES: Record<string, string> = {
  'State Bank of India': 'SBI',
  'Punjab National Bank': 'PNB',
  'Bank of Baroda': 'BoB',
  'Union Bank of India': 'Union Bank',
  'Bank of India': 'BoI',
  'Kotak Mahindra Bank': 'Kotak',
  'Bajaj Finserv (Bajaj Finance)': 'Bajaj Finserv',
  'Aditya Birla Finance': 'Aditya Birla',
};

export function shortLenderName(name: string): string {
  return LENDER_SHORT_NAMES[name] ?? name;
}

/** Inline source citation chip — plain text link styled as a quiet chip. */
export function SourceChip({ label, href, testId }: { label: string; href: string; testId?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded bg-[var(--space-data-highlight-soft,#fdf3e2)] px-1.5 py-[1px] align-middle text-[10px] font-semibold leading-4 text-[#8a5a00] no-underline hover:underline"
      title={`Source: ${label} — opens the official page`}
      data-testid={testId}
    >
      {label} ↗
    </a>
  );
}

/** Persistent non-promotional strip for every results screen. */
export function ZeroCommissionStrip({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg bg-[var(--space-brand-primary)] px-3.5 py-2.5 ${className}`}
      data-testid="zero-commission-strip"
    >
      <span className="text-xl font-bold leading-none text-[var(--space-data-highlight,#f5a623)] tabular-nums">₹0</span>
      <p className="text-[12px] font-medium leading-snug text-[var(--space-text-on-primary)]">
        earned from any lender shown here. Ranked by math, not money.
      </p>
    </div>
  );
}

/** Renders a preformatted string (e.g. "₹12,345/mo") with a large, bold ₹. */
export function emphasizeRupee(text: string) {
  const idx = text.indexOf('₹');
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-bold" style={{ fontSize: '1.08em' }}>₹</span>
      {text.slice(idx + 1)}
    </>
  );
}

/** Hero money figure — Indian grouping, with the ₹ rendered large and bold. */
export function RupeeAmount({ value, suffix, className = '' }: { value: number; suffix?: string; className?: string }) {
  const formatted = formatINR(value);
  const idx = formatted.indexOf('₹');
  return (
    <span className={`tabular-nums ${className}`}>
      {formatted.slice(0, idx)}
      <span className="font-bold" style={{ fontSize: '1.08em' }}>₹</span>
      {formatted.slice(idx + 1)}
      {suffix ? <span className="font-medium" style={{ fontSize: '0.55em' }}>{suffix}</span> : null}
    </span>
  );
}

function formatINR(n: number): string {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  let out: string;
  if (s.length <= 3) out = s;
  else out = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  return (neg ? '-₹' : '₹') + out;
}

function parseLoanleyJson(raw: string): Record<string, any> | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Streaming may hand us an incomplete object; try up to the last brace.
    const last = text.lastIndexOf('}');
    if (last > 0) {
      try {
        return JSON.parse(text.slice(0, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* ------------------------------ calculator card ------------------------------ */

interface LoanleyCalcCardProps {
  raw: string;
  onSubmit: (message: string) => void;
}

export function LoanleyCalcCard({ raw, onSubmit }: LoanleyCalcCardProps) {
  const prefill = parseLoanleyJson(raw) || {};

  const [loanType, setLoanType] = useState<string>(
    LOAN_TYPES.some((t) => t.value === prefill.loan_type) ? prefill.loan_type : 'personal',
  );
  const [principal, setPrincipal] = useState<string>(
    prefill.principal != null ? String(prefill.principal) : '',
  );
  const [rate, setRate] = useState<string>(
    prefill.annual_rate_pct != null ? String(prefill.annual_rate_pct) : '',
  );
  const [tenure, setTenure] = useState<string>(
    prefill.tenure_months != null
      ? String(prefill.tenure_months)
      : prefill.tenure_years != null
        ? String(prefill.tenure_years)
        : '',
  );
  const [tenureUnit, setTenureUnit] = useState<'months' | 'years'>(
    prefill.tenure_months != null ? 'months' : 'years',
  );
  const [processingFee, setProcessingFee] = useState<string>(
    prefill.processing_fee != null ? String(prefill.processing_fee) : '',
  );
  const [otherFees, setOtherFees] = useState<string>(
    prefill.other_fees != null ? String(prefill.other_fees) : '',
  );
  const [rateType, setRateType] = useState<string>(
    prefill.rate_type === 'floating' || prefill.rate_type === 'fixed' ? prefill.rate_type : '',
  );
  const [sent, setSent] = useState(false);

  const principalNum = parseFloat(principal);
  const rateNum = parseFloat(rate);
  const tenureNum = parseFloat(tenure);
  const canSubmit =
    !isNaN(principalNum) && principalNum > 0 && !isNaN(rateNum) && rateNum > 0 && !isNaN(tenureNum) && tenureNum > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const tenureMonths = tenureUnit === 'years' ? Math.round(tenureNum * 12) : Math.round(tenureNum);
    const label = LOAN_TYPES.find((t) => t.value === loanType)?.label || loanType;
    const lines = [
      'Please run the real maths on this offer with your loan_math tool:',
      `- Loan type: ${label}`,
      `- Loan amount: ₹${Math.round(principalNum)}`,
      `- Interest rate: ${rateNum}% p.a.`,
      `- Tenure: ${tenureMonths} months`,
      `- Processing fee: ₹${isNaN(parseFloat(processingFee)) ? 0 : Math.round(parseFloat(processingFee))}`,
      `- Other charges: ₹${isNaN(parseFloat(otherFees)) ? 0 : Math.round(parseFloat(otherFees))}`,
      `- Rate type: ${rateType || 'not sure'}`,
    ];
    setSent(true);
    onSubmit(lines.join('\n'));
  };

  const inputCls =
    'w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-2.5 py-2 text-sm text-[var(--space-text-primary)] focus:outline-none focus:border-[var(--space-border-strong)]';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--space-text-muted)] mb-1';

  return (
    // Professional intake form, not a chatbot widget: formal navy header,
    // uppercase field labels, quiet confirmation line.
    <div className="not-prose my-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--space-brand-primary)]">
        <Calculator className="w-4 h-4 shrink-0 text-[var(--space-text-on-primary)]" />
        <div className="min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--space-brand-primary-200)]">
            Loanley · offer intake
          </span>
          <span className="text-sm font-semibold text-[var(--space-text-on-primary)]">Your loan details</span>
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--space-brand-primary-200)]">nothing goes to any lender</span>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Loan type</label>
          <select className={inputCls} value={loanType} onChange={(e) => setLoanType(e.target.value)} disabled={sent}>
            {LOAN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Loan amount (₹)</label>
          <input
            type="number"
            inputMode="numeric"
            className={inputCls}
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder="e.g. 500000 for ₹5 lakh"
            disabled={sent}
          />
        </div>
        <div>
          <label className={labelCls}>Interest rate (% per year)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 14"
            disabled={sent}
          />
        </div>
        <div>
          <label className={labelCls}>Tenure</label>
          <div className="flex gap-2">
            <input
              type="number"
              className={inputCls}
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
              placeholder={tenureUnit === 'years' ? 'e.g. 4' : 'e.g. 48'}
              disabled={sent}
            />
            <select
              className={`${inputCls} w-28 shrink-0`}
              value={tenureUnit}
              onChange={(e) => setTenureUnit(e.target.value as 'months' | 'years')}
              disabled={sent}
            >
              <option value="years">years</option>
              <option value="months">months</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Processing fee (₹)</label>
          <input
            type="number"
            className={inputCls}
            value={processingFee}
            onChange={(e) => setProcessingFee(e.target.value)}
            placeholder="0 if none"
            disabled={sent}
          />
        </div>
        <div>
          <label className={labelCls}>Other charges (₹)</label>
          <input
            type="number"
            className={inputCls}
            value={otherFees}
            onChange={(e) => setOtherFees(e.target.value)}
            placeholder="insurance, documentation…"
            disabled={sent}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Rate type</label>
          <div className="flex gap-2">
            {[
              { v: 'fixed', l: 'Fixed' },
              { v: 'floating', l: 'Floating' },
              { v: '', l: 'Not sure' },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                disabled={sent}
                onClick={() => setRateType(o.v)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  rateType === o.v
                    ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-[var(--space-brand-primary)]'
                    : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)]'
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || sent}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] disabled:opacity-40 transition-opacity"
          data-testid="button-loanley-calc-submit"
        >
          {sent ? (
            <>
              <CheckCircle2 className="w-4 h-4" /> Sent — running the maths
            </>
          ) : (
            <>
              <Send className="w-4 h-4" /> Check this offer
            </>
          )}
        </button>
        <p className="mt-2 text-[10px] leading-snug text-[var(--space-text-muted)]">
          The maths runs on Loanley's server — never estimated. No lender is recommended, ever.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- result card -------------------------------- */

interface Verdict {
  status?: string;
  tooGoodToBeTrue?: boolean;
  headline?: string;
  detail?: string;
  basis?: string;
}

interface SourceItem {
  label?: string;
  detail?: string;
  url?: string;
}

// Verdict styling per the Loanley design brief: colored TEXT, no loud fills.
// 'Normal' = plain green text, 'High' = amber, 'Too good to be true' = red.
// Each status carries the standard plain-English read shown to the borrower.
function verdictStyle(status: string | undefined, tooGood: boolean | undefined) {
  if (tooGood || status === 'too_good')
    return {
      border: 'var(--space-semantic-danger)',
      Icon: ShieldAlert,
      color: 'text-[var(--space-semantic-danger)]',
      pillText: 'Too good to be true',
      standardLine:
        'This rate is unusually low. Verify directly with the lender — some offers include hidden fees or balloon payments.',
    };
  if (status === 'outside' || status === 'edge')
    return {
      border: 'var(--space-data-highlight, #f5a623)',
      Icon: AlertTriangle,
      color: 'text-[#8a5a00]',
      pillText: status === 'outside' ? 'High' : 'Borderline',
      standardLine:
        'This rate is above the typical range. Not necessarily wrong, but worth asking the lender about fees.',
    };
  if (status === 'inside')
    return {
      border: 'var(--space-semantic-success)',
      Icon: CheckCircle2,
      color: 'text-[var(--space-semantic-success)]',
      pillText: 'Normal',
      standardLine: 'This rate is within the typical published range for this loan type (RBI data).',
    };
  return {
    border: 'var(--space-brand-primary)',
    Icon: Scale,
    color: 'text-[var(--space-text-brand)]',
    pillText: null,
    standardLine: null,
  };
}

export function LoanleyResultCard({ raw }: { raw: string }) {
  const data = parseLoanleyJson(raw);

  if (!data || !Array.isArray(data.metrics)) {
    return (
      <div className="not-prose my-2 flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-4 py-3">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--space-text-muted)]" />
        <span className="text-xs text-[var(--space-text-muted)]">Preparing your result card…</span>
      </div>
    );
  }

  const verdict: Verdict = data.verdict || {};
  const sources: SourceItem[] = Array.isArray(data.sources) ? data.sources : [];
  const notes: string[] = Array.isArray(data.notes) ? data.notes : [];
  const vs = verdictStyle(verdict.status, verdict.tooGoodToBeTrue);
  const VerdictIcon = vs.Icon;

  return (
    <div
      className="not-prose my-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] overflow-hidden"
      style={{ borderLeft: '3px solid var(--space-brand-primary)' }}
    >
      {/* header */}
      <div className="px-4 py-3 border-b border-[var(--space-border-default)] bg-[var(--space-surface-muted)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--space-text-muted)]">
          {data.kind === 'benchmark' ? 'Loanley · normal-or-not check' : 'Loanley · real cost of this offer'}
        </p>
        {data.title && (
          <h3 className="mt-0.5 text-sm font-semibold text-[var(--space-text-primary)]">{data.title}</h3>
        )}
      </div>

      {/* metrics — the numbers are the hero */}
      <div className="grid grid-cols-2 gap-px bg-[var(--space-border-default)]">
        {data.metrics.map((m: any, i: number) => (
          <div key={i} className="bg-[var(--space-surface-card)] px-4 py-3">
            <p className="text-[11px] text-[var(--space-text-muted)]">{m.label}</p>
            <p
              className={`${i === 0 ? 'text-2xl text-[var(--space-text-brand)]' : 'text-xl text-[var(--space-text-primary)]'} font-bold leading-tight tabular-nums`}
            >
              {typeof m.value === 'string' ? emphasizeRupee(m.value) : m.value}
            </p>
            {m.hint && <p className="text-[10px] text-[var(--space-text-muted)] mt-0.5">{m.hint}</p>}
          </div>
        ))}
      </div>

      {/* verdict */}
      {(verdict.headline || verdict.detail) && (
        <div
          className="mx-4 mt-3 rounded-xl bg-[var(--space-surface-muted)] px-3 py-3"
          style={{ borderLeft: `3px solid ${vs.border}` }}
        >
          <div className="flex items-start gap-2">
            <VerdictIcon className={`w-4 h-4 mt-0.5 shrink-0 ${vs.color}`} />
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {vs.pillText && (
                  <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${vs.color}`}>{vs.pillText}</span>
                )}
                {/* the RBI benchmark source, visible with the verdict itself */}
                <SourceChip label="RBI" href={RBI_MASTER_DIRECTIONS_URL} testId="verdict-rbi-source" />
              </div>
              {vs.standardLine ? (
                <p className={`mt-1 text-[13px] font-semibold leading-snug ${vs.color}`}>{vs.standardLine}</p>
              ) : (
                verdict.headline && (
                  <p className="text-sm font-semibold text-[var(--space-text-primary)]">{verdict.headline}</p>
                )
              )}
              {verdict.detail && (
                <p className="mt-1 text-xs leading-relaxed text-[var(--space-text-secondary)]">{verdict.detail}</p>
              )}
              {verdict.basis && (
                <p className="mt-1.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
                  <span className="font-semibold">Basis:</span> {verdict.basis}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* scenario */}
      {data.scenario && (data.scenario.label || data.scenario.detail) && (
        <div className="mx-4 mt-2 rounded-xl border border-dashed border-[var(--space-border-strong)] px-3 py-2.5">
          <p className="text-xs font-semibold text-[var(--space-text-primary)]">{data.scenario.label}</p>
          {data.scenario.detail && (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--space-text-secondary)]">{data.scenario.detail}</p>
          )}
        </div>
      )}

      {/* notes */}
      {notes.length > 0 && (
        <ul className="mx-4 mt-2 space-y-1">
          {notes.map((note, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--space-text-secondary)]">
              <span className="mt-[6px] h-1 w-1 rounded-full bg-[var(--space-text-muted)] shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* sources — always present, quiet but visible */}
      {sources.length > 0 && (
        <div className="mx-4 mt-3 mb-1 border-t border-[var(--space-border-default)] pt-2">
          <div className="flex items-center gap-1.5 mb-1">
            <BookOpen className="w-3 h-3 text-[var(--space-text-muted)]" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Sources</p>
          </div>
          <ul className="space-y-1.5">
            {sources.map((s, i) => (
              <li key={i} className="text-[12px] leading-snug text-[var(--space-text-secondary)]">
                {s.url ? (
                  <SourceChip label={s.label || s.url} href={s.url} />
                ) : (
                  <span className="font-semibold">{s.label}</span>
                )}
                {s.detail && <span> — {s.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* neutrality footer */}
      <p className="px-4 py-2.5 text-[11px] leading-snug text-[var(--space-text-muted)] border-t border-[var(--space-border-default)]">
        {data.disclaimer ||
          'No lender has paid for placement. Loanley earns no referral commission. Neutral information, not financial advice.'}
      </p>
    </div>
  );
}

export { formatINR };
