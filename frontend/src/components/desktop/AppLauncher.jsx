import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import useDesktopStore from '@/stores/useDesktopStore';
import useWindowStore from '@/stores/useWindowStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY, { APP_CATEGORIES } from '@/lib/appRegistry';

export default function AppLauncher() {
  const closeLauncher = useDesktopStore((s) => s.closeLauncher);
  const openWindow = useWindowStore((s) => s.openWindow);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [search, setSearch] = useState('');

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
                return (
                  <button
                    key={app.id}
                    onClick={() => handleOpen(app.id)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-white/[0.06] transition-all duration-150 group"
                  >
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
