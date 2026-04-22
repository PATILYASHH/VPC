import { X, GripVertical } from 'lucide-react';

export default function WidgetShell({ title, icon: Icon, action, onRemove, children, className = '' }) {
  return (
    <div
      className={`group relative rounded-xl border overflow-hidden flex flex-col ${className}`}
      style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}
    >
      <div
        className="h-8 px-3 flex items-center gap-2 border-b shrink-0"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <GripVertical className="w-3 h-3 opacity-30 widget-drag-handle cursor-move" />
        {Icon && <Icon className="w-3 h-3 opacity-60" />}
        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70 flex-1 truncate" style={{ color: 'var(--text-on-surface)' }}>
          {title}
        </span>
        {action}
        {onRemove && (
          <button
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-50 hover:opacity-100 hover:text-rose-400"
            title="Remove from dashboard"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
