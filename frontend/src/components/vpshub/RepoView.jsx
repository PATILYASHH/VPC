import { useState, useEffect } from 'react';
import { ArrowLeft, GitBranch, Code, GitCommit, Tag, Settings, ChevronDown, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import CodeBrowser from './CodeBrowser';
import CommitHistory from './CommitHistory';

const TABS = [
  { id: 'code', label: 'Code', icon: Code },
  { id: 'commits', label: 'Commits', icon: GitCommit },
];

export default function RepoView({ repo, onBack }) {
  const [activeTab, setActiveTab] = useState('code');
  const [currentRef, setCurrentRef] = useState(null);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch repo details with branches
  const { data, isLoading } = useApiQuery(
    ['vpshub-repo', repo.owner_username, repo.slug],
    `/admin/vpshub/repos/${repo.owner_username}/${repo.slug}`
  );

  const repoDetail = data?.repo;
  const branches = repoDetail?.branches || [];

  useEffect(() => {
    if (repoDetail && !currentRef) {
      setCurrentRef(repoDetail.default_branch || 'main');
    }
  }, [repoDetail, currentRef]);

  const cloneUrl = `${window.location.origin}/git/${repo.owner_username}/${repo.slug}.git`;

  function copyCloneUrl() {
    navigator.clipboard.writeText(cloneUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <span className="font-semibold">{repo.owner_username}</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold">{repo.name}</span>
            <Badge variant="outline" className="text-xs">
              {repo.visibility}
            </Badge>
          </div>
        </div>

        {repo.description && (
          <div className="px-4 pb-2">
            <p className="text-sm text-muted-foreground">{repo.description}</p>
          </div>
        )}

        {/* Clone URL */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <code className="flex-1 text-xs bg-background border rounded px-3 py-1.5 font-mono truncate">
            {cloneUrl}
          </code>
          <Button variant="outline" size="sm" onClick={copyCloneUrl} className="gap-1.5 shrink-0">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Clone'}
          </Button>
        </div>

        {/* Tabs + Branch Selector */}
        <div className="px-4 flex items-center gap-4 border-t">
          {/* Branch selector */}
          {repoDetail?.has_commits && (
            <div className="relative py-2">
              <button
                onClick={() => setShowBranchPicker(!showBranchPicker)}
                className="flex items-center gap-1.5 px-3 py-1 rounded border bg-background text-xs font-medium hover:bg-accent transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                {currentRef}
                <ChevronDown className="w-3 h-3 opacity-50" />
              </button>
              {showBranchPicker && (
                <div className="absolute top-full left-0 mt-1 bg-card border rounded-lg shadow-xl z-50 min-w-[200px] max-h-60 overflow-auto">
                  <div className="p-2 border-b">
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">Branches</p>
                  </div>
                  {branches.map(branch => (
                    <button
                      key={branch.name}
                      onClick={() => {
                        setCurrentRef(branch.name);
                        setShowBranchPicker(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                        currentRef === branch.name ? 'bg-accent/50 font-medium' : ''
                      }`}
                    >
                      {branch.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab bar */}
          <div className="flex items-center gap-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        {!repoDetail?.has_commits ? (
          <EmptyRepoView cloneUrl={cloneUrl} repoName={repo.name} />
        ) : activeTab === 'code' && currentRef ? (
          <CodeBrowser owner={repo.owner_username} repo={repo.slug} branch={currentRef} />
        ) : activeTab === 'commits' && currentRef ? (
          <CommitHistory owner={repo.owner_username} repo={repo.slug} branch={currentRef} />
        ) : null}
      </div>
    </div>
  );
}

function EmptyRepoView({ cloneUrl, repoName }) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h3 className="text-lg font-semibold mb-4">Quick setup</h3>

      <div className="space-y-6">
        <div className="border rounded-lg p-4 bg-card">
          <h4 className="font-medium text-sm mb-3">Create a new repository on the command line</h4>
          <pre className="text-xs bg-background rounded p-3 overflow-x-auto font-mono text-muted-foreground">
{`echo "# ${repoName}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin ${cloneUrl}
git push -u origin main`}
          </pre>
        </div>

        <div className="border rounded-lg p-4 bg-card">
          <h4 className="font-medium text-sm mb-3">Push an existing repository</h4>
          <pre className="text-xs bg-background rounded p-3 overflow-x-auto font-mono text-muted-foreground">
{`git remote add origin ${cloneUrl}
git branch -M main
git push -u origin main`}
          </pre>
        </div>
      </div>
    </div>
  );
}
