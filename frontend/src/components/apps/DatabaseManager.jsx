import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import SchemaSelector from '@/components/database/SchemaSelector';
import TableList from '@/components/database/TableList';
import DataGrid from '@/components/database/DataGrid';
import RowEditorDialog from '@/components/database/RowEditorDialog';
import SqlEditor from '@/components/database/SqlEditor';
import ImportDialog from '@/components/database/ImportDialog';
import ExportDialog from '@/components/database/ExportDialog';
import { useApiQuery } from '@/hooks/useApi';
import api from '@/lib/api';

export default function DatabaseManager() {
  const [schema, setSchema] = useState('public');
  const [activeTable, setActiveTable] = useState('');
  const [activeTab, setActiveTab] = useState('browse');
  const [editRow, setEditRow] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const queryClient = useQueryClient();

  const { data: columnsData } = useApiQuery(
    ['columns', schema, activeTable],
    `/admin/db/table/${activeTable}/columns?schema=${schema}`,
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
      await api.delete(`/admin/db/table/${activeTable}/row/${pkValue}?schema=${schema}&primaryKey=${pkCol.column_name}`);
      toast.success('Row deleted');
      queryClient.invalidateQueries({ queryKey: ['table-data'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['table-data'] });
    queryClient.invalidateQueries({ queryKey: ['tables'] });
  };

  return (
    <div className="h-full flex">
      {/* Left sidebar */}
      <div className="w-56 border-r flex flex-col bg-card">
        <SchemaSelector value={schema} onChange={setSchema} />
        <TableList schema={schema} activeTable={activeTable} onSelect={setActiveTable} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-3 pt-2">
            <TabsList className="h-8">
              <TabsTrigger value="browse" className="text-xs px-3 h-7">Browse</TabsTrigger>
              <TabsTrigger value="sql" className="text-xs px-3 h-7">SQL</TabsTrigger>
              <TabsTrigger value="import" className="text-xs px-3 h-7">Import</TabsTrigger>
              <TabsTrigger value="export" className="text-xs px-3 h-7">Export</TabsTrigger>
            </TabsList>

            {activeTab === 'browse' && activeTable && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleNewRow}>
                <Plus className="w-3 h-3 mr-1" />
                Insert Row
              </Button>
            )}
          </div>

          <TabsContent value="browse" className="flex-1 mt-0">
            <DataGrid
              schema={schema}
              table={activeTable}
              onEditRow={handleEditRow}
            />
          </TabsContent>

          <TabsContent value="sql" className="flex-1 mt-0">
            <SqlEditor />
          </TabsContent>

          <TabsContent value="import" className="mt-0">
            <ImportDialog table={activeTable} schema={schema} />
          </TabsContent>

          <TabsContent value="export" className="mt-0">
            <ExportDialog table={activeTable} schema={schema} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Row editor dialog */}
      <RowEditorDialog
        open={showEditor}
        onClose={() => setShowEditor(false)}
        schema={schema}
        table={activeTable}
        row={editRow}
        columns={columnsData?.columns}
        onSaved={handleSaved}
      />
    </div>
  );
}
