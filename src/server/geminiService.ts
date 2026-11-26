import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AppointmentSlot,
  BantQualification,
  CallRecord,
  CallSummary,
  LeadRecord,
  RetrievedChunk,
  SentimentLabel,
  SupportedLanguageCode,
  VoicePersona,
} from '../types.ts';
import { LANGUAGE_OPTIONS } from '../lib/salesEngine.ts';

let cachedClient: GoogleGenAI | null = null;
let cachedBetaClient: GoogleGenAI | null = null;

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('high demand')
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isTransientError(err)) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function getGeminiClient(apiVersion?: 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add a valid Gemini API key in Settings > Secrets to enable AI voice intelligence.'
    );
  }
  if (apiVersion === 'v1beta') {
    if (!cachedBetaClient) {
      cachedBetaClient = new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return cachedBetaClient;
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export interface AgentTurnOutput {
  replyText: string;
  detectedLanguage: SupportedLanguageCode;
  sentimentLabel: SentimentLabel;
  sentimentScore: number;
  intent: string;
  buyingSignals: string[];
  objections: string[];
  bantPatch: {
    budget: string | null;
    authority: string | null;
    need: string | null;
    timeline: string | null;
    teamSize: number | null;
  };
  memoryNote: string | null;
  bookSlotId: string | null;
}

export async function generateSalesAgentTurn(params: {
  lead: LeadRecord;
  call: CallRecord;
  prospectUtterance: string;
  requestedLanguage: SupportedLanguageCode;
  retrievedChunks: RetrievedChunk[];
  availableSlots: AppointmentSlot[];
}): Promise<AgentTurnOutput> {
  const ai = getGeminiClient('v1beta');

  const langInfo =
    LANGUAGE_OPTIONS.find((l) => l.code === params.requestedLanguage) ?? LANGUAGE_OPTIONS[0];

  const transcriptHistory = params.call.turns
    .slice(-10)
    .map((t) => `${t.speaker === 'agent' ? 'Agent' : 'Prospect'}: ${t.text}`)
    .join('\n');

  const ragContext =
    params.retrievedChunks.length > 0
      ? params.retrievedChunks
          .map(
            (c, idx) =>
              `[Source ${idx + 1}: ${c.docTitle} (${c.category}, relevance ${c.score})]\n${c.snippet}`
          )
          .join('\n\n')
      : 'No direct RAG knowledge snippets retrieved for this turn. Stay accurate and offer to follow up on specifics.';

  const slotList =
    params.availableSlots.length > 0
      ? params.availableSlots
          .map((s) => `- ID: "${s.id}" | ${s.date} at ${s.time} ${s.timezone} with ${s.repName}`)
          .join('\n')
      : 'No open slots currently available.';

  const systemInstruction = `You are Cadence, an autonomous enterprise B2B AI Sales Voice Agent.
You are currently on a live real-time phone call with ${params.lead.name} (${params.lead.role} at ${params.lead.company}).

Strict voice conversation rules:
1. Keep "replyText" natural, warm, authoritative, and concise (2 to 3 spoken sentences max, ~35-65 words) suitable for immediate Text-to-Speech playback. Never use markdown bullets, asterisks, or URLs in replyText.
2. Multilingual rule: If the prospect speaks in a specific language (en, es, fr, de, hi, ja), mirror their language naturally. Otherwise respond in ${langInfo.label} (${langInfo.code}). Set "detectedLanguage" accordingly.
3. Ground all factual claims (pricing, SOC2/GDPR/HIPAA compliance, SLA, integrations, ROI) strictly in the Retrieved Knowledge Context below.
4. Actively advance BANT qualification (Budget, Authority, Need, Timeline, Team Size) by asking at most ONE focused discovery or scheduling question per turn.
5. Appointment booking rule: Only populate "bookSlotId" with one of the exact open slot IDs if the prospect explicitly confirms or requests booking a demo/meeting on this turn. Otherwise set "bookSlotId" to null.
6. Extract any newly stated BANT details, buying signals, objections, and a concise 1-sentence "memoryNote" if new durable account context was revealed.

Known Prospect Contextual Memory:
- Prior notes: ${params.lead.memoryNotes.join(' | ') || 'None yet'}
- Current BANT: Budget=${params.call.bant.budget ?? 'Unknown'}, Authority=${params.call.bant.authority ?? 'Unknown'}, Need=${params.call.bant.need ?? 'Unknown'}, Timeline=${params.call.bant.timeline ?? 'Unknown'}, TeamSize=${params.call.bant.teamSize ?? 'Unknown'}

Retrieved Knowledge Context (RAG):
${ragContext}

Open Demo Calendar Slots:
${slotList}`;

  const prompt = `Recent Call Transcript:
${transcriptHistory || '(Call just started)'}

Latest Prospect Utterance:
"${params.prospectUtterance}"

Respond as Cadence and extract structured qualification, sentiment, memory, and booking decision JSON.`;

  const callModel = (model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite') =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: {
          thinkingLevel:
            model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: {
              type: Type.STRING,
              description: 'Natural spoken sales response (2-3 sentences, no markdown).',
            },
            detectedLanguage: {
              type: Type.STRING,
              description: 'ISO code: en, es, fr, de, hi, or ja.',
            },
            sentimentLabel: {
              type: Type.STRING,
              description: 'One of: Positive, Neutral, Skeptical, Frustrated.',
            },
            sentimentScore: {
              type: Type.NUMBER,
              description: 'Sentiment score between -1.0 and 1.0.',
            },
            intent: {
              type: Type.STRING,
              description: 'Short 3-6 word summary of prospect intent on this turn.',
            },
            buyingSignals: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            objections: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            bantPatch: {
              type: Type.OBJECT,
              properties: {
                budget: { type: Type.STRING, nullable: true },
                authority: { type: Type.STRING, nullable: true },
                need: { type: Type.STRING, nullable: true },
                timeline: { type: Type.STRING, nullable: true },
                teamSize: { type: Type.INTEGER, nullable: true },
              },
            },
            memoryNote: {
              type: Type.STRING,
              nullable: true,
              description: 'Optional concise factual note to store in CRM contextual memory.',
            },
            bookSlotId: {
              type: Type.STRING,
              nullable: true,
              description: 'Exact slot ID to book if prospect confirmed scheduling, else null.',
            },
          },
          required: [
            'replyText',
            'detectedLanguage',
            'sentimentLabel',
            'sentimentScore',
            'intent',
            'buyingSignals',
            'objections',
            'bantPatch',
          ],
        },
      },
    });

  let response;
  try {
    response = await withRetry(() => callModel('gemini-4-hydrogen'), 2);
  } catch (err) {
    if (isTransientError(err)) {
      response = await withRetry(() => callModel('gemini-3.1-flash-lite'), 2);
    } else {
      throw err;
    }
  }

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty response for the sales turn.');
  }

  const parsed = JSON.parse(rawText) as Partial<AgentTurnOutput>;
  const validLangs: SupportedLanguageCode[] = ['en', 'es', 'fr', 'de', 'hi', 'ja'];
  const detectedLanguage = validLangs.includes(parsed.detectedLanguage as SupportedLanguageCode)
    ? (parsed.detectedLanguage as SupportedLanguageCode)
    : params.requestedLanguage;

  const validSentiments: SentimentLabel[] = ['Positive', 'Neutral', 'Skeptical', 'Frustrated'];
  const sentimentLabel = validSentiments.includes(parsed.sentimentLabel as SentimentLabel)
    ? (parsed.sentimentLabel as SentimentLabel)
    : 'Neutral';

  const sentimentScore =
    typeof parsed.sentimentScore === 'number' && Number.isFinite(parsed.sentimentScore)
      ? Math.max(-1, Math.min(1, Number(parsed.sentimentScore.toFixed(2))))
      : 0;

  return {
    replyText: parsed.replyText || 'Thanks for sharing that. Could you tell me a bit more about your timeline?',
    detectedLanguage,
    sentimentLabel,
    sentimentScore,
    intent: parsed.intent || 'Discovery conversation',
    buyingSignals: Array.isArray(parsed.buyingSignals) ? parsed.buyingSignals.slice(0, 4) : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections.slice(0, 4) : [],
    bantPatch: {
      budget: parsed.bantPatch?.budget ?? null,
      authority: parsed.bantPatch?.authority ?? null,
      need: parsed.bantPatch?.need ?? null,
      timeline: parsed.bantPatch?.timeline ?? null,
      teamSize:
        typeof parsed.bantPatch?.teamSize === 'number' ? parsed.bantPatch.teamSize : null,
    },
    memoryNote: parsed.memoryNote ?? null,
    bookSlotId: parsed.bookSlotId ?? null,
  };
}

export async function generateCallSummary(
  call: CallRecord,
  lead: LeadRecord,
  bant: BantQualification
): Promise<CallSummary> {
  const ai = getGeminiClient();

  const transcript = call.turns
    .map((t) => `[${t.speaker.toUpperCase()}] ${t.text}`)
    .join('\n');

  const callSummaryModel = (model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite') =>
    ai.models.generateContent({
      model,
      contents: `Summarize this B2B sales voice call for CRM sync and executive review.

Prospect: ${lead.name}, ${lead.role} at ${lead.company}
Current Qualification Stage: ${bant.stage} (Score ${bant.score}/100)
BANT Snapshot: Budget=${bant.budget ?? 'Unknown'}, Authority=${bant.authority ?? 'Unknown'}, Need=${bant.need ?? 'Unknown'}, Timeline=${bant.timeline ?? 'Unknown'}, Seats=${bant.teamSize ?? 'Unknown'}

Transcript:
${transcript}`,
      config: {
        thinkingConfig: {
          thinkingLevel:
            model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            objectionsHandled: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            qualificationVerdict: { type: Type.STRING },
            nextBestAction: { type: Type.STRING },
          },
          required: [
            'executiveSummary',
            'painPoints',
            'objectionsHandled',
            'actionItems',
            'qualificationVerdict',
            'nextBestAction',
          ],
        },
      },
    });

  let response;
  try {
    response = await withRetry(() => callSummaryModel('gemini-4-hydrogen'), 2);
  } catch (err) {
    if (isTransientError(err)) {
      response = await withRetry(() => callSummaryModel('gemini-3.1-flash-lite'), 2);
    } else {
      throw err;
    }
  }

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty response while summarizing the call.');
  }
  const parsed = JSON.parse(rawText) as Partial<CallSummary>;
  return {
    executiveSummary:
      typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : 'Call completed and synced to CRM.',
    painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
    objectionsHandled: Array.isArray(parsed.objectionsHandled) ? parsed.objectionsHandled : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    qualificationVerdict:
      typeof parsed.qualificationVerdict === 'string' && parsed.qualificationVerdict.trim()
        ? parsed.qualificationVerdict.trim()
        : `${bant.stage} (Score ${bant.score}/100)`,
    nextBestAction:
      typeof parsed.nextBestAction === 'string' && parsed.nextBestAction.trim()
        ? parsed.nextBestAction.trim()
        : 'Review call notes and schedule follow-up.',
  };
}

export async function synthesizeVoiceSpeech(params: {
  text: string;
  voiceName: VoicePersona;
  language: SupportedLanguageCode;
}): Promise<{ base64Wav: string; mimeType: string }> {
  const aiBeta = getGeminiClient('v1beta');
  const langLabel =
    LANGUAGE_OPTIONS.find((l) => l.code === params.language)?.label ?? 'English';

  const response = await withRetry(async () => {
    try {
      return await aiBeta.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: params.text,
                speechMetadata: {
                  style: `Warm, confident, natural enterprise B2B sales advisor speaking ${langLabel} at a crisp conversational pace`,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: params.voiceName },
            },
          },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('INVALID_ARGUMENT') || msg.includes('Unknown name')) {
        return await aiBeta.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: `Speak naturally in ${langLabel}: ${params.text}`,
          config: {
            responseModalities: ['AUDIO'],
          },
        });
      }
      throw err;
    }
  });

  const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inline?.data) {
    throw new Error('Gemini TTS did not return audio data.');
  }

  return {
    base64Wav: inline.data,
    mimeType: inline.mimeType || 'audio/wav',
  };
}

export async function transcribeVoiceAudio(params: {
  base64Audio: string;
  mimeType: string;
  languageHint?: SupportedLanguageCode;
}): Promise<string> {
  const aiBeta = getGeminiClient('v1beta');
  const langHint =
    LANGUAGE_OPTIONS.find((l) => l.code === params.languageHint)?.label ?? 'any language';

  const runTranscribe = (
    model: 'gemini-3.5-transcribe' | 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'
  ) =>
    aiBeta.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType || 'audio/webm',
              data: params.base64Audio,
            },
          },
          {
            text: `Transcribe the spoken audio accurately verbatim in its original language (expected hint: ${langHint}). If no intelligible speech is present, return an empty string. Return only the spoken transcript text with no extra commentary.`,
          },
        ],
      },
    });

  const models: Array<'gemini-3.5-transcribe' | 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'> = [
    'gemini-3.5-transcribe',
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ];

  let lastErr: unknown;
  for (const model of models) {
    try {
      const response = await withRetry(() => runTranscribe(model), 2);
      return (response.text ?? '').trim();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isModelNotFound =
        msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('not found');
      if (isModelNotFound || isTransientError(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
