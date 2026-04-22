import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  X, ArrowUpRight, AlertTriangle, CheckCircle2, Loader2, Shield, Rocket,
  Database, Globe, Clock, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { subscribe } from '@/lib/realtime';

const STAGES = [
  { key: 'backup', label: 'Snapshot prod DB', icon: Shield },
  { key: 'schema', label: 'Apply schema changes', icon: Database },
  { key: 'deploy', label: 'Redeploy prod sites', icon: Globe },
];

export default function PromoteDialog({ pipeline, onClose, onComplete }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('review'); // review | confirm | running | done | failed
  const [confirmations, setConfirmations] = useState({ schema: true, deploy: true });
  const [skipBackup, setSkipBackup] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState('');
  const [runState, setRunState] = useState({ stages: {}, runId: null, error: null, result: null });

  // Load preflight plan
  useEffect(() => {
    let alive = true;
    api.get(`/admin/pipeline/pipelines/${pipeline.id}/promote/preflight`)
      .then(({ data }) => { if (alive) setPlan(data.plan); })
      .catch(err => { if (alive) { toast.error(err.response?.data?.error || 'Preflight failed'); onClose(); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pipeline.id]);

  // Subscribe to progress events
  useEffect(() => {
    if (step !== 'running') return;
    const unsub = subscribe(`pipeline:promote:${pipeline.id}`, ({ payload }) => {
      if (payload.stage) {
        setRunState(prev => ({
          ...prev,
          runId: payload.run_id || prev.runId,
          stages: { ...prev.stages, [payload.stage]: { status: payload.status, ...payload } },
        }));
      }
      if (payload.status === 'success' || payload.status === 'partial') {
        setStep('done');
      } else if (payload.status === 'failed') {
        setStep('failed');
        setRunState(prev => ({ ...prev, error: payload.error }));
      }
    });
    return unsub;
  }, [step, pipeline.id]);

  async function execute() {
    setStep('running');
    setRunState({ stages: {}, runId: null, error: null });
    try {
      const { data } = await api.post(`/admin/pipeline/pipelines/${pipeline.id}/promote`, {
        confirmations,
        skipBackup,
      });
      setRunState(prev => ({ ...prev, result: data, runId: data.run_id }));
      if (data.status === 'failed') setStep('failed');
      else setStep('done');
    } catch (err) {
      setStep('failed');
      setRunState(prev => ({ ...prev, error: err.response?.data?.error || err.message }));
    }
  }

  async function rollback() {
    if (!runState.runId) return;
    if (!confirm('Restore the pre-promote snapshot? This will overwrite current prod DB.')) return;
    try {
      await api.post(`/admin/pipeline/pipelines/${pipeline.id}/promotions/${runState.runId}/rollback`);
      toast.success('Rolled back to pre-promote snapshot');
      onComplete?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Rollback failed');
    }
  }

  function close() {
    if (step === 'running') {
      if (!confirm('Promotion is running. Close anyway? It will continue in the background.')) return;
    }
    if (step === 'done') onComplete?.();
    onClose();
  }

  const expected = pipeline.name.toLowerCase().replace(/\s+/g, '-');
  const typedOk = step !== 'confirm' || typedConfirm.trim() === expected || typedConfirm.trim() === 'promote';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={close}>
      <div
        className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl mx-4 max-h-[90vh] flex flex-col"
        style={{ borderColor: 'var(--surface-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Rocket className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Promote Beta → Production</h3>
              <p className="text-[10px] text-muted-foreground">{pipeline.name}</p>
            </div>
          </div>
          <button onClick={close} className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {loading ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
              Analyzing changes…
            </div>
          ) : step === 'review' && plan ? (
            <ReviewStep plan={plan} confirmations={confirmations} setConfirmations={setConfirmations} skipBackup={skipBackup} setSkipBackup={setSkipBackup} />
          ) : step === 'confirm' ? (
            <ConfirmStep plan={plan} expected={expected} typedConfirm={typedConfirm} setTypedConfirm={setTypedConfirm} skipBackup={skipBackup} />
          ) : step === 'running' || step === 'done' || step === 'failed' ? (
            <RunStep plan={plan} runState={runState} step={step} skipBackup={skipBackup} />
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--surface-border)' }}>
          {step === 'review' && (
            <>
              <Button variant="ghost" onClick={close} className="text-xs">Cancel</Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={plan?.blockers?.length > 0 || loading || (!plan?.schema?.hasChanges && plan?.hosting?.redeployCount === 0)}
                className="text-xs bg-emerald-600 hover:bg-emerald-500"
              >
                <ArrowUpRight className="w-3.5 h-3.5 mr-1.5" /> Continue
              </Button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <Button variant="ghost" onClick={() => setStep('review')} className="text-xs">Back</Button>
              <Button
                onClick={execute}
                disabled={!typedOk}
                className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
              >
                <Rocket className="w-3.5 h-3.5 mr-1.5" /> Promote to Production
              </Button>
            </>
          )}
          {step === 'running' && (
            <>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Running…
              </div>
              <Button variant="ghost" onClick={close} className="text-xs">Close (runs in background)</Button>
            </>
          )}
          {step === 'done' && (
            <>
              {runState.runId && (
                <Button variant="outline" onClick={rollback} className="text-xs">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Rollback
                </Button>
              )}
              <Button onClick={close} className="text-xs">Done</Button>
            </>
          )}
          {step === 'failed' && (
            <>
              {runState.runId && (
                <Button variant="outline" onClick={rollback} className="text-xs">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore Snapshot
                </Button>
              )}
              <Button onClick={close} variant="outline" className="text-xs">Close</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step: Review ──────────────────────────────────────────

function ReviewStep({ plan, confirmations, setConfirmations, skipBackup, setSkipBackup }) {
  const s = plan.schema;
  const h = plan.hosting;
  const b = plan.backup;

  return (
    <div className="space-y-3">
      {plan.blockers.length > 0 && (
        <div className="rounded-lg p-3 bg-rose-500/10 border border-rose-500/30">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold mb-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Cannot promote
          </div>
          {plan.blockers.map((b, i) => <div key={i} className="text-[11px] text-rose-400">{b}</div>)}
        </div>
      )}

      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
        Changes to apply
      </div>

      {/* Schema */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)' }}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmations.schema}
            disabled={!s.hasChanges}
            onChange={e => setConfirmations({ ...confirmations, schema: e.target.checked })}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold">Schema migration</span>
              {s.hasChanges ? (
                <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[9px]">
                  {s.summary.newTables} tables · {s.summary.newColumns} cols
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px]">No changes</Badge>
              )}
            </div>
            {s.hasChanges && (
              <div className="mt-2">
                <div className="text-[10px] text-muted-foreground mb-1">SQL preview:</div>
                <pre className="text-[10px] font-mono bg-black/40 p-2 rounded max-h-28 overflow-auto whitespace-pre-wrap">
                  {s.sql.slice(0, 500)}{s.sql.length > 500 ? '\n…' : ''}
                </pre>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Hosting */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)' }}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmations.deploy}
            disabled={h.redeployCount === 0}
            onChange={e => setConfirmations({ ...confirmations, deploy: e.target.checked })}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold">Redeploy production sites</span>
              <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[9px]">
                {h.redeployCount}
              </Badge>
            </div>
            {h.sites.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1">
                {h.sites.map(s => s.name).join(', ')}
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Backup status */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="flex items-start gap-3">
          <Shield className="w-4 h-4 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Auto-snapshot prod DB</span>
              <label className="text-[10px] flex items-center gap-1 cursor-pointer text-muted-foreground">
                <input type="checkbox" checked={skipBackup} onChange={e => setSkipBackup(e.target.checked)} />
                Skip
              </label>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {b.lastAt ? (
                <>Last backup: <Clock className="inline w-2.5 h-2.5" /> {b.ageMinutes}m ago {b.stale && <span className="text-amber-400">(stale)</span>}</>
              ) : (
                <span className="text-amber-400">No prior backup found</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {plan.warnings.length > 0 && (
        <div className="text-[10px] text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <div>{plan.warnings.join(' · ')}</div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Confirm ─────────────────────────────────────────

function ConfirmStep({ plan, expected, typedConfirm, setTypedConfirm, skipBackup }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg p-3 bg-amber-500/5 border border-amber-500/30">
        <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold mb-2">
          <AlertTriangle className="w-4 h-4" /> Final confirmation
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          You're about to modify <b className="text-foreground">production</b>. This will apply
          {plan.schema.hasChanges && ` ${plan.schema.summary.newTables} table + ${plan.schema.summary.newColumns} column changes`}
          {plan.schema.hasChanges && plan.hosting.redeployCount > 0 && ' and '}
          {plan.hosting.redeployCount > 0 && `redeploy ${plan.hosting.redeployCount} site(s)`}.
          {skipBackup && <span className="text-rose-400"> No snapshot will be taken — rollback will not be possible.</span>}
          {!skipBackup && ' A snapshot will be taken first so you can roll back.'}
        </p>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
          Type <b className="text-foreground font-mono">promote</b> or <b className="text-foreground font-mono">{expected}</b> to confirm
        </label>
        <input
          type="text"
          autoFocus
          value={typedConfirm}
          onChange={e => setTypedConfirm(e.target.value)}
          className="w-full px-3 py-2 text-xs font-mono bg-background border rounded-lg outline-none focus:border-primary"
          placeholder={expected}
        />
      </div>
    </div>
  );
}

// ─── Step: Running / Done / Failed ─────────────────────────

function RunStep({ plan, runState, step, skipBackup }) {
  return (
    <div className="space-y-3">
      {STAGES.map(({ key, label, icon: Icon }) => {
        const info = runState.stages[key];
        const isSkipped = (key === 'backup' && skipBackup) || (key === 'schema' && !plan?.schema?.hasChanges) || (key === 'deploy' && plan?.hosting?.redeployCount === 0);
        const status = info?.status || (isSkipped ? 'skipped' : 'pending');

        return (
          <div key={key} className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--surface-border)' }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{
              background: status === 'success' ? 'rgba(16,185,129,0.1)' :
                         status === 'failed' ? 'rgba(239,68,68,0.1)' :
                         status === 'running' ? 'rgba(59,130,246,0.1)' :
                         'rgba(255,255,255,0.03)',
            }}>
              {status === 'running' ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" /> :
               status === 'success' || status === 'partial' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
               status === 'failed' ? <AlertTriangle className="w-4 h-4 text-rose-400" /> :
               <Icon className="w-4 h-4 text-muted-foreground/40" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">
                {label}
                {status === 'skipped' && <span className="text-muted-foreground/60 font-normal text-[10px] ml-2">· skipped</span>}
              </div>
              {info?.error && <div className="text-[10px] text-rose-400 mt-0.5">{info.error}</div>}
              {info?.deployed && <div className="text-[10px] text-emerald-400 mt-0.5">{info.deployed.join(', ')}</div>}
            </div>
          </div>
        );
      })}

      {step === 'done' && (
        <div className="rounded-lg p-3 bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" /> Production updated successfully
          </div>
        </div>
      )}

      {step === 'failed' && (
        <div className="rounded-lg p-3 bg-rose-500/10 border border-rose-500/30">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold mb-1">
            <AlertTriangle className="w-4 h-4" /> Promotion failed
          </div>
          {runState.error && <div className="text-[11px] text-rose-300">{runState.error}</div>}
        </div>
      )}
    </div>
  );
}
