import { useState, useEffect, useRef, useMemo } from 'react';
import {
  GitCompareArrows,
  Plus,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  TrendingDown,
  DollarSign,
  Calendar,
  Percent,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
  FileText,
} from 'lucide-react';
import { tw } from '../../lib/colors';

/* ============================================================================
 * Offer Stack — save and compare loan offers side-by-side with total lifetime
 * cost and plain-language risk flags. Uses WorkspaceDB for persistence.
 *
 * Table `loan_offers` (created on first write):
 *   lender (text), loan_type (text), apr (numeric), term_months (integer),
 *   monthly_payment (numeric), fees (numeric), rate_type (text),
 *   principal (numeric), notes (text)
 * ==========================================================================*/

interface LoanOffer {
  id: number;
  lender: string;
  loan_type: string;
  apr: number;
  term_months: number;
  monthly_payment: number;
  fees: number;
  rate_type: string;
  principal: number;
  notes?: string;
  created_at?: string;
}

interface OfferMetrics {
  totalPayments: number;
  totalCost: number;
  totalInterest: number;
}

declare global {
  interface Window {
    useWorkspaceDB: <T = unknown>(
      table: string,
      options?: {
        shared?: boolean;
        limit?: number;
        orderBy?: { column: string; direction: 'asc' | 'desc' };
      },
    ) => {
      data: T[];
      loading: boolean;
      error: Error | null;
      refresh: () => void;
    };
    __workspaceDb: {
      from: (table: string) => {
        insert: (row: Record<string, unknown>) => Promise<void>;
        update: (id: number, row: Record<string, unknown>) => Promise<void>;
        delete: (id: number) => Promise<void>;
      };
    };
  }
}

const LOAN_TYPES = ['Auto', 'Mortgage', 'Personal', 'Student', 'Home Equity', 'Other'];

const EMPTY_FORM = {
  lender: '',
  loan_type: 'Auto',
  apr: '',
  term_months: '60',
  monthly_payment: '',
  fees: '',
  rate_type: 'fixed' as 'fixed' | 'variable',
  principal: '',
  notes: '',
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCurrencyPrecise(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n);
}

function calcMetrics(offer: LoanOffer): OfferMetrics {
  const totalPayments = offer.monthly_payment * offer.term_months;
  const fees = offer.fees || 0;
  const totalCost = totalPayments + fees;
  const principal = offer.principal || 0;
  const totalInterest = principal > 0 ? totalCost - principal : totalPayments;
  return { totalPayments, totalCost, totalInterest };
}

function getRiskFlags(offer: LoanOffer, allOffers: LoanOffer[]): string[] {
  const flags: string[] = [];
  const metrics = calcMetrics(offer);

  if (offer.rate_type === 'variable') {
    flags.push(
      'This is a variable-rate loan — your monthly payment can increase if market rates rise, making the total cost unpredictable.',
    );
  }

  if (offer.apr >= 12) {
    flags.push(
      `An APR of ${offer.apr.toFixed(2)}% is relatively high. Over ${offer.term_months} months, interest adds up fast.`,
    );
  } else if (offer.apr >= 8) {
    flags.push(
      `At ${offer.apr.toFixed(2)}% APR, check whether a shorter term or different lender could reduce your total interest.`,
    );
  }

  if (offer.fees >= 1500) {
    flags.push(
      `Upfront fees of ${formatCurrency(offer.fees)} aren't included in your monthly payment — they raise the true cost of this offer.`,
    );
  } else if (offer.fees >= 500) {
    flags.push(
      `Closing or origination fees of ${formatCurrency(offer.fees)} add to what you'll actually pay beyond the sticker monthly payment.`,
    );
  }

  if (offer.term_months >= 72 && offer.monthly_payment < (offer.principal || 0) / 48) {
    flags.push(
      'A longer term keeps payments low but stretches interest over more years — compare total cost, not just the monthly number.',
    );
  }

  if (allOffers.length >= 2) {
    const others = allOffers.filter((o) => o.id !== offer.id);
    const myCost = metrics.totalCost;
    const lowestOther = Math.min(...others.map((o) => calcMetrics(o).totalCost));
    const diff = myCost - lowestOther;
    if (diff > 500) {
      flags.push(
        `This offer costs about ${formatCurrency(diff)} more over the full loan life than your cheapest saved option — a lower monthly payment may be hiding that gap.`,
      );
    }
  }

  if (offer.principal > 0) {
    const impliedRate = (metrics.totalInterest / offer.principal) * 100;
    if (impliedRate > offer.apr * (offer.term_months / 12) * 1.5) {
      flags.push(
        'The numbers suggest extra costs beyond a straightforward APR calculation — ask the lender about prepayment penalties or add-ons.',
      );
    }
  }

  return flags;
}

async function uploadDocument(file: File): Promise<string> {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData: base64Data, fileName: file.name }),
  });
  const { imageUrl } = await res.json();
  return imageUrl;
}

async function analyzeQuote(documentUrl: string, documentType: 'pdf' | 'image'): Promise<string> {
  const res = await fetch('/api/analyze-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentUrl,
      documentType,
      analysisPrompt: `Extract loan offer details from this document. Return ONLY valid JSON with these fields (use null if missing):
{
  "lender": "string",
  "loan_type": "Auto|Mortgage|Personal|Student|Home Equity|Other",
  "apr": number,
  "term_months": number,
  "monthly_payment": number,
  "fees": number,
  "rate_type": "fixed|variable",
  "principal": number,
  "notes": "brief summary of anything unusual"
}`,
    }),
  });
  const { analysis } = await res.json();
  return analysis;
}

async function generatePlainLanguageSummary(
  offers: LoanOffer[],
  metrics: Map<number, OfferMetrics>,
): Promise<string> {
  const summary = offers
    .map((o) => {
      const m = metrics.get(o.id)!;
      return `- ${o.lender}: ${formatCurrencyPrecise(o.monthly_payment)}/mo, APR ${o.apr}%, total cost ${formatCurrency(m.totalCost)} over ${o.term_months} months`;
    })
    .join('\n');

  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You are a friendly, trustworthy loan advisor for Loanley. Explain loan comparisons in plain language — no jargon. Be concise (3-4 sentences). Focus on total cost over the loan life, not just monthly payment. Be reassuring but honest about risks.',
        },
        {
          role: 'user',
          content: `Compare these loan offers and tell the borrower which is best overall and why:\n${summary}`,
        },
      ],
    }),
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export default function OfferStack() {
  const { data: offers, loading, error, refresh } = window.useWorkspaceDB<LoanOffer>('loan_offers', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 50,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'list' | 'compare'>('list');
  const [uploading, setUploading] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedFlags, setExpandedFlags] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedOffers = useMemo(
    () => (offers || []).filter((o) => selected.has(o.id)),
    [offers, selected],
  );

  const metricsMap = useMemo(() => {
    const map = new Map<number, OfferMetrics>();
    (offers || []).forEach((o) => map.set(o.id, calcMetrics(o)));
    return map;
  }, [offers]);

  const bestTotalCostId = useMemo(() => {
    if (selectedOffers.length < 2) return null;
    let best = selectedOffers[0];
    let bestCost = calcMetrics(best).totalCost;
    for (const o of selectedOffers) {
      const cost = calcMetrics(o).totalCost;
      if (cost < bestCost) {
        bestCost = cost;
        best = o;
      }
    }
    return best.id;
  }, [selectedOffers]);

  useEffect(() => {
    if (view === 'compare' && selectedOffers.length >= 2) {
      setAiLoading(true);
      setAiSummary('');
      generatePlainLanguageSummary(selectedOffers, metricsMap)
        .then(setAiSummary)
        .catch(() => setAiSummary(''))
        .finally(() => setAiLoading(false));
    }
  }, [view, selectedOffers, metricsMap]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    const lender = form.lender.trim();
    const apr = parseFloat(form.apr);
    const term = parseInt(form.term_months, 10);
    const payment = parseFloat(form.monthly_payment);
    const fees = parseFloat(form.fees) || 0;
    const principal = parseFloat(form.principal) || 0;

    if (!lender || isNaN(apr) || isNaN(term) || isNaN(payment) || busy) return;

    setBusy(true);
    try {
      const row = {
        lender,
        loan_type: form.loan_type,
        apr,
        term_months: term,
        monthly_payment: payment,
        fees,
        rate_type: form.rate_type,
        principal,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        await window.__workspaceDb.from('loan_offers').update(editingId, row);
      } else {
        await window.__workspaceDb.from('loan_offers').insert(row);
      }
      resetForm();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    await window.__workspaceDb.from('loan_offers').delete(id);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    refresh();
  };

  const startEdit = (offer: LoanOffer) => {
    setForm({
      lender: offer.lender,
      loan_type: offer.loan_type,
      apr: String(offer.apr),
      term_months: String(offer.term_months),
      monthly_payment: String(offer.monthly_payment),
      fees: String(offer.fees || ''),
      rate_type: (offer.rate_type as 'fixed' | 'variable') || 'fixed',
      principal: offer.principal ? String(offer.principal) : '',
      notes: offer.notes || '',
    });
    setEditingId(offer.id);
    setShowForm(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    try {
      const url = await uploadDocument(file);
      const docType = file.type === 'application/pdf' ? 'pdf' : 'image';
      const raw = await analyzeQuote(url, docType);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      setForm({
        lender: parsed.lender || '',
        loan_type: LOAN_TYPES.includes(parsed.loan_type) ? parsed.loan_type : 'Other',
        apr: parsed.apr != null ? String(parsed.apr) : '',
        term_months: parsed.term_months != null ? String(parsed.term_months) : '60',
        monthly_payment: parsed.monthly_payment != null ? String(parsed.monthly_payment) : '',
        fees: parsed.fees != null ? String(parsed.fees) : '',
        rate_type: parsed.rate_type === 'variable' ? 'variable' : 'fixed',
        principal: parsed.principal != null ? String(parsed.principal) : '',
        notes: parsed.notes || 'Imported from uploaded quote',
      });
      setEditingId(null);
      setShowForm(true);
    } catch {
      /* user can still add manually */
    } finally {
      setUploading(false);
    }
  };

  const toggleFlagExpand = (id: number) => {
    setExpandedFlags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inputCls = `${tw.input.base} ${tw.input.default} text-sm px-3 py-2.5`;
  const labelCls = `block text-xs font-medium ${tw.typography.color.secondary} mb-1`;

  return (
    <div className="min-h-full flex flex-col w-full bg-transparent">
      {/* Toolbar */}
      <div className="px-5 pt-3 pb-4 border-b border-[var(--space-border-default)]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm ${tw.button.primary}`}
            data-testid="button-add-offer"
          >
            <Plus className="w-4 h-4" /> Add offer
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm ${tw.button.secondary} disabled:opacity-50`}
            data-testid="button-upload-quote"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Reading quote…' : 'Upload quote'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFileUpload}
          />
          {selected.size >= 2 && (
            <button
              onClick={() => setView(view === 'compare' ? 'list' : 'compare')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm ml-auto ${tw.button.accent}`}
              data-testid="button-compare"
            >
              <GitCompareArrows className="w-4 h-4" />
              {view === 'compare' ? 'Back to list' : `Compare ${selected.size} offers`}
            </button>
          )}
        </div>
        {selected.size > 0 && selected.size < 2 && (
          <p className={`mt-2 text-xs ${tw.typography.color.tertiary}`}>
            Select one more offer to compare side-by-side
          </p>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className={`mx-5 mt-4 p-5 rounded-2xl ${tw.card.default} transition-all duration-200`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>
              {editingId ? 'Edit offer' : 'New loan offer'}
            </h3>
            <button
              onClick={resetForm}
              className={`p-1.5 rounded-lg ${tw.button.ghost}`}
              aria-label="Close form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>Lender / dealer</label>
              <input
                className={inputCls}
                value={form.lender}
                onChange={(e) => setForm({ ...form, lender: e.target.value })}
                placeholder="e.g. First National, Toyota Financial"
                data-testid="input-lender"
              />
            </div>
            <div>
              <label className={labelCls}>Loan type</label>
              <select
                className={inputCls}
                value={form.loan_type}
                onChange={(e) => setForm({ ...form, loan_type: e.target.value })}
              >
                {LOAN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Rate type</label>
              <select
                className={inputCls}
                value={form.rate_type}
                onChange={(e) =>
                  setForm({ ...form, rate_type: e.target.value as 'fixed' | 'variable' })
                }
              >
                <option value="fixed">Fixed</option>
                <option value="variable">Variable</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>APR (%)</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={form.apr}
                onChange={(e) => setForm({ ...form, apr: e.target.value })}
                placeholder="6.9"
                data-testid="input-apr"
              />
            </div>
            <div>
              <label className={labelCls}>Term (months)</label>
              <input
                type="number"
                className={inputCls}
                value={form.term_months}
                onChange={(e) => setForm({ ...form, term_months: e.target.value })}
                placeholder="60"
              />
            </div>
            <div>
              <label className={labelCls}>Monthly payment ($)</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={form.monthly_payment}
                onChange={(e) => setForm({ ...form, monthly_payment: e.target.value })}
                placeholder="425"
              />
            </div>
            <div>
              <label className={labelCls}>Loan amount / principal ($)</label>
              <input
                type="number"
                className={inputCls}
                value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })}
                placeholder="25000"
              />
            </div>
            <div>
              <label className={labelCls}>Fees & closing costs ($)</label>
              <input
                type="number"
                className={inputCls}
                value={form.fees}
                onChange={(e) => setForm({ ...form, fees: e.target.value })}
                placeholder="500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes (optional)</label>
              <input
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything unusual about this quote"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={busy || !form.lender.trim() || !form.apr || !form.monthly_payment}
              className={`px-4 py-2 rounded-xl text-sm ${tw.button.primary} disabled:opacity-40`}
              data-testid="button-save-offer"
            >
              {editingId ? 'Save changes' : 'Save offer'}
            </button>
            <button onClick={resetForm} className={`px-4 py-2 rounded-xl text-sm ${tw.button.ghost}`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" />
            <p className={`text-sm ${tw.typography.color.tertiary}`}>Loading your offers…</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className={`text-sm ${tw.typography.color.danger}`}>
              Couldn't load offers: {error.message}
            </p>
            <button onClick={refresh} className={`mt-3 px-3 py-1.5 text-sm rounded-lg ${tw.button.secondary}`}>
              Try again
            </button>
          </div>
        ) : view === 'compare' && selectedOffers.length >= 2 ? (
          /* Comparison view */
          <div className="space-y-5">
            {/* AI summary */}
            {(aiLoading || aiSummary) && (
              <div className={`p-4 rounded-2xl ${tw.card.flat} border-l-4 border-[var(--space-brand-primary)]`}>
                <div className="flex items-start gap-2">
                  <Sparkles className={`w-4 h-4 mt-0.5 shrink-0 ${tw.icon.primary}`} />
                  <div>
                    <p className={`text-xs font-medium ${tw.typography.color.secondary} mb-1`}>
                      Plain-language summary
                    </p>
                    {aiLoading ? (
                      <p className={`text-sm ${tw.typography.color.tertiary}`}>Analyzing your offers…</p>
                    ) : (
                      <p className={`text-sm leading-relaxed ${tw.typography.color.primary}`}>{aiSummary}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Savings callout */}
            {bestTotalCostId && selectedOffers.length >= 2 && (
              <div className={`p-4 rounded-2xl ${tw.bg.muted} flex items-center gap-3`}>
                <div className={`w-10 h-10 rounded-xl ${tw.bg.accent} flex items-center justify-center shrink-0`}>
                  <TrendingDown className={`w-5 h-5 ${tw.icon.success}`} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${tw.typography.color.primary}`}>
                    Lowest total cost:{' '}
                    {selectedOffers.find((o) => o.id === bestTotalCostId)?.lender}
                  </p>
                  <p className={`text-xs ${tw.typography.color.tertiary}`}>
                    {(() => {
                      const costs = selectedOffers.map((o) => calcMetrics(o).totalCost);
                      const max = Math.max(...costs);
                      const min = Math.min(...costs);
                      return max - min > 0
                        ? `Choosing the cheapest saves ${formatCurrency(max - min)} vs. the most expensive option over the full loan life.`
                        : 'These offers have similar total costs.';
                    })()}
                  </p>
                </div>
              </div>
            )}

            {/* Side-by-side cards */}
            <div
              className={`grid gap-4 ${
                selectedOffers.length === 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
              }`}
            >
              {selectedOffers.map((offer) => {
                const m = metricsMap.get(offer.id)!;
                const flags = getRiskFlags(offer, selectedOffers);
                const isBest = offer.id === bestTotalCostId;

                return (
                  <div
                    key={offer.id}
                    className={`rounded-2xl p-5 transition-all duration-300 ${
                      isBest
                        ? `${tw.card.default} ring-2 ring-[var(--space-semantic-success)] shadow-md`
                        : tw.card.default
                    }`}
                    data-testid={`compare-card-${offer.id}`}
                  >
                    {isBest && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium mb-3 ${tw.badge.success}`}
                      >
                        <Check className="w-3 h-3" /> Best total cost
                      </span>
                    )}

                    <h4 className={`font-semibold text-base ${tw.typography.color.primary}`}>
                      {offer.lender}
                    </h4>
                    <p className={`text-xs ${tw.typography.color.tertiary} mb-4`}>
                      {offer.loan_type} · {offer.rate_type === 'variable' ? 'Variable' : 'Fixed'} rate
                    </p>

                    <div className="space-y-3">
                      <div className="flex justify-between items-baseline">
                        <span className={`text-xs ${tw.typography.color.tertiary}`}>Monthly payment</span>
                        <span className={`text-lg font-semibold ${tw.typography.color.primary}`}>
                          {formatCurrencyPrecise(offer.monthly_payment)}
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className={`text-xs ${tw.typography.color.tertiary}`}>APR</span>
                        <span className={`text-sm font-medium ${tw.typography.color.secondary}`}>
                          {offer.apr.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className={`text-xs ${tw.typography.color.tertiary}`}>Term</span>
                        <span className={`text-sm ${tw.typography.color.secondary}`}>
                          {offer.term_months} months ({Math.round(offer.term_months / 12)} yr)
                        </span>
                      </div>
                      <div className="h-px bg-[var(--space-border-default)]" />
                      <div className="flex justify-between items-baseline">
                        <span className={`text-xs ${tw.typography.color.tertiary}`}>Total interest</span>
                        <span className={`text-sm font-medium ${tw.typography.color.secondary}`}>
                          {formatCurrency(m.totalInterest)}
                        </span>
                      </div>
                      {offer.fees > 0 && (
                        <div className="flex justify-between items-baseline">
                          <span className={`text-xs ${tw.typography.color.tertiary}`}>Upfront fees</span>
                          <span className={`text-sm ${tw.typography.color.secondary}`}>
                            {formatCurrency(offer.fees)}
                          </span>
                        </div>
                      )}
                      <div
                        className={`flex justify-between items-baseline pt-2 px-3 py-2 -mx-3 rounded-xl ${tw.bg.muted}`}
                      >
                        <span className={`text-xs font-medium ${tw.typography.color.secondary}`}>
                          Total cost of loan
                        </span>
                        <span className={`text-lg font-bold ${tw.typography.color.brand}`}>
                          {formatCurrency(m.totalCost)}
                        </span>
                      </div>
                    </div>

                    {/* Risk flags */}
                    {flags.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--space-border-default)]">
                        <button
                          onClick={() => toggleFlagExpand(offer.id)}
                          className={`flex items-center gap-1.5 text-xs font-medium ${tw.typography.color.secondary} w-full`}
                        >
                          <AlertTriangle className={`w-3.5 h-3.5 ${tw.icon.primary}`} />
                          {flags.length} thing{flags.length > 1 ? 's' : ''} to know
                          {expandedFlags.has(offer.id) ? (
                            <ChevronUp className="w-3.5 h-3.5 ml-auto" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 ml-auto" />
                          )}
                        </button>
                        {expandedFlags.has(offer.id) && (
                          <ul className="mt-2 space-y-2">
                            {flags.map((flag, i) => (
                              <li
                                key={i}
                                className={`text-xs leading-relaxed pl-2 border-l-2 border-[var(--space-brand-highlight-200)] ${tw.typography.color.secondary}`}
                              >
                                {flag}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : !offers || offers.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center max-w-sm mx-auto">
            <div className={`w-14 h-14 rounded-2xl ${tw.bg.muted} flex items-center justify-center`}>
              <GitCompareArrows className={`w-7 h-7 ${tw.icon.primary}`} />
            </div>
            <h3 className={`font-semibold ${tw.typography.color.primary}`}>No offers yet</h3>
            <p className={`text-sm ${tw.typography.color.tertiary}`}>
              Add loan quotes manually or upload a dealer PDF — then compare total cost side-by-side, not just monthly payments.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className={`mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm ${tw.button.primary}`}
            >
              <Plus className="w-4 h-4" /> Add your first offer
            </button>
          </div>
        ) : (
          /* Offer list */
          <div className="space-y-3">
            <p className={`text-xs ${tw.typography.color.tertiary} px-1`}>
              {offers.length} saved · select 2–4 to compare
            </p>
            {offers.map((offer) => {
              const m = metricsMap.get(offer.id)!;
              const isSelected = selected.has(offer.id);

              return (
                <div
                  key={offer.id}
                  className={`group rounded-2xl p-4 transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? `${tw.card.default} ring-2 ring-[var(--space-brand-primary)] shadow-sm`
                      : `${tw.card.default} hover:shadow-md`
                  }`}
                  onClick={() => toggleSelect(offer.id)}
                  data-testid={`offer-row-${offer.id}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(offer.id);
                      }}
                      className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-[var(--space-brand-primary)] border-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]'
                          : 'border-[var(--space-border-default)] group-hover:border-[var(--space-brand-primary)]'
                      }`}
                      aria-label={isSelected ? 'Deselect offer' : 'Select for comparison'}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className={`font-semibold text-sm ${tw.typography.color.primary}`}>
                            {offer.lender}
                          </h4>
                          <p className={`text-xs ${tw.typography.color.tertiary}`}>
                            {offer.loan_type} · {offer.apr.toFixed(2)}% APR · {offer.term_months} mo
                            {offer.rate_type === 'variable' && (
                              <span className={`ml-1.5 ${tw.badge.warning} ${tw.badge.default}`}>
                                Variable
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-base font-semibold ${tw.typography.color.primary}`}>
                            {formatCurrencyPrecise(offer.monthly_payment)}
                            <span className={`text-xs font-normal ${tw.typography.color.tertiary}`}>/mo</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                        <span className={`inline-flex items-center gap-1 text-xs ${tw.typography.color.secondary}`}>
                          <DollarSign className="w-3 h-3" />
                          Total: {formatCurrency(m.totalCost)}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-xs ${tw.typography.color.tertiary}`}>
                          <Percent className="w-3 h-3" />
                          Interest: {formatCurrency(m.totalInterest)}
                        </span>
                        {offer.fees > 0 && (
                          <span className={`inline-flex items-center gap-1 text-xs ${tw.typography.color.tertiary}`}>
                            <FileText className="w-3 h-3" />
                            Fees: {formatCurrency(offer.fees)}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 text-xs ${tw.typography.color.tertiary}`}>
                          <Calendar className="w-3 h-3" />
                          {Math.round(offer.term_months / 12)} years
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(offer);
                        }}
                        className={`p-1.5 rounded-lg text-xs ${tw.button.ghost}`}
                        aria-label="Edit offer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(offer.id);
                        }}
                        className={`p-1.5 rounded-lg ${tw.button.ghost} hover:text-[var(--space-semantic-danger)]`}
                        aria-label="Delete offer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
