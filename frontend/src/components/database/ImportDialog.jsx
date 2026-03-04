import { useState } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

export default function ImportDialog({ table, schema }) {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!file || !table) return;
    setImporting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('table', table);
      formData.append('schema', schema || 'public');

      const { data } = await api.post('/admin/db/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(data);
      toast.success(`Imported ${data.inserted} of ${data.total} rows`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Import CSV or Excel file into <strong>{table || 'selected table'}</strong>
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => setFile(e.target.files[0])}
          className="text-sm"
        />
      </div>

      <Button onClick={handleImport} disabled={!file || !table || importing} size="sm">
        <Upload className="w-3.5 h-3.5 mr-1.5" />
        {importing ? 'Importing...' : 'Import'}
      </Button>

      {result && (
        <div className="text-xs space-y-1">
          <p className="text-success">Inserted: {result.inserted} / {result.total}</p>
          {result.errors?.length > 0 && (
            <div className="text-destructive">
              <p>Errors ({result.errors.length}):</p>
              <ul className="list-disc pl-4 max-h-40 overflow-auto">
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>Row {e.row}: {e.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
