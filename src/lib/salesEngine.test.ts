import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBantScore,
  computeScaleProjection,
  estimateArrFromTeamSize,
  findAvailableSlot,
  mergeBantQualification,
  normalizeSentimentLabel,
} from './salesEngine';
import type { AppointmentSlot, BantQualification } from '../types';

test('calculateBantScore advances stage to Qualified when full BANT is discovered', () => {
  const res = calculateBantScore({
    budget: '$60,000 annual budget',
    authority: 'VP of Revenue Operations',
    need: 'Automate inbound qualification across EMEA',
    timeline: 'Q1 rollout',
    teamSize: 120,
    sentimentScore: 0.6,
    hasBookedDemo: false,
  });
  assert.ok(res.score >= 85);
  assert.equal(res.stage, 'Qualified');
});

test('calculateBantScore sets Demo Booked stage and enforces high score floor', () => {
  const res = calculateBantScore({
    budget: null,
    authority: 'Director of Sales',
    need: 'Voice SDR automation',
    timeline: 'This month',
    teamSize: 40,
    sentimentScore: 0.4,
    hasBookedDemo: true,
  });
  assert.equal(res.stage, 'Demo Booked');
  assert.ok(res.score >= 84);
});

test('mergeBantQualification preserves prior memory fields when new turn omits them', () => {
  const initial: BantQualification = {
    budget: '$45k/yr',
    authority: null,
    need: 'Reduce inbound lead response time',
    timeline: null,
    teamSize: 80,
    score: 58,
    stage: 'Discovery',
  };
  const updated = mergeBantQualification(
    initial,
    { authority: 'CRO decision maker', timeline: 'Next 30 days' },
    0.55,
    false
  );
  assert.equal(updated.budget, '$45k/yr');
  assert.equal(updated.need, 'Reduce inbound lead response time');
  assert.equal(updated.authority, 'CRO decision maker');
  assert.equal(updated.timeline, 'Next 30 days');
  assert.equal(updated.teamSize, 80);
  assert.equal(updated.stage, 'Qualified');
});

test('findAvailableSlot respects preferred slot if available and falls back otherwise', () => {
  const slots: AppointmentSlot[] = [
    { id: 's1', date: '2026-11-26', time: '10:00 AM', timezone: 'EST', repName: 'Elena', available: false },
    { id: 's2', date: '2026-11-26', time: '02:00 PM', timezone: 'EST', repName: 'Marcus', available: true },
  ];
  assert.equal(findAvailableSlot(slots, 's1')?.id, 's2');
  assert.equal(findAvailableSlot(slots, 's2')?.id, 's2');
});

test('normalizeSentimentLabel classifies edge scores properly', () => {
  assert.equal(normalizeSentimentLabel(0.5), 'Positive');
  assert.equal(normalizeSentimentLabel(0.05), 'Neutral');
  assert.equal(normalizeSentimentLabel(-0.2), 'Skeptical');
  assert.equal(normalizeSentimentLabel(-0.7), 'Frustrated');
});

test('computeScaleProjection models 100,000 users with positive ROI savings', () => {
  const p100k = computeScaleProjection(100000);
  assert.equal(p100k.totalUsers, 100000);
  assert.equal(p100k.callsPerMonth, 240000);
  assert.ok(p100k.peakConcurrentCalls >= 150);
  assert.ok(p100k.voiceGatewayPods >= 2);
  assert.ok(p100k.vectorDbReplicas === 4);
  assert.ok(p100k.monthlySavingsUsd > 0);
  assert.ok(p100k.costPerMinuteUsd > 0 && p100k.costPerMinuteUsd < 0.15);
  assert.equal(estimateArrFromTeamSize(100), 45600);
});
