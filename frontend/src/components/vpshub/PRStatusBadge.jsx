import {
  GitPullRequest, GitMerge, XCircle, AlertTriangle, Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const STATUS_MAP = {
  open:     { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: GitPullRequest, label: 'Open' },
  testing:  { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Loader2, label: 'Testing' },
  merged:   { color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: GitMerge, label: 'Merged' },
  closed:   { color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30', icon: XCircle, label: 'Closed' },
  conflict: { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: AlertTriangle, label: 'Conflict' },
};

export default function PRStatusBadge({ status, size = 'sm' }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.open;
  const Icon = cfg.icon;
  const spin = status === 'testing';

  return (
    <Badge variant="outline" className={`${cfg.color} text-xs`}>
      <Icon className={`w-3 h-3 mr-1 ${spin ? 'animate-spin' : ''}`} />
      {cfg.label}
    </Badge>
  );
}
