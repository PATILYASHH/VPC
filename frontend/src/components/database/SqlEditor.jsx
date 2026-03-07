import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Play,
  ChevronDown,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sparkles,
  Copy,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

const TEMPLATES = [
  { label: 'Select all rows', sql: 'SELECT * FROM table_name LIMIT 100;' },
  {
    label: 'Create table',
    sql: `CREATE TABLE table_name (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Insert row',
    sql: `INSERT INTO table_name (name, email)
VALUES ('John', 'john@example.com')
RETURNING *;`,
  },
  {
    label: 'Update row',
    sql: `UPDATE table_name
SET name = 'new_value'
WHERE id = 1
RETURNING *;`,
  },
  { label: 'Delete row', sql: `DELETE FROM table_name WHERE id = 1;` },
  {
    label: 'Add column',
    sql: `ALTER TABLE table_name
ADD COLUMN new_column TEXT DEFAULT '';`,
  },
  {
    label: 'List all tables',
    sql: `SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;`,
  },
  {
    label: 'Table structure',
    sql: `SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'table_name'
ORDER BY ordinal_position;`,
  },
  {
    label: 'Table sizes',
    sql: `SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  n_live_tup AS row_estimate
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;`,
  },
];

const HISTORY_KEY = 'vpc-sql-history-admin';
const MAX_HISTORY = 50;

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(sql) {
  try {
    const list = getHistory();
    const filtered = list.filter((h) => h.sql !== sql);
    filtered.unshift({ sql, ts: Date.now() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
  } catch {}
}

function clearHistoryStorage() {
  localStorage.removeItem(HISTORY_KEY);
}

function getSuccessMessage(command, rowCount) {
  switch (command) {
    case 'CREATE':
      return 'Created successfully';
    case 'DROP':
      return 'Dropped successfully';
    case 'ALTER':
      return 'Altered successfully';
    case 'INSERT':
      return `${rowCount || 0} row${rowCount !== 1 ? 's' : ''} inserted`;
    case 'UPDATE':
      return `${rowCount || 0} row${rowCount !== 1 ? 's' : ''} updated`;
    case 'DELETE':
      return `${rowCount || 0} row${rowCount !== 1 ? 's' : ''} deleted`;
    case 'GRANT':
      return 'Permissions granted';
    case 'REVOKE':
      return 'Permissions revoked';
    case 'TRUNCATE':
      return 'Table truncated';
    default:
      return 'Query executed successfully. No rows returned.';
  }
}

export default function SqlEditor() {
  const [sql, setSql] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef(null);
  const templatesRef = useRef(null);
  const historyRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (templatesRef.current && !templatesRef.current.contains(e.target)) setShowTemplates(false);
      if (historyRef.current && !historyRef.current.contains(e.target)) setShowHistory(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const executeQuery = useCallback(
    async (confirm = false) => {
      if (!sql.trim()) return;
      setLoading(true);

      try {
        const { data } = await api.post('/admin/db/query', { sql: sql.trim(), confirm });

        if (data.requiresConfirmation) {
          if (
            window.confirm(
              'This will execute a write operation (CREATE / INSERT / UPDATE / DELETE / etc). Continue?'
            )
          ) {
            await executeQuery(true);
            return;
          }
          setLoading(false);
          return;
        }

        if (data.results) {
          setResults(data);
          setActiveResultIdx(0);
          const total = data.results.length;
          const success = data.results.filter((r) => r.success).length;
          if (success === total) {
            toast.success(
              `${total} statement${total > 1 ? 's' : ''} executed (${data.duration_ms}ms)`
            );
          } else {
            toast.error(`${total - success} of ${total} statement${total > 1 ? 's' : ''} failed`);
          }
        } else {
          setResults({
            results: [{ ...data, success: true, sql: sql.trim() }],
            duration_ms: data.duration_ms,
          });
          setActiveResultIdx(0);
          toast.success(`Query executed (${data.duration_ms}ms)`);
        }

        saveToHistory(sql.trim());
      } catch (err) {
        const errorMsg = err.response?.data?.error || err.message;
        setResults({
          results: [
            {
              success: false,
              error: errorMsg,
              rows: [],
              fields: [],
              rowCount: 0,
              command: null,
              duration_ms: 0,
              sql: sql.trim(),
            },
          ],
          duration_ms: 0,
        });
        setActiveResultIdx(0);
        toast.error(errorMsg);
      } finally {
        setLoading(false);
      }
    },
    [sql]
  );

  const history = getHistory();
  const activeResult = results?.results?.[activeResultIdx];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-card">
        <span className="text-xs font-medium text-muted-foreground">SQL Editor</span>
        <div className="flex items-center gap-1">
          <div className="relative" ref={templatesRef}>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => {
                setShowTemplates(!showTemplates);
                setShowHistory(false);
              }}
            >
              <Sparkles className="w-3 h-3" />
              Templates
              <ChevronDown className="w-3 h-3" />
            </Button>
            {showTemplates && (
              <div className="absolute right-0 top-8 z-50 w-56 rounded-md border bg-popover shadow-lg">
                <div className="p-1">
                  {TEMPLATES.map((t, i) => (
                    <button
                      key={i}
                      className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                      onClick={() => {
                        setSql(t.sql);
                        setShowTemplates(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative" ref={historyRef}>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={() => {
                setShowHistory(!showHistory);
                setShowTemplates(false);
              }}
            >
              <Clock className="w-3 h-3" />
              History
              <ChevronDown className="w-3 h-3" />
            </Button>
            {showHistory && (
              <div className="absolute right-0 top-8 z-50 w-80 max-h-72 rounded-md border bg-popover shadow-lg flex flex-col">
                {history.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 border-b">
                    <span className="text-[10px] text-muted-foreground">
                      {history.length} queries
                    </span>
                    <button
                      className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                      onClick={() => {
                        clearHistoryStorage();
                        setShowHistory(false);
                      }}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                      Clear
                    </button>
                  </div>
                )}
                <div className="overflow-y-auto p-1">
                  {history.length === 0 ? (
                    <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                      No history yet
                    </div>
                  ) : (
                    history.map((h, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-3 py-2 text-xs rounded hover:bg-accent transition-colors"
                        onClick={() => {
                          setSql(h.sql);
                          setShowHistory(false);
                          textareaRef.current?.focus();
                        }}
                      >
                        <div className="font-mono truncate text-[11px]">{h.sql}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(h.ts).toLocaleString()}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="border-b">
        <textarea
          ref={textareaRef}
          className="w-full min-h-[160px] max-h-[400px] px-4 py-3 text-sm font-mono bg-background resize-y focus:outline-none border-0"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={`-- Write your SQL here\n-- Ctrl+Enter to execute\n\nSELECT * FROM users LIMIT 10;`}
          spellCheck={false}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              executeQuery();
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              const start = e.target.selectionStart;
              const end = e.target.selectionEnd;
              const newSql = sql.substring(0, start) + '  ' + sql.substring(end);
              setSql(newSql);
              setTimeout(() => {
                e.target.selectionStart = e.target.selectionEnd = start + 2;
              }, 0);
            }
          }}
        />
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-t">
          <span className="text-[10px] text-muted-foreground">
            Ctrl+Enter to run &bull; Tab to indent &bull; Separate statements with ;
          </span>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => executeQuery()}
            disabled={loading || !sql.trim()}
          >
            {loading ? (
              <RotateCcw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {loading ? 'Running...' : 'Run'}
          </Button>
        </div>
      </div>

      {/* Results */}
      {results && (
        <div className="flex-1 flex flex-col min-h-0">
          {results.results.length > 1 && (
            <div className="flex items-center gap-0.5 px-3 py-1 border-b bg-muted/30 overflow-x-auto">
              {results.results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => setActiveResultIdx(i)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                    activeResultIdx === i
                      ? 'bg-background text-foreground shadow-sm border'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.success ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-500" />
                  )}
                  {r.command || 'Error'} #{i + 1}
                </button>
              ))}
            </div>
          )}

          {activeResult && (
            <>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b ${
                  activeResult.success
                    ? 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                    : 'bg-red-500/5 text-red-700 dark:text-red-400'
                }`}
              >
                {activeResult.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="font-medium">
                  {activeResult.success ? 'Success' : 'Error'}
                </span>
                {activeResult.command && (
                  <>
                    <span className="text-muted-foreground">&bull;</span>
                    <span>{activeResult.command}</span>
                  </>
                )}
                {activeResult.rowCount != null && (
                  <>
                    <span className="text-muted-foreground">&bull;</span>
                    <span>
                      {activeResult.rowCount} row{activeResult.rowCount !== 1 ? 's' : ''}
                      {activeResult.command === 'SELECT' ? ' returned' : ' affected'}
                    </span>
                  </>
                )}
                {activeResult.duration_ms != null && (
                  <>
                    <span className="text-muted-foreground">&bull;</span>
                    <span>{activeResult.duration_ms}ms</span>
                  </>
                )}
                {activeResult.success && activeResult.rows?.length > 0 && (
                  <button
                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy rows as JSON"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(activeResult.rows, null, 2));
                      toast.success('Copied to clipboard');
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {!activeResult.success && activeResult.error && (
                <div className="px-4 py-3 text-sm text-red-700 dark:text-red-400 bg-red-500/5 border-b font-mono whitespace-pre-wrap">
                  {activeResult.error}
                </div>
              )}

              {activeResult.success && activeResult.rows?.length > 0 ? (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted z-10">
                      <tr>
                        <th className="text-center p-2 font-medium text-muted-foreground border-b border-r w-10">
                          #
                        </th>
                        {activeResult.fields?.map((f) => (
                          <th
                            key={f.name}
                            className="text-left p-2 font-medium text-muted-foreground border-b whitespace-nowrap"
                          >
                            {f.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeResult.rows.map((row, i) => (
                        <tr key={i} className="border-b hover:bg-accent/30 transition-colors">
                          <td className="p-2 text-center text-muted-foreground/50 border-r text-[10px]">
                            {i + 1}
                          </td>
                          {activeResult.fields?.map((f) => (
                            <td key={f.name} className="p-2 max-w-[300px] truncate font-mono">
                              {row[f.name] === null ? (
                                <span className="text-muted-foreground/40 italic">NULL</span>
                              ) : typeof row[f.name] === 'boolean' ? (
                                <span
                                  className={
                                    row[f.name]
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-500 dark:text-red-400'
                                  }
                                >
                                  {String(row[f.name])}
                                </span>
                              ) : typeof row[f.name] === 'object' ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {JSON.stringify(row[f.name])}
                                </span>
                              ) : (
                                String(row[f.name])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : activeResult.success ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center py-8">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {getSuccessMessage(activeResult.command, activeResult.rowCount)}
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {!results && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Write a query and press{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-muted border text-foreground text-[11px] font-mono">
                Ctrl+Enter
              </kbd>{' '}
              to execute
            </p>
            <p className="text-xs text-muted-foreground/60">
              or use Templates above for common queries
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
