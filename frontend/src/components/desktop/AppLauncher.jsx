import { useState, useEffect, useRef } from 'react';
import { Search, X, Pin, PinOff } from 'lucide-react';
import useDesktopStore from '@/stores/useDesktopStore';
import useWindowStore from '@/stores/useWindowStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY, { APP_CATEGORIES } from '@/lib/appRegistry';
import useIsMobile from '@/hooks/useIsMobile';

export default function AppLauncher() {
  const closeLauncher = useDesktopStore((s) => s.closeLauncher);
  const openWindow = useWindowStore((s) => s.openWindow);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isPinned = useDesktopStore((s) => s.isPinned);
  const pinApp = useDesktopStore((s) => s.pinApp);
  const unpinApp = useDesktopStore((s) => s.unpinApp);
  const isMobile = useIsMobile();
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [search, setSearch] = useState('');

  // Permission-filtered (not search-filtered) — pin state shouldn't depend on
  // whatever's currently typed in the search box.
  const permittedAppIds = Object.values(APP_REGISTRY)
    .filter((app) => !app.permission || hasPermission(app.permission))
    .map((app) => app.id);

  const togglePin = (e, appId) => {
    e.stopPropagation();
    if (isPinned(appId)) unpinApp(appId, permittedAppIds);
    else pinApp(appId, permittedAppIds);
  };

  useEffect(() => {
    searchRef.current?.focus();
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        closeLauncher();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') closeLauncher();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [closeLauncher]);

  const allApps = Object.values(APP_REGISTRY).filter((app) => {
    if (app.permission && !hasPermission(app.permission)) return false;
    if (search) {
      const q = search.toLowerCase();
      return app.title.toLowerCase().includes(q) || app.description?.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by category
  const grouped = {};
  for (const app of allApps) {
    const cat = app.category || 'system';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(app);
  }

  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => (APP_CATEGORIES[a]?.order ?? 99) - (APP_CATEGORIES[b]?.order ?? 99)
  );

  function handleOpen(appId) {
    openWindow(appId);
    closeLauncher();
  }

  // Mobile: full-screen launcher
  if (isMobile) {
    return (
      <div
        ref={ref}
        className="fixed inset-0 z-[10000] flex flex-col animate-fade-in"
        style={{ background: 'var(--surface-0)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-3 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-background border border-border/50">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <button
            onClick={closeLauncher}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* App Grid */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {sortedCategories.map((cat) => (
            <div key={cat}>
              {!search && (
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1 mb-3">
                  {APP_CATEGORIES[cat]?.label || cat}
                </p>
              )}
              <div className="grid grid-cols-4 gap-1">
                {grouped[cat].map((app) => {
                  const Icon = app.icon;
                  const pinned = isPinned(app.id);
                  return (
                    <button
                      key={app.id}
                      onClick={() => handleOpen(app.id)}
                      className="relative flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/[0.06] active:scale-95 transition-all duration-150 group"
                    >
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => togglePin(e, app.id)}
                        title={pinned ? 'Remove from Desktop' : 'Add to Desktop'}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center bg-black/40 text-white/80 hover:bg-black/60 hover:text-white transition-colors"
                      >
                        {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </span>
                      <div className={`w-12 h-12 rounded-xl ${app.iconBg || 'bg-primary/10'} flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 ${app.iconColor || 'text-primary'}`} />
                      </div>
                      <span className="text-[11px] text-foreground/80 text-center leading-tight truncate w-full font-medium">
                        {app.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {allApps.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">No apps found</p>
          )}
        </div>
      </div>
    );
  }

  // Desktop: positioned launcher popup
  return (
    <div
      ref={ref}
      className="absolute bottom-14 left-2 w-[340px] bg-card/95 backdrop-blur-xl border border-border/80 rounded-xl shadow-2xl z-[10000] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      {/* Search */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border/50">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {/* App Grid */}
      <div className="p-3 max-h-[420px] overflow-y-auto space-y-4">
        {sortedCategories.map((cat) => (
          <div key={cat}>
            {!search && (
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1 mb-2">
                {APP_CATEGORIES[cat]?.label || cat}
              </p>
            )}
            <div className="grid grid-cols-3 gap-1">
              {grouped[cat].map((app) => {
                const Icon = app.icon;
                const pinned = isPinned(app.id);
                return (
                  <button
                    key={app.id}
                    onClick={() => handleOpen(app.id)}
                    className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-white/[0.06] transition-all duration-150 group"
                  >
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => togglePin(e, app.id)}
                      title={pinned ? 'Remove from Desktop' : 'Add to Desktop'}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center bg-black/0 text-muted-foreground/0 group-hover:bg-black/40 group-hover:text-white/80 hover:!bg-black/60 hover:!text-white transition-colors"
                    >
                      {pinned ? <PinOff className="w-2.5 h-2.5" /> : <Pin className="w-2.5 h-2.5" />}
                    </span>
                    <div className={`w-11 h-11 rounded-xl ${app.iconBg || 'bg-primary/10'} flex items-center justify-center group-hover:scale-110 transition-transform duration-150`}>
                      <Icon className={`w-5.5 h-5.5 ${app.iconColor || 'text-primary'}`} />
                    </div>
                    <span className="text-[11px] text-foreground/80 text-center leading-tight truncate w-full font-medium">
                      {app.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {allApps.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">No apps found</p>
        )}
      </div>
    </div>
  );
}
