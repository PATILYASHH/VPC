import { useState } from 'react';
import { toast } from 'sonner';
import { Download, RefreshCw, Shield, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

export default function SettingsTab({ project }) {
  const [reinstalling, setReinstalling] = useState(false);

  const { data: trackingStatus, isLoading, refetch } = useApiQuery(
    ['tracking-status', project.id],
    `/admin/sync/projects/${project.id}/tracking/status`
  );

  async function handleReinstall() {
    setReinstalling(true);
    try {
      await api.post(`/admin/sync/projects/${project.id}/tracking/reinstall`);
      toast.success('DDL tracking reinstalled with SECURITY DEFINER');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reinstall failed');
    } finally {
      setReinstalling(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* DDL Tracking */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">DDL Change Tracking</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Event triggers that capture schema changes (CREATE, ALTER, DROP) for pull-based sync.
            </p>

            {isLoading ? (
              <LoadingSpinner className="mt-3" />
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <Badge variant="outline" className={
                    trackingStatus?.enabled
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-red-500/20 text-red-400 border-red-500/30'
                  }>
                    {trackingStatus?.enabled ? 'Active' : 'Not Installed'}
                  </Badge>
                </div>

                {trackingStatus?.total_changes !== undefined && (
                  <div className="text-xs text-muted-foreground">
                    Total tracked changes: {trackingStatus.total_changes}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={handleReinstall}
                disabled={reinstalling}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${reinstalling ? 'animate-spin' : ''}`} />
                {reinstalling ? 'Reinstalling...' : 'Reinstall Tracking'}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Reinstalling fixes "permission denied" errors by adding SECURITY DEFINER to trigger functions.
            </p>
          </div>
        </div>
      </div>

      {/* Extension Download */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold">VPC Sync &mdash; VS Code Extension</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Push SQL migrations as pull requests directly from VS Code.
            </p>
            <div className="flex gap-2 mt-4">
              <a
                href="/downloads/vpc-sync.vsix"
                download
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download vpc-sync.vsix
              </a>
              <Badge variant="outline" className="self-center">v3.0.0</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Info */}
      <div className="border rounded-lg bg-card p-6">
        <h3 className="font-semibold mb-3">Extension Connection Info</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-24">Server URL:</span>
            <code className="bg-muted px-2 py-1 rounded text-xs flex-1 truncate">
              {window.location.origin}/api/bana/v1/{project.slug}
            </code>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => copyToClipboard(`${window.location.origin}/api/bana/v1/${project.slug}`)}
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-24">API Key:</span>
            <span className="text-xs text-muted-foreground italic">
              Use your project's Pull Key (found in DB &rarr; Pull Keys)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
