import type {
  AppStatePayload,
  AppointmentSlot,
  CallRecord,
  CrmWebhookEvent,
  KnowledgeDoc,
  LeadRecord,
  LeadStage,
  RetrievedChunk,
  SupportedLanguageCode,
  VoicePersona,
} from '../types';

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  const rawText = await res.text();
  let data: unknown = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new ApiError(
        res.ok
          ? 'Server returned an unexpected non-JSON response. Please retry.'
          : `Server error (${res.status}). Please retry in a moment.`,
        res.status
      );
    }
  }

  if (!res.ok) {
    const msg =
      typeof (data as { error?: unknown })?.error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export const api = {
  getState: () => requestJson<AppStatePayload>('/api/state'),

  resetState: () => requestJson<AppStatePayload>('/api/reset', { method: 'POST' }),

  createLead: (payload: {
    name: string;
    role: string;
    company: string;
    email: string;
    phone: string;
    language: SupportedLanguageCode;
    teamSize?: number;
  }) =>
    requestJson<{ lead: LeadRecord; webhook: CrmWebhookEvent }>('/api/leads', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLead: (
    id: string,
    payload: {
      stage?: LeadStage;
      role?: string;
      email?: string;
      phone?: string;
      memoryNote?: string;
    }
  ) =>
    requestJson<{ lead: LeadRecord }>(`/api/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  startCall: (payload: {
    leadId: string;
    language: SupportedLanguageCode;
    voicePersona: VoicePersona;
  }) =>
    requestJson<{ call: CallRecord; lead: LeadRecord }>('/api/calls/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendCallTurn: (
    callId: string,
    payload: { text: string; language: SupportedLanguageCode }
  ) =>
    requestJson<{
      call: CallRecord;
      lead: LeadRecord;
      slots: AppointmentSlot[];
      webhooks: CrmWebhookEvent[];
      retrievedChunks: RetrievedChunk[];
      replyText: string;
      bookedSlotId: string | null;
    }>(`/api/calls/${encodeURIComponent(callId)}/turn`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  bookCallSlot: (callId: string, slotId: string) =>
    requestJson<{
      call: CallRecord;
      lead: LeadRecord;
      slot: AppointmentSlot;
      slots: AppointmentSlot[];
      webhooks: CrmWebhookEvent[];
    }>(`/api/calls/${encodeURIComponent(callId)}/book`, {
      method: 'POST',
      body: JSON.stringify({ slotId }),
    }),

  summarizeCall: (callId: string) =>
    requestJson<{
      call: CallRecord;
      lead: LeadRecord;
      webhooks: CrmWebhookEvent[];
    }>(`/api/calls/${encodeURIComponent(callId)}/summarize`, {
      method: 'POST',
    }),

  synthesizeTts: (payload: {
    text: string;
    voiceName: VoicePersona;
    language: SupportedLanguageCode;
  }) =>
    requestJson<{ base64Wav: string; mimeType: string }>('/api/voice/tts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  transcribeAudio: (payload: {
    base64Audio: string;
    mimeType: string;
    language: SupportedLanguageCode;
  }) =>
    requestJson<{ transcript: string }>('/api/voice/transcribe', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  addKnowledge: (payload: {
    title: string;
    category: KnowledgeDoc['category'];
    content: string;
  }) =>
    requestJson<{ doc: KnowledgeDoc; knowledge: KnowledgeDoc[] }>('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteKnowledge: (id: string) =>
    requestJson<{ knowledge: KnowledgeDoc[] }>(
      `/api/knowledge/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  searchKnowledge: (query: string, topK = 4) =>
    requestJson<{ query: string; chunks: RetrievedChunk[] }>('/api/knowledge/search', {
      method: 'POST',
      body: JSON.stringify({ query, topK }),
    }),
};
