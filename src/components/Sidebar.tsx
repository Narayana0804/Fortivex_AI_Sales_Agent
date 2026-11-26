import {
  BarChart3,
  BookOpen,
  Briefcase,
  Cpu,
  PhoneCall,
  X,
} from 'lucide-react';
import type { WorkspaceView } from '../types';

interface SidebarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  counts: {
    leads: number;
    booked: number;
    knowledge: number;
    calls: number;
  };
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceView;
  label: string;
  icon: typeof PhoneCall;
  countKey?: keyof SidebarProps['counts'];
}> = [
  { id: 'voice', label: 'Live Voice Agent', icon: PhoneCall },
  { id: 'crm', label: 'CRM & Bookings', icon: Briefcase, countKey: 'leads' },
  { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen, countKey: 'knowledge' },
  { id: 'insights', label: 'Insights & Calls', icon: BarChart3, countKey: 'calls' },
  { id: 'architecture', label: 'Architecture & Scale', icon: Cpu },
];

export function Sidebar({
  activeView,
  onSelectView,
  counts,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      <div className="flex h-16 items-center justify-between px-6 border-b border-slate-200">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
          Cadence
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav aria-label="Workspace sections" className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const count = item.countKey ? counts[item.countKey] : null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-blue-700' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {count !== null && (
                <span className="font-mono text-xs tabular-nums text-slate-400">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-500 space-y-1.5">
        <div className="flex items-center justify-between">
          <span>Booked Demos</span>
          <span className="font-mono font-medium text-slate-900 tabular-nums">
            {counts.booked}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Voice Models</span>
          <span className="font-mono text-slate-700">STT · LLM · TTS</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block lg:w-62 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <button
            type="button"
            aria-label="Close navigation backdrop"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-slate-900/30"
          />
          <div className="relative z-50 w-64 max-w-[80vw] h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}
