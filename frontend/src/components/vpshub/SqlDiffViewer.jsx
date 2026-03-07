import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';

const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|COLUMN|ADD|MODIFY|RENAME|SET|WHERE|FROM|JOIN|ON|INTO|VALUES|DEFAULT|NOT NULL|NULL|PRIMARY KEY|REFERENCES|CASCADE|UNIQUE|CHECK|IF EXISTS|IF NOT EXISTS|CONSTRAINT|FOREIGN KEY|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|TRIGGER|FUNCTION|RETURNS|SECURITY DEFINER|EXECUTE|REPLACE|VIEW|SCHEMA|TYPE|ENUM|SEQUENCE|AS|OR|AND|IN|WITH|RETURNS|LANGUAGE|DECLARE|RETURN|NEW|OLD|FOR EACH ROW|AFTER|BEFORE|ON DELETE|ON UPDATE)\b/gi;

function highlightSQL(sql) {
  if (!sql) return null;

  return sql.split('\n').map((line, i) => {
    const isComment = line.trimStart().startsWith('--');

    if (isComment) {
      return (
        <div key={i} className="table-row">
          <span className="table-cell pr-4 text-right text-muted-foreground/40 select-none w-10 align-top">{i + 1}</span>
          <span className="table-cell text-muted-foreground/60 italic">{line}</span>
        </div>
      );
    }

    const parts = [];
    let lastIndex = 0;
    const regex = new RegExp(SQL_KEYWORDS.source, 'gi');
    let match;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`t-${i}-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
      }
      parts.push(
        <span key={`k-${i}-${match.index}`} className="text-blue-400 font-semibold">
          {match[0]}
        </span>
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < line.length) {
      parts.push(<span key={`e-${i}-${lastIndex}`}>{line.slice(lastIndex)}</span>);
    }
    if (parts.length === 0) parts.push(<span key={`empty-${i}`}>{' '}</span>);

    return (
      <div key={i} className="table-row hover:bg-accent/30">
        <span className="table-cell pr-4 text-right text-muted-foreground/40 select-none w-10 align-top">{i + 1}</span>
        <span className="table-cell">{parts}</span>
      </div>
    );
  });
}

export default function SqlDiffViewer({ sql, title, maxHeight = '400px' }) {
  if (!sql) return null;

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      {title && (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => copyToClipboard(sql)}
          >
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
        </div>
      )}
      <div
        className="overflow-auto font-mono text-xs p-3"
        style={{ maxHeight }}
      >
        <div className="table w-full">
          {highlightSQL(sql)}
        </div>
      </div>
    </div>
  );
}
