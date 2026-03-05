import { useState } from 'react';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

export default function BanaSqlEditor({ project }) {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const baseUrl = `/admin/bana/projects/${project.id}`;

  const executeQuery = async (confirm = false) => {
    if (!sql.trim()) return;
    setLoading(true);
    setError('');

    try {
      const { data } = await api.post(`${baseUrl}/query`, { sql: sql.trim(), confirm });

      if (data.requiresConfirmation) {
        if (window.confirm('This is a write operation (INSERT/UPDATE/DELETE/CREATE/etc). Execute?')) {
          await executeQuery(true);
          return;
        } else {
          setLoading(false);
          return;
        }
      }

      setResult(data);
      toast.success(`Query executed (${data.duration_ms}ms, ${data.rowCount} rows)`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            SQL Editor — {project.name}
          </span>
        </div>
        <textarea
          className="w-full h-36 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono resize-y"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={`-- Run SQL against ${project.slug}\nSELECT * FROM auth_users;\n\n-- Create a table:\n-- CREATE TABLE posts (id serial PRIMARY KEY, title text, body text, created_at timestamptz DEFAULT now());`}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              executeQuery();
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">Ctrl+Enter to execute</span>
          <Button size="sm" onClick={() => executeQuery()} disabled={loading || !sql.trim()}>
            <Play className="w-3.5 h-3.5 mr-1.5" />
            {loading ? 'Running...' : 'Execute'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 border-b">{error}</div>
      )}

      {result && (
        <div className="flex-1 overflow-auto">
          <div className="px-3 py-2 text-xs text-muted-foreground border-b bg-muted">
            {result.command} | {result.rowCount} rows | {result.duration_ms}ms
          </div>
          {result.rows?.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {result.fields?.map((f) => (
                    <th key={f.name} className="text-left p-2 font-medium text-muted-foreground border-b whitespace-nowrap">
                      {f.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-accent/30">
                    {result.fields?.map((f) => (
                      <td key={f.name} className="p-2 max-w-[300px] truncate font-mono">
                        {row[f.name] === null ? (
                          <span className="text-muted-foreground/50 italic">null</span>
                        ) : typeof row[f.name] === 'object' ? (
                          JSON.stringify(row[f.name])
                        ) : (
                          String(row[f.name])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-xs text-muted-foreground">Query executed successfully. No rows returned.</div>
          )}
        </div>
      )}
    </div>
  );
}
