import { useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { format } from 'date-fns';

const SOURCES = [
  { value: 'action_log', label: 'Action Logs' },
  { value: 'erp', label: 'ERP' },
  { value: 'nginx', label: 'Nginx' },
];

export default function LogsViewer() {
  const [source, setSource] = useState('action_log');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading, refetch } = useApiQuery(
    ['logs', source, search],
    `/admin/logs?source=${source}&search=${encodeURIComponent(search)}&pageSize=200`
  );

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          {SOURCES.map((s) => (
            <Button
              key={s.value}
              variant={source === s.value ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7"
              onClick={() => setSource(s.value)}
            >
              {s.label}
            </Button>
          ))}
          <div className="ml-auto">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search logs..."
            className="text-xs h-8"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8">
            <Search className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <LoadingSpinner />
        ) : source === 'action_log' ? (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left p-2 font-medium text-muted-foreground">User</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Action</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Duration</th>
                <th className="text-left p-2 font-medium text-muted-foreground">IP</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs?.map((log) => (
                <tr key={log.id} className="border-b hover:bg-accent/30">
                  <td className="p-2 font-mono whitespace-nowrap">
                    {format(new Date(log.created_at), 'MMM d HH:mm:ss')}
                  </td>
                  <td className="p-2">{log.admin_username}</td>
                  <td className="p-2 font-mono">{log.action}</td>
                  <td className="p-2">
                    <Badge variant={log.status === 'success' ? 'success' : 'destructive'} className="text-[10px]">
                      {log.status}
                    </Badge>
                  </td>
                  <td className="p-2 font-mono">{log.duration_ms}ms</td>
                  <td className="p-2 font-mono">{log.ip_address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-2 font-mono text-xs space-y-0.5">
            {data?.logs?.map((log, i) => (
              <div key={i} className="py-0.5 px-2 hover:bg-accent/30 rounded">
                {log.message || JSON.stringify(log)}
              </div>
            ))}
            {data?.error && (
              <div className="p-4 text-muted-foreground">{data.error}</div>
            )}
          </div>
        )}

        {data?.total !== undefined && (
          <div className="p-2 text-xs text-muted-foreground border-t">
            Showing {data?.logs?.length || 0} of {data.total} entries
          </div>
        )}
      </div>
    </div>
  );
}
