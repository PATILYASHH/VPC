import { useState } from 'react';
import {
  Download, Terminal, Code, Package, Copy, Check, Monitor,
  ArrowLeft, Star, Shield, Zap, GitBranch, FolderSync,
  Search, Filter, ChevronRight, ExternalLink, Clock,
  HardDrive, Cpu, Box, Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
    version: '1.0.0',
    size: '22 KB',
    downloadUrl: '/downloads/vpc-sync-cli.tar.gz',
    filename: 'vpc-sync-cli.tar.gz',
    featured: true,
    isNew: true,
    description: 'Full version control system from your terminal. Init, add, commit, push, pull, branch, merge, diff — everything you need, zero Git dependency.',
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
    version: '6.3.0',
    size: '35 KB',
    downloadUrl: '/downloads/vpc-sync.vsix',
    filename: 'vpc-sync.vsix',
    featured: true,
    isNew: false,
    description: 'Git-like Source Control in VS Code. Connect with VPSHub token, select a repo, push and pull with one click. Full SCM integration.',
    longDescription: 'The VPC Sync VS Code extension gives you a complete Git-like experience inside VS Code. Connect with your VPSHub token, select a repository, and get Push/Pull buttons, staged/unstaged file tracking, commit history, and branch display — all using the custom VPC VCS protocol.',
    features: [
      { icon: Layers, label: 'Git-like SCM panel — staged, changes, untracked' },
      { icon: GitBranch, label: 'Push & Pull buttons with commit counts' },
      { icon: Shield, label: 'Connect with VPSHub token + repo selector' },
      { icon: Zap, label: 'Real-time file change detection & status bar' },
    ],
    requirements: 'VS Code 1.80+',
    platforms: ['VS Code'],
    commands: null,
    installSteps: [
      { title: 'Open VS Code', code: null, text: 'Open VS Code and go to the Extensions panel' },
      { title: 'Install VSIX', code: null, text: 'Click the ··· menu → "Install from VSIX..." → select vpc-sync.vsix' },
      { title: 'Configure', code: null, text: 'Set vpcSync.vpshubUrl, vpshubToken, vpshubOwner, vpshubRepo in settings' },
    ],
    changelog: [
      { version: '6.3.0', date: '2026-03-29', changes: ['Proper connection form UI in sidebar', 'All fields in one view — URL, Username, Token', 'Click Connect to load repos, click repo to clone', 'Connected view with branch, Push/Pull, sync status'] },
      { version: '6.2.0', date: '2026-03-29', changes: ['Sidebar icon in activity bar', 'Welcome view with Connect button'] },
      { version: '6.1.0', date: '2026-03-29', changes: ['Compact Git-like design — native SCM only', 'Quick Pick connect flow', 'Status bar branch + sync arrows'] },
    ],
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All', icon: Box },
  { id: 'cli', label: 'CLI Tools', icon: Terminal },
  { id: 'extension', label: 'Extensions', icon: Code },
];

// ─── Main Store Component ────────────────────────────────────

export default function VpcStore() {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = PRODUCTS.filter(p => {
    if (activeCategory !== 'all' && p.category !== activeCategory) return false;
    if (searchQuery && !p.title.toLowerCase().includes(searchQuery.toLowerCase()) && !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (selectedProduct) {
    return <ProductDetail product={selectedProduct} onBack={() => setSelectedProduct(null)} />;
  }

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      {/* Store Header */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-600/8 via-transparent to-orange-600/8" />
        <div className="relative px-6 py-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">VPC Store</h1>
              <p className="text-xs text-muted-foreground">Download tools & extensions for VPC</p>
            </div>
            <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/30 text-amber-400">
              {PRODUCTS.length} available
            </Badge>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search tools & extensions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-6 py-2 border-b border-white/[0.04] flex items-center gap-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeCategory === cat.id
                ? 'bg-amber-500/15 text-amber-400'
                : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/[0.04]'
            }`}
          >
            <cat.icon className="w-3.5 h-3.5" />
            {cat.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Featured Banner */}
        {activeCategory === 'all' && !searchQuery && (
          <div className="px-6 pt-5 pb-2">
            <FeaturedBanner product={PRODUCTS[0]} onSelect={setSelectedProduct} />
          </div>
        )}

        {/* Product Grid */}
        <div className="px-6 py-4">
          {activeCategory === 'all' && !searchQuery && (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">All Tools</h2>
          )}
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground/50">No tools found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(product => (
                <ProductCard key={product.id} product={product} onSelect={setSelectedProduct} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Featured Banner ─────────────────────────────────────────

function FeaturedBanner({ product, onSelect }) {
  return (
    <button
      onClick={() => onSelect(product)}
      className="w-full text-left border border-white/[0.06] rounded-2xl bg-gradient-to-br from-emerald-500/5 via-[#161b22] to-cyan-500/5 p-6 hover:border-emerald-500/30 transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className={`w-14 h-14 rounded-2xl ${product.iconBg} flex items-center justify-center shrink-0`}>
          <product.icon className={`w-7 h-7 ${product.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {product.isNew && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] px-1.5 py-0">NEW</Badge>
            )}
            <Badge variant="outline" className="text-[10px] border-white/[0.1]">v{product.version}</Badge>
          </div>
          <h3 className="text-base font-semibold mb-1">{product.title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{product.description}</p>
          <div className="flex items-center gap-3 mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium group-hover:gap-2 transition-all">
              View Details <ChevronRight className="w-3 h-3" />
            </span>
            <span className="text-[10px] text-muted-foreground/40">{product.size}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Product Card ────────────────────────────────────────────

function ProductCard({ product, onSelect }) {
  const [downloading, setDownloading] = useState(false);

  function handleDownload(e) {
    e.stopPropagation();
    setDownloading(true);
    // Trigger download via hidden link
    const a = document.createElement('a');
    a.href = product.downloadUrl;
    a.download = product.filename;
    a.click();
    setTimeout(() => setDownloading(false), 2000);
  }

  return (
    <div
      onClick={() => onSelect(product)}
      className="border border-white/[0.06] rounded-xl bg-[#161b22] p-5 flex flex-col cursor-pointer hover:border-white/[0.12] hover:bg-[#1c2128] transition-all group"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl ${product.iconBg} flex items-center justify-center shrink-0`}>
          <product.icon className={`w-5 h-5 ${product.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{product.title}</h3>
            {product.isNew && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] px-1.5 py-0">NEW</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60">{product.subtitle}</p>
        </div>
        <Badge variant="outline" className="text-[10px] border-white/[0.08] shrink-0">v{product.version}</Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-4 leading-relaxed line-clamp-2 flex-1">
        {product.description}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {product.platforms.map(p => (
          <span key={p} className="px-2 py-0.5 rounded-md bg-white/[0.04] text-[10px] text-muted-foreground/60 border border-white/[0.04]">
            {p}
          </span>
        ))}
        <span className="px-2 py-0.5 rounded-md bg-white/[0.04] text-[10px] text-muted-foreground/60 border border-white/[0.04]">
          {product.size}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        <button
          onClick={handleDownload}
          className={`flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${
            downloading
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : product.accentColor === 'emerald'
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {downloading ? (
            <><Check className="w-3.5 h-3.5" /> Downloaded</>
          ) : (
            <><Download className="w-3.5 h-3.5" /> Download</>
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(product); }}
          className="px-3 py-2 rounded-lg text-xs font-medium border border-white/[0.08] text-muted-foreground hover:bg-white/[0.04] transition-colors"
        >
          Details
        </button>
      </div>
    </div>
  );
}

// ─── Product Detail View ─────────────────────────────────────

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
    { id: 'install', label: 'Installation' },
    ...(product.commands ? [{ id: 'commands', label: 'Commands' }] : []),
    { id: 'changelog', label: 'Changelog' },
  ];

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      {/* Detail Header */}
      <div className="border-b border-white/[0.06] bg-[#161b22]">
        <div className="px-6 py-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Store
          </button>

          <div className="flex items-start gap-4">
            <div className={`w-16 h-16 rounded-2xl ${product.iconBg} flex items-center justify-center shrink-0`}>
              <product.icon className={`w-8 h-8 ${product.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold">{product.title}</h1>
                {product.isNew && (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px]">NEW</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-3">{product.subtitle}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleDownload}
                  className={`inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                    downloading
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : product.accentColor === 'emerald'
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                  }`}
                >
                  {downloading ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                  {downloading ? 'Downloaded!' : `Download ${product.filename}`}
                </button>
                <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
                  <span className="flex items-center gap-1"><Box className="w-3 h-3" /> v{product.version}</span>
                  <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> {product.size}</span>
                  <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {product.requirements}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 flex items-center gap-0.5 border-t border-white/[0.04]">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? `border-${product.accentColor}-400 text-foreground`
                  : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground'
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
          <div className="max-w-3xl space-y-6">
            {/* Description */}
            <div>
              <p className="text-sm text-muted-foreground leading-relaxed">{product.longDescription}</p>
            </div>

            {/* Features */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {product.features.map((feat, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-white/[0.04] bg-white/[0.02]">
                    <div className={`w-8 h-8 rounded-lg ${product.iconBg} flex items-center justify-center shrink-0`}>
                      <feat.icon className={`w-4 h-4 ${product.iconColor}`} />
                    </div>
                    <span className="text-xs text-muted-foreground leading-relaxed pt-1.5">{feat.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Platforms */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">Platforms</h3>
              <div className="flex gap-2">
                {product.platforms.map(p => (
                  <span key={p} className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-muted-foreground">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'install' && (
          <div className="max-w-3xl space-y-5">
            <h3 className="text-sm font-semibold mb-4">Installation Guide</h3>
            {product.installSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`w-6 h-6 rounded-full bg-${product.accentColor}-500/20 text-${product.accentColor}-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                  {i + 1}
                </span>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1.5">{step.title}</p>
                  {step.code ? (
                    <div className="relative group">
                      <pre className="text-[11px] bg-[#0d1117] border border-white/[0.06] rounded-lg p-3 overflow-x-auto font-mono text-muted-foreground">
                        {step.code.replace('{SERVER}', serverUrl)}
                      </pre>
                      <button
                        onClick={() => copyCommand(`install-${i}`, step.code)}
                        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/[0.06] border border-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copiedCmd === `install-${i}`
                          ? <Check className="w-3 h-3 text-emerald-400" />
                          : <Copy className="w-3 h-3 text-muted-foreground" />
                        }
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{step.text}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Quick start after install */}
            {product.commands && (
              <div className="mt-6 pt-6 border-t border-white/[0.06]">
                <h4 className="text-xs font-semibold mb-3">Quick Start</h4>
                <div className="relative group">
                  <pre className="text-[11px] bg-[#0d1117] border border-white/[0.06] rounded-lg p-3 overflow-x-auto font-mono text-muted-foreground leading-relaxed">
{`# Create a new repo
vpc init
vpc add -A
vpc commit -m "Initial commit"

# Connect to VPSHub
vpc remote add origin ${serverUrl}/vcs/your-user/your-repo
vpc push origin main`}
                  </pre>
                  <button
                    onClick={() => copyCommand('quickstart', `vpc init\nvpc add -A\nvpc commit -m "Initial commit"\nvpc remote add origin ${serverUrl}/vcs/your-user/your-repo\nvpc push origin main`)}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-white/[0.06] border border-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copiedCmd === 'quickstart'
                      ? <Check className="w-3 h-3 text-emerald-400" />
                      : <Copy className="w-3 h-3 text-muted-foreground" />
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'commands' && product.commands && (
          <div className="max-w-3xl">
            <h3 className="text-sm font-semibold mb-4">Command Reference</h3>
            <div className="border border-white/[0.06] rounded-xl overflow-hidden">
              <div className="divide-y divide-white/[0.04]">
                {product.commands.map((c, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-2.5 hover:bg-white/[0.02] transition-colors group">
                    <code className="text-[11px] font-mono text-emerald-400 w-[240px] shrink-0">{c.cmd}</code>
                    <span className="text-[11px] text-muted-foreground flex-1">{c.desc}</span>
                    <button
                      onClick={() => copyCommand(`cmd-${i}`, c.cmd)}
                      className="p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                    >
                      {copiedCmd === `cmd-${i}`
                        ? <Check className="w-3 h-3 text-emerald-400" />
                        : <Copy className="w-3 h-3 text-muted-foreground" />
                      }
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'changelog' && (
          <div className="max-w-3xl space-y-6">
            <h3 className="text-sm font-semibold mb-4">Release History</h3>
            {product.changelog.map((release, i) => (
              <div key={i} className="border-l-2 border-white/[0.08] pl-4 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-[10px] border-${product.accentColor}-500/30 text-${product.accentColor}-400`}>
                    v{release.version}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {release.date}
                  </span>
                </div>
                <ul className="space-y-1">
                  {release.changes.map((change, j) => (
                    <li key={j} className="text-xs text-muted-foreground flex items-start gap-2">
                      <span className="text-emerald-500 mt-1.5 shrink-0">+</span>
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
