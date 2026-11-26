import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, PhoneCall, PhoneOff } from 'lucide-react';
import { api, ApiError } from './services/api';
import { Sidebar } from './components/Sidebar';
import { LiveVoiceWorkspace } from './components/LiveVoiceWorkspace';
import { CrmBookingsView } from './components/CrmBookingsView';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { InsightsCallsView } from './components/InsightsCallsView';
import { ArchitectureScaleView } from './components/ArchitectureScaleView';
import type {
  AppStatePayload,
  CallRecord,
  KnowledgeDoc,
  LeadStage,
  SupportedLanguageCode,
  VoicePersona,
  WorkspaceView,
} from './types';

const VIEW_TITLES: Record<WorkspaceView, string> = {
  voice: 'Live Voice Agent',
  crm: 'CRM & Bookings',
  knowledge: 'Knowledge Base',
  insights: 'Insights & Calls',
  architecture: 'Architecture & Scale',
};

export default function App() {
  const [state, setState] = useState<AppStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<WorkspaceView>('voice');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Voice workspace session state
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [language, setLanguage] = useState<SupportedLanguageCode>('en');
  const [voicePersona, setVoicePersona] = useState<VoicePersona>('Kore');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const startingCallRef = useRef(false);
  const endingCallRef = useRef(false);

  const fetchInitialState = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getState();
      const sanitized: AppStatePayload = {
        leads: Array.isArray(data.leads) ? data.leads.filter((l) => Boolean(l?.id)) : [],
        calls: Array.isArray(data.calls) ? data.calls.filter((c) => Boolean(c?.id)) : [],
        slots: Array.isArray(data.slots) ? data.slots.filter((s) => Boolean(s?.id)) : [],
        knowledge: Array.isArray(data.knowledge) ? data.knowledge.filter((k) => Boolean(k?.id)) : [],
        webhooks: Array.isArray(data.webhooks) ? data.webhooks.filter((w) => Boolean(w?.id)) : [],
      };
      setState(sanitized);
      if (sanitized.leads.length > 0) {
        // Prefer an unbooked English prospect for immediate live voice testing
        const unbookedEn =
          sanitized.leads.find((l) => !l.bookedAppointmentId && l.language === 'en') ??
          sanitized.leads.find((l) => !l.bookedAppointmentId) ??
          sanitized.leads[0];
        if (unbookedEn?.id) {
          setSelectedLeadId(unbookedEn.id);
          setLanguage(unbookedEn.language);
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load workspace state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInitialState();
  }, [fetchInitialState]);

  const activeCall: CallRecord | null = useMemo(() => {
    if (!state || !activeCallId) return null;
    return state.calls.find((c) => c && c.id === activeCallId) ?? null;
  }, [state, activeCallId]);

  const handleSelectLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    const found = state?.leads.find((l) => l && l.id === leadId);
    if (found) {
      setLanguage(found.language);
    }
  };

  const handleStartCall = useCallback(
    async (overrideLang?: SupportedLanguageCode): Promise<CallRecord | null> => {
      if (!state || startingCallRef.current) return null;
      const targetId = selectedLeadId || state.leads[0]?.id;
      if (!targetId) return null;

      startingCallRef.current = true;
      setIsStartingCall(true);
      setCallError(null);
      try {
        const { call, lead } = await api.startCall({
          leadId: targetId,
          language: overrideLang ?? language,
          voicePersona,
        });
        if (!call?.id || !lead?.id) {
          throw new Error('Server returned an invalid call session. Please retry.');
        }

        setState((prev) =>
          prev
            ? {
                ...prev,
                calls: [call, ...prev.calls.filter((c) => Boolean(c?.id))],
                leads: prev.leads
                  .filter((l) => Boolean(l?.id))
                  .map((l) => (l.id === lead.id ? lead : l)),
              }
            : prev
        );
        setActiveCallId(call.id);
        return call;
      } catch (err) {
        setCallError(err instanceof Error ? err.message : 'Unable to start call.');
        return null;
      } finally {
        startingCallRef.current = false;
        setIsStartingCall(false);
      }
    },
    [state, selectedLeadId, language, voicePersona]
  );

  const handleSendTurn = useCallback(
    async (
      text: string,
      overrideLang?: SupportedLanguageCode
    ): Promise<{ replyText: string; language: SupportedLanguageCode } | null> => {
      const turnLang = overrideLang ?? language;
      let currentCallId = activeCall?.status === 'active' ? activeCall.id : null;
      if (!currentCallId) {
        const started = await handleStartCall(turnLang);
        if (!started?.id) return null;
        currentCallId = started.id;
      }

      setIsProcessingTurn(true);
      setCallError(null);
      try {
        const res = await api.sendCallTurn(currentCallId, { text, language: turnLang });
        if (!res.call?.id || !res.lead?.id) {
          throw new Error('Received incomplete call turn response.');
        }
        setState((prev) =>
          prev
            ? {
                ...prev,
                calls: prev.calls
                  .filter((c) => Boolean(c?.id))
                  .map((c) => (c.id === res.call.id ? res.call : c)),
                leads: prev.leads
                  .filter((l) => Boolean(l?.id))
                  .map((l) => (l.id === res.lead.id ? res.lead : l)),
                slots: Array.isArray(res.slots) ? res.slots : prev.slots,
                webhooks: Array.isArray(res.webhooks) ? res.webhooks : prev.webhooks,
              }
            : prev
        );
        setLanguage(res.call.language);
        return { replyText: res.replyText, language: res.call.language };
      } catch (err) {
        setCallError(
          err instanceof Error ? err.message : 'Failed to process prospect turn.'
        );
        return null;
      } finally {
        setIsProcessingTurn(false);
      }
    },
    [activeCall, handleStartCall, language]
  );

  const handleBookSlot = useCallback(
    async (slotId: string) => {
      if (!activeCallId) return;
      setCallError(null);
      try {
        const res = await api.bookCallSlot(activeCallId, slotId);
        if (!res.call?.id || !res.lead?.id) return;
        setState((prev) =>
          prev
            ? {
                ...prev,
                calls: prev.calls
                  .filter((c) => Boolean(c?.id))
                  .map((c) => (c.id === res.call.id ? res.call : c)),
                leads: prev.leads
                  .filter((l) => Boolean(l?.id))
                  .map((l) => (l.id === res.lead.id ? res.lead : l)),
                slots: Array.isArray(res.slots) ? res.slots : prev.slots,
                webhooks: Array.isArray(res.webhooks) ? res.webhooks : prev.webhooks,
              }
            : prev
        );
      } catch (err) {
        setCallError(err instanceof Error ? err.message : 'Failed to book appointment slot.');
      }
    },
    [activeCallId]
  );

  const handleEndAndSummarize = useCallback(async () => {
    if (!activeCallId || endingCallRef.current) return;
    endingCallRef.current = true;
    setIsSummarizing(true);
    setCallError(null);
    try {
      const res = await api.summarizeCall(activeCallId);
      if (res.call?.id) {
        setState((prev) =>
          prev
            ? {
                ...prev,
                calls: prev.calls
                  .filter((c) => Boolean(c?.id))
                  .map((c) => (c.id === res.call.id ? res.call : c)),
                leads: res.lead?.id
                  ? prev.leads
                      .filter((l) => Boolean(l?.id))
                      .map((l) => (l.id === res.lead.id ? res.lead : l))
                  : prev.leads,
                webhooks: Array.isArray(res.webhooks) ? res.webhooks : prev.webhooks,
              }
            : prev
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
        const partial = err.data as {
          call?: CallRecord;
          lead?: AppStatePayload['leads'][number];
          webhooks?: AppStatePayload['webhooks'];
        };
        if (partial.call?.id) {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  calls: prev.calls
                    .filter((c) => Boolean(c?.id))
                    .map((c) => (c.id === partial.call!.id ? partial.call! : c)),
                  leads: partial.lead?.id
                    ? prev.leads
                        .filter((l) => Boolean(l?.id))
                        .map((l) => (l.id === partial.lead!.id ? partial.lead! : l))
                    : prev.leads,
                  webhooks: Array.isArray(partial.webhooks) ? partial.webhooks : prev.webhooks,
                }
              : prev
          );
        }
      }
      setCallError(err instanceof Error ? err.message : 'Failed to summarize call.');
    } finally {
      endingCallRef.current = false;
      setIsSummarizing(false);
    }
  }, [activeCallId]);

  const handleCreateLead = async (payload: {
    name: string;
    role: string;
    company: string;
    email: string;
    phone: string;
    language: SupportedLanguageCode;
    teamSize?: number;
  }) => {
    const res = await api.createLead(payload);
    if (!res.lead?.id) return;
    setState((prev) =>
      prev
        ? {
            ...prev,
            leads: [res.lead, ...prev.leads.filter((l) => Boolean(l?.id))],
            webhooks: res.webhook?.id
              ? [res.webhook, ...prev.webhooks.filter((w) => Boolean(w?.id))]
              : prev.webhooks,
          }
        : prev
    );
  };

  const handleUpdateLead = async (
    id: string,
    payload: { stage?: LeadStage; memoryNote?: string }
  ) => {
    const res = await api.updateLead(id, payload);
    if (!res.lead?.id) return;
    setState((prev) =>
      prev
        ? {
            ...prev,
            leads: prev.leads
              .filter((l) => Boolean(l?.id))
              .map((l) => (l.id === res.lead.id ? res.lead : l)),
          }
        : prev
    );
  };

  const handleDialLeadFromCrm = (leadId: string) => {
    handleSelectLead(leadId);
    setActiveCallId(null);
    setActiveView('voice');
  };

  const handleAddKnowledge = async (payload: {
    title: string;
    category: KnowledgeDoc['category'];
    content: string;
  }) => {
    const res = await api.addKnowledge(payload);
    setState((prev) => (prev ? { ...prev, knowledge: res.knowledge } : prev));
  };

  const handleDeleteKnowledge = async (id: string) => {
    const res = await api.deleteKnowledge(id);
    setState((prev) => (prev ? { ...prev, knowledge: res.knowledge } : prev));
  };

  const sidebarCounts = useMemo(
    () => ({
      leads: state?.leads.length ?? 0,
      booked: state?.slots.filter((s) => !s.available).length ?? 0,
      knowledge: state?.knowledge.length ?? 0,
      calls: state?.calls.length ?? 0,
    }),
    [state]
  );

  const isCallActive = activeCall?.status === 'active';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        counts={sidebarCounts}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean SaaS Top Bar: Contextual Breadcrumb + 1 Primary Action */}
        <header className="sticky top-0 z-20 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline">Cadence</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {VIEW_TITLES[activeView]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isCallActive ? (
              <button
                type="button"
                onClick={() => {
                  setActiveView('voice');
                  void handleEndAndSummarize();
                }}
                disabled={isSummarizing}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                <span>{isSummarizing ? 'Summarizing...' : 'End & Summarize Call'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setActiveView('voice');
                  void handleStartCall();
                }}
                disabled={loading || !state || isStartingCall}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                <span>{isStartingCall ? 'Dialing...' : 'Launch Voice Call'}</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
              <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-80 bg-slate-100 rounded animate-pulse" />
              <div className="h-64 w-full bg-slate-100 rounded-lg animate-pulse" />
            </div>
          ) : loadError || !state ? (
            <div
              role="alert"
              className="bg-white border border-red-200 rounded-xl p-6 space-y-3"
            >
              <h2 className="text-sm font-semibold text-red-800">
                Unable to load Cadence workspace
              </h2>
              <p className="text-sm text-slate-600">{loadError ?? 'Unknown error'}</p>
              <button
                type="button"
                onClick={() => void fetchInitialState()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              {activeView === 'voice' && (
                <LiveVoiceWorkspace
                  leads={state.leads}
                  slots={state.slots}
                  activeCall={activeCall}
                  selectedLeadId={selectedLeadId}
                  language={language}
                  voicePersona={voicePersona}
                  ttsEnabled={ttsEnabled}
                  isStartingCall={isStartingCall}
                  isProcessingTurn={isProcessingTurn}
                  isSummarizing={isSummarizing}
                  callError={callError}
                  onSelectLead={handleSelectLead}
                  onChangeLanguage={setLanguage}
                  onChangePersona={setVoicePersona}
                  onToggleTts={() => setTtsEnabled((v) => !v)}
                  onStartCall={handleStartCall}
                  onSendTurn={handleSendTurn}
                  onBookSlot={handleBookSlot}
                  onEndAndSummarize={handleEndAndSummarize}
                  onClearError={() => setCallError(null)}
                />
              )}

              {activeView === 'crm' && (
                <CrmBookingsView
                  leads={state.leads}
                  slots={state.slots}
                  webhooks={state.webhooks}
                  onCreateLead={handleCreateLead}
                  onUpdateLead={handleUpdateLead}
                  onDialLead={handleDialLeadFromCrm}
                />
              )}

              {activeView === 'knowledge' && (
                <KnowledgeBaseView
                  docs={state.knowledge}
                  onAddDoc={handleAddKnowledge}
                  onDeleteDoc={handleDeleteKnowledge}
                />
              )}

              {activeView === 'insights' && (
                <InsightsCallsView calls={state.calls} leads={state.leads} />
              )}

              {activeView === 'architecture' && <ArchitectureScaleView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
