import { useState, useEffect } from 'react';
import { ArrowLeft, GitBranch, Code, GitCommit, GitPullRequest, CircleDot, Settings, ChevronDown, Copy, Check, Database, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import CodeBrowser from './CodeBrowser';
import CommitHistory from './CommitHistory';
import CodePullRequests from './CodePullRequests';
import CodePRDetail from './CodePRDetail';
import IssueList from './IssueList';
import IssueDetail from './IssueDetail';
import RepoSettings from './RepoSettings';

const TABS = [
  { id: 'code', label: 'Code', icon: Code },
  { id: 'commits', label: 'Commits', icon: GitCommit },
  { id: 'pulls', label: 'Pull Requests', icon: GitPullRequest },
  { id: 'issues', label: 'Issues', icon: CircleDot },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function RepoView({ repo, onBack }) {
  const [activeTab, setActiveTab] = useState('code');
  const [currentRef, setCurrentRef] = useState(null);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedPR, setSelectedPR] = useState(null);
  const [selectedIssue, setSelectedIssue] = useState(null);

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

  function switchTab(tabId) {
    setActiveTab(tabId);
    setSelectedPR(null);
    setSelectedIssue(null);
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
      <div className="border-b border-white/[0.06] bg-[#161b22]">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-violet-400" />
            <span className="font-medium text-sm text-muted-foreground">{repo.owner_username}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="font-semibold text-sm">{repo.name}</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 border-white/[0.08] ${
              repo.visibility === 'public' ? 'text-emerald-400' : 'text-muted-foreground'
            }`}>
              {repo.visibility}
            </Badge>
          </div>

          {/* Connected services */}
          {(repo.linked_project_id || repo.linked_hosting_id) && (
            <div className="flex items-center gap-1.5 ml-2">
              {repo.linked_project_id && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] text-emerald-400 border border-emerald-500/20">
                  <Database className="w-2.5 h-2.5" /> DB Connected
                </span>
              )}
              {repo.linked_hosting_id && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-[10px] text-blue-400 border border-blue-500/20">
                  <Globe className="w-2.5 h-2.5" /> Hosted
                </span>
              )}
            </div>
          )}
        </div>

        {repo.description && (
          <div className="px-4 pb-2">
            <p className="text-xs text-muted-foreground/60">{repo.description}</p>
          </div>
        )}

        {/* Clone URL */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <code className="flex-1 text-[11px] bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 font-mono truncate text-muted-foreground">
            {cloneUrl}
          </code>
          <Button variant="outline" size="sm" onClick={copyCloneUrl} className="gap-1.5 shrink-0 h-7 text-xs border-white/[0.08]">
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Clone'}
          </Button>
        </div>

        {/* Tabs + Branch Selector */}
        <div className="px-4 flex items-center gap-3 border-t border-white/[0.04]">
          {/* Branch selector */}
          {repoDetail?.has_commits && (activeTab === 'code' || activeTab === 'commits') && (
            <div className="relative py-2">
              <button
                onClick={() => setShowBranchPicker(!showBranchPicker)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs font-medium hover:bg-white/[0.06] transition-colors"
              >
                <GitBranch className="w-3 h-3 text-muted-foreground" />
                {currentRef}
                <ChevronDown className="w-3 h-3 opacity-40" />
              </button>
              {showBranchPicker && (
                <div className="absolute top-full left-0 mt-1 bg-[#1c2128] border border-white/[0.08] rounded-xl shadow-2xl z-50 min-w-[200px] max-h-60 overflow-auto">
                  <div className="p-2 border-b border-white/[0.06]">
                    <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider px-2 py-1">Branches</p>
                  </div>
                  {branches.map(branch => (
                    <button
                      key={branch.name}
                      onClick={() => {
                        setCurrentRef(branch.name);
                        setShowBranchPicker(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/[0.05] transition-colors ${
                        currentRef === branch.name ? 'bg-white/[0.04] text-violet-400 font-medium' : 'text-muted-foreground'
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
          <div className="flex items-center gap-0.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-violet-400 text-foreground'
                    : 'border-transparent text-muted-foreground/60 hover:text-foreground/80'
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
      <div className="flex-1 overflow-auto p-4">
        {!repoDetail?.has_commits && activeTab === 'code' ? (
          <EmptyRepoView cloneUrl={cloneUrl} repoName={repo.name} />
        ) : activeTab === 'code' && currentRef ? (
          <CodeBrowser owner={repo.owner_username} repo={repo.slug} branch={currentRef} />
        ) : activeTab === 'commits' && currentRef ? (
          <CommitHistory owner={repo.owner_username} repo={repo.slug} branch={currentRef} />
        ) : activeTab === 'pulls' ? (
          selectedPR ? (
            <CodePRDetail
              owner={repo.owner_username}
              repo={repo.slug}
              prNumber={selectedPR}
              onBack={() => setSelectedPR(null)}
            />
          ) : (
            <CodePullRequests
              owner={repo.owner_username}
              repo={repo.slug}
              branches={branches}
              onSelectPR={setSelectedPR}
            />
          )
        ) : activeTab === 'issues' ? (
          selectedIssue ? (
            <IssueDetail
              owner={repo.owner_username}
              repo={repo.slug}
              issueNumber={selectedIssue}
              onBack={() => setSelectedIssue(null)}
            />
          ) : (
            <IssueList
              owner={repo.owner_username}
              repo={repo.slug}
              onSelectIssue={setSelectedIssue}
            />
          )
        ) : activeTab === 'settings' ? (
          <RepoSettings owner={repo.owner_username} repo={repo.slug} />
        ) : null}
      </div>
    </div>
  );
}

function EmptyRepoView({ cloneUrl, repoName }) {
  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <h3 className="text-lg font-semibold mb-4">Quick setup</h3>

      <div className="space-y-4">
        <div className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.02]">
          <h4 className="font-medium text-sm mb-3 text-foreground/80">Create a new repository on the command line</h4>
          <pre className="text-xs bg-white/[0.03] rounded-lg p-3 overflow-x-auto font-mono text-muted-foreground">
{`echo "# ${repoName}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin ${cloneUrl}
git push -u origin main`}
          </pre>
        </div>

        <div className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.02]">
          <h4 className="font-medium text-sm mb-3 text-foreground/80">Push an existing repository</h4>
          <pre className="text-xs bg-white/[0.03] rounded-lg p-3 overflow-x-auto font-mono text-muted-foreground">
{`git remote add origin ${cloneUrl}
git branch -M main
git push -u origin main`}
          </pre>
        </div>
      </div>
    </div>
  );
}
