import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  HardDrive,
  Plus,
  Trash2,
  Upload,
  Download,
  Copy,
  ChevronRight,
  Globe,
  Lock,
  FolderOpen,
  File,
  ArrowLeft,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac'];
  if (imageExts.includes(ext)) return '🖼';
  if (videoExts.includes(ext)) return '🎬';
  if (audioExts.includes(ext)) return '🎵';
  return null;
}

export default function BanaBuckets({ project }) {
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const baseUrl = `/admin/bana/projects/${project.id}/storage`;
  const queryClient = useQueryClient();

  return selectedBucket ? (
    <BucketDetail
      project={project}
      bucket={selectedBucket}
      baseUrl={baseUrl}
      prefix={prefix}
      setPrefix={setPrefix}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      onBack={() => {
        setSelectedBucket(null);
        setPrefix('');
        setSearchTerm('');
      }}
      queryClient={queryClient}
    />
  ) : (
    <BucketList
      project={project}
      baseUrl={baseUrl}
      onSelect={(bucket) => setSelectedBucket(bucket)}
      showCreateDialog={showCreateDialog}
      setShowCreateDialog={setShowCreateDialog}
      queryClient={queryClient}
    />
  );
}

// ─── Bucket List ────────────────────────────────────────

function BucketList({ project, baseUrl, onSelect, showCreateDialog, setShowCreateDialog, queryClient }) {
  const { data, isLoading, refetch } = useApiQuery(
    ['bana-buckets', project.id],
    `${baseUrl}/buckets`
  );
  const [newName, setNewName] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  const buckets = data?.buckets || [];

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post(`${baseUrl}/buckets`, { name: newName.trim().toLowerCase(), isPublic: newPublic });
      toast.success('Bucket created');
      setNewName('');
      setNewPublic(false);
      setShowCreateDialog(false);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create bucket');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(bucket) {
    if (!confirm(`Delete bucket "${bucket.name}" and all its files? This cannot be undone.`)) return;
    try {
      await api.delete(`${baseUrl}/buckets/${bucket.id}`);
      toast.success(`Bucket "${bucket.name}" deleted`);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete bucket');
    }
  }

  async function handleTogglePublic(bucket) {
    try {
      await api.patch(`${baseUrl}/buckets/${bucket.id}`, { isPublic: !bucket.is_public });
      toast.success(`Bucket "${bucket.name}" is now ${bucket.is_public ? 'private' : 'public'}`);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update bucket');
    }
  }

  if (isLoading) return <LoadingSpinner className="p-8" />;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Buckets ({buckets.length})</h2>
        </div>
        <Button size="sm" className="h-7 text-xs" onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-3 h-3 mr-1" />
          Create Bucket
        </Button>
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <div className="px-4 py-3 border-b bg-muted/30">
          <form onSubmit={handleCreate} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Bucket Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                placeholder="my-bucket"
                className="w-full h-8 px-2 text-sm rounded-md border border-input bg-background"
                autoFocus
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer pb-1">
              <input
                type="checkbox"
                checked={newPublic}
                onChange={(e) => setNewPublic(e.target.checked)}
                className="rounded"
              />
              Public
            </label>
            <Button type="submit" size="sm" className="h-8" disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
          </form>
        </div>
      )}

      {/* Bucket list */}
      {buckets.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <HardDrive className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">No buckets yet</p>
            <p className="text-xs text-muted-foreground/60">Create a bucket to start storing files</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground border-b">Name</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b">Access</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b">Files</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b">Size</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b">Created</th>
                <th className="text-right p-2 font-medium text-muted-foreground border-b w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr
                  key={bucket.id}
                  className="border-b hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => onSelect(bucket)}
                >
                  <td className="p-2 font-medium">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-amber-500" />
                      {bucket.name}
                    </div>
                  </td>
                  <td className="p-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTogglePublic(bucket); }}
                      title="Click to toggle"
                    >
                      {bucket.is_public ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                          <Globe className="w-2.5 h-2.5 mr-1" /> Public
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">
                          <Lock className="w-2.5 h-2.5 mr-1" /> Private
                        </Badge>
                      )}
                    </button>
                  </td>
                  <td className="p-2 text-muted-foreground">{bucket.file_count}</td>
                  <td className="p-2 text-muted-foreground">{formatBytes(parseInt(bucket.total_size))}</td>
                  <td className="p-2 text-muted-foreground">
                    {new Date(bucket.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(bucket); }}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete bucket"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Bucket Detail ──────────────────────────────────────

function BucketDetail({ project, bucket, baseUrl, prefix, setPrefix, searchTerm, setSearchTerm, onBack, queryClient }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const { data, isLoading, refetch } = useApiQuery(
    ['bana-objects', bucket.id, prefix, searchTerm],
    `${baseUrl}/buckets/${bucket.id}/objects?prefix=${encodeURIComponent(prefix)}&search=${encodeURIComponent(searchTerm)}&limit=200`
  );

  const objects = data?.objects || [];

  // Compute virtual folders from object names
  const folders = new Set();
  const files = [];
  for (const obj of objects) {
    const relativeName = prefix ? obj.name.slice(prefix.length) : obj.name;
    const slashIdx = relativeName.indexOf('/');
    if (slashIdx > 0) {
      folders.add(relativeName.slice(0, slashIdx));
    } else {
      files.push(obj);
    }
  }

  // Breadcrumb parts
  const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : [];

  const handleUpload = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    let failed = 0;

    for (const file of fileList) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        if (prefix) formData.append('path', prefix);
        await api.post(`${baseUrl}/buckets/${bucket.id}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        uploaded++;
      } catch {
        failed++;
      }
    }

    setUploading(false);
    if (uploaded > 0) toast.success(`${uploaded} file${uploaded > 1 ? 's' : ''} uploaded`);
    if (failed > 0) toast.error(`${failed} file${failed > 1 ? 's' : ''} failed`);
    refetch();
  }, [baseUrl, bucket.id, prefix, refetch]);

  async function handleDelete(obj) {
    if (!confirm(`Delete "${obj.name}"?`)) return;
    try {
      await api.delete(`${baseUrl}/objects/${obj.id}`);
      toast.success('File deleted');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  }

  function getPublicUrl(obj) {
    return `${window.location.origin}/storage/v1/${project.slug}/${bucket.name}/${obj.name}`;
  }

  function copyUrl(obj) {
    navigator.clipboard.writeText(getPublicUrl(obj));
    toast.success('URL copied');
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleUpload(e.dataTransfer.files);
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 hover:bg-accent rounded transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <FolderOpen className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold">{bucket.name}</span>
          {bucket.is_public ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
              Public
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">
              Private
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search files..."
              className="h-7 pl-7 pr-2 text-xs rounded-md border border-input bg-background w-40"
            />
          </div>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="w-3 h-3 mr-1" />
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b bg-muted/30 text-xs">
          <button
            onClick={() => setPrefix('')}
            className="text-primary hover:underline"
          >
            {bucket.name}
          </button>
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <button
                onClick={() => setPrefix(breadcrumbs.slice(0, i + 1).join('/') + '/')}
                className={i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : 'text-primary hover:underline'}
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg m-2">
          <div className="text-center">
            <Upload className="w-10 h-10 text-primary/50 mx-auto mb-2" />
            <p className="text-sm text-primary font-medium">Drop files to upload</p>
          </div>
        </div>
      )}

      {/* File list */}
      {isLoading ? (
        <LoadingSpinner className="p-8" />
      ) : objects.length === 0 && folders.size === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Upload className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">No files in this bucket</p>
            <p className="text-xs text-muted-foreground/60">Drag & drop files here or click Upload</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground border-b">Name</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b w-20">Size</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b w-28">Type</th>
                <th className="text-left p-2 font-medium text-muted-foreground border-b w-32">Uploaded</th>
                <th className="text-right p-2 font-medium text-muted-foreground border-b w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Virtual folders */}
              {[...folders].sort().map((folder) => (
                <tr
                  key={`folder-${folder}`}
                  className="border-b hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => setPrefix(`${prefix}${folder}/`)}
                >
                  <td className="p-2 font-medium" colSpan={4}>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-amber-500" />
                      {folder}/
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground inline" />
                  </td>
                </tr>
              ))}

              {/* Files */}
              {files.map((obj) => {
                const displayName = prefix ? obj.name.slice(prefix.length) : obj.name;
                const icon = getFileIcon(obj.name);
                return (
                  <tr key={obj.id} className="border-b hover:bg-accent/30 transition-colors">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {icon ? (
                          <span className="text-sm">{icon}</span>
                        ) : (
                          <File className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="truncate max-w-[300px]" title={displayName}>
                          {displayName}
                        </span>
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">{formatBytes(obj.file_size)}</td>
                    <td className="p-2 text-muted-foreground truncate">{obj.mime_type || '—'}</td>
                    <td className="p-2 text-muted-foreground">
                      {new Date(obj.created_at).toLocaleString()}
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <a
                          href={`${baseUrl}/objects/${obj.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Download"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        {bucket.is_public && (
                          <button
                            onClick={(e) => { e.stopPropagation(); copyUrl(obj); }}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy public URL"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(obj); }}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer stats */}
      <div className="px-4 py-1.5 border-t bg-muted/30 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{data?.total || 0} objects in this view</span>
        {bucket.is_public && (
          <span>Public URL: /storage/v1/{project.slug}/{bucket.name}/</span>
        )}
      </div>
    </div>
  );
}
