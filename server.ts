import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadState, resetState, saveState } from './src/server/store.ts';
import {
  generateCallSummary,
  generateSalesAgentTurn,
  synthesizeVoiceSpeech,
  transcribeVoiceAudio,
} from './src/server/geminiService.ts';
import { retrieveRelevantChunks } from './src/lib/ragEngine.ts';
import {
  estimateArrFromTeamSize,
  findAvailableSlot,
  mergeBantQualification,
  normalizeSentimentLabel,
} from './src/lib/salesEngine.ts';
import type {
  CallRecord,
  CrmWebhookEvent,
  KnowledgeDoc,
  LeadRecord,
  SupportedLanguageCode,
  VoicePersona,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GREETINGS: Record<SupportedLanguageCode, (name: string, company: string) => string> = {
  en: (name, company) =>
    `Hi ${name}, this is Cadence calling regarding ${company}'s revenue automation inquiry. What is the biggest inbound or outbound sales bottleneck your team is trying to solve this quarter?`,
  es: (name, company) =>
    `Hola ${name}, te saluda Cadence respecto a la consulta de automatización comercial de ${company}. ¿Cuál es el principal cuello de botella que busca resolver su equipo de ventas este trimestre?`,
  fr: (name, company) =>
    `Bonjour ${name}, ici Cadence au sujet de la demande d'automatisation commerciale de ${company}. Quel est le principal défi que votre équipe commerciale souhaite résoudre ce trimestre ?`,
  de: (name, company) =>
    `Hallo ${name}, hier ist Cadence bezüglich der Anfrage von ${company} zur Vertriebsautomatisierung. Welchen Engpass möchte Ihr Vertriebsteam in diesem Quartal vorrangig lösen?`,
  hi: (name, company) =>
    `नमस्ते ${name}, मैं Cadence से बोल रहा हूँ ${company} की सेल्स ऑटोमेशन पूछताछ के संदर्भ में। इस तिमाही में आपकी सेल्स टीम किस मुख्य चुनौती को हल करना चाहती है?`,
  ja: (name, company) =>
    `${name}様、お時間をいただきありがとうございます。${company}様の営業自動化のお問い合わせについてご連絡したCadenceです。今期、営業チームで最も解決したい課題は何でしょうか？`,
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatUpstreamError(
  err: unknown,
  fallback: string
): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : fallback;
  let status = 500;
  let message = raw || fallback;

  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error) {
      if (typeof parsed.error.code === 'number' && parsed.error.code >= 400 && parsed.error.code < 600) {
        status = parsed.error.code;
      }
      if (parsed.error.message) {
        message = parsed.error.message;
      }
    }
  } catch {
    if (raw.includes('503') || raw.includes('UNAVAILABLE')) status = 503;
    else if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) status = 429;
    else if (raw.includes('403') || raw.includes('PERMISSION_DENIED')) status = 403;
  }

  if (status === 503) {
    message = 'Gemini AI is temporarily experiencing high demand (503). Please retry your turn in a moment.';
  } else if (status === 429) {
    message = 'Gemini API quota was reached (429). Please wait briefly or check your API key in Settings > Secrets.';
  } else if (status === 403) {
    message = 'Gemini API authentication failed (403). Please verify your GEMINI_API_KEY in Settings > Secrets.';
  }

  return { status, message };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Load initial persistent state
  loadState();

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/state', (_req, res) => {
    const state = loadState();
    res.json(state);
  });

  app.post('/api/reset', (_req, res) => {
    const state = resetState();
    res.json(state);
  });

  // Create a new lead in CRM
  app.post('/api/leads', (req, res) => {
    const { name, role, company, email, phone, language, teamSize } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim() || !company || typeof company !== 'string' || !company.trim()) {
      res.status(400).json({ error: 'Prospect name and company are required.' });
      return;
    }

    const state = loadState();
    const parsedSeats = Number.isFinite(Number(teamSize)) && Number(teamSize) > 0 ? Math.round(Number(teamSize)) : null;
    const lang: SupportedLanguageCode = ['en', 'es', 'fr', 'de', 'hi', 'ja'].includes(language) ? language : 'en';

    const newLead: LeadRecord = {
      id: makeId('lead'),
      name: name.trim(),
      role: typeof role === 'string' && role.trim() ? role.trim() : 'VP of Sales',
      company: company.trim(),
      email:
        typeof email === 'string' && email.trim()
          ? email.trim()
          : `${name.trim().toLowerCase().replace(/\s+/g, '.')}@${company
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')}.com`,
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : '+1 (415) 555-0194',
      language: lang,
      stage: 'New',
      score: 20,
      estimatedArr: estimateArrFromTeamSize(parsedSeats, 28800),
      bant: {
        budget: null,
        authority: typeof role === 'string' && role.trim() ? role.trim() : null,
        need: null,
        timeline: null,
        teamSize: parsedSeats,
        score: 20,
        stage: 'New',
      },
      sentimentLabel: 'Neutral',
      sentimentScore: 0,
      memoryNotes: ['Created in Cadence CRM for live autonomous sales call.'],
      bookedAppointmentId: null,
      lastContactedAt: new Date().toISOString(),
      crmExternalId: `SF-00Q${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    };

    const webhook: CrmWebhookEvent = {
      id: makeId('wh'),
      timestamp: new Date().toISOString(),
      provider: 'Salesforce',
      event: 'lead.created',
      leadId: newLead.id,
      payloadSummary: `Created lead ${newLead.name} (${newLead.company}) as ${newLead.crmExternalId}`,
      status: 'Synced',
    };

    state.leads.unshift(newLead);
    state.webhooks.unshift(webhook);
    saveState(state);

    res.status(201).json({ lead: newLead, webhook });
  });

  // Update lead fields in CRM
  app.patch('/api/leads/:id', (req, res) => {
    const state = loadState();
    const lead = state.leads.find((l) => l.id === req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    const { stage, role, email, phone, memoryNote } = req.body ?? {};
    if (stage && ['New', 'Discovery', 'Qualified', 'Demo Booked', 'Disqualified'].includes(stage)) {
      lead.stage = stage;
      lead.bant.stage = stage;
    }
    if (typeof role === 'string' && role.trim()) lead.role = role.trim();
    if (typeof email === 'string' && email.trim()) lead.email = email.trim();
    if (typeof phone === 'string' && phone.trim()) lead.phone = phone.trim();
    if (typeof memoryNote === 'string' && memoryNote.trim()) {
      lead.memoryNotes.unshift(memoryNote.trim());
    }

    saveState(state);
    res.json({ lead });
  });

  // Start a new real-time voice call session
  app.post('/api/calls/start', (req, res) => {
    const { leadId, language, voicePersona } = req.body ?? {};
    const state = loadState();
    const lead = state.leads.find((l) => l.id === leadId) ?? state.leads[0];
    if (!lead) {
      res.status(404).json({ error: 'No prospect lead found to dial.' });
      return;
    }

    const activeLang: SupportedLanguageCode = ['en', 'es', 'fr', 'de', 'hi', 'ja'].includes(language)
      ? language
      : lead.language;
    const persona: VoicePersona = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].includes(voicePersona)
      ? voicePersona
      : 'Kore';

    const now = new Date().toISOString();
    const greetingFn = GREETINGS[activeLang] ?? GREETINGS.en;
    const greetingText = greetingFn(lead.name.split(' ')[0], lead.company);

    const call: CallRecord = {
      id: makeId('call'),
      leadId: lead.id,
      leadName: lead.name,
      company: lead.company,
      language: activeLang,
      voicePersona: persona,
      startedAt: now,
      endedAt: null,
      durationSec: 0,
      status: 'active',
      turns: [
        {
          id: makeId('turn'),
          speaker: 'agent',
          text: greetingText,
          language: activeLang,
          timestamp: now,
          latencyMs: 320,
        },
      ],
      bant: { ...lead.bant },
      sentimentHistory: [lead.sentimentScore],
      latestSentiment: {
        label: lead.sentimentLabel,
        score: lead.sentimentScore,
        intent: 'Call opened — discovery initiated',
        buyingSignals: [],
        objections: [],
      },
      ragHits: 0,
      summary: null,
    };

    lead.lastContactedAt = now;
    state.calls.unshift(call);
    saveState(state);

    res.status(201).json({ call, lead });
  });

  // Process a prospect utterance turn -> RAG -> Gemini -> BANT/Sentiment/Auto-Booking -> CRM Sync
  app.post('/api/calls/:id/turn', async (req, res) => {
    const { text, language } = req.body ?? {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Utterance text is required.' });
      return;
    }

    const state = loadState();
    const call = state.calls.find((c) => c.id === req.params.id);
    if (!call) {
      res.status(404).json({ error: 'Active call session not found.' });
      return;
    }
    const lead = state.leads.find((l) => l.id === call.leadId);
    if (!lead) {
      res.status(404).json({ error: 'Associated CRM lead not found.' });
      return;
    }

    const reqLang: SupportedLanguageCode = ['en', 'es', 'fr', 'de', 'hi', 'ja'].includes(language)
      ? language
      : call.language;

    const startedMs = Date.now();
    const retrievedChunks = retrieveRelevantChunks(text.trim(), state.knowledge, 3);
    const openSlots = state.slots.filter((s) => s.available);

    try {
      const aiResult = await generateSalesAgentTurn({
        lead,
        call,
        prospectUtterance: text.trim(),
        requestedLanguage: reqLang,
        retrievedChunks,
        availableSlots: openSlots,
      });

      const latencyMs = Date.now() - startedMs;
      const nowIso = new Date().toISOString();

      const sentimentLabel = normalizeSentimentLabel(
        aiResult.sentimentScore,
        aiResult.sentimentLabel
      );
      const sentimentSnapshot = {
        label: sentimentLabel,
        score: aiResult.sentimentScore,
        intent: aiResult.intent,
        buyingSignals: aiResult.buyingSignals,
        objections: aiResult.objections,
      };

      // Handle automated appointment booking if Gemini triggered a slot ID
      let bookedSlotId: string | undefined;
      if (aiResult.bookSlotId) {
        const slot = findAvailableSlot(state.slots, aiResult.bookSlotId);
        if (slot) {
          slot.available = false;
          slot.leadId = lead.id;
          slot.leadName = lead.name;
          slot.company = lead.company;
          slot.notes = `Autonomously booked via Cadence Voice Call (${call.id}).`;
          lead.bookedAppointmentId = slot.id;
          bookedSlotId = slot.id;

          state.webhooks.unshift({
            id: makeId('wh'),
            timestamp: nowIso,
            provider: lead.crmExternalId.startsWith('HS') ? 'HubSpot' : 'Salesforce',
            event: 'meeting.booked',
            leadId: lead.id,
            payloadSummary: `Booked ${slot.date} at ${slot.time} ${slot.timezone} with ${slot.repName} for ${lead.name}`,
            status: 'Synced',
          });
        }
      }

      const hasBookedDemo = Boolean(lead.bookedAppointmentId || bookedSlotId);
      const updatedBant = mergeBantQualification(
        call.bant,
        aiResult.bantPatch,
        aiResult.sentimentScore,
        hasBookedDemo
      );

      const previousStage = lead.stage;

      // Append prospect & agent turns
      call.turns.push({
        id: makeId('turn'),
        speaker: 'prospect',
        text: text.trim(),
        language: aiResult.detectedLanguage,
        timestamp: nowIso,
        sentiment: sentimentSnapshot,
      });

      call.turns.push({
        id: makeId('turn'),
        speaker: 'agent',
        text: aiResult.replyText,
        language: aiResult.detectedLanguage,
        timestamp: new Date().toISOString(),
        retrievedChunks,
        bookedSlotId,
        latencyMs,
      });

      call.language = aiResult.detectedLanguage;
      call.bant = updatedBant;
      call.latestSentiment = sentimentSnapshot;
      call.sentimentHistory.push(aiResult.sentimentScore);
      call.ragHits += retrievedChunks.length;
      call.durationSec = Math.max(
        call.durationSec + 18,
        Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000)
      );

      // Update CRM Lead with contextual memory & BANT
      lead.language = aiResult.detectedLanguage;
      lead.bant = updatedBant;
      lead.score = updatedBant.score;
      lead.stage = updatedBant.stage;
      lead.sentimentLabel = sentimentLabel;
      lead.sentimentScore = aiResult.sentimentScore;
      lead.lastContactedAt = nowIso;
      if (updatedBant.teamSize) {
        lead.estimatedArr = estimateArrFromTeamSize(updatedBant.teamSize, lead.estimatedArr);
      }
      if (aiResult.memoryNote && !lead.memoryNotes.includes(aiResult.memoryNote)) {
        lead.memoryNotes.unshift(aiResult.memoryNote);
        lead.memoryNotes = lead.memoryNotes.slice(0, 8);
      }

      if (previousStage !== lead.stage && lead.stage === 'Qualified') {
        state.webhooks.unshift({
          id: makeId('wh'),
          timestamp: nowIso,
          provider: lead.crmExternalId.startsWith('HS') ? 'HubSpot' : 'Salesforce',
          event: 'lead.qualified',
          leadId: lead.id,
          payloadSummary: `Auto-qualified ${lead.name} (${lead.company}) · Score ${lead.score}/100 · Est. ARR $${lead.estimatedArr.toLocaleString()}`,
          status: 'Synced',
        });
      }

      saveState(state);

      res.json({
        call,
        lead,
        slots: state.slots,
        webhooks: state.webhooks,
        retrievedChunks,
        replyText: aiResult.replyText,
        bookedSlotId: bookedSlotId ?? null,
      });
    } catch (err) {
      const formatted = formatUpstreamError(err, 'Failed to process voice turn.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Manual or one-click confirmed appointment booking during or after call
  app.post('/api/calls/:id/book', (req, res) => {
    const { slotId } = req.body ?? {};
    const state = loadState();
    const call = state.calls.find((c) => c.id === req.params.id);
    if (!call) {
      res.status(404).json({ error: 'Call session not found.' });
      return;
    }
    const lead = state.leads.find((l) => l.id === call.leadId);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    const slot = findAvailableSlot(state.slots, slotId);
    if (!slot) {
      res.status(409).json({ error: 'Selected appointment slot is no longer available.' });
      return;
    }

    const nowIso = new Date().toISOString();
    slot.available = false;
    slot.leadId = lead.id;
    slot.leadName = lead.name;
    slot.company = lead.company;
    slot.notes = `Confirmed during Cadence Voice session (${call.id}).`;

    lead.bookedAppointmentId = slot.id;
    const updatedBant = mergeBantQualification(call.bant, {}, call.latestSentiment.score, true);
    call.bant = updatedBant;
    lead.bant = updatedBant;
    lead.score = updatedBant.score;
    lead.stage = updatedBant.stage;

    call.turns.push({
      id: makeId('turn'),
      speaker: 'agent',
      text: `I have confirmed your demo with ${slot.repName} on ${slot.date} at ${slot.time} ${slot.timezone} and synced the calendar invitation to ${lead.email}.`,
      language: call.language,
      timestamp: nowIso,
      bookedSlotId: slot.id,
      latencyMs: 120,
    });

    state.webhooks.unshift({
      id: makeId('wh'),
      timestamp: nowIso,
      provider: lead.crmExternalId.startsWith('HS') ? 'HubSpot' : 'Salesforce',
      event: 'meeting.booked',
      leadId: lead.id,
      payloadSummary: `Booked ${slot.date} at ${slot.time} ${slot.timezone} with ${slot.repName} for ${lead.name}`,
      status: 'Synced',
    });

    saveState(state);
    res.json({ call, lead, slot, slots: state.slots, webhooks: state.webhooks });
  });

  // End call & generate AI executive call summary + CRM sync
  app.post('/api/calls/:id/summarize', async (req, res) => {
    const state = loadState();
    const call = state.calls.find((c) => c.id === req.params.id);
    if (!call) {
      res.status(404).json({ error: 'Call session not found.' });
      return;
    }
    const lead = state.leads.find((l) => l.id === call.leadId);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const prospectTurns = call.turns.filter((t) => t.speaker === 'prospect');

    // Always terminate the call cleanly first so start/stop never traps the user
    call.status = 'completed';
    call.endedAt = nowIso;
    call.durationSec = Math.max(
      call.durationSec,
      Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000)
    );

    // If user started and stopped immediately without talking, complete cleanly without invoking LLM
    if (prospectTurns.length === 0) {
      call.summary = {
        executiveSummary: `Call with ${lead.name} (${lead.company}) ended before any prospect conversation was recorded.`,
        painPoints: [],
        objectionsHandled: [],
        actionItems: ['Re-attempt outbound dial or follow up via email to start discovery.'],
        qualificationVerdict: `No Conversation Recorded (${call.bant.stage} · Score ${call.bant.score}/100)`,
        nextBestAction: `Retry outreach with ${lead.name} at ${lead.company}.`,
      };
      saveState(state);
      res.json({ call, lead, webhooks: state.webhooks });
      return;
    }

    try {
      const summary = await generateCallSummary(call, lead, call.bant);
      call.summary = summary;

      if (summary.nextBestAction && !lead.memoryNotes.includes(summary.nextBestAction)) {
        lead.memoryNotes.unshift(`Next Action: ${summary.nextBestAction}`);
      }

      state.webhooks.unshift({
        id: makeId('wh'),
        timestamp: nowIso,
        provider: lead.crmExternalId.startsWith('HS') ? 'HubSpot' : 'Salesforce',
        event: 'call.summarized',
        leadId: lead.id,
        payloadSummary: `Synced AI executive summary & action items for ${lead.name} (${lead.crmExternalId})`,
        status: 'Synced',
      });

      saveState(state);
      res.json({ call, lead, webhooks: state.webhooks });
    } catch (err) {
      // Persist completed call state even if AI summarization fails transiently
      saveState(state);
      const formatted = formatUpstreamError(err, 'Failed to summarize call.');
      res.status(formatted.status).json({
        error: formatted.message,
        call,
        lead,
        webhooks: state.webhooks,
      });
    }
  });

  // Gemini TTS endpoint (gemini-3.8-flash-lite-tts)
  app.post('/api/voice/tts', async (req, res) => {
    const { text, voiceName, language } = req.body ?? {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Text is required for speech synthesis.' });
      return;
    }

    const persona: VoicePersona = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].includes(voiceName)
      ? voiceName
      : 'Kore';
    const lang: SupportedLanguageCode = ['en', 'es', 'fr', 'de', 'hi', 'ja'].includes(language)
      ? language
      : 'en';

    try {
      const audio = await synthesizeVoiceSpeech({
        text: text.trim().slice(0, 600),
        voiceName: persona,
        language: lang,
      });
      res.json(audio);
    } catch (err) {
      const formatted = formatUpstreamError(err, 'Speech synthesis failed.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Gemini STT Audio Transcription endpoint (gemini-3.5-transcribe on v1beta)
  app.post('/api/voice/transcribe', async (req, res) => {
    const { base64Audio, mimeType, language } = req.body ?? {};
    if (!base64Audio || typeof base64Audio !== 'string') {
      res.status(400).json({ error: 'base64Audio payload is required.' });
      return;
    }

    if (base64Audio.length < 256) {
      res.json({ transcript: '' });
      return;
    }

    try {
      const transcript = await transcribeVoiceAudio({
        base64Audio,
        mimeType: typeof mimeType === 'string' ? mimeType : 'audio/webm',
        languageHint: language,
      });
      res.json({ transcript });
    } catch (err) {
      const formatted = formatUpstreamError(err, 'Audio transcription failed.');
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Knowledge Base CRUD & Live RAG Retrieval Test
  app.post('/api/knowledge', (req, res) => {
    const { title, category, content } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim() || !content || typeof content !== 'string' || content.trim().length < 15) {
      res.status(400).json({ error: 'Title and content (minimum 15 characters) are required.' });
      return;
    }

    const validCategories: KnowledgeDoc['category'][] = [
      'Pricing',
      'Security',
      'Integrations',
      'SLA & Scale',
      'Case Study',
      'Product',
    ];
    const doc: KnowledgeDoc = {
      id: makeId('kb'),
      title: title.trim(),
      category: validCategories.includes(category) ? category : 'Product',
      content: content.trim(),
      updatedAt: new Date().toISOString().slice(0, 10),
    };

    const state = loadState();
    state.knowledge.unshift(doc);
    saveState(state);
    res.status(201).json({ doc, knowledge: state.knowledge });
  });

  app.delete('/api/knowledge/:id', (req, res) => {
    const state = loadState();
    const before = state.knowledge.length;
    state.knowledge = state.knowledge.filter((d) => d.id !== req.params.id);
    if (state.knowledge.length === before) {
      res.status(404).json({ error: 'Knowledge document not found.' });
      return;
    }
    saveState(state);
    res.json({ knowledge: state.knowledge });
  });

  app.post('/api/knowledge/search', (req, res) => {
    const { query, topK } = req.body ?? {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    const state = loadState();
    const chunks = retrieveRelevantChunks(
      query.trim(),
      state.knowledge,
      typeof topK === 'number' ? topK : 4,
      0.05
    );
    res.json({ query: query.trim(), chunks });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cadence Voice server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting Cadence server:', err);
  process.exit(1);
});
