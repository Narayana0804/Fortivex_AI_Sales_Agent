import type {
  AppointmentSlot,
  ArchitectureScaleProjection,
  BantQualification,
  LeadStage,
  SentimentLabel,
  SupportedLanguageCode,
} from '../types.ts';

export const LANGUAGE_OPTIONS: Array<{
  code: SupportedLanguageCode;
  label: string;
  nativeLabel: string;
  bcp47: string;
}> = [
  { code: 'en', label: 'English', nativeLabel: 'English (US)', bcp47: 'en-US' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', bcp47: 'es-ES' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', bcp47: 'fr-FR' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', bcp47: 'de-DE' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', bcp47: 'hi-IN' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', bcp47: 'ja-JP' },
];

export function calculateBantScore(input: {
  budget: string | null;
  authority: string | null;
  need: string | null;
  timeline: string | null;
  teamSize: number | null;
  sentimentScore: number;
  hasBookedDemo: boolean;
}): { score: number; stage: LeadStage } {
  let score = 15; // baseline inbound/outbound contact

  if (input.need && input.need.trim().length > 2) {
    score += 22;
  }
  if (input.budget && input.budget.trim().length > 1) {
    score += 20;
  }
  if (input.authority && input.authority.trim().length > 2) {
    score += 15;
  }
  if (input.timeline && input.timeline.trim().length > 2) {
    score += 15;
  }
  if (input.teamSize !== null && input.teamSize >= 25) {
    score += 8;
  } else if (input.teamSize !== null && input.teamSize >= 5) {
    score += 4;
  }

  // Sentiment adjustment (-10 to +10)
  const clampedSentiment = Math.max(-1, Math.min(1, input.sentimentScore));
  score += Math.round(clampedSentiment * 10);

  if (input.hasBookedDemo) {
    score = Math.max(score + 12, 84);
  }

  const boundedScore = Math.max(0, Math.min(100, score));

  let stage: LeadStage = 'New';
  if (input.hasBookedDemo) {
    stage = 'Demo Booked';
  } else if (clampedSentiment <= -0.65 && boundedScore < 35) {
    stage = 'Disqualified';
  } else if (boundedScore >= 68) {
    stage = 'Qualified';
  } else if (boundedScore >= 35) {
    stage = 'Discovery';
  }

  return { score: boundedScore, stage };
}

export function mergeBantQualification(
  current: BantQualification,
  patch: Partial<Pick<BantQualification, 'budget' | 'authority' | 'need' | 'timeline' | 'teamSize'>>,
  sentimentScore: number,
  hasBookedDemo: boolean
): BantQualification {
  const budget = patch.budget && patch.budget.trim() ? patch.budget.trim() : current.budget;
  const authority =
    patch.authority && patch.authority.trim() ? patch.authority.trim() : current.authority;
  const need = patch.need && patch.need.trim() ? patch.need.trim() : current.need;
  const timeline =
    patch.timeline && patch.timeline.trim() ? patch.timeline.trim() : current.timeline;
  const teamSize =
    typeof patch.teamSize === 'number' && Number.isFinite(patch.teamSize) && patch.teamSize > 0
      ? Math.round(patch.teamSize)
      : current.teamSize;

  const { score, stage } = calculateBantScore({
    budget,
    authority,
    need,
    timeline,
    teamSize,
    sentimentScore,
    hasBookedDemo,
  });

  return {
    budget,
    authority,
    need,
    timeline,
    teamSize,
    score,
    stage,
  };
}

export function normalizeSentimentLabel(score: number, rawLabel?: string): SentimentLabel {
  const valid: SentimentLabel[] = ['Positive', 'Neutral', 'Skeptical', 'Frustrated'];
  if (rawLabel && valid.includes(rawLabel as SentimentLabel)) {
    return rawLabel as SentimentLabel;
  }
  if (score >= 0.28) return 'Positive';
  if (score <= -0.45) return 'Frustrated';
  if (score <= -0.12) return 'Skeptical';
  return 'Neutral';
}

export function findAvailableSlot(
  slots: AppointmentSlot[],
  preferredSlotId?: string | null
): AppointmentSlot | null {
  if (preferredSlotId) {
    const exact = slots.find((s) => s.id === preferredSlotId && s.available);
    if (exact) return exact;
  }
  return slots.find((s) => s.available) ?? null;
}

export function estimateArrFromTeamSize(teamSize: number | null, fallbackArr = 24000): number {
  if (!teamSize || teamSize <= 0) return fallbackArr;
  // Enterprise tier ~$38/seat/month -> $456/seat/year, minimum $14,400 ARR
  return Math.max(14400, Math.round(teamSize * 456));
}

export function computeScaleProjection(totalUsers: number): ArchitectureScaleProjection {
  const users = Math.max(500, Math.min(250000, Math.round(totalUsers)));
  // Typical enterprise B2B sales voice platform: 2.4 calls/user/month, 4.5 min avg call
  const callsPerMonth = Math.round(users * 2.4);
  const avgMinutesPerCall = 4.5;
  const totalMinutesPerMonth = callsPerMonth * avgMinutesPerCall;

  // Peak concurrency assumes 8x diurnal business-hour spike over monthly average
  const avgConcurrentCalls = totalMinutesPerMonth / (30 * 24 * 60);
  const peakConcurrentCalls = Math.max(10, Math.ceil(avgConcurrentCalls * 8));

  // Infrastructure sizing
  const voiceGatewayPods = Math.max(2, Math.ceil(peakConcurrentCalls / 120));
  const orchestratorPods = Math.max(2, Math.ceil(peakConcurrentCalls / 85));
  const redisMemoryGb = Math.max(2, Math.ceil((peakConcurrentCalls * 1.5) / 100));
  const vectorDbReplicas = users >= 50000 ? 4 : users >= 15000 ? 2 : 1;

  // Unit economics per minute (optimized Gemini Flash Lite TTS + Gemini Flash LLM + Streaming STT + SIP)
  const sttRate = 0.008;
  const llmRate = 0.007;
  const ttsRate = 0.011;
  const telephonyRate = 0.012;

  const sttMonthlyUsd = Math.round(totalMinutesPerMonth * sttRate);
  const llmMonthlyUsd = Math.round(totalMinutesPerMonth * llmRate);
  const ttsMonthlyUsd = Math.round(totalMinutesPerMonth * ttsRate);
  const telephonyMonthlyUsd = Math.round(totalMinutesPerMonth * telephonyRate);
  const infraMonthlyUsd = Math.round(
    voiceGatewayPods * 115 +
      orchestratorPods * 145 +
      redisMemoryGb * 28 +
      vectorDbReplicas * 420 +
      650
  );

  const totalMonthlyUsd =
    sttMonthlyUsd + llmMonthlyUsd + ttsMonthlyUsd + telephonyMonthlyUsd + infraMonthlyUsd;
  const costPerMinuteUsd = Number((totalMonthlyUsd / Math.max(1, totalMinutesPerMonth)).toFixed(4));
  const costPerUserMonthlyUsd = Number((totalMonthlyUsd / users).toFixed(2));

  // Human SDR benchmark: 1 SDR handles ~1,100 voice minutes/month at $6,500 fully loaded monthly cost
  const requiredHumanSdrs = Math.max(1, Math.ceil(totalMinutesPerMonth / 1100));
  const equivalentHumanSdrMonthlyUsd = requiredHumanSdrs * 6500;
  const monthlySavingsUsd = Math.max(0, equivalentHumanSdrMonthlyUsd - totalMonthlyUsd);

  return {
    totalUsers: users,
    peakConcurrentCalls,
    callsPerMonth,
    avgMinutesPerCall,
    voiceGatewayPods,
    orchestratorPods,
    redisMemoryGb,
    vectorDbReplicas,
    sttMonthlyUsd,
    llmMonthlyUsd,
    ttsMonthlyUsd,
    telephonyMonthlyUsd,
    infraMonthlyUsd,
    totalMonthlyUsd,
    costPerMinuteUsd,
    costPerUserMonthlyUsd,
    equivalentHumanSdrMonthlyUsd,
    monthlySavingsUsd,
  };
}
