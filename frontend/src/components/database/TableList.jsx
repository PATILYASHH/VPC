import { useApiQuery } from '@/hooks/useApi';
import { Database } from 'lucide-react';

export default function TableList({ schema, activeTable, onSelect }) {
  const { data, isLoading } = useApiQuery(
    ['tables', schema],
    `/admin/db/tables?schema=${schema}`,
    { enabled: !!schema }
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-3 py-2 text-xs text-muted-foreground font-medium">
        Tables {data?.tables ? `(${data.tables.length})` : ''}
      </div>
      {isLoading ? (
        <div className="px-3 text-xs text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-0.5 px-1">
          {data?.tables?.map((t) => (
            <button
              key={t.table_name}
              onClick={() => onSelect(t.table_name)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                activeTable === t.table_name
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              <Database className="w-3 h-3 shrink-0" />
              <span className="truncate flex-1">{t.table_name}</span>
              <span className="text-[10px] opacity-60 shrink-0">{t.row_estimate}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
