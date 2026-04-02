import { useState } from 'react';
import { Sparkles, CheckCircle2, XCircle, Loader2, FileCode, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function VPAIResolver({ owner, repo, prNumber, conflicts, onResolved, onClose }) {
  const [phase, setPhase] = useState('idle'); // idle | analyzing | ready | applying | done
  const [resolutions, setResolutions] = useState([]);
  const [approved, setApproved] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());

  async function analyze() {
    setPhase('analyzing');
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/ai-resolve`);

      if (data.resolved) {
        toast.success('No conflicts found — PR is clean!');
        onResolved();
        return;
      }

      const res = data.resolutions || [];
      setResolutions(res);
      // Auto-approve high confidence resolutions
      const autoApproved = new Set();
      res.forEach((r, i) => {
        if (r.resolution?.confidence === 'high' || r.confidence === 'high') {
          autoApproved.add(i);
        }
      });
      setApproved(autoApproved);
      setPhase('ready');
    } catch (err) {
      toast.error(err.response?.data?.error || 'VPAI analysis failed');
      setPhase('idle');
    }
  }

  async function applyResolutions() {
    setPhase('applying');
    const approvedPaths = resolutions
      .filter((_, i) => approved.has(i))
      .map(r => r.path);

    if (approvedPaths.length === 0) {
      toast.error('Select at least one resolution to apply');
      setPhase('ready');
      return;
    }

    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/ai-auto-resolve`, {
        approved: approvedPaths,
      });

      if (data.applied > 0) {
        toast.success(`VPAI resolved ${data.applied} conflict(s)!`);
        setPhase('done');
        setTimeout(() => onResolved(), 1500);
      } else {
        toast.error('No resolutions could be applied');
        setPhase('ready');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to apply resolutions');
      setPhase('ready');
    }
  }

  function toggleApproval(index) {
    setApproved(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleExpand(index) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const approvedCount = approved.size;

  return (
    <div className="border border-violet-500/20 rounded-lg bg-violet-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet-500/15">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-violet-300">VPAI Conflict Resolver</span>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>

      <div className="p-4">
        {/* Idle state — prompt to start */}
        {phase === 'idle' && (
          <div className="text-center py-4">
            <Sparkles className="w-8 h-8 text-violet-400 mx-auto mb-3" />
            <div className="text-sm font-medium mb-1">
              {conflicts.length} file{conflicts.length !== 1 ? 's' : ''} with conflicts
            </div>
            <div className="text-xs text-muted-foreground mb-4">
              VPAI will analyze each conflict and suggest the best resolution.
              You'll review and approve before anything is applied.
            </div>
            <Button onClick={analyze} className="bg-violet-600 hover:bg-violet-700">
              <Sparkles className="w-4 h-4 mr-1.5" /> Analyze Conflicts
            </Button>
          </div>
        )}

        {/* Analyzing */}
        {phase === 'analyzing' && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-violet-400 mx-auto mb-3 animate-spin" />
            <div className="text-sm font-medium text-violet-300">VPAI is analyzing conflicts...</div>
            <div className="text-xs text-muted-foreground mt-1">This may take a moment for complex files</div>
          </div>
        )}

        {/* Ready — show resolutions */}
        {phase === 'ready' && (
          <div className="space-y-3">
            {resolutions.map((res, i) => {
              const resolution = res.resolution || res;
              const isApproved = approved.has(i);
              const isExpanded = expanded.has(i);
              const confidence = resolution.confidence || 'medium';
              const summary = resolution.plain_summary || resolution.strategy || 'AI merged both changes';

              return (
                <div key={i} className={`border rounded-lg overflow-hidden transition-colors ${
                  isApproved ? 'border-green-500/30 bg-green-500/5' : 'border-white/[0.08] bg-white/[0.02]'
                }`}>
                  {/* File header */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button onClick={() => toggleExpand(i)} className="text-muted-foreground hover:text-foreground">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <FileCode className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-mono flex-1">{res.path}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${
                      confidence === 'high' ? 'bg-green-500/15 text-green-400 border-green-500/30' :
                      confidence === 'medium' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                      'bg-red-500/15 text-red-400 border-red-500/30'
                    }`}>
                      {confidence}
                    </span>
                    <button
                      onClick={() => toggleApproval(i)}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        isApproved
                          ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                          : 'bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1]'
                      }`}
                    >
                      {isApproved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {isApproved ? 'Approved' : 'Approve'}
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-white/[0.06]">
                      <div className="mt-2.5 p-3 rounded-md bg-white/[0.03] text-sm">
                        <div className="text-xs font-medium text-muted-foreground mb-1">What happened:</div>
                        <div className="text-foreground">{summary}</div>
                      </div>
                      {resolution.changes_made?.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {resolution.changes_made.map((change, j) => (
                            <div key={j} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                change.side_chosen === 'yours' ? 'bg-blue-500/15 text-blue-400' :
                                change.side_chosen === 'theirs' ? 'bg-orange-500/15 text-orange-400' :
                                'bg-violet-500/15 text-violet-400'
                              }`}>
                                {change.side_chosen}
                              </span>
                              <span>{change.description}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Apply button */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                {approvedCount} of {resolutions.length} resolution{resolutions.length !== 1 ? 's' : ''} approved
              </div>
              <Button
                onClick={applyResolutions}
                disabled={approvedCount === 0}
                className="bg-violet-600 hover:bg-violet-700"
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                Apply {approvedCount} Resolution{approvedCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* Applying */}
        {phase === 'applying' && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-violet-400 mx-auto mb-3 animate-spin" />
            <div className="text-sm font-medium text-violet-300">Applying resolutions...</div>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-3" />
            <div className="text-sm font-medium text-green-400">Conflicts resolved!</div>
            <div className="text-xs text-muted-foreground mt-1">The PR is being refreshed...</div>
          </div>
        )}
      </div>
    </div>
  );
}
