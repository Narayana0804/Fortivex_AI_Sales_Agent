import { useMemo, useState } from 'react';
import { ShieldCheck, Server, TrendingUp, Workflow } from 'lucide-react';
import { computeScaleProjection } from '../lib/salesEngine';

interface ArchNode {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  width: number;
  stack: string;
  latencyBudget: string;
  protocol: string;
  scalingStrategy: string;
  fallback: string;
}

const ARCH_NODES: ArchNode[] = [
  {
    id: 'edge',
    label: 'WebRTC / SIP Edge',
    sublabel: 'Twilio · Browser Mic',
    x: 24,
    y: 78,
    width: 148,
    stack: 'Twilio Elastic SIP Trunking + Browser WebRTC Media Streams',
    latencyBudget: '35–60 ms (Anycast regional PoP)',
    protocol: 'SRTP / WSS (Opus 16kHz / G.711)',
    scalingStrategy: 'Stateless regional voice gateway pods behind L4 NLB; 120 concurrent streams/pod.',
    fallback: 'Multi-region SIP failover (US-East <-> US-West <-> EU-Central).',
  },
  {
    id: 'stt',
    label: 'Streaming STT',
    sublabel: 'Gemini Transcribe',
    x: 204,
    y: 78,
    width: 148,
    stack: 'Gemini 3.5 Transcribe + Web Speech Edge VAD (Voice Activity Detection)',
    latencyBudget: '90–140 ms endpointing',
    protocol: 'Bi-directional gRPC / HTTPS audio frames',
    scalingStrategy: 'Barge-in VAD filters silence before inference, cutting STT compute by ~42%.',
    fallback: 'Automatic client Web Speech / secondary region STT failover.',
  },
  {
    id: 'orchestrator',
    label: 'Voice Orchestrator',
    sublabel: 'Memory · BANT · State',
    x: 384,
    y: 78,
    width: 158,
    stack: 'Node.js / TypeScript Async Workers + Redis Cluster (Session State)',
    latencyBudget: '15–25 ms orchestration overhead',
    protocol: 'HTTP/2 + Redis Pub/Sub',
    scalingStrategy: 'Horizontal Pod Autoscaler (HPA) keyed on active WebSocket/turn queue depth.',
    fallback: 'Write-ahead PostgreSQL checkpointing restores call context on pod restart.',
  },
  {
    id: 'rag',
    label: 'RAG Knowledge Store',
    sublabel: 'Vector + BM25 Hybrid',
    x: 384,
    y: 204,
    width: 158,
    stack: 'Hybrid TF-IDF / BM25 + pgvector / Qdrant Embeddings (Gemini Embedding 2)',
    latencyBudget: '25–45 ms top-K retrieval',
    protocol: 'Pooled SQL / gRPC Read Replicas',
    scalingStrategy: '4 read replicas + Redis semantic query cache (68% hit rate on pricing/SOC2 FAQs).',
    fallback: 'Graceful degradation to in-memory lexical BM25 index.',
  },
  {
    id: 'llm',
    label: 'Gemini 4 Reasoning',
    sublabel: 'Multilingual + JSON',
    x: 576,
    y: 78,
    width: 156,
    stack: 'Gemini 4 Hydrogen (Low Thinking Mode + Structured JSON Schema)',
    latencyBudget: '160–240 ms TTFT',
    protocol: 'HTTPS Streaming / Vertex AI Regional Endpoints',
    scalingStrategy: 'Provisioned Throughput + multi-region quota load balancing for 100k users.',
    fallback: 'Circuit breaker with retry backoff and regional endpoint failover.',
  },
  {
    id: 'crm',
    label: 'Booking & CRM Sync',
    sublabel: 'Calendar · Salesforce',
    x: 576,
    y: 204,
    width: 156,
    stack: 'Async Tool Executor + Idempotent Webhook Queue (BullMQ / Cloud Tasks)',
    latencyBudget: 'Async < 1.5 s (non-blocking voice path)',
    protocol: 'OAuth 2.0 REST (Salesforce, HubSpot, GCal)',
    scalingStrategy: 'Dead-letter queue with exponential retry ensures zero dropped demo bookings.',
    fallback: 'Local transaction ledger replays missed CRM writes automatically.',
  },
  {
    id: 'tts',
    label: 'Streaming TTS',
    sublabel: 'Gemini 3.8 Flash Lite',
    x: 766,
    y: 78,
    width: 150,
    stack: 'Gemini 3.8 Flash Lite TTS (24kHz PCM/WAV · 5 Voice Personas)',
    latencyBudget: '110–170 ms first audio byte',
    protocol: 'Streaming PCM / 24kHz WAV',
    scalingStrategy: 'Pre-cached multilingual greetings + sentence-chunked progressive playback.',
    fallback: 'Client SpeechSynthesis API fallback if audio stream degrades.',
  },
];

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Inbound / Outbound Trigger',
    detail: 'Web lead submission or CRM trigger initiates a sub-15-second voice call in prospect language.',
  },
  {
    step: '02',
    title: 'Multilingual STT + Memory Hydration',
    detail: 'Audio streams into STT while Redis hydrates prior account notes, CRM ID, and open calendar slots.',
  },
  {
    step: '03',
    title: 'Hybrid RAG Grounding',
    detail: 'Prospect objections (SOC2, GDPR, volume pricing) retrieve verified playbook chunks with citation scores.',
  },
  {
    step: '04',
    title: 'BANT & Sentiment Scoring',
    detail: 'Every turn extracts Budget, Authority, Need, Timeline, sentiment trajectory, and buying signals.',
  },
  {
    step: '05',
    title: 'Autonomous Demo Booking & CRM Sync',
    detail: 'Once qualified, the agent locks an AE calendar slot and emits an idempotent Salesforce/HubSpot webhook.',
  },
  {
    step: '06',
    title: 'Call Summarisation & Executive Insights',
    detail: 'On hang-up, Gemini synthesizes pain points, handled objections, and next best action into CRM.',
  },
];

export function ArchitectureScaleView() {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('llm');
  const [targetUsers, setTargetUsers] = useState<number>(100000);

  const selectedNode = useMemo(
    () => ARCH_NODES.find((n) => n.id === selectedNodeId) ?? ARCH_NODES[0],
    [selectedNodeId]
  );

  const projection = useMemo(() => computeScaleProjection(targetUsers), [targetUsers]);

  return (
    <div className="space-y-6">
      {/* 1. Interactive System Architecture Diagram */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              System Architecture Diagram
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any architecture component to inspect protocols, latency budgets, autoscaling, and failover behavior.
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-blue-700 font-medium">
            Target End-to-End Turn Latency: ~420 ms
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg bg-slate-50/70 p-3">
          <svg
            viewBox="0 0 940 296"
            className="w-full min-w-[760px] h-auto"
            role="img"
            aria-label="Cadence Autonomous AI Sales Voice Agent System Architecture Diagram"
          >
            <defs>
              <marker
                id="arch-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748B" />
              </marker>
            </defs>

            {/* Primary Real-Time Voice Pipeline Edges */}
            <line x1="172" y1="110" x2="200" y2="110" stroke="#64748B" strokeWidth="1.75" markerEnd="url(#arch-arrow)" />
            <line x1="352" y1="110" x2="380" y2="110" stroke="#64748B" strokeWidth="1.75" markerEnd="url(#arch-arrow)" />
            <line x1="542" y1="110" x2="572" y2="110" stroke="#64748B" strokeWidth="1.75" markerEnd="url(#arch-arrow)" />
            <line x1="732" y1="110" x2="762" y2="110" stroke="#64748B" strokeWidth="1.75" markerEnd="url(#arch-arrow)" />

            {/* Return Audio Feedback Loop (TTS -> Edge) */}
            <path
              d="M 841 78 L 841 32 L 98 32 L 98 74"
              fill="none"
              stroke="#1D4ED8"
              strokeWidth="1.5"
              strokeDasharray="5 4"
              markerEnd="url(#arch-arrow)"
            />
            <text x="470" y="24" textAnchor="middle" fill="#1D4ED8" fontSize="11" fontWeight="600">
              24kHz Streaming Voice Playback Loop (Barge-In Interruptible)
            </text>

            {/* Vertical Data & Tool Edges */}
            <line x1="463" y1="142" x2="463" y2="200" stroke="#64748B" strokeWidth="1.75" markerEnd="url(#arch-arrow)" />
            <line x1="654" y1="142" x2="654" y2="200" stroke="#64748B" strokeWidth="1.75" markerEnd="url(#arch-arrow)" />

            {/* Interactive Nodes */}
            {ARCH_NODES.map((node) => {
              const active = node.id === selectedNodeId;
              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${node.label} architecture node`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedNodeId(node.id);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={64}
                    rx={8}
                    fill={active ? '#EFF6FF' : '#FFFFFF'}
                    stroke={active ? '#1D4ED8' : '#CBD5E1'}
                    strokeWidth={active ? 2 : 1.25}
                  />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + 27}
                    textAnchor="middle"
                    fill={active ? '#1E3A8A' : '#0F172A'}
                    fontSize="12.5"
                    fontWeight="600"
                  >
                    {node.label}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + 46}
                    textAnchor="middle"
                    fill="#64748B"
                    fontSize="10.5"
                  >
                    {node.sublabel}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Node Technical Spec */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-200 text-xs"
          data-testid="arch-node-detail"
        >
          <div>
            <div className="font-semibold text-slate-900 mb-1">
              Selected Component: {selectedNode.label}
            </div>
            <p className="text-slate-600 leading-relaxed">{selectedNode.stack}</p>
          </div>
          <div>
            <div className="font-semibold text-slate-900 mb-1">Protocol & Latency Budget</div>
            <p className="text-slate-600 font-mono">{selectedNode.latencyBudget}</p>
            <p className="text-slate-500 mt-0.5">{selectedNode.protocol}</p>
          </div>
          <div>
            <div className="font-semibold text-slate-900 mb-1">Horizontal Scaling</div>
            <p className="text-slate-600 leading-relaxed">{selectedNode.scalingStrategy}</p>
          </div>
          <div>
            <div className="font-semibold text-slate-900 mb-1">Resilience & Failover</div>
            <p className="text-slate-600 leading-relaxed">{selectedNode.fallback}</p>
          </div>
        </div>
      </section>

      {/* 2. 100,000-User Scalability & Unit Economics Calculator */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Server className="h-4 w-4 text-blue-700" />
              <span>Scalability & Operational Cost Model (Up to 100,000 Users)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Adjust active user scale to inspect real-time concurrency, Kubernetes pod sizing, and commercial unit economics.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="scale-users-slider" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              Active Users:
            </label>
            <input
              id="scale-users-slider"
              type="range"
              min={1000}
              max={100000}
              step={1000}
              value={targetUsers}
              onChange={(e) => setTargetUsers(Number(e.target.value))}
              className="w-44 accent-blue-700"
            />
            <span
              className="font-mono text-sm font-semibold tabular-nums text-blue-700 w-20 text-right"
              data-testid="scale-user-count"
            >
              {projection.totalUsers.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Capacity Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-lg divide-y lg:divide-y-0 divide-x divide-slate-200">
          <div className="p-4">
            <div className="text-xs text-slate-500">Monthly Voice Calls</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">
              {projection.callsPerMonth.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {projection.avgMinutesPerCall} min avg duration
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500">Peak Concurrent Streams</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">
              {projection.peakConcurrentCalls.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">8x diurnal business-hour peak</div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500">Autoscale Cluster Footprint</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">
              {projection.voiceGatewayPods + projection.orchestratorPods} pods
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {projection.voiceGatewayPods} SIP · {projection.orchestratorPods} Orchestrator ·{' '}
              {projection.vectorDbReplicas} Vector DB
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500">Cost per Voice Minute</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-green-700">
              ${projection.costPerMinuteUsd.toFixed(4)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              ${projection.costPerUserMonthlyUsd.toFixed(2)} / active user / month
            </div>
          </div>
        </div>

        {/* Cost Breakdown & Commercial Feasibility Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Operational Cost Component</th>
                  <th className="py-2 px-3 font-semibold">Technology Stack</th>
                  <th className="py-2 pl-3 text-right font-semibold">Monthly Cost (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2.5 pr-3 font-medium text-slate-900">Streaming STT</td>
                  <td className="py-2.5 px-3 text-slate-600">Gemini 3.5 Transcribe + Edge VAD</td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-900">
                    ${projection.sttMonthlyUsd.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium text-slate-900">LLM Reasoning & RAG</td>
                  <td className="py-2.5 px-3 text-slate-600">Gemini 4 Hydrogen (Low Thinking)</td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-900">
                    ${projection.llmMonthlyUsd.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium text-slate-900">Neural TTS Synthesis</td>
                  <td className="py-2.5 px-3 text-slate-600">Gemini 3.8 Flash Lite TTS (24kHz)</td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-900">
                    ${projection.ttsMonthlyUsd.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium text-slate-900">Global SIP / WebRTC</td>
                  <td className="py-2.5 px-3 text-slate-600">Twilio Elastic SIP + Edge Media</td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-900">
                    ${projection.telephonyMonthlyUsd.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-medium text-slate-900">Cloud & Vector Infra</td>
                  <td className="py-2.5 px-3 text-slate-600">
                    GKE Autopilot · Redis ({projection.redisMemoryGb} GB) · pgvector
                  </td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-900">
                    ${projection.infraMonthlyUsd.toLocaleString()}
                  </td>
                </tr>
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <td className="py-3 pr-3 text-slate-900">Total Monthly Operating Cost</td>
                  <td className="py-3 px-3 text-slate-600">All-in Cloud + AI + Telephony</td>
                  <td className="py-3 pl-3 text-right font-mono tabular-nums text-blue-700 text-sm">
                    ${projection.totalMonthlyUsd.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="lg:col-span-5 border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <TrendingUp className="h-4 w-4 text-green-700" />
              <span>Commercial Feasibility & ROI vs Human SDR Team</span>
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">Equivalent Human SDR Cost</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  ${projection.equivalentHumanSdrMonthlyUsd.toLocaleString()}/mo
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">Cadence Autonomous Cost</dt>
                <dd className="font-mono tabular-nums font-medium text-blue-700">
                  ${projection.totalMonthlyUsd.toLocaleString()}/mo
                </dd>
              </div>
              <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
                <dt className="font-semibold text-slate-900">Estimated Monthly Savings</dt>
                <dd className="font-mono tabular-nums font-semibold text-green-700 text-sm">
                  ${projection.monthlySavingsUsd.toLocaleString()}/mo
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-600 leading-relaxed pt-1">
              At $38/seat SaaS pricing (or $0.14/min usage pricing), Cadence sustains an
              ~72% gross margin while cutting customer cost-per-qualified-meeting by over 80%
              and reducing speed-to-lead from hours to under 15 seconds.
            </p>
          </div>
        </div>
      </section>

      {/* 3. End-to-End Business Workflow & Security / Deployment Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Workflow className="h-4 w-4 text-blue-700" />
            <span>End-to-End Autonomous Sales Workflow</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {WORKFLOW_STEPS.map((item) => (
              <div key={item.step} className="space-y-1 text-xs">
                <div className="font-semibold text-slate-900">
                  <span className="font-mono text-blue-700 mr-1.5">{item.step}.</span>
                  {item.title}
                </div>
                <p className="text-slate-600 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            <span>Data Security, Compliance & Deployment</span>
          </h2>
          <dl className="space-y-3 text-xs">
            <div>
              <dt className="font-semibold text-slate-900">Encryption & PII Redaction</dt>
              <dd className="text-slate-600 mt-0.5 leading-relaxed">
                TLS 1.3 / SRTP in transit, AES-256-GCM at rest, automated pre-storage regex & NER redaction for payment cards, SSNs, and PHI. Zero training on tenant data.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Regulatory Compliance</dt>
              <dd className="text-slate-600 mt-0.5 leading-relaxed">
                SOC2 Type II controls, EU Frankfurt (eu-central-1) GDPR regional pinning, TCPA calling-window enforcement, DNC scrubbing, and mandatory AI voice disclosure.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-900">Multi-Region Production Deployment</dt>
              <dd className="text-slate-600 mt-0.5 leading-relaxed">
                Containerized Cloud Run / GKE Autopilot services deployed via Terraform & CI/CD blue-green rollouts, Cloud Armor WAF, and regional active-active PostgreSQL + Redis failover.
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
