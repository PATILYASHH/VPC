import { useState } from 'react';
import { ChevronDown, ChevronRight, Database, Table2, Columns3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

export default function SchemaTab({ project }) {
  const [expandedTable, setExpandedTable] = useState(null);

  const { data: schema, isLoading } = useApiQuery(
    ['sync-schema', project.id],
    `/admin/sync/projects/${project.id}/schema`
  );

  if (isLoading) return <LoadingSpinner />;

  if (!schema?.tables?.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No tables found in this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Database Schema &mdash; {schema.tables.length} tables
      </h3>

      {schema.tables.map(table => {
        const isExpanded = expandedTable === table.name;
        return (
          <div key={table.name} className="border rounded-lg bg-card overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
              onClick={() => setExpandedTable(isExpanded ? null : table.name)}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <Table2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono font-medium">{table.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">{table.columns.length} columns</span>
            </button>

            {isExpanded && (
              <div className="border-t">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Column</th>
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Nullable</th>
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map(col => (
                      <tr key={col.column_name} className="border-t border-border/50 hover:bg-accent/30">
                        <td className="px-4 py-1.5 font-mono flex items-center gap-2">
                          <Columns3 className="w-3 h-3 text-muted-foreground" />
                          {col.column_name}
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground font-mono">
                          {col.data_type}{col.character_maximum_length ? `(${col.character_maximum_length})` : ''}
                        </td>
                        <td className="px-4 py-1.5">
                          <Badge variant="outline" className={`text-xs ${col.is_nullable === 'YES' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}
                          </Badge>
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground font-mono text-xs truncate max-w-[200px]">
                          {col.column_default || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {table.constraints?.length > 0 && (
                  <div className="border-t p-3">
                    <span className="text-xs font-medium text-muted-foreground">Constraints</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {table.constraints.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {c.constraint_type}: {c.column_name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {table.indexes?.length > 0 && (
                  <div className="border-t p-3">
                    <span className="text-xs font-medium text-muted-foreground">Indexes</span>
                    <div className="space-y-1 mt-1">
                      {table.indexes.map((idx, i) => (
                        <div key={i} className="text-xs font-mono text-muted-foreground truncate">
                          {idx.indexname}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
