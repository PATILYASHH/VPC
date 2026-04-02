import { useState, useEffect } from 'react';
import {
  Download, Terminal, Code, Package, Copy, Check, Monitor,
  ArrowLeft, Shield, Zap, GitBranch, FolderSync,
  Search, ChevronRight, Clock,
  HardDrive, Cpu, Box, Layers, RefreshCw, ArrowUpCircle,
  CheckCircle2, Loader2, GitCommit, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { toast } from 'sonner';

// ─── Product Catalog ─────────────────────────────────────────

const PRODUCTS = [
  {
    id: 'vpc-sync-cli',
    title: 'VPC Sync CLI',
    subtitle: 'Version Control from Terminal',
    category: 'cli',
    icon: Terminal,
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    accentColor: 'emerald',
    accentGradient: 'from-emerald-600/20 to-cyan-600/10',
    version: '1.0.0',
    size: '22 KB',
    downloadUrl: '/downloads/vpc-sync-cli.tar.gz',
    filename: 'vpc-sync-cli.tar.gz',
    featured: true,
    isNew: true,
    description: 'Full version control from terminal. Init, commit, push, pull, branch, merge — zero Git dependency.',
    longDescription: 'VPC Sync CLI is our custom-built version control system. It uses SHA-256 content-addressable storage to track your code with full branching, merging, and remote sync capabilities. Works directly with VPSHub repositories over HTTP.',
    features: [
      { icon: GitBranch, label: 'Branch & merge with 3-way conflict detection' },
      { icon: FolderSync, label: 'Push & pull to VPSHub over HTTP' },
      { icon: Shield, label: 'SHA-256 content-addressable object store' },
      { icon: Zap, label: 'Fast diffing with Myers algorithm' },
    ],
    requirements: 'Node.js 18+',
    platforms: ['Linux', 'macOS', 'Windows'],
    commands: [
      { cmd: 'vpc init', desc: 'Initialize a new repository' },
      { cmd: 'vpc clone <url>', desc: 'Clone a remote repository' },
      { cmd: 'vpc add -A', desc: 'Stage all changes' },
      { cmd: 'vpc commit -m "msg"', desc: 'Create a commit' },
      { cmd: 'vpc push', desc: 'Push to remote' },
      { cmd: 'vpc pull', desc: 'Pull from remote' },
      { cmd: 'vpc branch <name>', desc: 'Create a branch' },
      { cmd: 'vpc checkout <branch>', desc: 'Switch branches' },
      { cmd: 'vpc merge <branch>', desc: 'Merge a branch' },
      { cmd: 'vpc status', desc: 'Show working tree status' },
      { cmd: 'vpc log', desc: 'Show commit history' },
      { cmd: 'vpc diff', desc: 'Show changes' },
      { cmd: 'vpc remote add <n> <url>', desc: 'Add a remote' },
    ],
    installSteps: [
      { title: 'Download', code: 'curl -L {SERVER}/downloads/vpc-sync-cli.tar.gz | tar xz' },
      { title: 'Install', code: 'cd vpc-vcs && npm install && npm link' },
      { title: 'Verify', code: 'vpc --version' },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-29', changes: ['Initial release', 'Full push/pull/clone support', 'Branch & merge with 3-way conflict detection', 'Myers diff algorithm', 'SHA-256 content-addressable storage'] },
    ],
  },
  {
    id: 'vpc-sync-extension',
    title: 'VPC Sync for VS Code',
    subtitle: 'IDE Integration',
    category: 'extension',
    icon: Code,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    accentColor: 'blue',
    accentGradient: 'from-blue-600/20 to-indigo-600/10',
    version: '7.0.0',
    size: '56 KB',
    downloadUrl: '/downloads/vpc-sync.vsix',
    filename: 'vpc-sync.vsix',
    featured: true,
    isNew: false,
    description: 'Git-like Source Control in VS Code. Push creates PR, pull with one click. Full SCM + VPAI conflict resolution.',
    longDescription: 'The VPC Sync VS Code extension gives you a complete Git-like experience inside VS Code. Connect with your VPSHub token, select a repository, and get Push/Pull buttons, staged/unstaged file tracking, commit history, and branch display. Every push creates a PR for review.',
    features: [
      { icon: Layers, label: 'Git-like SCM panel with staged & unstaged files' },
      { icon: GitBranch, label: 'Push creates PR automatically for review' },
      { icon: Sparkles, label: 'VPAI conflict resolution integration' },
      { icon: Zap, label: 'Real-time file change detection & status bar' },
    ],
    requirements: 'VS Code 1.85+',
    platforms: ['VS Code'],
    commands: null,
    installSteps: [
      { title: 'Open VS Code', code: null, text: 'Open VS Code and press Ctrl+Shift+P' },
      { title: 'Install VSIX', code: null, text: 'Type "Install from VSIX" and select vpc-sync-7.0.0.vsix' },
      { title: 'Connect', code: null, text: 'Click the VPC Sync icon in the sidebar. Enter your server URL, username, and token.' },
    ],
    changelog: [
      { version: '7.0.0', date: '2026-04-01', changes: ['Push always creates PR (no direct merge)', 'VPAI conflict detection after push', 'Conflict notification with "Open PR" button', 'Merge-check integration'] },
      { version: '6.3.0', date: '2026-03-29', changes: ['Connection form with repo selector', 'Connected view with branch, Push/Pull, sync status'] },
    ],
  },
];

const CATEGORIES = [
  { id: 'all', label: 'Discover', icon: Sparkles },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'cli', label: 'Developer Tools', icon: Terminal },
  { id: 'extension', label: 'Extensions', icon: Code },
];

// ─── Main Store Component ────────────────────────────────────

export default function VpcStore() {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = PRODUCTS.filter(p => {
    if (activeCategory !== 'all' && activeCategory !== 'system' && p.category !== activeCategory) return false;
    if (activeCategory === 'system') return false; // system tab only shows upgrade
    if (searchQuery && !p.title.toLowerCase().includes(searchQuery.toLowerCase()) && !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (selectedProduct) {
    return <ProductDetail product={selectedProduct} onBack={() => setSelectedProduct(null)} />;
  }

  return (
    <div className="h-full flex flex-col surface-0">
      {/* Store Header — App Store style */}
      <div className="border-b border-white/[0.06]">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">VPC Store</h1>
              <p className="text-xs text-muted-foreground/50 mt-0.5">Tools, extensions & system updates</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] border-white/[0.08] text-muted-foreground/50">
                {PRODUCTS.length} apps
              </Badge>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/30" />
            <input
              type="text"
              placeholder="Search apps and tools..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white/[0.05] border border-white/[0.06] rounded-xl text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:border-white/[0.15] focus:bg-white/[0.07] transition-all"
            />
          </div>
        </div>

        {/* Category tabs — pill style */}
        <div className="px-6 pb-3 flex items-center gap-1.5 overflow-x-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-white/[0.12] text-foreground'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-white/[0.04]'
              }`}
            >
              <cat.icon className="w-3.5 h-3.5" />
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Software Upgrade */}
        {(activeCategory === 'all' || activeCategory === 'system') && !searchQuery && (
          <div className="px-6 pt-5">
            <SoftwareUpgrade />
          </div>
        )}

        {/* Featured Hero — only on Discover tab */}
        {activeCategory === 'all' && !searchQuery && (
          <div className="px-6 pt-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/30 mb-3">Featured</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {PRODUCTS.filter(p => p.featured).map(product => (
                <FeaturedCard key={product.id} product={product} onSelect={setSelectedProduct} />
              ))}
            </div>
          </div>
        )}

        {/* App list */}
        {(activeCategory !== 'all' && activeCategory !== 'system') && (
          <div className="px-6 py-5">
            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <Package className="w-10 h-10 text-muted-foreground/10 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground/30">No apps found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(product => (
                  <AppListItem key={product.id} product={product} onSelect={setSelectedProduct} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search results */}
        {searchQuery && (
          <div className="px-6 py-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/30 mb-3">
              Results for "{searchQuery}"
            </h2>
            {filtered.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-8 h-8 text-muted-foreground/10 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground/30">No matching apps</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(product => (
                  <AppListItem key={product.id} product={product} onSelect={setSelectedProduct} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* All apps list — on Discover tab below featured */}
        {activeCategory === 'all' && !searchQuery && (
          <div className="px-6 py-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/30 mb-3">All Apps</h2>
            <div className="space-y-2">
              {PRODUCTS.map(product => (
                <AppListItem key={product.id} product={product} onSelect={setSelectedProduct} />
              ))}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}

// ─── Software Upgrade ────────────────────────────────────────

function SoftwareUpgrade() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const [autoUpgrade, setAutoUpgrade] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);

  useEffect(() => {
    // Load cached upgrade check
    try {
      const cached = localStorage.getItem('vpc-upgrade-check');
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - new Date(data.lastChecked).getTime() < 600000) {
          setStatus(data);
        } else {
          checkForUpdates();
        }
      } else {
        checkForUpdates();
      }
    } catch { checkForUpdates(); }

    // Load auto-upgrade setting + pending restart status
    loadAutoUpgradeSettings();
  }, []);

  async function loadAutoUpgradeSettings() {
    try {
      const { data } = await api.get('/admin/vpshub/system/auto-upgrade');
      setAutoUpgrade(!!data.enabled);
      setPendingRestart(!!data.pendingRestart);
    } catch {}
  }

  async function toggleAutoUpgrade() {
    setTogglingAuto(true);
    try {
      const { data } = await api.post('/admin/vpshub/system/auto-upgrade', { enabled: !autoUpgrade });
      setAutoUpgrade(data.enabled);
      toast.success(data.enabled ? 'Auto-upgrade enabled (checks every 5 hours)' : 'Auto-upgrade disabled');
    } catch (err) {
      toast.error('Failed to update setting');
    } finally {
      setTogglingAuto(false);
    }
  }

  async function checkForUpdates() {
    setChecking(true);
    try {
      const { data } = await api.get('/admin/vpshub/system/upgrade-check');
      setStatus(data);
      localStorage.setItem('vpc-upgrade-check', JSON.stringify(data));
    } catch (err) {
      setStatus({ error: err.response?.data?.error || 'Failed to check' });
    } finally {
      setChecking(false);
    }
  }

  async function applyUpgrade() {
    if (!window.confirm('Upgrade VPC to the latest version?\n\nThe server will NOT restart automatically.\nYou can restart when ready.')) return;
    setUpgrading(true);
    try {
      await api.post('/admin/vpshub/system/upgrade-apply', {
        branch: status?.current?.branch || 'main',
        skipRestart: true,
      });
      toast.success('Upgrade in progress... You will need to restart when done.');
      // Poll until upgrade completes (check pending restart flag)
      const poll = setInterval(async () => {
        try {
          const { data } = await api.get('/admin/vpshub/system/auto-upgrade');
          if (data.pendingRestart) {
            clearInterval(poll);
            setPendingRestart(true);
            setUpgrading(false);
            localStorage.removeItem('vpc-upgrade-check');
            checkForUpdates();
            toast.success('Upgrade complete! Restart server when ready.');
          }
        } catch {}
      }, 5000);
      setTimeout(() => { clearInterval(poll); setUpgrading(false); }, 180000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upgrade failed');
      setUpgrading(false);
    }
  }

  async function restartServer() {
    if (!window.confirm('Restart the VPC server now?\n\nThe page will reload when the server is back.')) return;
    setRestarting(true);
    try {
      await api.post('/admin/vpshub/system/restart');
      toast.success('Restarting server...');
      setTimeout(() => {
        const poll = setInterval(async () => {
          try {
            await fetch('/health');
            clearInterval(poll);
            setPendingRestart(false);
            setRestarting(false);
            localStorage.removeItem('vpc-upgrade-check');
            window.location.reload();
          } catch {}
        }, 3000);
        setTimeout(() => clearInterval(poll), 120000);
      }, 3000);
    } catch {
      // Server probably already restarting
      setTimeout(() => {
        const poll = setInterval(async () => {
          try { await fetch('/health'); clearInterval(poll); window.location.reload(); } catch {}
        }, 3000);
        setTimeout(() => clearInterval(poll), 120000);
      }, 2000);
    }
  }

  const hasUpdate = status?.updateAvailable;

  return (
    <div className={`rounded-2xl overflow-hidden border transition-all ${
      pendingRestart ? 'border-amber-500/25 bg-gradient-to-r from-amber-500/8 via-[#12161f] to-orange-500/5' :
      hasUpdate ? 'border-violet-500/20 bg-gradient-to-r from-violet-500/8 via-[#12161f] to-indigo-500/8' :
      'border-white/[0.06] surface-1'
    }`}>
      {/* Main row */}
      <div className="p-4 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
          pendingRestart ? 'bg-amber-500/15' : hasUpdate ? 'bg-violet-500/15' : 'bg-white/[0.04]'
        }`}>
          {upgrading ? <Loader2 className="w-6 h-6 text-violet-400 animate-spin" /> :
           restarting ? <Loader2 className="w-6 h-6 text-amber-400 animate-spin" /> :
           pendingRestart ? <RefreshCw className="w-6 h-6 text-amber-400" /> :
           hasUpdate ? <ArrowUpCircle className="w-6 h-6 text-violet-400" /> :
           <CheckCircle2 className="w-6 h-6 text-emerald-500/70" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Software Update</span>
            {pendingRestart && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px]">RESTART NEEDED</Badge>}
            {!pendingRestart && hasUpdate && <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-[9px]">NEW</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5">
            {restarting ? 'Restarting server...' :
             upgrading ? 'Downloading & installing update...' :
             pendingRestart ? 'Upgrade installed. Restart to apply changes.' :
             hasUpdate ? `${status.behindCount} update${status.behindCount !== 1 ? 's' : ''} available` :
             status?.error && !status?.current ? status.error :
             status ? 'VPC is up to date' : 'Checking...'}
          </p>
          {status?.current && !pendingRestart && (
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/30">
              <span className="font-mono">{status.current.hash}</span>
              <span>{status.current.branch}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pendingRestart && !restarting && (
            <Button size="sm" onClick={restartServer} className="bg-amber-600 hover:bg-amber-700 text-xs h-8 px-4">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Restart
            </Button>
          )}
          {hasUpdate && !upgrading && !pendingRestart && (
            <Button size="sm" onClick={applyUpgrade} className="bg-violet-600 hover:bg-violet-700 text-xs h-8 px-4">
              Update
            </Button>
          )}
          <button
            onClick={checkForUpdates}
            disabled={checking || upgrading || restarting}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/[0.06] transition-colors disabled:opacity-30"
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expandable commits */}
      {hasUpdate && status.newCommits?.length > 0 && !pendingRestart && (
        <div className="px-4 pb-3 border-t border-white/[0.04]">
          <button onClick={() => setShowCommits(!showCommits)} className="flex items-center gap-1 text-[11px] text-violet-400/70 hover:text-violet-400 mt-2 mb-1 transition-colors">
            <ChevronRight className={`w-3 h-3 transition-transform ${showCommits ? 'rotate-90' : ''}`} />
            What's new
          </button>
          {showCommits && (
            <div className="space-y-0.5 max-h-[160px] overflow-y-auto mt-1">
              {status.newCommits.map((c, i) => (
                <div key={i} className="flex items-center gap-2 py-1 px-2 rounded text-[11px]">
                  <span className="font-mono text-violet-400/50 shrink-0">{c.hash}</span>
                  <span className="text-muted-foreground/60 truncate">{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {upgrading && (
        <div className="px-4 pb-3">
          <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
            <div className="h-full bg-violet-500/50 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Auto-upgrade toggle */}
      <div className="px-4 py-2.5 border-t border-white/[0.04] flex items-center justify-between">
        <div>
          <span className="text-[11px] text-muted-foreground/50">Automatic Updates</span>
          <span className="text-[10px] text-muted-foreground/25 ml-2">Checks every 5 hours</span>
        </div>
        <button
          onClick={toggleAutoUpgrade}
          disabled={togglingAuto}
          className={`relative w-9 h-5 rounded-full transition-colors ${
            autoUpgrade ? 'bg-violet-600' : 'bg-white/[0.08]'
          }`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            autoUpgrade ? 'left-[18px]' : 'left-0.5'
          }`} />
        </button>
      </div>
    </div>
  );
}

// ─── Featured Card (App Store hero style) ────────────────────

function FeaturedCard({ product, onSelect }) {
  return (
    <button
      onClick={() => onSelect(product)}
      className={`w-full text-left rounded-2xl border border-white/[0.06] bg-gradient-to-br ${product.accentGradient} p-5 hover:border-white/[0.12] transition-all group overflow-hidden relative`}
    >
      {/* Subtle glow */}
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/[0.02] blur-3xl" />

      <div className="relative flex items-start gap-4">
        <div className={`w-14 h-14 rounded-[18px] ${product.iconBg} flex items-center justify-center shrink-0 shadow-lg`}>
          <product.icon className={`w-7 h-7 ${product.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {product.isNew && <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-[8px] px-1.5 py-0">NEW</Badge>}
            <Badge variant="outline" className="text-[9px] border-white/[0.1]">v{product.version}</Badge>
          </div>
          <h3 className="text-base font-bold mb-0.5">{product.title}</h3>
          <p className="text-[11px] text-muted-foreground/50 leading-relaxed line-clamp-2">{product.description}</p>

          <div className="flex items-center gap-3 mt-3">
            <button className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              product.accentColor === 'emerald' ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-blue-500 text-white hover:bg-blue-400'
            }`}>
              <Download className="w-3 h-3" /> Get
            </button>
            <span className="text-[10px] text-muted-foreground/30">{product.size}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── App List Item (App Store list style) ────────────────────

function AppListItem({ product, onSelect }) {
  const [downloading, setDownloading] = useState(false);

  function handleDownload(e) {
    e.stopPropagation();
    setDownloading(true);
    const a = document.createElement('a');
    a.href = product.downloadUrl;
    a.download = product.filename;
    a.click();
    setTimeout(() => setDownloading(false), 2000);
  }

  return (
    <div
      onClick={() => onSelect(product)}
      className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.03] cursor-pointer transition-all group"
    >
      <div className={`w-12 h-12 rounded-[14px] ${product.iconBg} flex items-center justify-center shrink-0`}>
        <product.icon className={`w-6 h-6 ${product.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold truncate">{product.title}</h3>
          {product.isNew && <Badge className="bg-emerald-500/20 text-emerald-400 border-0 text-[8px] px-1.5 py-0">NEW</Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground/40 truncate">{product.description}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/30">
          <span>v{product.version}</span>
          <span>{product.size}</span>
        </div>
      </div>
      <button
        onClick={handleDownload}
        className={`px-4 py-1.5 rounded-full text-[11px] font-semibold shrink-0 transition-all ${
          downloading
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-white/[0.08] text-blue-400 hover:bg-white/[0.12]'
        }`}
      >
        {downloading ? <Check className="w-3.5 h-3.5" /> : 'Get'}
      </button>
    </div>
  );
}

// ─── Product Detail View (App Store detail page) ─────────────

function ProductDetail({ product, onBack }) {
  const [copiedCmd, setCopiedCmd] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const serverUrl = window.location.origin;

  function copyCommand(id, text) {
    navigator.clipboard.writeText(text.replace('{SERVER}', serverUrl));
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  }

  function handleDownload() {
    setDownloading(true);
    const a = document.createElement('a');
    a.href = product.downloadUrl;
    a.download = product.filename;
    a.click();
    setTimeout(() => setDownloading(false), 2000);
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'install', label: 'Install' },
    ...(product.commands ? [{ id: 'commands', label: 'Commands' }] : []),
    { id: 'changelog', label: "What's New" },
  ];

  return (
    <div className="h-full flex flex-col surface-0">
      {/* Detail Header */}
      <div className="border-b border-white/[0.06]">
        <div className="px-6 pt-4 pb-5">
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground mb-5 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Store
          </button>

          <div className="flex items-start gap-5">
            <div className={`w-[72px] h-[72px] rounded-[20px] ${product.iconBg} flex items-center justify-center shrink-0 shadow-lg shadow-black/20`}>
              <product.icon className={`w-9 h-9 ${product.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold">{product.title}</h1>
              <p className="text-xs text-muted-foreground/40 mt-0.5">{product.subtitle}</p>

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handleDownload}
                  className={`inline-flex items-center gap-2 px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                    downloading
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : product.accentColor === 'emerald'
                        ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                  }`}
                >
                  {downloading ? <><Check className="w-4 h-4" /> Done</> : <><Download className="w-4 h-4" /> Get</>}
                </button>
              </div>

              <div className="flex items-center gap-5 mt-3 text-[11px] text-muted-foreground/30">
                <span className="flex items-center gap-1"><Box className="w-3 h-3" /> v{product.version}</span>
                <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> {product.size}</span>
                <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {product.requirements}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 flex items-center gap-0.5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-white text-foreground'
                  : 'border-transparent text-muted-foreground/30 hover:text-muted-foreground/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && (
          <div className="max-w-3xl space-y-8">
            <p className="text-sm text-muted-foreground/60 leading-relaxed">{product.longDescription}</p>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/25 mb-4">Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {product.features.map((feat, i) => (
                  <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className={`w-9 h-9 rounded-xl ${product.iconBg} flex items-center justify-center shrink-0`}>
                      <feat.icon className={`w-4 h-4 ${product.iconColor}`} />
                    </div>
                    <span className="text-xs text-muted-foreground/50 leading-relaxed pt-2">{feat.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/25 mb-3">Compatibility</h3>
              <div className="flex gap-2">
                {product.platforms.map(p => (
                  <span key={p} className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] text-xs text-muted-foreground/40">{p}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'install' && (
          <div className="max-w-3xl space-y-5">
            {product.installSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className={`w-7 h-7 rounded-full bg-white/[0.06] text-muted-foreground/40 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1.5">{step.title}</p>
                  {step.code ? (
                    <div className="relative group">
                      <pre className="text-[11px] surface-0 border border-white/[0.06] rounded-xl p-3.5 overflow-x-auto font-mono text-muted-foreground/50">
                        {step.code.replace('{SERVER}', serverUrl)}
                      </pre>
                      <button
                        onClick={() => copyCommand(`install-${i}`, step.code)}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copiedCmd === `install-${i}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground/40" />}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/40">{step.text}</p>
                  )}
                </div>
              </div>
            ))}

            {product.commands && (
              <div className="mt-6 pt-6 border-t border-white/[0.04]">
                <h4 className="text-xs font-semibold mb-3">Quick Start</h4>
                <div className="relative group">
                  <pre className="text-[11px] surface-0 border border-white/[0.06] rounded-xl p-3.5 overflow-x-auto font-mono text-muted-foreground/50 leading-relaxed">
{`vpc init
vpc add -A
vpc commit -m "Initial commit"
vpc remote add origin ${serverUrl}/vcs/your-user/your-repo
vpc push origin main`}
                  </pre>
                  <button
                    onClick={() => copyCommand('quickstart', `vpc init\nvpc add -A\nvpc commit -m "Initial commit"\nvpc remote add origin ${serverUrl}/vcs/your-user/your-repo\nvpc push origin main`)}
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copiedCmd === 'quickstart' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground/40" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'commands' && product.commands && (
          <div className="max-w-3xl">
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              {product.commands.map((c, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors group">
                  <code className="text-[11px] font-mono text-emerald-400/80 w-[220px] shrink-0">{c.cmd}</code>
                  <span className="text-[11px] text-muted-foreground/40 flex-1">{c.desc}</span>
                  <button
                    onClick={() => copyCommand(`cmd-${i}`, c.cmd)}
                    className="p-1 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
                  >
                    {copiedCmd === `cmd-${i}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'changelog' && (
          <div className="max-w-3xl space-y-6">
            {product.changelog.map((release, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">Version {release.version}</span>
                  <span className="text-[10px] text-muted-foreground/25">{release.date}</span>
                </div>
                <ul className="space-y-1.5 pl-1">
                  {release.changes.map((change, j) => (
                    <li key={j} className="text-xs text-muted-foreground/50 flex items-start gap-2">
                      <span className="text-emerald-500/50 mt-1 shrink-0">+</span>
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
