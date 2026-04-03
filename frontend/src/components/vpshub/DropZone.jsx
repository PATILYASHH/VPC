import { useState, useRef, useCallback } from 'react';
import { Upload, FolderUp, FileCode, Sparkles, Loader2, Check, X, Database, Globe, Zap, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function DropZone({ owner, repo, branch, onUploadComplete }) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [basePath, setBasePath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAiOptions, setShowAiOptions] = useState(false);
  const [aiRequirements, setAiRequirements] = useState('');
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiReview, setAiReview] = useState(null);
  const [aiFixing, setAiFixing] = useState(false);
  const [showQuickDeploy, setShowQuickDeploy] = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  // Folders to skip automatically (heavy/unnecessary)
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.next', '.nuxt', '__pycache__', '.cache',
    'dist', 'build', '.idea', '.gradle', 'vendor', '.dart_tool',
    '.pub-cache', 'target', 'bin', 'obj', '.angular',
  ]);

  const processEntries = async (entries) => {
    const fileList = [];

    async function readEntry(entry, basePath = '') {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file) => {
            const relativePath = basePath ? `${basePath}/${file.name}` : file.name;
            Object.defineProperty(file, 'relativePath', { value: relativePath });
            fileList.push(file);
            resolve();
          }, () => resolve()); // skip unreadable files
        });
      } else if (entry.isDirectory) {
        // Skip heavy folders
        if (SKIP_DIRS.has(entry.name)) return;

        const dirReader = entry.createReader();
        return new Promise((resolve) => {
          const readAll = (allEntries = []) => {
            dirReader.readEntries(async (entries) => {
              if (entries.length === 0) {
                for (const e of allEntries) {
                  await readEntry(e, basePath ? `${basePath}/${entry.name}` : entry.name);
                }
                resolve();
              } else {
                readAll([...allEntries, ...entries]);
              }
            }, () => resolve()); // skip unreadable dirs
          };
          readAll();
        });
      }
    }

    for (const entry of entries) {
      await readEntry(entry);
    }
    return fileList;
  };

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items) return;

    // Use webkitGetAsEntry for folder support
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    if (entries.length > 0) {
      const processedFiles = await processEntries(entries);
      setFiles(prev => [...prev, ...processedFiles]);
    } else {
      // Fallback: regular file drop
      const droppedFiles = Array.from(e.dataTransfer.files);
      droppedFiles.forEach(f => {
        Object.defineProperty(f, 'relativePath', { value: f.name });
      });
      setFiles(prev => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    selectedFiles.forEach(f => {
      const path = f.webkitRelativePath || f.name;
      Object.defineProperty(f, 'relativePath', { value: path });
    });
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setFiles([]);
    setAiReview(null);
    setShowAiOptions(false);
  };

  const uploadFiles = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress('Uploading files...');

    try {
      const formData = new FormData();
      files.forEach(f => {
        // Use relativePath as the filename to preserve folder structure
        formData.append('files', f, f.relativePath || f.name);
      });
      formData.append('branch', branch || 'main');
      formData.append('message', commitMessage || `Upload ${files.length} file(s) via drop`);
      if (basePath) formData.append('basePath', basePath);

      const { data } = await api.post(
        `/admin/vpshub/repos/${owner}/${repo}/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      toast.success(data.message || `${data.filesCount} file(s) saved successfully!`);
      // Show notifications from server (e.g. conflict auto-resolve info)
      if (data.notifications) {
        data.notifications.forEach(n => {
          if (n.type === 'conflicts_auto_resolving') {
            toast.info(n.message, { duration: 8000 });
          }
        });
      }
      setFiles([]);
      setCommitMessage('');
      setBasePath('');
      setUploadProgress(null);
      setShowQuickDeploy(true);
      if (onUploadComplete) onUploadComplete();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const runAiReview = async () => {
    setAiReviewing(true);
    setAiReview(null);
    try {
      const { data } = await api.post(
        `/admin/vpshub/repos/${owner}/${repo}/ai-review-fix`,
        { requirements: aiRequirements, branch: branch || 'main' }
      );
      setAiReview(data.response || data.message || 'Review complete');
      toast.success('AI review complete');
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI review failed');
    } finally {
      setAiReviewing(false);
    }
  };

  const runAiFix = async () => {
    setAiFixing(true);
    try {
      const { data } = await api.post(
        `/admin/vpshub/repos/${owner}/${repo}/ai-auto-fix`,
        { requirements: aiRequirements, branch: branch || 'main' }
      );
      if (data.applied) {
        toast.success(`AI fixed ${data.filesFixed} file(s): ${data.message}`);
        if (onUploadComplete) onUploadComplete();
      } else {
        toast.info(data.message);
        if (data.review) setAiReview(data.review);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI fix failed');
    } finally {
      setAiFixing(false);
    }
  };

  const linkDatabase = async () => {
    try {
      const { data: projects } = await api.get('/admin/vpshub/projects');
      if (projects.length === 0) {
        toast.info('No database projects found. Create one in the Database tab first.');
        return;
      }
      // Link to first available project (or show selection)
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/link-db`, {
        projectId: projects[0].id,
      });
      toast.success('Database linked! Go to Settings to run migrations.');
      if (onUploadComplete) onUploadComplete();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to link database');
    }
  };

  const createHosting = async () => {
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/create-hosting`, {
        type: 'static',
      });
      toast.success('Hosting created! Deploy from Settings tab.');
      if (onUploadComplete) onUploadComplete();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create hosting');
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-violet-400 bg-violet-500/10 scale-[1.01]'
            : 'border-white/[0.1] bg-white/[0.02] hover:border-white/[0.2] hover:bg-white/[0.04]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex flex-col items-center gap-3">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${
            isDragging ? 'bg-violet-500/20' : 'bg-white/[0.06]'
          }`}>
            {isDragging ? (
              <FolderUp className="w-8 h-8 text-violet-400 animate-bounce" />
            ) : (
              <Upload className="w-8 h-8 text-muted-foreground" />
            )}
          </div>

          <div>
            <p className="text-sm font-medium">
              {isDragging ? 'Drop files or folders here' : 'Drag & drop your code here'}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Drop entire project folders, individual files, or click to browse
            </p>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 border-white/[0.08]"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <FileCode className="w-3 h-3 mr-1.5" /> Select Files
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 border-white/[0.08]"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
            >
              <FolderUp className="w-3 h-3 mr-1.5" /> Select Folder
            </Button>
          </div>
        </div>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="border border-white/[0.06] rounded-xl bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{files.length} file(s)</span>
              <span className="text-[10px] text-muted-foreground/60">{formatSize(totalSize)}</span>
            </div>
            <div className="flex items-center gap-3">
              {uploadPreview && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  {uploadPreview.newFiles.length > 0 && (
                    <span className="text-emerald-400">{uploadPreview.newFiles.length} new</span>
                  )}
                  {uploadPreview.modifiedFiles.length > 0 && (
                    <span className="text-amber-400">{uploadPreview.modifiedFiles.length} updated</span>
                  )}
                  {uploadPreview.unchangedFiles.length > 0 && (
                    <span className="text-muted-foreground/40">{uploadPreview.unchangedFiles.length} same</span>
                  )}
                </div>
              )}
              <button
                onClick={clearFiles}
                className="text-[10px] text-muted-foreground hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>

          <div className="max-h-48 overflow-auto">
            {files.map((file, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-1.5 hover:bg-white/[0.02] text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="truncate text-muted-foreground">{file.relativePath || file.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground/40">{formatSize(file.size)}</span>
                  <button onClick={() => removeFile(i)} className="text-muted-foreground/40 hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Upload Options */}
          <div className="border-t border-white/[0.06] p-3 space-y-2">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Describe your changes (optional)"
              className="w-full text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 placeholder:text-muted-foreground/30 focus:outline-none focus:border-violet-500/40"
            />

            {/* Advanced options (hidden by default for non-programmers) */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
            </button>

            {showAdvanced && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={basePath}
                  onChange={(e) => setBasePath(e.target.value)}
                  placeholder="Subfolder path (optional)"
                  className="flex-1 text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 placeholder:text-muted-foreground/30 focus:outline-none focus:border-violet-500/40"
                />
                <span className="text-[10px] text-muted-foreground/40">Branch: {branch || 'main'}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={uploadFiles}
                disabled={uploading}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-xs h-8"
              >
                {uploading ? (
                  <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> {uploadProgress || 'Saving...'}</>
                ) : (
                  <><Upload className="w-3 h-3 mr-1.5" /> Save {files.length} file(s)</>
                )}
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground/40 text-center">
              Don't worry about conflicts — AI will handle them automatically
            </p>
          </div>
        </div>
      )}

      {/* AI Code Review Section */}
      <div className="border border-white/[0.06] rounded-xl bg-white/[0.02] overflow-hidden">
        <button
          onClick={() => setShowAiOptions(!showAiOptions)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium">AI Code Review & Fix</p>
              <p className="text-[10px] text-muted-foreground/50">Let Claude review, fix, and optimize your code</p>
            </div>
          </div>
          <ArrowRight className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${showAiOptions ? 'rotate-90' : ''}`} />
        </button>

        {showAiOptions && (
          <div className="border-t border-white/[0.06] p-3 space-y-3">
            <textarea
              value={aiRequirements}
              onChange={(e) => setAiRequirements(e.target.value)}
              placeholder="Describe your requirements... (e.g., 'Fix all security issues', 'Add error handling', 'Convert to TypeScript', 'Make it production-ready')"
              rows={3}
              className="w-full text-xs bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 placeholder:text-muted-foreground/30 focus:outline-none focus:border-violet-500/40 resize-none"
            />

            <div className="flex items-center gap-2">
              <Button
                onClick={runAiReview}
                disabled={aiReviewing || aiFixing}
                variant="outline"
                className="flex-1 text-xs h-8 border-white/[0.08]"
              >
                {aiReviewing ? (
                  <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Reviewing...</>
                ) : (
                  <><Sparkles className="w-3 h-3 mr-1.5" /> Review Code</>
                )}
              </Button>
              <Button
                onClick={runAiFix}
                disabled={aiReviewing || aiFixing}
                className="flex-1 text-xs h-8 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {aiFixing ? (
                  <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Fixing...</>
                ) : (
                  <><Zap className="w-3 h-3 mr-1.5" /> Auto-Fix Code</>
                )}
              </Button>
            </div>

            {aiReview && (
              <div className="border border-white/[0.06] rounded-lg bg-white/[0.02] p-3 max-h-72 overflow-auto">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3 h-3 text-violet-400" />
                  <span className="text-[10px] font-medium text-violet-400">AI Review</span>
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {aiReview}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Deploy Section */}
      {showQuickDeploy && (
        <div className="border border-white/[0.06] rounded-xl bg-white/[0.02] p-4 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium">Quick Deploy</span>
            <span className="text-[10px] text-muted-foreground/50">Set up hosting & database in one click</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={linkDatabase}
              className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-emerald-500/5 hover:border-emerald-500/20 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                <Database className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="text-xs font-medium">Connect Database</p>
                <p className="text-[10px] text-muted-foreground/50">Link a DB project</p>
              </div>
            </button>

            <button
              onClick={createHosting}
              className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-blue-500/5 hover:border-blue-500/20 transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                <Globe className="w-5 h-5 text-blue-400" />
              </div>
              <div className="text-left">
                <p className="text-xs font-medium">Host Website</p>
                <p className="text-[10px] text-muted-foreground/50">Deploy from this repo</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
