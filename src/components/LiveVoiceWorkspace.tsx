import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  FileText,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Radio,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useVoiceEngine } from '../hooks/useVoiceEngine';
import { LANGUAGE_OPTIONS } from '../lib/salesEngine';
import type {
  AppointmentSlot,
  CallRecord,
  LeadRecord,
  RetrievedChunk,
  SupportedLanguageCode,
  VoicePersona,
} from '../types';

interface LiveVoiceWorkspaceProps {
  leads: LeadRecord[];
  slots: AppointmentSlot[];
  activeCall: CallRecord | null;
  selectedLeadId: string;
  language: SupportedLanguageCode;
  voicePersona: VoicePersona;
  ttsEnabled: boolean;
  isStartingCall: boolean;
  isProcessingTurn: boolean;
  isSummarizing: boolean;
  callError: string | null;
  onSelectLead: (leadId: string) => void;
  onChangeLanguage: (lang: SupportedLanguageCode) => void;
  onChangePersona: (persona: VoicePersona) => void;
  onToggleTts: () => void;
  onStartCall: (overrideLang?: SupportedLanguageCode) => Promise<CallRecord | null>;
  onSendTurn: (
    text: string,
    overrideLang?: SupportedLanguageCode
  ) => Promise<{ replyText: string; language: SupportedLanguageCode } | null>;
  onBookSlot: (slotId: string) => Promise<void>;
  onEndAndSummarize: () => Promise<void>;
  onClearError: () => void;
}

const VOICE_PERSONAS: VoicePersona[] = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

const QUICK_SCENARIOS: Array<{
  id: string;
  label: string;
  language: SupportedLanguageCode;
  text: string;
}> = [
  {
    id: 'en-enterprise',
    label: 'Enterprise SOC2 & 120 Seats',
    language: 'en',
    text: 'We have 120 sales reps on Salesforce and a $55,000 budget for Q1. Are you SOC2 Type II compliant, what is your volume discount, and can we book a demo tomorrow at 2:00 PM EST?',
  },
  {
    id: 'es-multilingual',
    label: 'Spanish Multilingual Inquiry',
    language: 'es',
    text: 'Hola, dirigimos un equipo de 60 vendedores en Latinoamérica y usamos HubSpot. ¿Cómo manejan la sincronización con CRM y cuál es el precio del plan Growth?',
  },
  {
    id: 'de-gdpr',
    label: 'German GDPR & Latency',
    language: 'de',
    text: 'Wir benötigen zwingend EU-Hosting in Frankfurt für 80 Mitarbeiter. Welche Latenzzeiten erreichen Sie im Live-Betrieb und können wir einen Termin am Freitag vereinbaren?',
  },
];

function SentimentSparkline({ scores }: { scores: number[] }) {
  const safeScores = scores.length > 0 ? scores : [0];
  const width = 220;
  const height = 44;
  const pad = 6;
  const points = safeScores.map((s, idx) => {
    const x =
      safeScores.length === 1
        ? width / 2
        : pad + (idx / (safeScores.length - 1)) * (width - pad * 2);
    const normalized = (Math.max(-1, Math.min(1, s)) + 1) / 2;
    const y = height - pad - normalized * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const latest = safeScores[safeScores.length - 1];
  const stroke =
    latest >= 0.25 ? '#16A34A' : latest <= -0.2 ? '#DC2626' : '#1D4ED8';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-11 overflow-visible"
      role="img"
      aria-label="Live sentiment trend across call turns"
    >
      <line
        x1={pad}
        y1={height / 2}
        x2={width - pad}
        y2={height / 2}
        stroke="#E2E8F0"
        strokeDasharray="3 3"
      />
      {safeScores.length > 1 && (
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.join(' ')}
        />
      )}
      {safeScores.map((s, idx) => {
        const [cx, cy] = points[idx].split(',');
        return (
          <circle
            key={`${idx}-${s}`}
            cx={cx}
            cy={cy}
            r="3"
            fill={stroke}
          />
        );
      })}
    </svg>
  );
}

export function LiveVoiceWorkspace({
  leads,
  slots,
  activeCall,
  selectedLeadId,
  language,
  voicePersona,
  ttsEnabled,
  isStartingCall,
  isProcessingTurn,
  isSummarizing,
  callError,
  onSelectLead,
  onChangeLanguage,
  onChangePersona,
  onToggleTts,
  onStartCall,
  onSendTurn,
  onBookSlot,
  onEndAndSummarize,
  onClearError,
}: LiveVoiceWorkspaceProps) {
  const [utteranceInput, setUtteranceInput] = useState('');
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const lastGreetedCallIdRef = useRef<string | null>(null);

  const isCallActive = activeCall?.status === 'active';

  const safeLeads = useMemo(() => leads.filter((l) => Boolean(l?.id)), [leads]);
  const safeSlots = useMemo(() => slots.filter((s) => Boolean(s?.id)), [slots]);

  const selectedLead = useMemo(
    () =>
      safeLeads.find((l) => l.id === (activeCall?.leadId ?? selectedLeadId)) ??
      safeLeads[0] ??
      null,
    [safeLeads, activeCall, selectedLeadId]
  );

  const openSlots = useMemo(() => safeSlots.filter((s) => s.available), [safeSlots]);
  const bookedSlot = useMemo(
    () =>
      selectedLead?.bookedAppointmentId
        ? safeSlots.find((s) => s.id === selectedLead.bookedAppointmentId) ?? null
        : null,
    [selectedLead, safeSlots]
  );

  const latestRagChunks: RetrievedChunk[] = useMemo(() => {
    if (!activeCall) return [];
    for (let i = activeCall.turns.length - 1; i >= 0; i -= 1) {
      const chunks = activeCall.turns[i].retrievedChunks;
      if (chunks && chunks.length > 0) return chunks;
    }
    return [];
  }, [activeCall]);

  const handleUtteranceSubmit = async (
    text: string,
    overrideLang?: SupportedLanguageCode
  ) => {
    const trimmed = text.trim();
    if (!trimmed || isProcessingTurn) return;
    setUtteranceInput('');

    const result = await onSendTurn(trimmed, overrideLang);
    if (result && result.replyText) {
      void voice.speakText(result.replyText, result.language);
    }
  };

  const voice = useVoiceEngine({
    language,
    voicePersona,
    ttsEnabled,
    handsFreeEnabled,
    isCallActive,
    isProcessingTurn,
    onFinalTranscript: (spokenText) => {
      void handleUtteranceSubmit(spokenText);
    },
  });

  useEffect(() => {
    if (activeCall && activeCall.turns.length > 0 && transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [activeCall?.turns.length]);

  // Auto-play opening greeting & activate hands-free mic whenever a new call starts
  // (works whether launched from top-bar "Launch Voice Call", "Start Call", or "Dial")
  useEffect(() => {
    if (
      activeCall?.id &&
      activeCall.status === 'active' &&
      lastGreetedCallIdRef.current !== activeCall.id
    ) {
      lastGreetedCallIdRef.current = activeCall.id;
      const firstTurn = activeCall.turns?.[0];
      if (firstTurn?.speaker === 'agent' && firstTurn.text) {
        void voice.speakText(firstTurn.text, activeCall.language);
      } else if (handsFreeEnabled) {
        void voice.startMicCapture(true);
      }
    }
  }, [activeCall, handsFreeEnabled, voice.speakText, voice.startMicCapture]);

  // Whenever the active call terminates (from header or toolbar), halt all mic/STT/TTS immediately
  const prevCallStatusRef = useRef<string | undefined>(activeCall?.status);
  useEffect(() => {
    if (prevCallStatusRef.current === 'active' && activeCall?.status !== 'active') {
      voice.stopAll();
    }
    prevCallStatusRef.current = activeCall?.status;
  }, [activeCall?.status, voice.stopAll]);

  const handleStartCallWithGreeting = async () => {
    // Request microphone permission immediately inside the user click gesture
    if (handsFreeEnabled) {
      void voice.ensureMicrophoneStream();
    }
    await onStartCall();
  };

  const handleManualBook = async (slotId: string) => {
    setBookingSlotId(slotId);
    try {
      await onBookSlot(slotId);
    } finally {
      setBookingSlotId(null);
    }
  };

  const activeBant = activeCall?.bant ?? selectedLead?.bant ?? null;
  const activeSentiment = activeCall?.latestSentiment ?? {
    label: selectedLead?.sentimentLabel ?? 'Neutral',
    score: selectedLead?.sentimentScore ?? 0,
    intent: 'Ready to initiate live voice discovery',
    buyingSignals: [],
    objections: [],
  };

  const sentimentColor =
    activeSentiment.label === 'Positive'
      ? 'text-green-700'
      : activeSentiment.label === 'Frustrated'
        ? 'text-red-700'
        : activeSentiment.label === 'Skeptical'
          ? 'text-amber-700'
          : 'text-slate-700';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Main Conversation & Voice Console (Left 8 columns) */}
      <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
        {/* Call Configuration Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-end justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 min-w-[260px]">
            <div>
              <label
                htmlFor="prospect-select"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Prospect Account
              </label>
              <select
                id="prospect-select"
                value={selectedLead?.id ?? ''}
                disabled={isCallActive}
                onChange={(e) => onSelectLead(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
              >
                {safeLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} — {lead.company}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="language-select"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Voice Language
              </label>
              <select
                id="language-select"
                value={language}
                onChange={(e) => onChangeLanguage(e.target.value as SupportedLanguageCode)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label} ({opt.nativeLabel})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="persona-select"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                TTS Voice Persona
              </label>
              <select
                id="persona-select"
                value={voicePersona}
                onChange={(e) => onChangePersona(e.target.value as VoicePersona)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {VOICE_PERSONAS.map((persona) => (
                  <option key={persona} value={persona}>
                    {persona} (Gemini TTS)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (voice.isSpeaking) voice.stopPlayback();
                onToggleTts();
              }}
              aria-label={ttsEnabled ? 'Mute AI voice audio' : 'Unmute AI voice audio'}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              {ttsEnabled ? (
                <Volume2 className="h-4 w-4 text-blue-700" />
              ) : (
                <VolumeX className="h-4 w-4 text-slate-400" />
              )}
              <span>{ttsEnabled ? 'Audio On' : 'Muted'}</span>
            </button>

            {isCallActive ? (
              <button
                type="button"
                onClick={() => {
                  voice.stopAll();
                  void onEndAndSummarize();
                }}
                disabled={isSummarizing}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <PhoneOff className="h-4 w-4" />
                <span>{isSummarizing ? 'Ending...' : 'End Call'}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isStartingCall}
                onClick={() => void handleStartCallWithGreeting()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <PhoneCall className="h-4 w-4 text-blue-700" />
                <span>{isStartingCall ? 'Dialing...' : 'Start Call'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Acoustic Voice Bar & Live Microphone Controls */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            <div
              className="flex items-end gap-1 h-8 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 shrink-0"
              aria-hidden="true"
            >
              {voice.audioLevels.map((lvl, idx) => (
                <span
                  key={idx}
                  className={`w-1 rounded-sm transition-all duration-75 ${
                    voice.isSpeaking
                      ? 'bg-blue-700'
                      : voice.isRecordingAudio && voice.speechDetected
                        ? 'bg-green-600'
                        : voice.isListening || voice.isRecordingAudio
                          ? 'bg-emerald-500'
                          : 'bg-slate-300'
                  }`}
                  style={{ height: `${Math.max(16, lvl)}%` }}
                />
              ))}
            </div>

            <div className="text-xs text-slate-600 min-w-0 flex-1">
              <div className="font-medium text-slate-900 truncate">
                {voice.isSpeaking
                  ? `AI Speaking (${voicePersona}) · Click Interrupt & Speak anytime`
                  : voice.isTranscribing
                    ? 'Transcribing your voice with Gemini STT...'
                    : isProcessingTurn
                      ? 'Retrieving RAG context & qualifying turn...'
                      : voice.isRecordingAudio
                        ? voice.speechDetected
                          ? 'Hearing your voice — pause or click Stop & Send'
                          : 'Listening on mic — speak naturally now...'
                        : voice.isListening
                          ? 'Listening via Browser Web Speech STT...'
                          : isCallActive
                            ? voice.micPermission === 'denied'
                              ? 'Mic blocked in browser · Allow mic permission or type below'
                              : `Call active · Click Speak Now (Mic) to talk to Cadence`
                            : 'Ready to dial · Press Start Call to begin live voice session'}
              </div>
              {voice.interimTranscript && (
                <div className="text-blue-700 truncate mt-0.5">
                  Hearing: “{voice.interimTranscript}”
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => void voice.toggleGeminiAudioStt()}
              disabled={isProcessingTurn || voice.isTranscribing}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border transition-colors whitespace-nowrap ${
                voice.isRecordingAudio
                  ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                  : voice.isSpeaking
                    ? 'bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100'
                    : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
              } disabled:opacity-50`}
            >
              {voice.isRecordingAudio ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              <span>
                {voice.isRecordingAudio
                  ? 'Stop & Send'
                  : voice.isSpeaking
                    ? 'Interrupt & Speak'
                    : 'Speak Now (Mic)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setHandsFreeEnabled((prev) => {
                  const next = !prev;
                  if (
                    next &&
                    isCallActive &&
                    !voice.isSpeaking &&
                    !voice.isRecordingAudio &&
                    !voice.isTranscribing &&
                    !isProcessingTurn
                  ) {
                    void voice.startMicCapture(true);
                  }
                  return next;
                });
              }}
              aria-pressed={handsFreeEnabled}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium border transition-colors whitespace-nowrap ${
                handsFreeEnabled
                  ? 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100'
                  : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>{handsFreeEnabled ? 'Auto-Listen: On' : 'Auto-Listen: Off'}</span>
            </button>

            <button
              type="button"
              onClick={voice.toggleLiveSpeechStt}
              disabled={isProcessingTurn || voice.isTranscribing}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium border transition-colors whitespace-nowrap ${
                voice.isListening
                  ? 'bg-green-600 border-green-600 text-white hover:bg-green-700'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              } disabled:opacity-50`}
            >
              <Radio className="h-3.5 w-3.5" />
              <span>{voice.isListening ? 'Stop Browser STT' : 'Browser STT'}</span>
            </button>
          </div>
        </div>

        {/* Error banner */}
        {(callError || voice.voiceError) && (
          <div
            role="alert"
            className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start justify-between gap-4"
          >
            <span>{callError || voice.voiceError}</span>
            <button
              type="button"
              onClick={() => {
                onClearError();
                voice.clearVoiceError();
              }}
              className="text-xs font-medium text-red-700 hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Live Transcript Feed */}
        <div
          ref={transcriptContainerRef}
          className="flex-1 min-h-[340px] max-h-[480px] overflow-y-auto p-5 space-y-5 bg-white"
          data-testid="transcript-feed"
        >
          {!activeCall ? (
            <div className="py-12 text-center max-w-md mx-auto space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                Autonomous Voice Discovery Ready
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Start a live call with{' '}
                <span className="font-medium text-slate-900">
                  {selectedLead?.name ?? 'your prospect'}
                </span>{' '}
                to test real-time STT/TTS, RAG objection handling, BANT scoring, and
                automated calendar booking.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleStartCallWithGreeting()}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 transition-colors"
                >
                  <PhoneCall className="h-4 w-4" />
                  <span>Dial {selectedLead?.name ?? 'Prospect'}</span>
                </button>
              </div>
            </div>
          ) : (
            activeCall.turns.map((turn) => {
              const isAgent = turn.speaker === 'agent';
              return (
                <div
                  key={turn.id}
                  className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
                    <span className="font-medium text-slate-800">
                      {isAgent ? `Cadence (${activeCall.voicePersona})` : activeCall.leadName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {new Date(turn.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono uppercase">{turn.language}</span>
                    {turn.latencyMs && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{turn.latencyMs}ms</span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      isAgent
                        ? 'bg-slate-50 border border-slate-200 text-slate-900'
                        : 'bg-blue-700 text-white'
                    }`}
                  >
                    <p>{turn.text}</p>

                    {turn.bookedSlotId && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex items-center gap-2 text-xs font-medium text-green-700">
                        <CalendarCheck className="h-4 w-4 shrink-0" />
                        <span>
                          Appointment booked autonomously and synced to CRM ({turn.bookedSlotId})
                        </span>
                      </div>
                    )}

                    {turn.retrievedChunks && turn.retrievedChunks.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 text-xs text-slate-500 space-y-1">
                        <div className="font-medium text-slate-700">
                          Grounded via RAG ({turn.retrievedChunks.length}{' '}
                          {turn.retrievedChunks.length === 1 ? 'source' : 'sources'}):
                        </div>
                        {turn.retrievedChunks.map((chunk, i) => (
                          <div key={`${chunk.docId}-${i}`} className="flex items-center justify-between gap-2">
                            <span className="truncate text-slate-600">
                              {chunk.docTitle} · {chunk.category}
                            </span>
                            <span className="font-mono tabular-nums text-blue-700 shrink-0">
                              {(chunk.score * 100).toFixed(0)}% match
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Post-Call Executive Summary Banner (when completed) */}
        {activeCall?.summary && (
          <div
            className="border-t border-slate-200 bg-slate-50 p-5 space-y-3"
            data-testid="call-summary-panel"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="h-4 w-4 text-blue-700" />
                <span>AI Call Summary & CRM Sync</span>
              </div>
              <span className="text-xs font-medium text-green-700">
                {activeCall.summary.qualificationVerdict}
              </span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              {activeCall.summary.executiveSummary}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
              <div>
                <div className="font-semibold text-slate-800 mb-1">Key Pain Points</div>
                {(activeCall.summary.painPoints ?? []).length > 0 ? (
                  <ul className="space-y-1 text-slate-600 list-disc pl-4">
                    {(activeCall.summary.painPoints ?? []).map((pt, i) => (
                      <li key={i}>{pt}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">No pain points captured during this call.</p>
                )}
              </div>
              <div>
                <div className="font-semibold text-slate-800 mb-1">Action Items & Next Best Step</div>
                {(activeCall.summary.actionItems ?? []).length > 0 ? (
                  <ul className="space-y-1 text-slate-600 list-disc pl-4">
                    {(activeCall.summary.actionItems ?? []).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">No follow-up action items recorded.</p>
                )}
                {activeCall.summary.nextBestAction && (
                  <p className="mt-2 font-medium text-blue-700">
                    Next Best Action: {activeCall.summary.nextBestAction}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quick Prospect Test Prompts + Utterance Input */}
        <div className="border-t border-slate-200 p-4 bg-slate-50/70 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Test Scenarios:</span>
            {QUICK_SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                type="button"
                disabled={isProcessingTurn}
                onClick={() => {
                  onChangeLanguage(sc.language);
                  void handleUtteranceSubmit(sc.text, sc.language);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {sc.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUtteranceSubmit(utteranceInput);
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="prospect-utterance" className="sr-only">
              Prospect spoken or typed message
            </label>
            <input
              id="prospect-utterance"
              type="text"
              value={utteranceInput}
              onChange={(e) => setUtteranceInput(e.target.value)}
              disabled={isProcessingTurn}
              placeholder="Speak via microphone above or type a prospect utterance (any language)..."
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none disabled:bg-slate-100"
            />
            <button
              type="submit"
              disabled={isProcessingTurn || !utteranceInput.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Send className="h-4 w-4" />
              <span>{isProcessingTurn ? 'Thinking...' : 'Send Turn'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Right Intelligence Sidebar (4 columns, single-elevation hairline sections) */}
      <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {/* 1. Real-Time BANT Lead Qualification */}
        <section className="p-5 space-y-3" aria-labelledby="bant-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="bant-heading" className="text-sm font-semibold text-slate-900">
              Lead Qualification (BANT)
            </h2>
            <div className="text-xs text-slate-500 font-mono tabular-nums">
              <span className="text-base font-semibold text-slate-900">
                {activeBant?.score ?? 0}
              </span>
              /100 · <span className="font-sans font-medium text-blue-700">{activeBant?.stage ?? 'New'}</span>
            </div>
          </div>

          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-blue-700 transition-all duration-300"
              style={{ width: `${activeBant?.score ?? 0}%` }}
            />
          </div>

          <dl className="grid grid-cols-1 gap-2 text-xs pt-1">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 shrink-0">Budget</dt>
              <dd className="text-slate-900 font-medium text-right">
                {activeBant?.budget ?? 'Undiscovered'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 shrink-0">Authority</dt>
              <dd className="text-slate-900 font-medium text-right">
                {activeBant?.authority ?? 'Undiscovered'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 shrink-0">Need</dt>
              <dd className="text-slate-900 font-medium text-right">
                {activeBant?.need ?? 'Undiscovered'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 shrink-0">Timeline</dt>
              <dd className="text-slate-900 font-medium text-right">
                {activeBant?.timeline ?? 'Undiscovered'}
              </dd>
            </div>
            <div className="flex justify-between gap-3 pt-1 border-t border-slate-100">
              <dt className="text-slate-500 shrink-0">Seats / Est. ARR</dt>
              <dd className="font-mono tabular-nums text-slate-900 font-medium text-right">
                {activeBant?.teamSize ? `${activeBant.teamSize} seats` : 'TBD'} · $
                {(selectedLead?.estimatedArr ?? 0).toLocaleString()}
              </dd>
            </div>
          </dl>
        </section>

        {/* 2. Live Sentiment Analysis */}
        <section className="p-5 space-y-3" aria-labelledby="sentiment-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="sentiment-heading" className="text-sm font-semibold text-slate-900">
              Sentiment & Intent
            </h2>
            <span className={`text-xs font-semibold font-mono tabular-nums ${sentimentColor}`}>
              {activeSentiment.label} ({activeSentiment.score >= 0 ? '+' : ''}
              {activeSentiment.score.toFixed(2)})
            </span>
          </div>

          <SentimentSparkline scores={activeCall?.sentimentHistory ?? [selectedLead?.sentimentScore ?? 0]} />

          <div className="text-xs text-slate-600">
            <span className="font-medium text-slate-800">Intent:</span> {activeSentiment.intent}
          </div>

          {activeSentiment.buyingSignals.length > 0 && (
            <div className="text-xs space-y-1">
              <div className="font-medium text-green-700">Buying Signals</div>
              <p className="text-slate-600">{activeSentiment.buyingSignals.join(' · ')}</p>
            </div>
          )}

          {activeSentiment.objections.length > 0 && (
            <div className="text-xs space-y-1">
              <div className="font-medium text-amber-700">Detected Objections</div>
              <p className="text-slate-600">{activeSentiment.objections.join(' · ')}</p>
            </div>
          )}
        </section>

        {/* 3. Active RAG Retrieval Context */}
        <section className="p-5 space-y-3" aria-labelledby="rag-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="rag-heading" className="text-sm font-semibold text-slate-900">
              RAG Knowledge Retrieval
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {latestRagChunks.length} active {latestRagChunks.length === 1 ? 'chunk' : 'chunks'}
            </span>
          </div>

          {latestRagChunks.length === 0 ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              Ask about pricing tiers, SOC2/GDPR compliance, CRM sync, or SLA benchmarks to
              see real-time RAG chunk retrieval and grounding scores.
            </p>
          ) : (
            <div className="space-y-2.5">
              {latestRagChunks.map((chunk, i) => (
                <div key={`${chunk.docId}-${i}`} className="text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 truncate">
                      {chunk.docTitle}
                    </span>
                    <span className="font-mono tabular-nums text-blue-700 shrink-0">
                      {(chunk.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-slate-600 line-clamp-2 leading-relaxed">
                    {chunk.snippet}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. Automated Appointment Booking */}
        <section className="p-5 space-y-3" aria-labelledby="booking-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="booking-heading" className="text-sm font-semibold text-slate-900">
              Appointment Booking
            </h2>
            <span className="text-xs font-mono text-slate-500">
              {selectedLead?.crmExternalId ?? 'CRM Ready'}
            </span>
          </div>

          {bookedSlot ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Demo Confirmed</span>
              </div>
              <div className="text-green-900 font-mono tabular-nums">
                {bookedSlot.date} · {bookedSlot.time} {bookedSlot.timezone}
              </div>
              <div className="text-green-800">{bookedSlot.repName}</div>
            </div>
          ) : (
            <div className="space-y-2">
              {openSlots.slice(0, 3).map((slot) => (
                <div
                  key={slot.id}
                  className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-slate-100 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="font-mono tabular-nums font-medium text-slate-900">
                      {slot.date} · {slot.time} {slot.timezone}
                    </div>
                    <div className="text-slate-500 truncate">{slot.repName}</div>
                  </div>
                  <button
                    type="button"
                    disabled={!activeCall || bookingSlotId === slot.id}
                    onClick={() => void handleManualBook(slot.id)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-blue-600 hover:text-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
                  >
                    {bookingSlotId === slot.id ? 'Booking...' : 'Book Slot'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Contextual Account Memory */}
        <section className="p-5 space-y-2.5" aria-labelledby="memory-heading">
          <h2 id="memory-heading" className="text-sm font-semibold text-slate-900">
            Contextual Memory
          </h2>
          {selectedLead && selectedLead.memoryNotes.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
              {selectedLead.memoryNotes.slice(0, 4).map((note, idx) => (
                <li key={idx} className="leading-relaxed">
                  {note}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              Durable facts extracted across calls will persist here automatically.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
