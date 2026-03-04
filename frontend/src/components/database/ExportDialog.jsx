import { useState } from 'react';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

export default function ExportDialog({ table, schema }) {
  const [format, setFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!table) return;
    setExporting(true);

    try {
      const response = await api.get('/admin/db/export', {
        params: { table, schema: schema || 'public', format },
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${table}_${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Export <strong>{table || 'selected table'}</strong> data
      </p>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" value="csv" checked={format === 'csv'} onChange={(e) => setFormat(e.target.value)} />
          CSV
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" value="xlsx" checked={format === 'xlsx'} onChange={(e) => setFormat(e.target.value)} />
          Excel (XLSX)
        </label>
      </div>

      <Button onClick={handleExport} disabled={!table || exporting} size="sm">
        <Download className="w-3.5 h-3.5 mr-1.5" />
        {exporting ? 'Exporting...' : 'Download'}
      </Button>
    </div>
  );
}
