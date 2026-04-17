import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  GitBranch, Database, Globe, Plus, X, ExternalLink, Rocket,
  HardDrive, Lock, RefreshCw, GitFork, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Clock, Activity, ArrowUpRight,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import AddResourceDialog from './AddResourceDialog';
import SchemaDiffViewer from '@/components/db/SchemaDiffViewer';
import useWindowStore from '@/stores/useWindowStore';
import api from '@/lib/api';

export default function PipelineDashboard({ pipeline }) {
  const [showAdd, setShowAdd] = useState(false);
  const [addEnv, setAddEnv] = useState('production');
  const [forking, setForking] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [deploying, setDeploying] = useState({});
  const [showDiff, setShowDiff] = useState(false);
  const queryClient = useQueryClient();
  const openWindow = useWindowStore((s) => s.openWindow);

  const { data, isLoading, refetch } = useApiQuery(
    ['pipeline-detail', pipeline.id],
    `/admin/pipeline/pipelines/${pipeline.id}`,
    { refetchInterval: 15000 }
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipeline.id] });
    queryClient.invalidateQueries({ queryKey: ['pipelines'] });
  };

  const removeResource = async (type, id) => {
    try {
      await api.delete(`/admin/pipeline/pipelines/${pipeline.id}/resources`, { data: { resourceType: type, resourceId: id } });
      invalidate(); toast.success('Removed');
    } catch { toast.error('Failed'); }
  };

  const handleDeploy = async (hostingId, env) => {
    setDeploying(prev => ({ ...prev, [hostingId]: true }));
    try {
      await api.post(`/admin/pipeline/pipelines/${pipeline.id}/deploy/${hostingId}`, { environment: env });
      toast.success('Deployed successfully');
      invalidate();
    } catch (err) { toast.error(err.response?.data?.error || 'Deploy failed'); }
    finally { setDeploying(prev => ({ ...prev, [hostingId]: false })); }
  };

  const handleForkToBeta = async () => {
    if (!confirm('Fork production databases to beta?\nRepos will be shared.')) return;
    setForking(true);
    try {
      const { data: result } = await api.post(`/admin/pipeline/pipelines/${pipeline.id}/fork-to-beta`);
      if (result.forkedDbs?.length > 0) toast.success(`Forked ${result.forkedDbs.length} DB(s)`);
      if (result.errors?.length > 0) toast.error(`${result.errors.length} failed`);
      invalidate();
    } catch (err) { toast.error(err.response?.data?.error || 'Fork failed'); }
    finally { setForking(false); }
  };

  const handlePromote = async () => {
    if (!confirm('Promote Beta → Production?\n\nThis will:\n• Create a Schema PR for new tables/columns on prod DB\n• Redeploy production hosting sites\n\nContinue?')) return;
    setPromoting(true);
    try {
      const { data: result } = await api.post(`/admin/pipeline/pipelines/${pipeline.id}/promote`);
      const msgs = [];
      if (result.schemaPRs?.length > 0) msgs.push(`${result.schemaPRs.length} schema PR(s) created`);
      if (result.deployedSites?.length > 0) msgs.push(`${result.deployedSites.length} site(s) deployed`);
      if (result.errors?.length > 0) msgs.push(`${result.errors.length} error(s)`);
      toast.success(msgs.join(', ') || 'Promote complete');
      invalidate();
    } catch (err) { toast.error(err.response?.data?.error || 'Promote failed'); }
    finally { setPromoting(false); }
  };

  if (isLoading) return <LoadingSpinner />;

  const prod = data?.production || { repos: [], databases: [], hosting: [] };
  const beta = data?.beta || { repos: [], databases: [], hosting: [] };
  const activity = data?.activity || [];
  const schemaDiff = data?.schemaDiff;
  const prodTotal = prod.repos.length + prod.databases.length + prod.hosting.length;
  const betaTotal = beta.repos.length + beta.databases.length + beta.hosting.length;
  const hasSchemaDiff = schemaDiff && (schemaDiff.newTables?.length > 0 || schemaDiff.modifiedTables?.length > 0);

  return (
    <div className="flex-1 overflow-auto" style={{ background: 'var(--surface-0)' }}>
      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
        <div className="flex items-center gap-3 text-xs flex-1">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="font-medium text-emerald-400">{prodTotal}</span> <span className="text-muted-foreground/50">prod</span></span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /><span className="font-medium text-blue-400">{betaTotal}</span> <span className="text-muted-foreground/50">beta</span></span>
          {hasSchemaDiff && (
            <button onClick={() => setShowDiff(!showDiff)} className="flex items-center gap-1 text-amber-400 hover:text-amber-300">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-[11px] font-medium">{schemaDiff.summary.newTables} new table{schemaDiff.summary.newTables !== 1 ? 's' : ''}, {schemaDiff.summary.newColumns} new col{schemaDiff.summary.newColumns !== 1 ? 's' : ''} in beta</span>
            </button>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
        {prodTotal > 0 && betaTotal === 0 && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleForkToBeta} disabled={forking}>
            {forking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitFork className="w-3.5 h-3.5" />} Fork to Beta
          </Button>
        )}
      </div>

      {/* Schema diff banner */}
      {showDiff && schemaDiff && (
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--surface-border)', background: 'rgba(217,119,6,0.03)' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-amber-400">Beta has schema changes not in Production</h3>
            <button onClick={() => setShowDiff(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
          <SchemaDiffViewer diff={schemaDiff} sql={null} />
        </div>
      )}

      {/* Two columns */}
      <div className="flex flex-col lg:flex-row min-h-0">
        <div className="flex-1 border-b lg:border-b-0 lg:border-r min-w-0" style={{ borderColor: 'var(--surface-border)' }}>
          <EnvHeader label="Production" color="emerald" count={prodTotal} onAdd={() => { setAddEnv('production'); setShowAdd(true); }} />
          <div className="p-3 space-y-3">
            {prodTotal === 0 ? <EmptyState label="production" onAdd={() => { setAddEnv('production'); setShowAdd(true); }} /> :
              <EnvResources resources={prod} env="production" onRemove={removeResource} onOpenApp={openWindow} onDeploy={handleDeploy} deploying={deploying} />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <EnvHeader label="Beta" color="blue" count={betaTotal} onAdd={() => { setAddEnv('beta'); setShowAdd(true); }}
            extraAction={betaTotal > 0 && (
              <Button size="sm" className="h-6 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white" onClick={handlePromote} disabled={promoting}>
                {promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                Push to Prod
              </Button>
            )}
          />
          <div className="p-3 space-y-3">
            {betaTotal === 0 ? (
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <GitFork className="w-7 h-7 mb-2 opacity-20" />
                <p className="text-xs mb-3">No beta resources</p>
                {prodTotal > 0 ? (
                  <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={handleForkToBeta} disabled={forking}>
                    {forking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitFork className="w-3.5 h-3.5" />} Fork from Production
                  </Button>
                ) : <Button size="sm" variant="ghost" className="text-xs" onClick={() => { setAddEnv('beta'); setShowAdd(true); }}><Plus className="w-3 h-3 mr-1" /> Add manually</Button>}
              </div>
            ) : <EnvResources resources={beta} env="beta" onRemove={removeResource} onOpenApp={openWindow} onDeploy={handleDeploy} deploying={deploying} />}
          </div>
        </div>
      </div>

      {/* Activity */}
      {activity.length > 0 && (
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-muted-foreground/40" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold">Recent Activity</span>
          </div>
          <div className="space-y-1 max-h-36 overflow-auto">
            {activity.map(a => (
              <div key={a.id} className="flex items-start gap-2 text-[11px] py-0.5">
                <ActivityIcon type={a.event_type} />
                <span className="text-muted-foreground/60 flex-1">{a.message}</span>
                <span className="text-[9px] text-muted-foreground/25 shrink-0">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddResourceDialog open={showAdd} onOpenChange={setShowAdd} pipelineId={pipeline.id} environment={addEnv}
        currentResources={addEnv === 'production' ? prod : beta} onSaved={invalidate} />
    </div>
  );
}

// ─── Sub Components ──────────────────────────────────────────

function EnvHeader({ label, color, count, onAdd, extraAction }) {
  const dot = color === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500';
  const text = color === 'emerald' ? 'text-emerald-400' : 'text-blue-400';
  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b ${color === 'emerald' ? 'bg-emerald-500/[0.03]' : 'bg-blue-500/[0.03]'}`} style={{ borderColor: 'var(--surface-border)' }}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${text}`}>{label}</span>
        <span className="text-[10px] text-muted-foreground/40">{count}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {extraAction}
        <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={onAdd}><Plus className="w-3 h-3" /> Add</Button>
      </div>
    </div>
  );
}

function EmptyState({ label, onAdd }) {
  return (
    <div className="flex flex-col items-center py-8 text-muted-foreground">
      <Plus className="w-7 h-7 mb-2 opacity-15" />
      <p className="text-xs mb-2">No {label} resources</p>
      <Button size="sm" variant="ghost" className="text-xs" onClick={onAdd}><Plus className="w-3 h-3 mr-1" /> Add resources</Button>
    </div>
  );
}

function EnvResources({ resources, env, onRemove, onOpenApp, onDeploy, deploying }) {
  return (
    <>
      {resources.repos.length > 0 && (
        <Sec icon={GitBranch} color="text-violet-400" label="Repositories">
          {resources.repos.map(r => (
            <Card key={r.id} onRemove={() => onRemove('repo', r.id)}>
              <div className="flex items-start justify-between">
                <div className="min-w-0"><h4 className="text-xs font-semibold truncate">{r.name}</h4><span className="text-[10px] text-muted-foreground/50 font-mono">/{r.slug}</span></div>
                <div className="flex items-center gap-1">{r.visibility === 'private' && <Lock className="w-3 h-3 text-muted-foreground/30" />}<Btn icon={ExternalLink} onClick={() => onOpenApp('vpshub')} title="VPSHub" /></div>
              </div>
              <p className="text-[10px] text-muted-foreground/30 mt-1">{r.owner_username} · {r.default_branch || 'main'}{r.updated_at ? ` · ${timeAgo(r.updated_at)}` : ''}</p>
            </Card>
          ))}
        </Sec>
      )}
      {resources.databases.length > 0 && (
        <Sec icon={Database} color="text-emerald-400" label="Databases">
          {resources.databases.map(d => (
            <Card key={d.id} onRemove={() => onRemove('db', d.id)}>
              <div className="flex items-start justify-between">
                <div className="min-w-0"><h4 className="text-xs font-semibold truncate">{d.name}</h4><span className="text-[10px] text-muted-foreground/50 font-mono">/{d.slug}</span></div>
                <div className="flex items-center gap-1">
                  {d.environment && d.environment !== 'production' && <Badge className="text-[8px] bg-blue-500/10 text-blue-400 border-blue-500/20">{d.environment}</Badge>}
                  <Btn icon={ExternalLink} onClick={() => onOpenApp('db')} title="DB" />
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/30 mt-1.5"><HardDrive className="w-3 h-3" />{d.storage_used_mb || 0}/{d.storage_limit_mb || 500} MB{d.active_connections > 0 && ` · ${d.active_connections} conn`}</div>
              <Progress value={Math.min(((d.storage_used_mb || 0) / (d.storage_limit_mb || 500)) * 100, 100)} className="h-1 mt-1" />
            </Card>
          ))}
        </Sec>
      )}
      {resources.hosting.length > 0 && (
        <Sec icon={Globe} color="text-blue-400" label="Hosting">
          {resources.hosting.map(s => (
            <Card key={s.id} onRemove={() => onRemove('hosting', s.id)}>
              <div className="flex items-start justify-between">
                <div className="min-w-0"><h4 className="text-xs font-semibold truncate">{s.name}</h4><span className="text-[10px] text-muted-foreground/50 font-mono">/{s.slug}</span></div>
                <Badge variant={s.status === 'running' ? 'success' : s.status === 'error' ? 'destructive' : 'secondary'} className="text-[8px]">{s.status}</Badge>
              </div>
              {s.project_type && <p className="text-[10px] text-muted-foreground/30 mt-1">{s.project_type}{s.last_deploy_at ? ` · ${timeAgo(s.last_deploy_at)}` : ''}</p>}
              <div className="flex items-center gap-1 mt-2 pt-1.5 border-t" style={{ borderColor: 'var(--surface-border)' }}>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => onDeploy(s.id, env)} disabled={deploying[s.id]}>
                  {deploying[s.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />} Deploy
                </Button>
                <Btn icon={ExternalLink} onClick={() => onOpenApp('web-hosting')} title="Web Hosting" />
                {s.slug && <a href={`/${s.slug}/`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-[10px] text-primary/50 hover:text-primary"><Globe className="w-3 h-3" /> Visit</a>}
              </div>
            </Card>
          ))}
        </Sec>
      )}
    </>
  );
}

function Sec({ icon: Icon, color, label, children }) {
  return (<div><div className="flex items-center gap-1.5 mb-1.5"><Icon className={`w-3.5 h-3.5 ${color}`} /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">{label}</span></div><div className="space-y-2">{children}</div></div>);
}

function Card({ children, onRemove }) {
  return (
    <div className="rounded-lg border p-3 group relative" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
      {children}
      <button onClick={onRemove} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/10 transition-all"><X className="w-3 h-3 text-destructive/60" /></button>
    </div>
  );
}

function Btn({ icon: Icon, onClick, title }) {
  return <button onClick={onClick} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/[0.06] text-muted-foreground/30 hover:text-foreground transition-colors" title={title}><Icon className="w-3 h-3" /></button>;
}

function ActivityIcon({ type }) {
  if (type === 'deploy_success') return <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />;
  if (type === 'deploy_error') return <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />;
  if (type === 'deploy_start') return <Rocket className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />;
  if (type === 'fork') return <GitFork className="w-3 h-3 text-violet-400 mt-0.5 shrink-0" />;
  return <Clock className="w-3 h-3 text-muted-foreground/30 mt-0.5 shrink-0" />;
}

function timeAgo(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
