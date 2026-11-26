export type WorkspaceView =
  | 'voice'
  | 'crm'
  | 'knowledge'
  | 'insights'
  | 'architecture';

export type SupportedLanguageCode = 'en' | 'es' | 'fr' | 'de' | 'hi' | 'ja';

export type VoicePersona = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type LeadStage =
  | 'New'
  | 'Discovery'
  | 'Qualified'
  | 'Demo Booked'
  | 'Disqualified';

export type SentimentLabel =
  | 'Positive'
  | 'Neutral'
  | 'Skeptical'
  | 'Frustrated';

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: 'Pricing' | 'Security' | 'Integrations' | 'SLA & Scale' | 'Case Study' | 'Product';
  content: string;
  updatedAt: string;
}

export interface RetrievedChunk {
  docId: string;
  docTitle: string;
  category: KnowledgeDoc['category'];
  snippet: string;
  score: number;
}

export interface BantQualification {
  budget: string | null;
  authority: string | null;
  need: string | null;
  timeline: string | null;
  teamSize: number | null;
  score: number;
  stage: LeadStage;
}

export interface SentimentSnapshot {
  label: SentimentLabel;
  score: number; // -1.0 to 1.0
  intent: string;
  buyingSignals: string[];
  objections: string[];
}

export interface TranscriptTurn {
  id: string;
  speaker: 'prospect' | 'agent';
  text: string;
  language: SupportedLanguageCode;
  timestamp: string;
  sentiment?: SentimentSnapshot;
  retrievedChunks?: RetrievedChunk[];
  bookedSlotId?: string;
  latencyMs?: number;
}

export interface AppointmentSlot {
  id: string;
  date: string;
  time: string;
  timezone: string;
  repName: string;
  available: boolean;
  leadId?: string;
  leadName?: string;
  company?: string;
  notes?: string;
}

export interface CrmWebhookEvent {
  id: string;
  timestamp: string;
  provider: 'HubSpot' | 'Salesforce';
  event: 'lead.created' | 'lead.qualified' | 'meeting.booked' | 'call.summarized';
  leadId: string;
  payloadSummary: string;
  status: 'Synced';
}

export interface LeadRecord {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  language: SupportedLanguageCode;
  stage: LeadStage;
  score: number;
  estimatedArr: number;
  bant: BantQualification;
  sentimentLabel: SentimentLabel;
  sentimentScore: number;
  memoryNotes: string[];
  bookedAppointmentId: string | null;
  lastContactedAt: string;
  crmExternalId: string;
}

export interface CallSummary {
  executiveSummary: string;
  painPoints: string[];
  objectionsHandled: string[];
  actionItems: string[];
  qualificationVerdict: string;
  nextBestAction: string;
}

export interface CallRecord {
  id: string;
  leadId: string;
  leadName: string;
  company: string;
  language: SupportedLanguageCode;
  voicePersona: VoicePersona;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  status: 'active' | 'completed';
  turns: TranscriptTurn[];
  bant: BantQualification;
  sentimentHistory: number[];
  latestSentiment: SentimentSnapshot;
  ragHits: number;
  summary: CallSummary | null;
}

export interface ArchitectureScaleProjection {
  totalUsers: number;
  peakConcurrentCalls: number;
  callsPerMonth: number;
  avgMinutesPerCall: number;
  voiceGatewayPods: number;
  orchestratorPods: number;
  redisMemoryGb: number;
  vectorDbReplicas: number;
  sttMonthlyUsd: number;
  llmMonthlyUsd: number;
  ttsMonthlyUsd: number;
  telephonyMonthlyUsd: number;
  infraMonthlyUsd: number;
  totalMonthlyUsd: number;
  costPerMinuteUsd: number;
  costPerUserMonthlyUsd: number;
  equivalentHumanSdrMonthlyUsd: number;
  monthlySavingsUsd: number;
}

export interface AppStatePayload {
  leads: LeadRecord[];
  slots: AppointmentSlot[];
  knowledge: KnowledgeDoc[];
  calls: CallRecord[];
  webhooks: CrmWebhookEvent[];
}
