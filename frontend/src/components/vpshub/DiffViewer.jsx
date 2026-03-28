import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

function parseDiff(rawDiff) {
  if (!rawDiff) return [];
  const files = [];
  const lines = rawDiff.split('\n');
  let currentFile = null;
  let currentHunk = null;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (currentFile) files.push(currentFile);
      currentFile = { header: line, path: '', hunks: [], expanded: true };
      currentHunk = null;
    } else if (line.startsWith('--- ') && currentFile) {
      // skip
    } else if (line.startsWith('+++ ') && currentFile) {
      currentFile.path = line.replace('+++ b/', '').replace('+++ /dev/null', '(deleted)');
    } else if (line.startsWith('@@') && currentFile) {
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
    } else if (currentHunk) {
      let type = 'context';
      if (line.startsWith('+')) type = 'add';
      else if (line.startsWith('-')) type = 'remove';
      currentHunk.lines.push({ text: line, type });
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

function DiffFile({ file }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const adds = file.hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'add').length, 0);
  const removes = file.hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'remove').length, 0);

  function copyPath() {
    navigator.clipboard.writeText(file.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="border rounded-lg mb-3 overflow-hidden">
      {/* File header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-accent/50 border-b cursor-pointer hover:bg-accent/70"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <span className="font-mono text-xs flex-1 truncate">{file.path}</span>
        <button onClick={e => { e.stopPropagation(); copyPath(); }} className="text-muted-foreground hover:text-foreground">
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <span className="text-xs text-green-500 font-mono">+{adds}</span>
        <span className="text-xs text-red-500 font-mono">-{removes}</span>
      </div>

      {/* Diff content */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono leading-5">
            <tbody>
              {file.hunks.map((hunk, hi) => {
                let oldLine = 0, newLine = 0;
                const match = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
                if (match) { oldLine = parseInt(match[1]) - 1; newLine = parseInt(match[2]) - 1; }

                return [
                  <tr key={`hunk-${hi}`} className="bg-blue-500/5">
                    <td colSpan={3} className="px-3 py-1 text-blue-400 select-none">{hunk.header}</td>
                  </tr>,
                  ...hunk.lines.map((line, li) => {
                    let leftNum = '', rightNum = '';
                    if (line.type === 'context') { oldLine++; newLine++; leftNum = oldLine; rightNum = newLine; }
                    else if (line.type === 'add') { newLine++; rightNum = newLine; }
                    else if (line.type === 'remove') { oldLine++; leftNum = oldLine; }

                    const bg = line.type === 'add' ? 'bg-green-500/10' : line.type === 'remove' ? 'bg-red-500/10' : '';
                    const textColor = line.type === 'add' ? 'text-green-400' : line.type === 'remove' ? 'text-red-400' : 'text-foreground/80';

                    return (
                      <tr key={`${hi}-${li}`} className={`${bg} hover:brightness-110`}>
                        <td className="w-10 text-right pr-2 select-none text-muted-foreground/50 border-r border-border/50">{leftNum}</td>
                        <td className="w-10 text-right pr-2 select-none text-muted-foreground/50 border-r border-border/50">{rightNum}</td>
                        <td className={`pl-3 pr-4 whitespace-pre ${textColor}`}>{line.text}</td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DiffViewer({ diff }) {
  const files = parseDiff(diff);

  if (!diff || files.length === 0) {
    return <div className="text-center py-6 text-sm text-muted-foreground">No changes to display</div>;
  }

  return (
    <div>
      {files.map((file, i) => (
        <DiffFile key={i} file={file} />
      ))}
    </div>
  );
}
