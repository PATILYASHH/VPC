import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import BanaDataGrid from './BanaDataGrid';
import BanaRowEditor from './BanaRowEditor';
import api from '@/lib/api';

export default function BanaTableEditor({ project }) {
  const [activeTable, setActiveTable] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;

  const { data: tablesData, isLoading: tablesLoading } = useApiQuery(
    ['bana-tables', project.id],
    `${baseUrl}/tables?schema=public`
  );

  const { data: columnsData } = useApiQuery(
    ['bana-columns', project.id, activeTable],
    `${baseUrl}/table/${activeTable}/columns?schema=public`,
    { enabled: !!activeTable }
  );

  const handleEditRow = (row) => {
    setEditRow(row);
    setShowEditor(true);
  };

  const handleNewRow = () => {
    setEditRow(null);
    setShowEditor(true);
  };

  const handleDeleteRow = async (row) => {
    if (!activeTable || !columnsData?.columns) return;
    const pkCol = columnsData.columns.find((c) => c.column_default?.includes('gen_random_uuid')) || columnsData.columns[0];
    const pkValue = row[pkCol.column_name];
    if (!confirm(`Delete row with ${pkCol.column_name} = ${pkValue}?`)) return;

    try {
      await api.delete(`${baseUrl}/table/${activeTable}/row/${pkValue}?schema=public&primaryKey=${pkCol.column_name}`);
      toast.success('Row deleted');
      queryClient.invalidateQueries({ queryKey: ['bana-table-data'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['bana-table-data'] });
    queryClient.invalidateQueries({ queryKey: ['bana-tables'] });
  };

  return (
    <div className="h-full flex">
      {/* Table list sidebar */}
      <div className="w-48 border-r flex flex-col bg-card/50">
        <div className="px-3 py-2 border-b">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">Tables</h3>
        </div>
        <div className="flex-1 overflow-auto">
          {tablesLoading ? (
            <div className="p-3 text-xs text-muted-foreground">Loading...</div>
          ) : tablesData?.tables?.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No tables yet. Use SQL Editor to create one.</div>
          ) : (
            tablesData?.tables?.map((t) => (
              <button
                key={t.table_name}
                onClick={() => setActiveTable(t.table_name)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                  activeTable === t.table_name ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'
                }`}
              >
                <div className="truncate">{t.table_name}</div>
                <div className="text-[10px] text-muted-foreground">{t.row_estimate} rows</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs text-muted-foreground">
            {activeTable ? `public.${activeTable}` : 'Select a table'}
          </span>
          {activeTable && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleNewRow}>
              <Plus className="w-3 h-3 mr-1" />
              Insert Row
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <BanaDataGrid
            projectId={project.id}
            table={activeTable}
            onEditRow={handleEditRow}
          />
        </div>
      </div>

      {/* Row editor */}
      <BanaRowEditor
        open={showEditor}
        onClose={() => setShowEditor(false)}
        projectId={project.id}
        table={activeTable}
        row={editRow}
        columns={columnsData?.columns}
        onSaved={handleSaved}
      />
    </div>
  );
}
