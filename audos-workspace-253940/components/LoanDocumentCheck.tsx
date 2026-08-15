/**
 * LoanDocumentCheck — upload the paperwork, verify what was read, run the maths.
 *
 * The order of the screen is the order of the work: the document comes first,
 * the fields it filled come second, the Calculate button comes last. Anyone
 * who has the sanction letter in hand drops it in and checks five figures;
 * anyone who does not simply types them, because every field below is an
 * ordinary editable input whether a document touched it or not.
 *
 * Two rules hold this file together:
 *  1. An extracted figure is never presented as a settled one. Auto-filled
 *     fields are highlighted in amber and carry "Extracted from document —
 *     please verify" until they are edited by hand, and a field the document
 *     did not clearly state is left BLANK rather than guessed at.
 *  2. The maths is the same maths. Calculate posts to the loan-math hook that
 *     the chat already uses, so EMI, total cost and effective cost cannot
 *     drift between the two ways of asking. Nothing is computed here.
 *
 * Neutral by construction, like the rest of Loanley: no lender is named,
 * ranked, linked or recommended anywhere on this screen.
 */
import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { LoanleyResultCard, ZeroCommissionStrip } from './LoanleyCards';
import {
  ACCEPTED_DOC_TYPES,
  EXTRACT_FIELD_LABELS,
  describeBytes,
  extractLoanFieldsFromFile,
  validateDocFile,
} from '../lib/loan-doc-extract';
import type { ExtractedField, ExtractionOutcome, LoanTypeId } from '../lib/loan-doc-extract';

const LOAN_MATH_ENDPOINT = '/api/hooks/execute/workspace-253940/loan-math';

const LOAN_TYPES: { value: LoanTypeId; label: string }[] = [
  { value: 'personal', label: 'Personal loan' },
  { value: 'home', label: 'Home loan' },
  { value: 'business', label: 'Business loan' },
  { value: 'education', label: 'Education loan' },
  { value: 'loan_against_property', label: 'Loan against property' },
];

type TenureUnit = 'months' | 'years';
type RateType = 'fixed' | 'floating' | '';
type DocStatus = 'idle' | 'processing' | 'parsed' | 'error';

interface FormState {
  loanType: LoanTypeId;
  principal: string;
  ratePct: string;
  tenure: string;
  tenureUnit: TenureUnit;
  processingFee: string;
  otherFees: string;
  rateType: RateType;
}

const EMPTY_FORM: FormState = {
  loanType: 'personal',
  principal: '',
  ratePct: '',
  tenure: '',
  tenureUnit: 'months',
  processingFee: '',
  otherFees: '',
  rateType: '',
};

/** Which form inputs a document can fill — the rest are always manual. */
const FIELD_TO_EXTRACT: Partial<Record<keyof FormState, ExtractedField>> = {
  loanType: 'loanType',
  principal: 'principal',
  ratePct: 'ratePct',
  tenure: 'tenureMonths',
  processingFee: 'processingFee',
};

const CALCULATOR_UNAVAILABLE =
  "Loanley's calculator is unavailable right now. The numbers won't be estimated — please try again in a moment.";

const LABEL_CLASS =
  'mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--space-text-muted)]';
const INPUT_BASE =
  'w-full rounded-lg border px-2.5 py-2 text-sm text-[var(--space-text-primary)] transition-colors focus:outline-none';
const INPUT_PLAIN =
  'border-[var(--space-border-default)] bg-[var(--space-surface-card)] focus:border-[var(--space-border-strong)]';
// Auto-filled fields wear the amber trust accent until somebody edits them.
const INPUT_EXTRACTED =
  'border-[var(--space-data-highlight,#f5a623)] bg-[var(--space-data-highlight-soft,#fdf3e2)] focus:border-[var(--space-data-highlight,#f5a623)]';

function inputClass(extracted: boolean): string {
  return `${INPUT_BASE} ${extracted ? INPUT_EXTRACTED : INPUT_PLAIN}`;
}

function VerifyNote() {
  return (
    <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-[#8a5a00]">
      <Sparkles className="mt-[2px] h-3 w-3 shrink-0" />
      Extracted from document — please verify
    </p>
  );
}

function listFields(fields: ExtractedField[]): string {
  const labels = fields.map((field) => EXTRACT_FIELD_LABELS[field]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export default function LoanDocumentCheck() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [autoFilled, setAutoFilled] = useState<ExtractedField[]>([]);

  const [docStatus, setDocStatus] = useState<DocStatus>('idle');
  const [docName, setDocName] = useState('');
  const [docSize, setDocSize] = useState(0);
  const [docError, setDocError] = useState('');
  const [extraction, setExtraction] = useState<ExtractionOutcome | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [dragging, setDragging] = useState(false);

  const [calcBusy, setCalcBusy] = useState(false);
  const [cardJson, setCardJson] = useState<string | null>(null);
  const [calcErrors, setCalcErrors] = useState<string[]>([]);
  const [calcFailure, setCalcFailure] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isExtracted = (field: ExtractedField) => autoFilled.indexOf(field) !== -1;

  const clearResult = () => {
    setCardJson(null);
    setCalcErrors([]);
    setCalcFailure('');
  };

  /** Editing a field by hand means it has been verified — the amber comes off. */
  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }) as FormState);
    const extracted = FIELD_TO_EXTRACT[key];
    if (extracted) setAutoFilled((prev) => prev.filter((field) => field !== extracted));
    clearResult();
  };

  /* ---- document ---- */

  const openPicker = () => {
    if (docStatus === 'processing') return;
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File | null | undefined) => {
    if (!file || docStatus === 'processing') return;
    clearResult();
    setDocName(file.name || 'document');
    setDocSize(file.size || 0);

    const problem = validateDocFile(file);
    if (problem) {
      setDocStatus('error');
      setDocError(problem);
      setExtraction(null);
      return;
    }

    setDocStatus('processing');
    setDocError('');
    setExtraction(null);
    setProgress(4);
    setProgressLabel('Opening the document…');

    try {
      const outcome = await extractLoanFieldsFromFile(file, (percent, label) => {
        setProgress(percent);
        setProgressLabel(label);
      });
      const found = outcome.fields;
      setForm((prev) => ({
        ...prev,
        ...(found.loanType ? { loanType: found.loanType } : {}),
        ...(found.principal != null ? { principal: String(found.principal) } : {}),
        ...(found.ratePct != null ? { ratePct: String(found.ratePct) } : {}),
        ...(found.tenureMonths != null
          ? { tenure: String(found.tenureMonths), tenureUnit: 'months' as TenureUnit }
          : {}),
        ...(found.processingFee != null ? { processingFee: String(found.processingFee) } : {}),
      }));
      setAutoFilled(outcome.filled);
      setExtraction(outcome);
      setDocStatus('parsed');
    } catch (err) {
      setDocStatus('error');
      setDocError(err instanceof Error ? err.message : 'That document could not be read.');
    }
  };

  const clearDocument = () => {
    setForm(EMPTY_FORM);
    setAutoFilled([]);
    setExtraction(null);
    setDocStatus('idle');
    setDocName('');
    setDocSize(0);
    setDocError('');
    setProgress(0);
    setProgressLabel('');
    clearResult();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ---- maths ---- */

  const principalNum = parseFloat(form.principal);
  const rateNum = parseFloat(form.ratePct);
  const tenureNum = parseFloat(form.tenure);
  const tenureMonths = Number.isFinite(tenureNum)
    ? Math.round(form.tenureUnit === 'years' ? tenureNum * 12 : tenureNum)
    : null;
  const canCalculate =
    Number.isFinite(principalNum) &&
    principalNum > 0 &&
    Number.isFinite(rateNum) &&
    rateNum > 0 &&
    tenureMonths != null &&
    tenureMonths > 0 &&
    !calcBusy;

  const handleCalculate = async () => {
    if (!canCalculate) return;
    setCalcBusy(true);
    clearResult();
    try {
      const feeNum = parseFloat(form.processingFee);
      const otherNum = parseFloat(form.otherFees);
      const response = await fetch(LOAN_MATH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loan_type: form.loanType,
          principal: Math.round(principalNum),
          annual_rate_pct: rateNum,
          tenure_months: tenureMonths,
          processing_fee: Number.isFinite(feeNum) ? Math.round(feeNum) : 0,
          other_fees: Number.isFinite(otherNum) ? Math.round(otherNum) : 0,
          rate_type: form.rateType || 'unknown',
        }),
      });
      const data = await response.json();
      if (data?.ok && data.resultCard) {
        setCardJson(JSON.stringify(data.resultCard));
      } else if (Array.isArray(data?.validation_errors) && data.validation_errors.length > 0) {
        setCalcErrors(data.validation_errors.map((message: string) => String(message)));
      } else {
        setCalcFailure(CALCULATOR_UNAVAILABLE);
      }
    } catch {
      setCalcFailure(CALCULATOR_UNAVAILABLE);
    } finally {
      setCalcBusy(false);
    }
  };

  /* ---- upload zone appearance ---- */

  let zoneTone = 'border-[var(--space-border-strong)] bg-[var(--space-surface-page-alt)]';
  if (dragging) {
    zoneTone =
      'border-[var(--space-data-highlight,#f5a623)] bg-[var(--space-data-highlight-soft,#fdf3e2)]';
  } else if (docStatus === 'processing') {
    zoneTone = 'border-[var(--space-brand-primary)] bg-[var(--space-surface-accent-soft)]';
  } else if (docStatus === 'parsed') {
    zoneTone =
      'border-[var(--space-semantic-success)] bg-[color-mix(in_srgb,var(--space-semantic-success)_7%,transparent)]';
  } else if (docStatus === 'error') {
    zoneTone =
      'border-[var(--space-semantic-danger)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_6%,transparent)]';
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto bg-[var(--space-surface-page)]"
      data-testid="loan-document-check"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6 sm:py-7">
        <div className="mb-4">
          <h1 className="text-lg font-bold leading-tight text-[var(--space-text-brand)] sm:text-xl">
            Check a loan offer
          </h1>
          <p className="mt-1 text-[12px] leading-snug text-[var(--space-text-secondary)]">
            Upload the offer letter, sanction letter or agreement and Loanley reads the figures off it, or fill the
            form in by hand. Either way the maths runs on Loanley's server — EMI, total cost and the effective cost
            once fees are counted.
          </p>
        </div>

        {/* upload card */}
        <div className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 shadow-sm sm:p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_DOC_TYPES}
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid="loan-doc-input"
          />

          <div
            role="button"
            tabIndex={0}
            aria-label="Upload Loan Document"
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPicker();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (docStatus !== 'processing') setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFile(e.dataTransfer?.files?.[0]);
            }}
            className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${zoneTone} ${
              docStatus === 'processing' ? 'cursor-wait' : 'cursor-pointer'
            }`}
            data-testid="loan-doc-dropzone"
          >
            {docStatus === 'processing' ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-[var(--space-text-brand)]" />
                <p className="mt-3 text-sm font-semibold text-[var(--space-text-primary)]">Processing document…</p>
                <p className="mt-0.5 text-[11px] text-[var(--space-text-secondary)]">{progressLabel}</p>
                <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[var(--space-surface-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                    data-testid="loan-doc-progress"
                  />
                </div>
                <p className="mt-2 text-[10px] text-[var(--space-text-muted)]">{docName}</p>
              </>
            ) : docStatus === 'parsed' ? (
              <>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--space-semantic-success)_14%,transparent)] px-3 py-1 text-[11px] font-bold text-[var(--space-semantic-success)]"
                  data-testid="loan-doc-parsed-badge"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Document parsed ✓
                </span>
                <p className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-[var(--space-text-primary)]">
                  <FileText className="h-4 w-4 shrink-0 text-[var(--space-text-muted)]" />
                  <span className="break-all">{docName}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--space-text-secondary)]">
                  {docSize > 0 ? `${describeBytes(docSize)} · ` : ''}
                  {extraction && extraction.filled.length > 0
                    ? `${listFields(extraction.filled)} filled in below`
                    : 'no figures could be read — please fill the form in by hand'}
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDocument();
                  }}
                  className="mt-2.5 text-[11px] font-medium text-[var(--space-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--space-text-brand)]"
                  data-testid="loan-doc-clear"
                >
                  Clear document
                </button>
              </>
            ) : docStatus === 'error' ? (
              <>
                <AlertTriangle className="h-7 w-7 text-[var(--space-semantic-danger)]" />
                <p className="mt-2.5 max-w-md text-[12px] leading-snug text-[var(--space-text-primary)]">{docError}</p>
                <p className="mt-2 text-[11px] font-medium text-[var(--space-text-brand)] underline underline-offset-2">
                  Choose another file
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDocument();
                  }}
                  className="mt-2 text-[11px] font-medium text-[var(--space-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--space-text-brand)]"
                  data-testid="loan-doc-clear"
                >
                  Clear document
                </button>
              </>
            ) : (
              <>
                <UploadCloud className="h-9 w-9 text-[var(--space-text-brand)]" />
                <p className="mt-3 text-base font-bold text-[var(--space-text-primary)]">Upload Loan Document</p>
                <p className="mt-1 max-w-sm text-[11px] leading-snug text-[var(--space-text-secondary)]">
                  PDF, JPG, PNG · Offer letters, sanction letters, loan agreements
                </p>
                <p className="mt-2.5 text-[11px] font-medium text-[var(--space-text-brand)] underline underline-offset-2">
                  Drag and drop, or click to choose a file
                </p>
              </>
            )}
          </div>

          <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-snug text-[var(--space-text-muted)]">
            <ShieldCheck className="mt-[1px] h-3 w-3 shrink-0" />
            Your document is read only to fill this form. It is never sent to a lender, and no lender is recommended
            here.
          </p>
        </div>

        {/* what the document gave us */}
        {docStatus === 'parsed' && extraction && (
          <div
            className="mt-3 rounded-xl border border-[var(--space-data-highlight,#f5a623)] bg-[var(--space-data-highlight-soft,#fdf3e2)] px-3.5 py-2.5"
            data-testid="loan-doc-summary"
          >
            <p className="text-[12px] font-semibold leading-snug text-[#8a5a00]">
              {extraction.filled.length > 0
                ? 'The highlighted fields below came from your document. Check every one against the page before you calculate.'
                : 'Nothing could be read off that document with confidence, so nothing has been filled in — please enter the figures by hand below.'}
            </p>
            {extraction.missing.length > 0 && extraction.filled.length > 0 && (
              <p className="mt-1 text-[11px] leading-snug text-[#8a5a00]">
                Not stated clearly in the document: {listFields(extraction.missing)}. Those are left blank rather than
                guessed — please fill them in.
              </p>
            )}
            {extraction.feeFromPercent != null && (
              <p className="mt-1 text-[11px] leading-snug text-[#8a5a00]">
                The processing fee was printed as {extraction.feeFromPercent}% of the loan, so it is shown here in
                rupees. GST on the fee is not included.
              </p>
            )}
          </div>
        )}

        {/* the calculator */}
        <div className="mt-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 shadow-sm sm:p-5">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
            Loan details
          </h2>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="loan-type">
                Loan type
              </label>
              <select
                id="loan-type"
                className={inputClass(isExtracted('loanType'))}
                value={form.loanType}
                onChange={(e) => setField('loanType', e.target.value)}
                data-testid="field-loan-type"
              >
                {LOAN_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              {isExtracted('loanType') && <VerifyNote />}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="loan-amount">
                Loan amount (₹)
              </label>
              <input
                id="loan-amount"
                type="number"
                inputMode="numeric"
                className={inputClass(isExtracted('principal'))}
                value={form.principal}
                onChange={(e) => setField('principal', e.target.value)}
                placeholder="e.g. 500000 for ₹5 lakh"
                data-testid="field-principal"
              />
              {isExtracted('principal') && <VerifyNote />}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="loan-rate">
                Interest rate (% per year)
              </label>
              <input
                id="loan-rate"
                type="number"
                step="0.01"
                inputMode="decimal"
                className={inputClass(isExtracted('ratePct'))}
                value={form.ratePct}
                onChange={(e) => setField('ratePct', e.target.value)}
                placeholder="e.g. 14"
                data-testid="field-rate"
              />
              {isExtracted('ratePct') && <VerifyNote />}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="loan-tenure">
                Tenure
              </label>
              <div className="flex gap-2">
                <input
                  id="loan-tenure"
                  type="number"
                  inputMode="numeric"
                  className={inputClass(isExtracted('tenureMonths'))}
                  value={form.tenure}
                  onChange={(e) => setField('tenure', e.target.value)}
                  placeholder={form.tenureUnit === 'years' ? 'e.g. 4' : 'e.g. 48'}
                  data-testid="field-tenure"
                />
                <select
                  aria-label="Tenure unit"
                  className={`${inputClass(false)} w-28 shrink-0`}
                  value={form.tenureUnit}
                  onChange={(e) => setField('tenureUnit', e.target.value)}
                  data-testid="field-tenure-unit"
                >
                  <option value="months">months</option>
                  <option value="years">years</option>
                </select>
              </div>
              {isExtracted('tenureMonths') && <VerifyNote />}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="loan-fee">
                Processing fee (₹)
              </label>
              <input
                id="loan-fee"
                type="number"
                inputMode="numeric"
                className={inputClass(isExtracted('processingFee'))}
                value={form.processingFee}
                onChange={(e) => setField('processingFee', e.target.value)}
                placeholder="0 if there is none"
                data-testid="field-processing-fee"
              />
              {isExtracted('processingFee') && <VerifyNote />}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor="loan-other-fees">
                Other charges (₹)
              </label>
              <input
                id="loan-other-fees"
                type="number"
                inputMode="numeric"
                className={inputClass(false)}
                value={form.otherFees}
                onChange={(e) => setField('otherFees', e.target.value)}
                placeholder="insurance, documentation…"
                data-testid="field-other-fees"
              />
            </div>

            <div className="sm:col-span-2">
              <span className={LABEL_CLASS}>Rate type</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'fixed' as RateType, label: 'Fixed' },
                  { value: 'floating' as RateType, label: 'Floating' },
                  { value: '' as RateType, label: 'Not sure' },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setField('rateType', option.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      form.rateType === option.value
                        ? 'border-[var(--space-brand-primary)] bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]'
                        : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCalculate()}
            disabled={!canCalculate}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--space-text-on-primary)] transition-opacity disabled:opacity-40 sm:w-auto"
            data-testid="loan-doc-calculate"
          >
            {calcBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Running the real maths…
              </>
            ) : (
              'Calculate'
            )}
          </button>
          <p className="mt-2 text-[10px] leading-snug text-[var(--space-text-muted)]">
            Loan amount, interest rate and tenure are needed before this can run. The maths is computed on Loanley's
            server — never estimated.
          </p>
        </div>

        {/* results */}
        {calcErrors.length > 0 && (
          <div
            className="mt-3 rounded-xl border border-[var(--space-semantic-danger)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_6%,transparent)] px-3.5 py-3"
            data-testid="loan-doc-validation"
          >
            <p className="text-[12px] font-semibold text-[var(--space-text-primary)]">
              Those numbers don't add up, so they won't be pretended to:
            </p>
            <ul className="mt-1.5 space-y-1">
              {calcErrors.map((message, i) => (
                <li key={i} className="text-[11px] leading-snug text-[var(--space-text-secondary)]">
                  • {message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {calcFailure && (
          <p className="mt-3 rounded-xl bg-[var(--space-surface-muted)] px-3.5 py-3 text-[12px] leading-snug text-[var(--space-text-secondary)]">
            {calcFailure}
          </p>
        )}

        {cardJson && (
          <div className="mt-3 space-y-2" data-testid="loan-doc-result">
            <ZeroCommissionStrip />
            <LoanleyResultCard raw={cardJson} />
          </div>
        )}

        <p className="mt-4 text-center text-[10px] leading-snug text-[var(--space-text-muted)]">
          No lender has paid for placement. Loanley earns no referral commission. Neutral information, not financial
          advice.
        </p>
      </div>
    </div>
  );
}
