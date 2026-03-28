import { useState } from 'react';
import { Folder, File, ChevronRight, ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const FILE_ICONS = {
  js: '📄', jsx: '📄', ts: '📄', tsx: '📄',
  json: '📋', md: '📝', txt: '📝',
  html: '🌐', css: '🎨', scss: '🎨',
  py: '🐍', go: '📦', rs: '🦀',
  sql: '🗃️', yml: '⚙️', yaml: '⚙️',
  sh: '⚡', bat: '⚡',
  png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
};

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] || null;
}

function getLanguage(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', go: 'go', rs: 'rust', rb: 'ruby',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c',
    html: 'html', css: 'css', scss: 'scss',
    json: 'json', yml: 'yaml', yaml: 'yaml',
    sql: 'sql', sh: 'bash', md: 'markdown',
    dart: 'dart', swift: 'swift', kt: 'kotlin',
  };
  return map[ext] || 'text';
}

export default function CodeBrowser({ owner, repo, branch }) {
  const [currentPath, setCurrentPath] = useState('');
  const [viewingFile, setViewingFile] = useState(null);

  const treePath = currentPath
    ? `/admin/vpshub/repos/${owner}/${repo}/tree/${branch}/${currentPath}`
    : `/admin/vpshub/repos/${owner}/${repo}/tree/${branch}`;

  const { data: treeData, isLoading: treeLoading } = useApiQuery(
    ['vpshub-tree', owner, repo, branch, currentPath],
    treePath
  );

  const { data: fileData, isLoading: fileLoading } = useApiQuery(
    ['vpshub-blob', owner, repo, branch, viewingFile],
    `/admin/vpshub/repos/${owner}/${repo}/blob/${branch}/${viewingFile}`,
    { enabled: !!viewingFile }
  );

  const { data: readmeData } = useApiQuery(
    ['vpshub-readme', owner, repo, branch],
    `/admin/vpshub/repos/${owner}/${repo}/readme/${branch}`,
    { enabled: !viewingFile && !currentPath }
  );

  const tree = treeData?.tree || [];
  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  function navigateToDir(dirPath) {
    setViewingFile(null);
    setCurrentPath(dirPath);
  }

  function navigateToFile(filePath) {
    setViewingFile(filePath);
  }

  function handleItemClick(item) {
    if (item.type === 'tree') {
      navigateToDir(item.path);
    } else {
      navigateToFile(item.path);
    }
  }

  // File viewer
  if (viewingFile) {
    const fileName = viewingFile.split('/').pop();
    const language = getLanguage(fileName);

    return (
      <div className="p-4">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 mb-3 text-xs">
          <button onClick={() => { setViewingFile(null); setCurrentPath(''); }} className="text-primary hover:underline">
            {repo}
          </button>
          {viewingFile.split('/').map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              {i === arr.length - 1 ? (
                <span className="font-medium">{part}</span>
              ) : (
                <button
                  onClick={() => {
                    setViewingFile(null);
                    setCurrentPath(arr.slice(0, i + 1).join('/'));
                  }}
                  className="text-primary hover:underline"
                >
                  {part}
                </button>
              )}
            </span>
          ))}
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-card border-b">
            <span className="text-xs font-medium">{fileName}</span>
            <span className="text-xs text-muted-foreground">{language}</span>
          </div>
          {fileLoading ? (
            <div className="p-8 flex justify-center"><LoadingSpinner /></div>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs font-mono">
                <tbody>
                  {(fileData?.content || '').split('\n').map((line, i) => (
                    <tr key={i} className="hover:bg-accent/30">
                      <td className="text-right text-muted-foreground select-none px-3 py-0.5 border-r w-[1%] whitespace-nowrap">
                        {i + 1}
                      </td>
                      <td className="px-3 py-0.5 whitespace-pre">{line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Directory listing
  return (
    <div className="p-4">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-3 text-xs">
        <button onClick={() => navigateToDir('')} className="text-primary hover:underline font-medium">
          {repo}
        </button>
        {breadcrumbs.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            {i === breadcrumbs.length - 1 ? (
              <span className="font-medium">{part}</span>
            ) : (
              <button
                onClick={() => navigateToDir(breadcrumbs.slice(0, i + 1).join('/'))}
                className="text-primary hover:underline"
              >
                {part}
              </button>
            )}
          </span>
        ))}
      </div>

      {treeLoading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : tree.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileText className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">This directory is empty</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          {tree.map((item, i) => (
            <button
              key={item.name}
              onClick={() => handleItemClick(item)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-xs hover:bg-accent/30 transition-colors text-left ${
                i > 0 ? 'border-t' : ''
              }`}
            >
              {item.type === 'tree' ? (
                <Folder className="w-4 h-4 text-blue-400 shrink-0" />
              ) : (
                <File className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className={`flex-1 ${item.type === 'tree' ? 'font-medium' : ''}`}>
                {item.name}
              </span>
              {item.size !== null && (
                <span className="text-muted-foreground text-[10px]">
                  {item.size > 1024 ? `${(item.size / 1024).toFixed(1)} KB` : `${item.size} B`}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* README */}
      {readmeData?.readme && !currentPath && (
        <div className="mt-4 border rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-card border-b flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">{readmeData.readme.name}</span>
          </div>
          <div className="p-4 text-sm prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/80">
              {readmeData.readme.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
