import { useMemo, useState } from 'react';
import { FileText, MessageSquare } from 'lucide-react';
import type { CallRecord, LeadRecord } from '../types';

interface InsightsCallsViewProps {
  calls: CallRecord[];
  leads: LeadRecord[];
}

export function InsightsCallsView({ calls, leads }: InsightsCallsViewProps) {
  const [selectedCallId, setSelectedCallId] = useState<string>(calls[0]?.id ?? '');

  const selectedCall = useMemo(
    () => calls.find((c) => c.id === selectedCallId) ?? calls[0] ?? null,
    [calls, selectedCallId]
  );

  const metrics = useMemo(() => {
    const totalArr = leads.reduce((sum, l) => sum + l.estimatedArr, 0);
    const qualifiedCount = leads.filter(
      (l) => l.stage === 'Qualified' || l.stage === 'Demo Booked'
    ).length;
    const bookedCount = leads.filter((l) => l.stage === 'Demo Booked').length;
    const avgScore =
      leads.length > 0
        ? Math.round(leads.reduce((sum, l) => sum + l.score, 0) / leads.length)
        : 0;
    const totalRagHits = calls.reduce((sum, c) => sum + c.ragHits, 0);
    const avgSentiment =
      calls.length > 0
        ? calls.reduce((sum, c) => sum + c.latestSentiment.score, 0) / calls.length
        : 0;

    return {
      totalArr,
      qualifiedCount,
      bookedCount,
      avgScore,
      totalRagHits,
      avgSentiment,
      conversionRate:
        leads.length > 0 ? Math.round((bookedCount / leads.length) * 100) : 0,
    };
  }, [calls, leads]);

  const funnelStages = useMemo(() => {
    const total = Math.max(1, leads.length);
    const rows = [
      { label: 'Total Prospects Engaged', count: leads.length },
      {
        label: 'Discovery & Beyond',
        count: leads.filter((l) => l.stage !== 'New' && l.stage !== 'Disqualified').length,
      },
      {
        label: 'BANT Qualified (68+)',
        count: leads.filter((l) => l.stage === 'Qualified' || l.stage === 'Demo Booked').length,
      },
      {
        label: 'Autonomous Demo Booked',
        count: leads.filter((l) => l.stage === 'Demo Booked').length,
      },
    ];
    return rows.map((r) => ({ ...r, pct: Math.round((r.count / total) * 100) }));
  }, [leads]);

  const languageBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calls) {
      counts.set(c.language.toUpperCase(), (counts.get(c.language.toUpperCase()) ?? 0) + 1);
    }
    const total = Math.max(1, calls.length);
    return Array.from(counts.entries())
      .map(([lang, count]) => ({ lang, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
  }, [calls]);

  return (
    <div className="space-y-6">
      {/* Executive KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Pipeline Evaluated</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            ${metrics.totalArr.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {leads.length} accounts · {metrics.qualifiedCount} qualified
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Demo Booking Rate</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-green-700">
            {metrics.conversionRate}%
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {metrics.bookedCount} autonomously scheduled
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Average BANT Score</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {metrics.avgScore}
            <span className="text-sm font-normal text-slate-400">/100</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Mean sentiment {metrics.avgSentiment >= 0 ? '+' : ''}
            {metrics.avgSentiment.toFixed(2)}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">RAG Grounded Citations</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-blue-700">
            {metrics.totalRagHits}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Across {calls.length} recorded calls
          </div>
        </div>
      </div>

      {/* Funnel & Language Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Qualification & Booking Funnel
          </h2>
          <div className="space-y-3">
            {funnelStages.map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{row.label}</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {row.count} ({row.pct}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-700 transition-all duration-300"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Multilingual Call Distribution
          </h2>
          {languageBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500">No voice calls recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {languageBreakdown.map((item) => (
                <div key={item.lang} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-slate-800">{item.lang}</span>
                    <span className="font-mono tabular-nums text-slate-600">
                      {item.count} {item.count === 1 ? 'call' : 'calls'} · {item.pct}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-slate-800 transition-all duration-300"
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Call History & Executive Summaries Master-Detail */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
            Recorded Sales Calls ({calls.length})
          </div>
          <div className="divide-y divide-slate-200 max-h-[540px] overflow-y-auto">
            {calls.map((call) => {
              const isSelected = selectedCall?.id === call.id;
              return (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => setSelectedCallId(call.id)}
                  className={`w-full text-left p-4 transition-colors ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {call.leadName}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-slate-600">
                      Score {call.bant.score}/100
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {call.company} · <span className="font-mono uppercase">{call.language}</span> ·{' '}
                    {call.bant.stage}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-600 flex items-center justify-between">
                    <span>
                      {call.turns.length} turns · {call.ragHits} RAG hits
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {Math.floor(call.durationSec / 60)}m {call.durationSec % 60}s
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          {selectedCall ? (
            <>
              <div className="p-5 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">
                    {selectedCall.leadName} — {selectedCall.company}
                  </h2>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {new Date(selectedCall.startedAt).toLocaleString()} · {selectedCall.voicePersona}
                  </span>
                </div>
                <div className="text-xs text-slate-600">
                  Stage: <span className="font-semibold text-blue-700">{selectedCall.bant.stage}</span> ·
                  Sentiment:{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedCall.latestSentiment.label} ({selectedCall.latestSentiment.score.toFixed(2)})
                  </span>
                </div>
              </div>

              {selectedCall.summary ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <FileText className="h-4 w-4 text-blue-700" />
                    <span>Executive Call Summary</span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {selectedCall.summary.executiveSummary}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <h3 className="font-semibold text-slate-800 mb-1.5">Pain Points</h3>
                      {(selectedCall.summary.painPoints ?? []).length > 0 ? (
                        <ul className="space-y-1 text-slate-600 list-disc pl-4">
                          {(selectedCall.summary.painPoints ?? []).map((pt, i) => (
                            <li key={i}>{pt}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">None recorded on this call.</p>
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800 mb-1.5">Objections Handled</h3>
                      {(selectedCall.summary.objectionsHandled ?? []).length > 0 ? (
                        <ul className="space-y-1 text-slate-600 list-disc pl-4">
                          {(selectedCall.summary.objectionsHandled ?? []).map((obj, i) => (
                            <li key={i}>{obj}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">None recorded on this call.</p>
                      )}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
                    <div className="font-semibold text-slate-800">Action Items</div>
                    {(selectedCall.summary.actionItems ?? []).length > 0 ? (
                      <ul className="space-y-1 text-slate-600 list-disc pl-4">
                        {(selectedCall.summary.actionItems ?? []).map((act, i) => (
                          <li key={i}>{act}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500">No action items logged.</p>
                    )}
                    {selectedCall.summary.nextBestAction && (
                      <div className="pt-2 font-medium text-blue-700">
                        Next Best Action: {selectedCall.summary.nextBestAction}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-5 text-xs text-slate-500">
                  This call has not been summarized yet. End and summarize the call from the Live Voice Agent view to generate CRM insights.
                </div>
              )}

              <div className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <MessageSquare className="h-4 w-4 text-slate-500" />
                  <span>Full Call Transcript ({selectedCall.turns.length} turns)</span>
                </div>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {selectedCall.turns.map((turn) => (
                    <div key={turn.id} className="text-xs space-y-0.5">
                      <div className="font-semibold text-slate-800">
                        {turn.speaker === 'agent' ? 'Cadence AI' : selectedCall.leadName}{' '}
                        <span className="font-mono font-normal text-slate-400">
                          · {turn.language.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-slate-600 leading-relaxed">{turn.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="p-6 text-sm text-slate-500">Select a call to view summary and transcript.</div>
          )}
        </div>
      </div>
    </div>
  );
}
