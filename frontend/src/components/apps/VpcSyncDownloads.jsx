import { useState } from 'react';
import { Download, Terminal, Code, Package, Copy, Check, Monitor, ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const CLI_VERSION = '1.0.0';
const EXTENSION_VERSION = '8.0.0';

export default function VpcSyncDownloads() {
  const [copiedCmd, setCopiedCmd] = useState(null);

  function copyCommand(id, text) {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  }

  const serverUrl = window.location.origin;

  return (
    <div className="h-full overflow-auto surface-0">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 via-transparent to-cyan-600/10" />
        <div className="relative max-w-4xl mx-auto px-6 py-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-4">
            <RefreshCw className="w-3 h-3" />
            VPC Sync v{CLI_VERSION}
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            VPC Sync
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto leading-relaxed">
            Our own version control system. Push, pull, clone, branch, merge &mdash; all without Git.
            Custom-built for VPC with SHA-256 content-addressable storage.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Download Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CLI Download */}
          <div className="border border-white/[0.06] rounded-xl surface-1 p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Terminal className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">VPC CLI</h3>
                <p className="text-xs text-muted-foreground">Command-line tool</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[10px] border-emerald-500/30 text-emerald-400">v{CLI_VERSION}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Full version control from your terminal. Init, add, commit, push, pull, branch, merge, diff, and more.
            </p>
            <div className="mt-auto flex gap-2">
              <a
                href="/downloads/vpc-sync-cli.tar.gz"
                download
                className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-500 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download .tar.gz
              </a>
            </div>
          </div>

          {/* VS Code Extension */}
          <div className="border border-white/[0.06] rounded-xl surface-1 p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Code className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">VS Code Extension</h3>
                <p className="text-xs text-muted-foreground">IDE integration</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[10px] border-blue-500/30 text-blue-400">v{EXTENSION_VERSION}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Native Source Control panel integration with push, pull, migration management, and PR viewer.
            </p>
            <div className="mt-auto flex gap-2">
              <a
                href="/downloads/vpc-sync.vsix"
                download
                className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download .vsix
              </a>
            </div>
          </div>
        </div>

        {/* Installation Guide */}
        <div className="border border-white/[0.06] rounded-xl surface-1 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <Package className="w-4 h-4 text-violet-400" />
            <h2 className="font-semibold text-sm">Quick Install</h2>
          </div>

          <div className="p-6 space-y-5">
            {/* Step 1: Install */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold flex items-center justify-center">1</span>
                <span className="text-xs font-medium">Download and install the CLI</span>
              </div>
              <CodeBlock
                id="install"
                text={`# Download and extract\ncurl -L ${serverUrl}/downloads/vpc-sync-cli.tar.gz | tar xz\n\n# Install globally\ncd vpc-vcs && npm install && npm link`}
                copied={copiedCmd}
                onCopy={copyCommand}
              />
            </div>

            {/* Step 2: Clone */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold flex items-center justify-center">2</span>
                <span className="text-xs font-medium">Clone a repository</span>
              </div>
              <CodeBlock
                id="clone"
                text={`vpc clone ${serverUrl}/vcs/your-username/your-repo`}
                copied={copiedCmd}
                onCopy={copyCommand}
              />
            </div>

            {/* Step 3: Configure remote auth */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold flex items-center justify-center">3</span>
                <span className="text-xs font-medium">Set up authentication (PAT token)</span>
              </div>
              <CodeBlock
                id="auth"
                text={`vpc remote set-token origin vpshub_your_token_here`}
                copied={copiedCmd}
                onCopy={copyCommand}
              />
            </div>

            {/* Step 4: Start working */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold flex items-center justify-center">4</span>
                <span className="text-xs font-medium">Start working</span>
              </div>
              <CodeBlock
                id="workflow"
                text={`# Make changes, then:\nvpc add -A\nvpc commit -m "Your commit message"\nvpc push`}
                copied={copiedCmd}
                onCopy={copyCommand}
              />
            </div>
          </div>
        </div>

        {/* All Commands Reference */}
        <div className="border border-white/[0.06] rounded-xl surface-1 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h2 className="font-semibold text-sm">Command Reference</h2>
          </div>

          <div className="divide-y divide-white/[0.04]">
            <CommandRow cmd="vpc init" desc="Initialize a new VPC repository" />
            <CommandRow cmd="vpc clone <url>" desc="Clone a remote repository" />
            <CommandRow cmd="vpc add <files...>" desc="Stage files for commit" />
            <CommandRow cmd="vpc add -A" desc="Stage all changes" />
            <CommandRow cmd="vpc status" desc="Show working tree status" />
            <CommandRow cmd="vpc commit -m <msg>" desc="Create a commit" />
            <CommandRow cmd="vpc log" desc="Show commit history" />
            <CommandRow cmd="vpc diff" desc="Show unstaged changes" />
            <CommandRow cmd="vpc diff --staged" desc="Show staged changes" />
            <CommandRow cmd="vpc branch" desc="List branches" />
            <CommandRow cmd="vpc branch <name>" desc="Create a new branch" />
            <CommandRow cmd="vpc checkout <branch>" desc="Switch branches" />
            <CommandRow cmd="vpc checkout -b <name>" desc="Create and switch to new branch" />
            <CommandRow cmd="vpc merge <branch>" desc="Merge a branch into current" />
            <CommandRow cmd="vpc push" desc="Push commits to remote" />
            <CommandRow cmd="vpc pull" desc="Pull commits from remote" />
            <CommandRow cmd="vpc remote add <n> <url>" desc="Add a remote" />
            <CommandRow cmd="vpc remote list" desc="List all remotes" />
            <CommandRow cmd="vpc remote set-token <n> <t>" desc="Set auth token for remote" />
          </div>
        </div>

        {/* VS Code Setup */}
        <div className="border border-white/[0.06] rounded-xl surface-1 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <Monitor className="w-4 h-4 text-blue-400" />
            <h2 className="font-semibold text-sm">VS Code Extension Setup</h2>
          </div>

          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-xs font-medium">Install the extension</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Open VS Code → Extensions → <code className="bg-white/[0.06] px-1 rounded">...</code> menu → Install from VSIX → Select the downloaded <code className="bg-white/[0.06] px-1 rounded">vpc-sync.vsix</code>
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-xs font-medium">Configure settings</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Set <code className="bg-white/[0.06] px-1 rounded">vpcSync.vpshubUrl</code> to <code className="bg-white/[0.06] px-1 rounded">{serverUrl}</code>, add your PAT token and repository details.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-xs font-medium">Start syncing</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Open the Source Control panel — VPC Sync appears as a native SCM provider. Stage, commit, push, and pull right from the sidebar.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pb-8">
          <p className="text-[11px] text-muted-foreground/50">
            VPC Sync — Custom version control built for VPC. SHA-256 content-addressable storage. No Git required.
          </p>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ id, text, copied, onCopy }) {
  return (
    <div className="relative group">
      <pre className="text-[11px] surface-0 border border-white/[0.06] rounded-lg p-3 overflow-x-auto font-mono text-muted-foreground leading-relaxed">
        {text}
      </pre>
      <button
        onClick={() => onCopy(id, text)}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/[0.06] border border-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied === id
          ? <Check className="w-3 h-3 text-emerald-400" />
          : <Copy className="w-3 h-3 text-muted-foreground" />
        }
      </button>
    </div>
  );
}

function CommandRow({ cmd, desc }) {
  return (
    <div className="flex items-center gap-4 px-6 py-2.5 hover:bg-white/[0.02] transition-colors">
      <code className="text-[11px] font-mono text-emerald-400 w-[260px] shrink-0">{cmd}</code>
      <span className="text-[11px] text-muted-foreground">{desc}</span>
    </div>
  );
}
