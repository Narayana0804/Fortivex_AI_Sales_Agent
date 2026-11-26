import { useMemo, useState } from 'react';
import {
  Calendar,
  Download,
  PhoneCall,
  Plus,
  Search,
  Webhook,
} from 'lucide-react';
import { LANGUAGE_OPTIONS } from '../lib/salesEngine';
import type {
  AppointmentSlot,
  CrmWebhookEvent,
  LeadRecord,
  LeadStage,
  SupportedLanguageCode,
} from '../types';

interface CrmBookingsViewProps {
  leads: LeadRecord[];
  slots: AppointmentSlot[];
  webhooks: CrmWebhookEvent[];
  onCreateLead: (payload: {
    name: string;
    role: string;
    company: string;
    email: string;
    phone: string;
    language: SupportedLanguageCode;
    teamSize?: number;
  }) => Promise<void>;
  onUpdateLead: (
    id: string,
    payload: { stage?: LeadStage; memoryNote?: string }
  ) => Promise<void>;
  onDialLead: (leadId: string) => void;
}

const STAGES: Array<'All' | LeadStage> = [
  'All',
  'New',
  'Discovery',
  'Qualified',
  'Demo Booked',
  'Disqualified',
];

export function CrmBookingsView({
  leads,
  slots,
  webhooks,
  onCreateLead,
  onUpdateLead,
  onDialLead,
}: CrmBookingsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'All' | LeadStage>('All');
  const [selectedLeadId, setSelectedLeadId] = useState<string>(leads[0]?.id ?? '');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add lead form state
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<SupportedLanguageCode>('en');
  const [teamSize, setTeamSize] = useState('50');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add note state
  const [newMemoryNote, setNewMemoryNote] = useState('');

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      if (stageFilter !== 'All' && lead.stage !== stageFilter) return false;
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.company.toLowerCase().includes(q) ||
        lead.role.toLowerCase().includes(q) ||
        lead.crmExternalId.toLowerCase().includes(q)
      );
    });
  }, [leads, searchQuery, stageFilter]);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) ?? filteredLeads[0] ?? null,
    [leads, selectedLeadId, filteredLeads]
  );

  const bookedSlots = useMemo(() => slots.filter((s) => !s.available), [slots]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !company.trim()) {
      setFormError('Prospect name and company are required.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await onCreateLead({
        name: name.trim(),
        role: role.trim() || 'VP of Sales',
        company: company.trim(),
        email: email.trim(),
        phone: phone.trim(),
        language,
        teamSize: Number(teamSize) > 0 ? Number(teamSize) : undefined,
      });
      setName('');
      setRole('');
      setCompany('');
      setEmail('');
      setPhone('');
      setShowAddForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'CRM ID',
      'Name',
      'Role',
      'Company',
      'Email',
      'Language',
      'Stage',
      'Score',
      'Estimated ARR',
      'Sentiment',
    ];
    const rows = leads.map((l) => [
      l.crmExternalId,
      l.name,
      l.role,
      l.company,
      l.email,
      l.language,
      l.stage,
      String(l.score),
      String(l.estimatedArr),
      l.sentimentLabel,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cadence-crm-pipeline.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const stageTextColor = (stage: LeadStage) => {
    if (stage === 'Demo Booked') return 'text-green-700 font-semibold';
    if (stage === 'Qualified') return 'text-blue-700 font-semibold';
    if (stage === 'Disqualified') return 'text-red-700 font-medium';
    if (stage === 'Discovery') return 'text-amber-700 font-medium';
    return 'text-slate-600 font-medium';
  };

  return (
    <div className="space-y-6">
      {/* Toolbar: Search, Stage Filter, Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <label htmlFor="crm-search" className="sr-only">
              Search CRM leads
            </label>
            <input
              id="crm-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search lead, company, CRM ID..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
            role="tablist"
            aria-label="Filter leads by stage"
          >
            {STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                role="tab"
                aria-selected={stageFilter === stage}
                onClick={() => setStageFilter(stage)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  stageFilter === stage
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {stage}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showAddForm ? 'Close Form' : 'Add Prospect'}</span>
          </button>
        </div>
      </div>

      {/* Add Prospect Inline Form */}
      {showAddForm && (
        <form
          onSubmit={(e) => void handleAddSubmit(e)}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">New CRM Prospect</h2>
            {formError && <span className="text-xs text-red-700 font-medium">{formError}</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="new-lead-name" className="block text-xs font-medium text-slate-600 mb-1">
                Full Name *
              </label>
              <input
                id="new-lead-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Ellis"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-lead-company" className="block text-xs font-medium text-slate-600 mb-1">
                Company *
              </label>
              <input
                id="new-lead-company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Apex Freight Corp"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-lead-role" className="block text-xs font-medium text-slate-600 mb-1">
                Title / Role
              </label>
              <input
                id="new-lead-role"
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="VP of Revenue"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-lead-email" className="block text-xs font-medium text-slate-600 mb-1">
                Work Email
              </label>
              <input
                id="new-lead-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jordan@apexfreight.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-lead-phone" className="block text-xs font-medium text-slate-600 mb-1">
                Phone
              </label>
              <input
                id="new-lead-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (415) 555-0148"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-lead-lang" className="block text-xs font-medium text-slate-600 mb-1">
                Preferred Language
              </label>
              <select
                id="new-lead-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value as SupportedLanguageCode)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="new-lead-seats" className="block text-xs font-medium text-slate-600 mb-1">
                Sales Team Seats
              </label>
              <input
                id="new-lead-seats"
                type="number"
                min={1}
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Saving...' : 'Save to CRM'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Main Split: Lead Pipeline Table + Lead Detail Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Prospect & Account</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4 text-right">BANT Score</th>
                  <th className="py-3 px-4 text-right">Est. ARR</th>
                  <th className="py-3 px-4">Sentiment</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredLeads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-sm text-slate-500">
                      No leads match the current filter. Adjust the stage filter or add a new prospect.
                    </td>
                  </tr>
                ) : (
                  filteredLeads.map((lead) => {
                    const isSelected = selectedLead?.id === lead.id;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{lead.name}</div>
                          <div className="text-xs text-slate-500">
                            {lead.company} · {lead.role} · <span className="font-mono uppercase">{lead.language}</span>
                          </div>
                        </td>
                        <td className={`py-3 px-4 text-xs ${stageTextColor(lead.stage)}`}>
                          {lead.stage}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900">
                          {lead.score}/100
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-800">
                          ${lead.estimatedArr.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          {lead.sentimentLabel}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDialLead(lead.id);
                            }}
                            aria-label={`Dial ${lead.name}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-blue-600 hover:text-blue-700 transition-colors whitespace-nowrap"
                          >
                            <PhoneCall className="h-3.5 w-3.5" />
                            <span>Dial</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Lead CRM Inspector */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          {selectedLead ? (
            <>
              <div className="p-5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {selectedLead.name}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {selectedLead.role} · {selectedLead.company}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-slate-500">
                    {selectedLead.crmExternalId}
                  </span>
                </div>
                <div className="text-xs text-slate-600 pt-1 space-y-0.5">
                  <div>{selectedLead.email}</div>
                  <div className="font-mono tabular-nums">{selectedLead.phone}</div>
                </div>
              </div>

              <div className="p-5 space-y-3">
                <label
                  htmlFor="inspector-stage"
                  className="block text-xs font-semibold text-slate-800"
                >
                  Pipeline Stage
                </label>
                <select
                  id="inspector-stage"
                  value={selectedLead.stage}
                  onChange={(e) =>
                    void onUpdateLead(selectedLead.id, {
                      stage: e.target.value as LeadStage,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                >
                  {STAGES.filter((s) => s !== 'All').map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-5 space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-800">
                  Account Contextual Memory
                </h3>
                <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                  {selectedLead.memoryNotes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newMemoryNote.trim()) return;
                    void onUpdateLead(selectedLead.id, {
                      memoryNote: newMemoryNote.trim(),
                    });
                    setNewMemoryNote('');
                  }}
                  className="flex gap-2 pt-2"
                >
                  <label htmlFor="add-memory-note" className="sr-only">
                    Add CRM memory note
                  </label>
                  <input
                    id="add-memory-note"
                    type="text"
                    value={newMemoryNote}
                    onChange={(e) => setNewMemoryNote(e.target.value)}
                    placeholder="Add account note..."
                    className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    Save
                  </button>
                </form>
              </div>

              <div className="p-5 space-y-2">
                <h3 className="text-xs font-semibold text-slate-800">
                  CRM Sync Payload (JSON)
                </h3>
                <pre className="rounded-lg bg-slate-900 text-slate-100 p-3 text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {JSON.stringify(
                    {
                      externalId: selectedLead.crmExternalId,
                      stage: selectedLead.stage,
                      bantScore: selectedLead.score,
                      estimatedArr: selectedLead.estimatedArr,
                      bookedSlotId: selectedLead.bookedAppointmentId,
                      bant: {
                        budget: selectedLead.bant.budget,
                        authority: selectedLead.bant.authority,
                        timeline: selectedLead.bant.timeline,
                      },
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </>
          ) : (
            <div className="p-6 text-sm text-slate-500">Select a lead to inspect CRM details.</div>
          )}
        </div>
      </div>

      {/* Bottom Split: Booked Appointments + Real-Time CRM Webhook Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-700" />
              <span>Confirmed Demo Bookings</span>
            </h2>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {bookedSlots.length} booked · {slots.length - bookedSlots.length} open
            </span>
          </div>

          {bookedSlots.length === 0 ? (
            <p className="text-xs text-slate-500">No demos booked yet.</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {bookedSlots.map((slot) => (
                <div key={slot.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-slate-900">
                      {slot.leadName} · {slot.company}
                    </div>
                    <div className="text-xs text-slate-500">{slot.repName}</div>
                    {slot.notes && <div className="text-xs text-slate-600 pt-0.5">{slot.notes}</div>}
                  </div>
                  <div className="text-right font-mono tabular-nums text-xs shrink-0">
                    <div className="font-semibold text-green-700">{slot.date}</div>
                    <div className="text-slate-600">
                      {slot.time} {slot.timezone}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Webhook className="h-4 w-4 text-blue-700" />
              <span>CRM Webhook Sync Log</span>
            </h2>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {webhooks.length} events
            </span>
          </div>

          <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
            {webhooks.slice(0, 8).map((ev) => (
              <div key={ev.id} className="py-2.5 first:pt-0 last:pb-0 space-y-0.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium text-slate-900">
                    {ev.provider} · {ev.event}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {new Date(ev.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · <span className="text-green-700">{ev.status}</span>
                  </span>
                </div>
                <p className="text-slate-600">{ev.payloadSummary}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
