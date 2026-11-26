import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkKnowledgeDocs, retrieveRelevantChunks, tokenizeText } from './ragEngine';
import type { KnowledgeDoc } from '../types';

const SAMPLE_DOCS: KnowledgeDoc[] = [
  {
    id: 'doc-pricing',
    title: 'Enterprise Pricing & Seat Tiers',
    category: 'Pricing',
    content:
      'Growth plan starts at $32 per seat per month billed annually for teams up to 50 seats. Enterprise plan is $38 per seat per month with volume discounts starting at 100 seats (15% off) and dedicated SSO.',
    updatedAt: '2026-11-01',
  },
  {
    id: 'doc-security',
    title: 'Security, SOC2 Type II & GDPR Compliance',
    category: 'Security',
    content:
      'Cadence Cloud is SOC2 Type II audited, ISO 27001 certified, and fully GDPR compliant with EU Frankfurt data residency. All voice audio is encrypted in transit with TLS 1.3 and at rest using AES-256.',
    updatedAt: '2026-11-10',
  },
  {
    id: 'doc-crm',
    title: 'Salesforce & HubSpot Native Integrations',
    category: 'Integrations',
    content:
      'Bi-directional native connectors sync BANT fields, call transcripts, sentiment scores, and booked demo meetings to Salesforce and HubSpot within 2 seconds of call completion.',
    updatedAt: '2026-11-15',
  },
];

test('tokenizeText strips stop words and punctuation while preserving terms', () => {
  const tokens = tokenizeText('Do you support SOC2 Type II and GDPR compliance?');
  assert.ok(tokens.includes('soc2'));
  assert.ok(tokens.includes('gdpr'));
  assert.ok(tokens.includes('compliance'));
  assert.ok(!tokens.includes('the'));
});

test('chunkKnowledgeDocs splits long paragraphs into bounded chunks', () => {
  const longDoc: KnowledgeDoc = {
    id: 'doc-long',
    title: 'SLA Spec',
    category: 'SLA & Scale',
    content: Array.from(
      { length: 8 },
      (_, i) => `Sentence number ${i + 1} describes regional failover and uptime guarantees in detail.`
    ).join(' '),
    updatedAt: '2026-11-20',
  };
  const chunks = chunkKnowledgeDocs([longDoc], 220);
  assert.ok(chunks.length >= 2);
});

test('retrieveRelevantChunks ranks Security doc highest for SOC2/GDPR query', () => {
  const results = retrieveRelevantChunks('Are you SOC2 Type II and GDPR compliant with EU residency?', SAMPLE_DOCS, 3);
  assert.ok(results.length >= 1);
  assert.equal(results[0].docId, 'doc-security');
  assert.ok(results[0].score > 0.25);
});

test('retrieveRelevantChunks returns empty array for empty or stop-word query', () => {
  const results = retrieveRelevantChunks('the and or to', SAMPLE_DOCS);
  assert.equal(results.length, 0);
});
