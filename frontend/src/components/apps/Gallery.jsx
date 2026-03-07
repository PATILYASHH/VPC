import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Upload, FolderPlus, Grid3X3, List, Search, Download, Trash2, Pencil,
  ChevronRight, Image, FileText, Film, File, FolderOpen, Eye,
  HardDrive, Layers, Music, ArrowUpDown, Link2, ChevronDown,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

const CATEGORIES = [
  { id: 'all', label: 'All Files', icon: FolderOpen, color: 'text-blue-400' },
  { id: 'images', label: 'Images', icon: Image, color: 'text-emerald-400' },
  { id: 'docs', label: 'Documents', icon: FileText, color: 'text-amber-400' },
  { id: 'videos', label: 'Videos', icon: Film, color: 'text-purple-400' },
  { id: 'others', label: 'Others', icon: File, color: 'text-gray-400' },
];

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest First' },
  { id: 'oldest', label: 'Oldest First' },
  { id: 'name', label: 'Name A-Z' },
  { id: 'size', label: 'Largest First' },
  { id: 'type', label: 'File Type' },
];

function formatBytes(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function getFileIcon(file) {
  const name = file.original_name || file.name || '';
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'bi-file-earmark-pdf text-red-400';
    case 'doc': case 'docx': return 'bi-file-earmark-word text-blue-400';
    case 'xls': case 'xlsx': case 'csv': return 'bi-file-earmark-excel text-green-400';
    case 'ppt': case 'pptx': return 'bi-file-earmark-ppt text-orange-400';
    case 'zip': case 'rar': case '7z': return 'bi-file-earmark-zip text-yellow-400';
    case 'js': case 'ts': case 'py': case 'sql': return 'bi-file-earmark-code text-cyan-400';
    case 'mp4': case 'webm': case 'mov': case 'avi': return 'bi-file-earmark-play text-purple-400';
    case 'mp3': case 'wav': case 'ogg': case 'flac': return 'bi-file-earmark-music text-pink-400';
    case 'txt': case 'md': return 'bi-file-earmark-text text-gray-400';
    default: return 'bi-file-earmark text-gray-400';
  }
}

function getCategoryFromMime(mime) {
  if (!mime) return 'others';
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  return 'others';
}

export default function Gallery() {
  const [source, setSource] = useState('gallery');
  const [activeCategory, setActiveCategory] = useState('all');
  const [currentFolder, setCurrentFolder] = useState('/');
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [renameDialog, setRenameDialog] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [newFolderDialog, setNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  // Bucket state
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [expandedProjects, setExpandedProjects] = useState({});

  // ── Gallery Data ──
  const queryParams = new URLSearchParams({
    category: activeCategory,
    folder: currentFolder,
    ...(searchQuery && { search: searchQuery }),
    limit: '100',
  }).toString();

  const { data: galleryData, isLoading: galleryLoading } = useApiQuery(
    ['gallery-files', activeCategory, currentFolder, searchQuery],
    `/admin/gallery/files?${queryParams}`,
    { enabled: source === 'gallery', refetchInterval: 10000 }
  );

  const { data: stats } = useApiQuery('gallery-stats', '/admin/gallery/stats');

  // ── Bucket Data ──
  const { data: bucketData, isLoading: bucketDataLoading } = useApiQuery(
    'gallery-bucket-data',
    '/admin/gallery/bucket-data',
    { enabled: source === 'buckets' }
  );

  const bucketFilesParams = selectedProject && selectedBucket
    ? new URLSearchParams({
        projectId: selectedProject.id,
        bucketId: selectedBucket.id,
        sort: sortBy,
        ...(searchQuery && { search: searchQuery }),
      }).toString()
    : null;

  const { data: bucketFilesData, isLoading: bucketFilesLoading } = useApiQuery(
    ['gallery-bucket-files', selectedProject?.id, selectedBucket?.id, sortBy, searchQuery],
    bucketFilesParams ? `/admin/gallery/bucket-files?${bucketFilesParams}` : null,
    { enabled: source === 'buckets' && !!bucketFilesParams }
  );

  const isLoading = source === 'gallery' ? galleryLoading : (bucketDataLoading || bucketFilesLoading);
  const files = source === 'gallery' ? (galleryData?.files || []) : (bucketFilesData?.files || []);

  const toggleProject = (projId) => {
    setExpandedProjects((prev) => ({ ...prev, [projId]: !prev[projId] }));
  };

  const selectBucket = (project, bucket) => {
    setSelectedProject(project);
    setSelectedBucket(bucket);
    setSearchQuery('');
    setSearchInput('');
  };

  // --- Upload ---
  const handleUpload = async (fileList) => {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const f of fileList) formData.append('files', f);
      formData.append('folder', currentFolder);
      await api.post('/admin/gallery/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      queryClient.invalidateQueries({ queryKey: ['gallery-files'] });
      queryClient.invalidateQueries({ queryKey: ['gallery-stats'] });
      toast.success(`${fileList.length} file(s) uploaded`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (source === 'gallery') handleUpload(e.dataTransfer.files);
  }, [currentFolder, source]);

  const handleDelete = async (file) => {
    if (!confirm(`Delete "${file.original_name}"?`)) return;
    try {
      if (source === 'buckets' && file.project_id) {
        await api.delete(`/admin/bana/projects/${file.project_id}/storage/objects/${file.id}`);
        queryClient.invalidateQueries({ queryKey: ['gallery-bucket-files'] });
        queryClient.invalidateQueries({ queryKey: ['gallery-bucket-data'] });
      } else {
        await api.delete(`/admin/gallery/files/${file.id}`);
        queryClient.invalidateQueries({ queryKey: ['gallery-files'] });
        queryClient.invalidateQueries({ queryKey: ['gallery-stats'] });
      }
      toast.success('File deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleDownload = async (file) => {
    try {
      const url = source === 'buckets' && file.project_id
        ? `/admin/gallery/bucket-files/${file.id}/preview?projectId=${file.project_id}`
        : `/admin/gallery/files/${file.id}/download`;
      const response = await api.get(url, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Download failed');
    }
  };

  const handleRename = async () => {
    if (!renameName.trim()) return;
    try {
      await api.patch(`/admin/gallery/files/${renameDialog.id}`, { name: renameName });
      queryClient.invalidateQueries({ queryKey: ['gallery-files'] });
      toast.success('File renamed');
      setRenameDialog(null);
    } catch {
      toast.error('Rename failed');
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newPath = currentFolder === '/' ? `/${newFolderName}` : `${currentFolder}/${newFolderName}`;
    setCurrentFolder(newPath.replace(/\/+/g, '/'));
    setNewFolderDialog(false);
    setNewFolderName('');
    toast.success(`Navigated to ${newFolderName}`);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchQuery(searchInput);
  };

  const breadcrumbs = currentFolder === '/' ? ['/'] : currentFolder.split('/').filter(Boolean);

  const previewUrl = (file) => {
    if (source === 'buckets' && file.project_id) {
      return `/admin/gallery/bucket-files/${file.id}/preview?projectId=${file.project_id}`;
    }
    return `/admin/gallery/files/${file.id}/preview`;
  };

  const totalBucketFiles = (bucketData?.projects || []).reduce(
    (sum, p) => sum + p.buckets.reduce((s, b) => s + b.file_count, 0), 0
  );
  const totalBucketSize = (bucketData?.projects || []).reduce(
    (sum, p) => sum + p.buckets.reduce((s, b) => s + b.total_size, 0), 0
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        {/* ── Left Sidebar ─────────────────────────── */}
        <div className="w-48 border-r bg-card flex flex-col shrink-0 overflow-hidden">
          <div className="flex-1 overflow-auto">
            {/* Source Tabs */}
            <div className="flex border-b">
              <button
                onClick={() => { setSource('gallery'); setSearchQuery(''); setSearchInput(''); }}
                className={`flex-1 px-3 py-2 text-[10px] font-medium transition-colors ${
                  source === 'gallery' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FolderOpen className="w-3 h-3 inline mr-1" />
                Gallery
              </button>
              <button
                onClick={() => { setSource('buckets'); setSearchQuery(''); setSearchInput(''); }}
                className={`flex-1 px-3 py-2 text-[10px] font-medium transition-colors ${
                  source === 'buckets' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <HardDrive className="w-3 h-3 inline mr-1" />
                Buckets
              </button>
            </div>

            {source === 'gallery' ? (
              <div className="p-2 space-y-0.5">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const count = cat.id === 'all' ? stats?.total_files : stats?.[cat.id];
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setActiveCategory(cat.id); setSearchQuery(''); setSearchInput(''); }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors ${
                        activeCategory === cat.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 ${cat.color}`} />
                        {cat.label}
                      </span>
                      {count > 0 && (
                        <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded-full">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {bucketDataLoading ? (
                  <div className="py-4 text-center"><LoadingSpinner /></div>
                ) : (bucketData?.projects || []).length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-4">No buckets found</p>
                ) : (
                  (bucketData?.projects || []).map((project) => (
                    <div key={project.id}>
                      <button
                        onClick={() => toggleProject(project.id)}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${expandedProjects[project.id] ? 'rotate-90' : ''}`} />
                        <Layers className="w-3 h-3 shrink-0 text-blue-400" />
                        <span className="truncate font-medium">{project.name}</span>
                      </button>
                      {expandedProjects[project.id] && (
                        <div className="ml-3 mt-0.5 space-y-0.5">
                          {project.buckets.map((bucket) => {
                            const isSelected = selectedBucket?.id === bucket.id && selectedProject?.id === project.id;
                            return (
                              <button
                                key={bucket.id}
                                onClick={() => selectBucket(project, bucket)}
                                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                                  isSelected
                                    ? 'bg-primary/10 text-primary font-medium'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <HardDrive className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{bucket.name}</span>
                                </span>
                                <span className="flex items-center gap-1.5 shrink-0">
                                  {bucket.is_public && <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Public" />}
                                  <span className="text-[9px] bg-muted px-1 py-0.5 rounded-full">{bucket.file_count}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Storage info */}
          <div className="p-3 border-t">
            {source === 'gallery' && stats ? (
              <>
                <p className="text-[9px] text-muted-foreground">Gallery Storage</p>
                <p className="text-xs font-mono font-medium">{formatBytes(Number(stats.total_size))}</p>
                <p className="text-[9px] text-muted-foreground mt-1">{stats.total_files} files</p>
              </>
            ) : source === 'buckets' ? (
              <>
                <p className="text-[9px] text-muted-foreground">Bucket Storage</p>
                <p className="text-xs font-mono font-medium">{formatBytes(totalBucketSize)}</p>
                <p className="text-[9px] text-muted-foreground mt-1">{totalBucketFiles} files</p>
              </>
            ) : null}
          </div>
        </div>

        {/* ── Main Content ─────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <div className="flex items-center gap-2 p-2 border-b">
            {source === 'gallery' ? (
              <div className="flex items-center text-[11px] text-muted-foreground mr-2">
                <button className="hover:text-foreground" onClick={() => setCurrentFolder('/')}>
                  <i className="bi bi-house-door text-xs"></i>
                </button>
                {breadcrumbs.map((segment, i) => {
                  if (segment === '/') return null;
                  return (
                    <span key={i} className="flex items-center">
                      <ChevronRight className="w-3 h-3 mx-0.5" />
                      <button className="hover:text-foreground" onClick={() => setCurrentFolder('/' + breadcrumbs.slice(0, i + 1).join('/'))}>
                        {segment}
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center text-[11px] text-muted-foreground mr-2">
                <HardDrive className="w-3 h-3 mr-1.5" />
                {selectedProject && selectedBucket ? (
                  <span>{selectedProject.name} / <span className="text-foreground font-medium">{selectedBucket.name}</span></span>
                ) : (
                  <span>Select a bucket</span>
                )}
              </div>
            )}

            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-xs">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input placeholder="Search files..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-7 pl-7 text-[11px]" />
              </div>
            </form>

            {/* Sort */}
            {source === 'buckets' && (
              <div className="relative">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setShowSortMenu(!showSortMenu)}>
                  <ArrowUpDown className="w-3 h-3 mr-1" />
                  {SORT_OPTIONS.find((s) => s.id === sortBy)?.label}
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
                {showSortMenu && (
                  <div className="absolute top-full right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 py-1 min-w-[140px]">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => { setSortBy(opt.id); setShowSortMenu(false); }}
                        className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent transition-colors ${
                          sortBy === opt.id ? 'text-primary font-medium' : 'text-foreground'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* View toggle */}
            <div className="flex border rounded overflow-hidden">
              <button className={`p-1.5 ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setViewMode('grid')}>
                <Grid3X3 className="w-3 h-3" />
              </button>
              <button className={`p-1.5 ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setViewMode('list')}>
                <List className="w-3 h-3" />
              </button>
            </div>

            {/* Gallery actions */}
            {source === 'gallery' && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setNewFolderDialog(true)}>
                  <FolderPlus className="w-3 h-3 mr-1" /> New Folder
                </Button>
                <Button size="sm" className="h-7 text-[11px]" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Upload className="w-3 h-3 mr-1" /> {uploading ? 'Uploading...' : 'Upload'}
                </Button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
              </>
            )}
          </div>

          {/* File Area */}
          <div
            className={`flex-1 overflow-auto p-3 relative ${dragOver ? 'ring-2 ring-primary ring-inset bg-primary/5' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {dragOver && source === 'gallery' && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 pointer-events-none">
                <div className="text-center">
                  <Upload className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-primary">Drop files to upload</p>
                </div>
              </div>
            )}

            {source === 'buckets' && !selectedBucket ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <HardDrive className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">Select a bucket from the sidebar</p>
                <p className="text-xs mt-1">Browse files from your BanaDB storage buckets</p>
              </div>
            ) : isLoading ? (
              <LoadingSpinner />
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <i className="bi bi-cloud-arrow-up text-4xl mb-3 opacity-30"></i>
                <p className="text-sm">No files here</p>
                <p className="text-xs mt-1">{source === 'gallery' ? 'Drag & drop files or click Upload' : 'This bucket is empty'}</p>
              </div>
            ) : viewMode === 'grid' ? (
              <GridView
                files={files}
                source={source}
                onPreview={setPreviewFile}
                onDelete={handleDelete}
                onDownload={handleDownload}
                onRename={source === 'gallery' ? (f) => { setRenameDialog(f); setRenameName(f.original_name); } : null}
                previewUrl={previewUrl}
              />
            ) : (
              <ListView
                files={files}
                source={source}
                onPreview={setPreviewFile}
                onDelete={handleDelete}
                onDownload={handleDownload}
                onRename={source === 'gallery' ? (f) => { setRenameDialog(f); setRenameName(f.original_name); } : null}
                previewUrl={previewUrl}
              />
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <Dialog open onOpenChange={() => setPreviewFile(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] p-0 overflow-hidden">
            <DialogHeader className="p-3 pb-0">
              <DialogTitle className="text-sm flex items-center justify-between">
                {previewFile.original_name}
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownload(previewFile)}>
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  {previewFile.public_url && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { copyToClipboard(`${window.location.origin}${previewFile.public_url}`); toast.success('Public URL copied'); }}>
                      <Link2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </DialogTitle>
            </DialogHeader>
            <div className="p-3 flex items-center justify-center min-h-[300px] bg-black/20">
              {previewFile.mime_type?.startsWith('image/') ? (
                <img src={previewUrl(previewFile)} alt={previewFile.original_name} className="max-w-full max-h-[70vh] object-contain rounded" />
              ) : previewFile.mime_type?.startsWith('video/') ? (
                <video src={previewUrl(previewFile)} controls className="max-w-full max-h-[70vh] rounded" />
              ) : previewFile.mime_type?.startsWith('audio/') ? (
                <div className="text-center">
                  <Music className="w-16 h-16 text-pink-400 mx-auto mb-4" />
                  <p className="text-sm mb-3">{previewFile.original_name}</p>
                  <audio src={previewUrl(previewFile)} controls className="w-80" />
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <i className={`${getFileIcon(previewFile)} text-5xl`}></i>
                  <p className="text-sm mt-3">{previewFile.original_name}</p>
                  <p className="text-xs mt-1">{formatBytes(previewFile.file_size)} &middot; {previewFile.mime_type}</p>
                  <Button size="sm" className="mt-3" onClick={() => handleDownload(previewFile)}>
                    <Download className="w-3 h-3 mr-1" /> Download
                  </Button>
                </div>
              )}
            </div>
            <div className="px-3 pb-3 text-[10px] text-muted-foreground flex items-center justify-between">
              <span>
                {formatBytes(previewFile.file_size)} &middot; {previewFile.mime_type}
                {previewFile.bucket_name && <> &middot; <Badge variant="secondary" className="text-[8px] ml-1">{previewFile.bucket_name}</Badge></>}
              </span>
              <span>{new Date(previewFile.created_at).toLocaleString()}</span>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Rename Dialog */}
      {renameDialog && (
        <Dialog open onOpenChange={() => setRenameDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-sm">Rename File</DialogTitle></DialogHeader>
            <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRename()} autoFocus className="text-sm" />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setRenameDialog(null)}>Cancel</Button>
              <Button size="sm" onClick={handleRename}>Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* New Folder Dialog */}
      {newFolderDialog && (
        <Dialog open onOpenChange={() => setNewFolderDialog(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-sm">New Folder</DialogTitle></DialogHeader>
            <Input placeholder="Folder name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()} autoFocus className="text-sm" />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setNewFolderDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateFolder}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Grid View ─────────────────────────────────────────
function GridView({ files, source, onPreview, onDelete, onDownload, onRename, previewUrl }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
      {files.map((file) => (
        <div
          key={file.id}
          className="group border rounded-lg overflow-hidden hover:border-primary/50 transition-colors cursor-pointer bg-card"
          onClick={() => onPreview(file)}
        >
          <div className="aspect-square bg-muted/30 flex items-center justify-center relative overflow-hidden">
            {file.mime_type?.startsWith('image/') ? (
              <img src={previewUrl(file)} alt={file.original_name} className="w-full h-full object-cover" loading="lazy" />
            ) : file.mime_type?.startsWith('audio/') ? (
              <Music className="w-8 h-8 text-pink-400" />
            ) : (
              <i className={`${getFileIcon(file)} text-3xl`}></i>
            )}

            {file.is_public && (
              <span className="absolute top-1 left-1 bg-green-500/80 text-white text-[8px] px-1.5 py-0.5 rounded-full">Public</span>
            )}

            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
              <button className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white" onClick={(e) => { e.stopPropagation(); onPreview(file); }} title="Preview">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white" onClick={(e) => { e.stopPropagation(); onDownload(file); }} title="Download">
                <Download className="w-3.5 h-3.5" />
              </button>
              {onRename && (
                <button className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white" onClick={(e) => { e.stopPropagation(); onRename(file); }} title="Rename">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {file.public_url && (
                <button className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white" onClick={(e) => { e.stopPropagation(); copyToClipboard(`${window.location.origin}${file.public_url}`); toast.success('URL copied'); }} title="Copy URL">
                  <Link2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button className="p-1.5 rounded-full bg-red-500/60 hover:bg-red-500/80 text-white" onClick={(e) => { e.stopPropagation(); onDelete(file); }} title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-2">
            <p className="text-[11px] font-medium truncate" title={file.original_name}>{file.original_name}</p>
            <p className="text-[9px] text-muted-foreground">{formatBytes(file.file_size)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── List View ─────────────────────────────────────────
function ListView({ files, source, onPreview, onDelete, onDownload, onRename, previewUrl }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b text-muted-foreground text-left">
          <th className="py-1.5 pl-2 font-medium w-8"></th>
          <th className="py-1.5 font-medium">Name</th>
          <th className="py-1.5 font-medium w-20">Size</th>
          <th className="py-1.5 font-medium w-20">Type</th>
          {source === 'buckets' && <th className="py-1.5 font-medium w-16">Status</th>}
          <th className="py-1.5 font-medium w-32">Date</th>
          <th className="py-1.5 font-medium w-28 text-right pr-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr key={file.id} className="border-b border-border/50 hover:bg-accent/50 cursor-pointer transition-colors" onClick={() => onPreview(file)}>
            <td className="py-1.5 pl-2">
              {file.mime_type?.startsWith('image/') ? (
                <img src={previewUrl(file)} alt="" className="w-5 h-5 rounded object-cover" loading="lazy" />
              ) : (
                <i className={`${getFileIcon(file)} text-sm`}></i>
              )}
            </td>
            <td className="py-1.5 font-medium truncate max-w-[200px]" title={file.original_name}>
              {file.original_name}
              {file.full_path && file.full_path !== file.original_name && (
                <span className="text-muted-foreground font-normal ml-1 text-[9px]">{file.full_path.split('/').slice(0, -1).join('/')}</span>
              )}
            </td>
            <td className="py-1.5 text-muted-foreground">{formatBytes(file.file_size)}</td>
            <td className="py-1.5">
              <Badge variant="secondary" className="text-[8px]">{file.category || getCategoryFromMime(file.mime_type)}</Badge>
            </td>
            {source === 'buckets' && (
              <td className="py-1.5">
                {file.is_public ? <Badge variant="success" className="text-[8px]">Public</Badge> : <Badge variant="outline" className="text-[8px]">Private</Badge>}
              </td>
            )}
            <td className="py-1.5 text-muted-foreground">{new Date(file.created_at).toLocaleDateString()}</td>
            <td className="py-1.5 text-right pr-2">
              <div className="flex items-center justify-end gap-0.5">
                {file.public_url && (
                  <button className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); copyToClipboard(`${window.location.origin}${file.public_url}`); toast.success('URL copied'); }} title="Copy URL">
                    <Link2 className="w-3 h-3" />
                  </button>
                )}
                <button className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onDownload(file); }} title="Download">
                  <Download className="w-3 h-3" />
                </button>
                {onRename && (
                  <button className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onRename(file); }} title="Rename">
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                <button className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(file); }} title="Delete">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
