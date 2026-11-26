import { useMemo, useState } from 'react';
import { BookOpen, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import type { KnowledgeDoc, RetrievedChunk } from '../types';

interface KnowledgeBaseViewProps {
  docs: KnowledgeDoc[];
  onAddDoc: (payload: {
    title: string;
    category: KnowledgeDoc['category'];
    content: string;
  }) => Promise<void>;
  onDeleteDoc: (id: string) => Promise<void>;
}

const CATEGORIES: Array<'All' | KnowledgeDoc['category']> = [
  'All',
  'Pricing',
  'Security',
  'Integrations',
  'SLA & Scale',
  'Case Study',
  'Product',
];

export function KnowledgeBaseView({
  docs,
  onAddDoc,
  onDeleteDoc,
}: KnowledgeBaseViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<'All' | KnowledgeDoc['category']>('All');
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState<RetrievedChunk[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Add doc form
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KnowledgeDoc['category']>('Security');
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredDocs = useMemo(() => {
    if (categoryFilter === 'All') return docs;
    return docs.filter((d) => d.category === categoryFilter);
  }, [docs, categoryFilter]);

  const handleTestRetrieval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragQuery.trim()) return;
    setSearching(true);
    try {
      const res = await api.searchKnowledge(ragQuery.trim(), 4);
      setRagResults(res.chunks);
    } finally {
      setSearching(false);
    }
  };

  const handleSaveDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || content.trim().length < 15) {
      setFormError('Document title and at least 15 characters of grounded content are required.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await onAddDoc({
        title: title.trim(),
        category,
        content: content.trim(),
      });
      setTitle('');
      setContent('');
      setShowAdd(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save knowledge document.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live RAG Retrieval Tester */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Live RAG Retrieval Tester
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Test TF-IDF chunk ranking and similarity scoring against the exact corpus injected into live voice calls.
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {docs.length} indexed documents
          </span>
        </div>

        <form onSubmit={(e) => void handleTestRetrieval(e)} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <label htmlFor="rag-test-input" className="sr-only">
              Test RAG retrieval query
            </label>
            <input
              id="rag-test-input"
              type="text"
              value={ragQuery}
              onChange={(e) => setRagQuery(e.target.value)}
              placeholder="Ask a prospect question (e.g., SOC2 Type II GDPR Frankfurt, or 100 seat volume discount)..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !ragQuery.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {searching ? 'Retrieving...' : 'Run Retrieval'}
          </button>
        </form>

        {ragResults !== null && (
          <div
            className="border-t border-slate-200 pt-4 space-y-3"
            data-testid="rag-search-results"
          >
            <div className="text-xs font-semibold text-slate-700">
              Top Retrieved Chunks ({ragResults.length})
            </div>
            {ragResults.length === 0 ? (
              <p className="text-xs text-slate-500">
                No chunks met the relevance threshold for this query. Try adding a knowledge document covering this topic.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {ragResults.map((chunk, idx) => (
                  <div key={`${chunk.docId}-${idx}`} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-900">
                        #{idx + 1} · {chunk.docTitle}{' '}
                        <span className="font-normal text-slate-500">({chunk.category})</span>
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-blue-700">
                        Score {(chunk.score * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{chunk.snippet}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Corpus Filter & Add Button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
          role="tablist"
          aria-label="Filter knowledge base by category"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{showAdd ? 'Cancel' : 'Add Knowledge Document'}</span>
        </button>
      </div>

      {/* Add Knowledge Document Form */}
      {showAdd && (
        <form
          onSubmit={(e) => void handleSaveDoc(e)}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Index New Sales Knowledge Document
            </h3>
            {formError && <span className="text-xs font-medium text-red-700">{formError}</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="kb-title" className="block text-xs font-medium text-slate-600 mb-1">
                Document Title *
              </label>
              <input
                id="kb-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Healthcare HIPAA BAA Addendum"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="kb-category" className="block text-xs font-medium text-slate-600 mb-1">
                Category
              </label>
              <select
                id="kb-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeDoc['category'])}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="kb-content" className="block text-xs font-medium text-slate-600 mb-1">
              Grounded Playbook / Policy Content *
            </label>
            <textarea
              id="kb-content"
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter verified product specifications, pricing policies, security attestations, or customer proof points..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Indexing...' : 'Index into RAG Store'}
            </button>
          </div>
        </form>
      )}

      {/* Indexed Knowledge Corpus List */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {filteredDocs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No knowledge documents in this category yet.
          </div>
        ) : (
          filteredDocs.map((doc) => (
            <article key={doc.id} className="p-5 flex items-start justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <BookOpen className="h-3.5 w-3.5 text-blue-700 shrink-0" />
                  <span className="font-medium text-slate-700">{doc.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">Updated {doc.updatedAt}</span>
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{doc.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{doc.content}</p>
              </div>
              <button
                type="button"
                onClick={() => void onDeleteDoc(doc.id)}
                aria-label={`Delete knowledge document ${doc.title}`}
                className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
