import { useState } from 'react';
import { Check, X, GitMerge, Wand2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Visual Conflict Viewer
 * Parses conflict markers and shows a friendly side-by-side comparison.
 * Non-programmers see "Your version" vs "Their version" with action buttons.
 */
export default function ConflictViewer({ conflicts, onResolve, resolving }) {
  const [expanded, setExpanded] = useState({});
  const [choices, setChoices] = useState({});

  if (!conflicts || conflicts.length === 0) return null;

  // Parse conflict markers from file content
  function parseConflicts(content) {
    if (!content || !content.includes('<<<<<<<')) return [];

    const sections = [];
    const lines = content.split('\n');
    let current = null;
    let inOurs = false;
    let inTheirs = false;

    for (const line of lines) {
      if (line.startsWith('<<<<<<< ')) {
        current = { ours: [], theirs: [] };
        inOurs = true;
        inTheirs = false;
      } else if (line === '=======') {
        inOurs = false;
        inTheirs = true;
      } else if (line.startsWith('>>>>>>> ')) {
        inTheirs = false;
        if (current) sections.push(current);
        current = null;
      } else if (inOurs && current) {
        current.ours.push(line);
      } else if (inTheirs && current) {
        current.theirs.push(line);
      }
    }
    return sections;
  }

  const toggleExpand = (path) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const setChoice = (path, sectionIdx, choice) => {
    setChoices(prev => ({
      ...prev,
      [path]: { ...(prev[path] || {}), [sectionIdx]: choice }
    }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <GitMerge className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium">Conflicts Found</span>
        <span className="text-[10px] text-muted-foreground/60 bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">
          {conflicts.length} file(s)
        </span>
      </div>

      <p className="text-xs text-muted-foreground/60 px-1">
        These files have changes from multiple people. Choose which version to keep, or let AI decide.
      </p>

      {conflicts.map((conflict, idx) => {
        const sections = parseConflicts(conflict.content);
        const isExpanded = expanded[conflict.path];

        return (
          <div key={idx} className="border border-white/[0.08] rounded-xl bg-white/[0.02] overflow-hidden">
            {/* File header */}
            <button
              onClick={() => toggleExpand(conflict.path)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span className="text-xs font-mono">{conflict.path}</span>
                <span className="text-[10px] text-amber-400/70">
                  {sections.length} conflict{sections.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground/40">{conflict.type}</span>
            </button>

            {/* Expanded conflict details */}
            {isExpanded && sections.length > 0 && (
              <div className="border-t border-white/[0.06]">
                {sections.map((section, sIdx) => {
                  const choice = choices[conflict.path]?.[sIdx];
                  return (
                    <div key={sIdx} className="border-b border-white/[0.04] last:border-0">
                      <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
                        {/* Your version (ours) */}
                        <div className={`p-3 ${choice === 'ours' ? 'bg-emerald-500/5' : ''}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-medium text-emerald-400">Your version</span>
                            <Button
                              size="sm"
                              variant={choice === 'ours' ? 'default' : 'outline'}
                              className={`h-5 text-[10px] px-2 ${choice === 'ours' ? 'bg-emerald-600 hover:bg-emerald-500' : 'border-white/[0.08]'}`}
                              onClick={() => setChoice(conflict.path, sIdx, 'ours')}
                            >
                              {choice === 'ours' ? <Check className="w-2.5 h-2.5 mr-1" /> : null}
                              Keep yours
                            </Button>
                          </div>
                          <pre className="text-[11px] text-muted-foreground/80 whitespace-pre-wrap font-mono leading-relaxed bg-white/[0.02] rounded p-2 max-h-40 overflow-auto">
                            {section.ours.join('\n') || '(empty)'}
                          </pre>
                        </div>

                        {/* Their version (theirs) */}
                        <div className={`p-3 ${choice === 'theirs' ? 'bg-blue-500/5' : ''}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-medium text-blue-400">Their version</span>
                            <Button
                              size="sm"
                              variant={choice === 'theirs' ? 'default' : 'outline'}
                              className={`h-5 text-[10px] px-2 ${choice === 'theirs' ? 'bg-blue-600 hover:bg-blue-500' : 'border-white/[0.08]'}`}
                              onClick={() => setChoice(conflict.path, sIdx, 'theirs')}
                            >
                              {choice === 'theirs' ? <Check className="w-2.5 h-2.5 mr-1" /> : null}
                              Keep theirs
                            </Button>
                          </div>
                          <pre className="text-[11px] text-muted-foreground/80 whitespace-pre-wrap font-mono leading-relaxed bg-white/[0.02] rounded p-2 max-h-40 overflow-auto">
                            {section.theirs.join('\n') || '(empty)'}
                          </pre>
                        </div>
                      </div>

                      {/* Keep both option */}
                      <div className="px-3 py-1.5 flex items-center gap-2 bg-white/[0.01]">
                        <Button
                          size="sm"
                          variant={choice === 'both' ? 'default' : 'outline'}
                          className={`h-5 text-[10px] px-2 ${choice === 'both' ? 'bg-violet-600' : 'border-white/[0.08]'}`}
                          onClick={() => setChoice(conflict.path, sIdx, 'both')}
                        >
                          Keep both (combined)
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick actions */}
            {isExpanded && (
              <div className="border-t border-white/[0.06] px-3 py-2 flex items-center gap-2 bg-white/[0.01]">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] border-white/[0.08]"
                  onClick={() => {
                    const allChoices = {};
                    sections.forEach((_, i) => { allChoices[i] = 'ours'; });
                    setChoices(prev => ({ ...prev, [conflict.path]: allChoices }));
                  }}
                >
                  Keep all yours
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] border-white/[0.08]"
                  onClick={() => {
                    const allChoices = {};
                    sections.forEach((_, i) => { allChoices[i] = 'theirs'; });
                    setChoices(prev => ({ ...prev, [conflict.path]: allChoices }));
                  }}
                >
                  Keep all theirs
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {/* Global actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={() => onResolve && onResolve('ai')}
          disabled={resolving}
          className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-xs h-8"
        >
          <Wand2 className="w-3 h-3 mr-1.5" />
          {resolving ? 'AI is resolving...' : 'Let AI resolve all'}
        </Button>
        {Object.keys(choices).length > 0 && (
          <Button
            onClick={() => onResolve && onResolve('manual', choices)}
            disabled={resolving}
            variant="outline"
            className="text-xs h-8 border-white/[0.08]"
          >
            <Check className="w-3 h-3 mr-1.5" />
            Apply my choices
          </Button>
        )}
      </div>
    </div>
  );
}
