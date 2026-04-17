import { useState } from 'react';
import { ChevronDown, ChevronRight, Table2, Plus, Pencil, Minus, Code2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function SchemaDiffViewer({ diff, sql }) {
  const [expandedTables, setExpandedTables] = useState(new Set());
  const [showSql, setShowSql] = useState(false);

  if (!diff) return null;

  const toggleTable = (name) => {
    const next = new Set(expandedTables);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedTables(next);
  };

  const hasChanges = diff.newTables.length > 0 || diff.modifiedTables.length > 0 || diff.droppedTables.length > 0;

  if (!hasChanges) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Table2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No schema differences found</p>
        <p className="text-xs mt-1">Both databases have identical schemas</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-2">
        {diff.summary.newTables > 0 && (
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            <Plus className="w-3 h-3 mr-1" /> {diff.summary.newTables} new table{diff.summary.newTables > 1 ? 's' : ''}
          </Badge>
        )}
        {diff.summary.newColumns > 0 && (
          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
            <Plus className="w-3 h-3 mr-1" /> {diff.summary.newColumns} new column{diff.summary.newColumns > 1 ? 's' : ''}
          </Badge>
        )}
        {diff.summary.newIndexes > 0 && (
          <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20">
            <Plus className="w-3 h-3 mr-1" /> {diff.summary.newIndexes} new index{diff.summary.newIndexes > 1 ? 'es' : ''}
          </Badge>
        )}
        {diff.summary.droppedTables > 0 && (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
            <Minus className="w-3 h-3 mr-1" /> {diff.summary.droppedTables} dropped table{diff.summary.droppedTables > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* New Tables */}
      {diff.newTables.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-semibold px-1">New Tables</p>
          {diff.newTables.map((table) => (
            <div key={table.name} className="border rounded-lg overflow-hidden border-emerald-500/20">
              <button
                onClick={() => toggleTable(`new-${table.name}`)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-emerald-500/5 transition-colors"
              >
                {expandedTables.has(`new-${table.name}`)
                  ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                }
                <Table2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium font-mono">{table.name}</span>
                <span className="text-muted-foreground/60 ml-auto">{table.columns.length} columns</span>
              </button>
              {expandedTables.has(`new-${table.name}`) && (
                <div className="border-t border-emerald-500/10 px-3 py-2 space-y-0.5 bg-emerald-500/[0.02]">
                  {table.columns.map((col) => (
                    <div key={col.column_name} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span className="text-emerald-400/60 w-3">+</span>
                      <span className="font-mono font-medium">{col.column_name}</span>
                      <span className="text-muted-foreground font-mono">{col.data_type}</span>
                      {col.is_nullable === 'NO' && <Badge variant="outline" className="text-[9px] py-0 px-1">NOT NULL</Badge>}
                      {col.column_default && <span className="text-muted-foreground/50 text-[10px]">default: {col.column_default}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modified Tables */}
      {diff.modifiedTables.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-blue-400/70 font-semibold px-1">Modified Tables</p>
          {diff.modifiedTables.map((table) => (
            <div key={table.name} className="border rounded-lg overflow-hidden border-blue-500/20">
              <button
                onClick={() => toggleTable(`mod-${table.name}`)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-blue-500/5 transition-colors"
              >
                {expandedTables.has(`mod-${table.name}`)
                  ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                }
                <Pencil className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-medium font-mono">{table.name}</span>
                <span className="text-muted-foreground/60 ml-auto">
                  {table.addedColumns.length > 0 && `+${table.addedColumns.length} cols`}
                  {table.addedIndexes.length > 0 && ` +${table.addedIndexes.length} idx`}
                </span>
              </button>
              {expandedTables.has(`mod-${table.name}`) && (
                <div className="border-t border-blue-500/10 px-3 py-2 space-y-0.5 bg-blue-500/[0.02]">
                  {table.addedColumns.map((col) => (
                    <div key={col.column_name} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span className="text-emerald-400/60 w-3">+</span>
                      <span className="font-mono font-medium">{col.column_name}</span>
                      <span className="text-muted-foreground font-mono">{col.data_type}</span>
                      {col.is_nullable === 'NO' && <Badge variant="outline" className="text-[9px] py-0 px-1">NOT NULL</Badge>}
                    </div>
                  ))}
                  {table.droppedColumns.map((col) => (
                    <div key={col.column_name} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span className="text-red-400/60 w-3">-</span>
                      <span className="font-mono font-medium text-red-400/70 line-through">{col.column_name}</span>
                    </div>
                  ))}
                  {table.modifiedColumns.map((col) => (
                    <div key={col.column_name} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span className="text-amber-400/60 w-3">~</span>
                      <span className="font-mono font-medium">{col.column_name}</span>
                      <span className="text-muted-foreground/50">{col.from.data_type}</span>
                      <span className="text-muted-foreground/40">&rarr;</span>
                      <span className="text-amber-400 font-mono">{col.to.data_type}</span>
                    </div>
                  ))}
                  {table.addedIndexes.map((idx) => (
                    <div key={idx.indexname} className="flex items-center gap-2 text-[11px] py-0.5">
                      <span className="text-violet-400/60 w-3">+</span>
                      <span className="font-mono text-muted-foreground">{idx.indexname}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dropped Tables */}
      {diff.droppedTables.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-red-400/70 font-semibold px-1">Dropped Tables (in beta)</p>
          {diff.droppedTables.map((table) => (
            <div key={table.name} className="flex items-center gap-2 px-3 py-2 text-xs border rounded-lg border-red-500/20">
              <Minus className="w-3.5 h-3.5 text-red-400" />
              <span className="font-mono text-red-400/70 line-through">{table.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* SQL Preview */}
      {sql && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowSql(!showSql)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/50 transition-colors"
          >
            {showSql
              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            }
            <Code2 className="w-3.5 h-3.5 text-primary" />
            <span className="font-medium">Migration SQL</span>
            <span className="text-muted-foreground/60 ml-auto">{sql.split('\n').filter(l => l.trim()).length} lines</span>
          </button>
          {showSql && (
            <div className="border-t">
              <pre className="text-[11px] font-mono p-3 overflow-auto max-h-60 bg-muted/30 whitespace-pre-wrap">
                {sql}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
