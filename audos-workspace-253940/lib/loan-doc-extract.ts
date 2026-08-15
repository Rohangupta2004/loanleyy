/**
 * loan-doc-extract — turn a loan document into calculator inputs.
 *
 * Whoever is checking an offer usually has the paperwork in front of them: a
 * sanction letter, an offer letter, a scanned loan agreement. Retyping four
 * figures off that page is where the mistakes happen, so the document is read
 * once and the calculator is pre-filled from it — the person then verifies
 * rather than transcribes.
 *
 * Two transports, because the platform reads the two formats differently:
 *   images (JPG/PNG/WebP) → gemini-vision-transform, POST /api/generate/vision
 *   PDFs                  → file-storage upload, then document-analysis,
 *                           POST /api/analyze-document (native PDF reading)
 *
 * Nothing here is allowed to guess. The model is told to return null for any
 * figure that is not printed on the page, and every value it does return is
 * bounded against the same limits the loan-math hook validates against — a
 * field outside those bounds is DROPPED rather than clamped, so the person is
 * asked for it instead of being shown a number the document never said.
 *
 * Neutrality: the lender's identity is deliberately not extracted. This reads
 * numbers off a page; it never names, ranks, or steers anyone toward a lender.
 */

export type LoanTypeId = 'personal' | 'home' | 'business' | 'education' | 'loan_against_property';

export type ExtractedField = 'loanType' | 'principal' | 'ratePct' | 'tenureMonths' | 'processingFee';

export interface ExtractedLoanFields {
  loanType?: LoanTypeId;
  principal?: number;
  ratePct?: number;
  tenureMonths?: number;
  processingFee?: number;
}

export interface ExtractionOutcome {
  fields: ExtractedLoanFields;
  /** Fields the document actually yielded, in form order. */
  filled: ExtractedField[];
  /** Fields the document did not state — these stay blank for manual entry. */
  missing: ExtractedField[];
  /** Set when the fee was computed from a percentage the document printed. */
  feeFromPercent: number | null;
}

export type ExtractionProgress = (percent: number, label: string) => void;

export const EXTRACT_FIELD_LABELS: Record<ExtractedField, string> = {
  loanType: 'loan type',
  principal: 'loan amount',
  ratePct: 'interest rate',
  tenureMonths: 'tenure',
  processingFee: 'processing fee',
};

const FIELD_ORDER: ExtractedField[] = ['loanType', 'principal', 'ratePct', 'tenureMonths', 'processingFee'];

export const ACCEPTED_DOC_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

const VISION_ENDPOINT = '/api/generate/vision';
const ANALYZE_ENDPOINT = '/api/analyze-document';
const UPLOAD_FILE_ENDPOINT = '/api/upload/file';
const UPLOAD_IMAGE_ENDPOINT = '/api/upload/image';

const READ_FAILED =
  "Loanley couldn't read that document. Try a clearer photo or the original PDF — or enter the figures by hand below.";
const UPLOAD_FAILED =
  "That document couldn't be uploaded for reading. Please try again in a moment, or enter the figures by hand below.";

/* ============================================================================
 * 1. File checks
 * ==========================================================================*/

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** 'image' | 'pdf' | null — mime type first, filename extension as fallback. */
export function documentKind(file: File): 'image' | 'pdf' | null {
  const mime = String(file?.type || '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (/^image\/(jpe?g|png|webp)$/.test(mime)) return 'image';
  const ext = extensionOf(file?.name || '');
  if (ext === 'pdf') return 'pdf';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') return 'image';
  return null;
}

export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** A plain-language problem with the file, or null when it is fine to read. */
export function validateDocFile(file: File | null | undefined): string | null {
  if (!file) return 'No file was selected.';
  if (!documentKind(file)) {
    return 'Loanley can read a PDF, JPG, PNG or WebP. Please upload the document in one of those formats, or enter the figures by hand below.';
  }
  if (file.size === 0) return 'That file is empty. Please pick the document again.';
  if (file.size > MAX_DOC_BYTES) {
    return `That file is ${describeBytes(file.size)}. Please upload a document under ${describeBytes(MAX_DOC_BYTES)}.`;
  }
  return null;
}

/* ============================================================================
 * 2. The extraction prompt
 *
 * Written to be boring and literal. Every clause that sounds redundant is
 * there because the alternative is a confident number nobody printed: the
 * EMI read as the principal, a "typical" rate filled in for a blank, a
 * monthly rate reported as an annual one.
 * ==========================================================================*/

const EXTRACTION_PROMPT = [
  'You are reading one Indian loan document: an offer letter, a sanction letter, a loan agreement, or a written quote.',
  'Extract ONLY what is actually printed on the page. Reply with a single JSON object and nothing else — no explanation, no markdown fence:',
  '{"loan_type": "personal" | "home" | "business" | "education" | "loan_against_property" | null, "principal_inr": number | null, "annual_rate_pct": number | null, "tenure_months": integer | null, "processing_fee_inr": number | null, "processing_fee_pct": number | null}',
  '',
  'Rules:',
  '- Amounts are Indian rupees. Return plain numbers with no symbol, commas, or words: "Rs. 5,00,000" is 500000, "INR 5 lakh" is 500000, "1.2 crore" is 12000000.',
  '- principal_inr is the loan amount sanctioned or offered. It is NOT the EMI, NOT the total repayable, and NOT the net amount disbursed after fees.',
  '- annual_rate_pct is the interest rate per YEAR as a plain number: "13.5% p.a." is 13.5. If the document prints only a monthly rate, multiply it by 12.',
  '- tenure_months is the repayment tenure in MONTHS: "48 months" is 48, "4 years" is 48.',
  '- processing_fee_inr is the processing fee as a rupee figure when the document prints one. processing_fee_pct is the fee as a percentage of the loan when the document prints a percentage instead ("2% of the loan amount" is 2). Fill whichever the document states; both may be present, and both are null when no processing fee is mentioned.',
  '- Use null for anything not clearly printed on the page. Never estimate, never fill in a typical market value, and never carry a number over from a different field.',
  '- Do not return the lender name or any other field.',
].join('\n');

/* ============================================================================
 * 3. Transport
 * ==========================================================================*/

function appId(): string | null {
  try {
    const id = (window as unknown as { __APP_ID__?: string }).__APP_ID__;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const id = appId();
  if (id) headers['X-App-Id'] = id;
  return headers;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be opened in the browser.'));
    reader.readAsDataURL(file);
  });
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Images go straight to Gemini Vision as base64 — no upload round trip. */
async function readImageDocument(file: File, onProgress: ExtractionProgress): Promise<string> {
  onProgress(22, 'Reading the document…');
  const base64 = stripDataUrlPrefix(await fileToDataUrl(file));
  onProgress(48, 'Finding the figures on the page…');
  const response = await fetch(VISION_ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      prompt: EXTRACTION_PROMPT,
      image: base64,
      mimeType: file.type || 'image/jpeg',
    }),
  });
  const data = await readJson(response);
  const result = data && typeof data.result === 'string' ? data.result : '';
  if (!result || data?.success === false) throw new Error(READ_FAILED);
  return result;
}

/**
 * Multipart upload first: it preserves the PDF content type and skips the
 * base64 size ceiling. The JSON upload is the fallback for servers that only
 * expose that route.
 */
async function uploadDocument(file: File): Promise<string> {
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'loan-documents');
    const id = appId();
    const response = await fetch(UPLOAD_FILE_ENDPOINT, {
      method: 'POST',
      headers: id ? { 'X-App-Id': id } : undefined,
      body: form,
    });
    const data = await readJson(response);
    const url = data && (data.url || data.imageUrl);
    if (typeof url === 'string' && url) return url;
  } catch {
    // Fall through to the base64 route below.
  }

  const dataUrl = await fileToDataUrl(file);
  const response = await fetch(UPLOAD_IMAGE_ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ imageData: dataUrl, fileName: file.name || 'loan-document.pdf' }),
  });
  const data = await readJson(response);
  const url = data && (data.imageUrl || data.url);
  if (typeof url !== 'string' || !url) throw new Error(UPLOAD_FAILED);
  return url;
}

/** PDFs are read natively by the document-analysis endpoint. */
async function readPdfDocument(file: File, onProgress: ExtractionProgress): Promise<string> {
  onProgress(20, 'Uploading the document…');
  const documentUrl = await uploadDocument(file);
  onProgress(52, 'Finding the figures on the page…');
  const response = await fetch(ANALYZE_ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ documentUrl, analysisPrompt: EXTRACTION_PROMPT, documentType: 'pdf' }),
  });
  const data = await readJson(response);
  const analysis = data && typeof data.analysis === 'string' ? data.analysis : '';
  if (!analysis || data?.success === false) throw new Error(READ_FAILED);
  return analysis;
}

/* ============================================================================
 * 4. Parsing and bounds
 * ==========================================================================*/

/** Pull the JSON object out of a model reply that may be fenced or chatty. */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  const text = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[₹,\s%]/g, '').replace(/[a-z.]+$/i, '');
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseLoanType(value: unknown): LoanTypeId | null {
  const text = String(value || '').toLowerCase();
  if (!text || text === 'null') return null;
  if (/property|\blap\b|mortgage/.test(text)) return 'loan_against_property';
  if (/home|housing|house/.test(text)) return 'home';
  if (/education|student|study|tuition/.test(text)) return 'education';
  if (/business|msme|sme|working capital/.test(text)) return 'business';
  if (/personal/.test(text)) return 'personal';
  return null;
}

/*
 * The same bounds the loan-math hook validates against, applied before the
 * form is touched: a figure outside them is far more likely to be a misread
 * than a real offer, and a blank field somebody fills in is always better
 * than a filled field they have to notice is wrong.
 */
function boundedPrincipal(value: number | null): number | undefined {
  if (value == null) return undefined;
  const rounded = Math.round(value);
  return rounded >= 1000 && rounded <= 1000000000 ? rounded : undefined;
}

function boundedRate(value: number | null): number | undefined {
  if (value == null) return undefined;
  const rate = Math.round(value * 100) / 100;
  return rate > 0 && rate <= 60 ? rate : undefined;
}

function boundedTenure(value: number | null): number | undefined {
  if (value == null) return undefined;
  const months = Math.round(value);
  return months >= 3 && months <= 360 ? months : undefined;
}

function boundedFee(value: number | null, principal: number | undefined): number | undefined {
  if (value == null) return undefined;
  const fee = Math.round(value);
  if (fee < 0) return undefined;
  // A "fee" as large as the loan itself is a misread line, not a charge.
  if (principal != null && fee > principal) return undefined;
  return fee <= 100000000 ? fee : undefined;
}

export function normaliseExtraction(parsed: Record<string, unknown> | null): ExtractionOutcome {
  const fields: ExtractedLoanFields = {};
  let feeFromPercent: number | null = null;

  if (parsed) {
    const loanType = normaliseLoanType(parsed.loan_type);
    if (loanType) fields.loanType = loanType;

    const principal = boundedPrincipal(toNumber(parsed.principal_inr));
    if (principal != null) fields.principal = principal;

    const rate = boundedRate(toNumber(parsed.annual_rate_pct));
    if (rate != null) fields.ratePct = rate;

    const tenure = boundedTenure(toNumber(parsed.tenure_months));
    if (tenure != null) fields.tenureMonths = tenure;

    let fee = boundedFee(toNumber(parsed.processing_fee_inr), principal);
    if (fee == null) {
      // A fee quoted only as a percentage is still a real figure off the page —
      // it just needs the principal to become rupees.
      const pct = toNumber(parsed.processing_fee_pct);
      if (pct != null && pct > 0 && pct <= 10 && principal != null) {
        fee = boundedFee(Math.round((principal * pct) / 100), principal);
        if (fee != null) feeFromPercent = Math.round(pct * 100) / 100;
      }
    }
    if (fee != null) fields.processingFee = fee;
  }

  const filled = FIELD_ORDER.filter((key) => fields[key] !== undefined);
  const missing = FIELD_ORDER.filter((key) => fields[key] === undefined);
  return { fields, filled, missing, feeFromPercent };
}

/* ============================================================================
 * 5. The one call the UI makes
 * ==========================================================================*/

export async function extractLoanFieldsFromFile(
  file: File,
  onProgress: ExtractionProgress = () => {},
): Promise<ExtractionOutcome> {
  const problem = validateDocFile(file);
  if (problem) throw new Error(problem);

  onProgress(8, 'Opening the document…');
  const kind = documentKind(file);
  const raw = kind === 'pdf' ? await readPdfDocument(file, onProgress) : await readImageDocument(file, onProgress);

  onProgress(86, 'Checking the figures…');
  const outcome = normaliseExtraction(parseModelJson(raw));

  onProgress(100, 'Done');
  return outcome;
}
