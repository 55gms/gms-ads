import { CornerDownLeft, Globe, Image, LayoutDashboard, LogOut, Megaphone, Plus, Search, SunMoon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { api, get } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { fuzzy, sizeLabel } from '../lib/format.js';
import { useDebounced, useEscape, useFocusTrap, usePresence, useScrollLock } from '../lib/hooks.js';
import { setCommandOpen, toggleTheme, useCommandOpen } from '../lib/stores.js';

const NO_RESULTS = { campaigns: [], creatives: [], domains: [] };

// ⌘K / Ctrl+K: fuzzy search over pages and actions, plus live results for
// campaigns, creatives, and domains.
export function CommandMenu({ pages, onSignOut, canWrite }) {
  const open = useCommandOpen();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const [mounted, state] = usePresence(open, 150);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [found, setFound] = useState({ q: '', data: NO_RESULTS });
  const debounced = useDebounced(query.trim(), 150);
  // Results only count while they belong to the current query.
  const remote = open && found.q === debounced ? found.data : NO_RESULTS;

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    let current = true;
    if (!open || debounced.length < 2) return undefined;
    get(api('/search'), { q: debounced })
      .then((data) => current && setFound({ q: debounced, data }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [open, debounced]);

  const close = () => {
    setCommandOpen(false);
    setQuery('');
    setActive(0);
  };
  useEscape(open, close);
  useFocusTrap(mounted && open, panelRef);
  useScrollLock(mounted);

  const groups = useMemo(() => {
    const go = (to) => () => navigate(to, { viewTransition: true });
    const local = [
      ...pages.map((page) => ({ group: 'Pages', label: page.label, icon: LayoutDashboard, run: go(page.to) })),
      ...(canWrite
        ? [
            { group: 'Actions', label: 'New campaign', icon: Plus, run: go('/campaigns?new=1') },
            { group: 'Actions', label: 'Upload creative', icon: Image, run: go('/creatives') },
            { group: 'Actions', label: 'Add domains', icon: Globe, run: go('/domains?import=1') },
          ]
        : []),
      { group: 'Actions', label: 'Toggle theme', icon: SunMoon, run: toggleTheme },
      { group: 'Actions', label: 'Sign out', icon: LogOut, run: onSignOut },
    ]
      .map((item) => ({ ...item, score: fuzzy(query.trim(), item.label) }))
      .filter((item) => item.score !== null)
      .sort((a, b) => (a.group === b.group ? a.score - b.score : 0));
    const matches = [
      ...remote.campaigns.map((c) => ({ group: 'Campaigns', label: c.name, icon: Megaphone, run: go(`/campaigns?edit=${c.id}`) })),
      ...remote.creatives.map((c) => ({ group: 'Creatives', label: `${sizeLabel(`${c.width}x${c.height}`)}${c.alt_text ? ` · ${c.alt_text}` : ''}`, icon: Image, run: go(`/creatives?preview=${c.id}`) })),
      ...remote.domains.map((d) => ({ group: 'Domains', label: d.hostname, icon: Globe, mono: true, run: go(`/domains?search=${encodeURIComponent(d.hostname)}`) })),
    ];
    return [...matches, ...local];
  }, [pages, canWrite, query, remote, navigate, onSignOut]);

  const index = Math.min(active, Math.max(0, groups.length - 1));

  const run = (item) => {
    if (!item) return;
    close();
    item.run();
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + groups.length) % Math.max(1, groups.length);
      setActive(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(groups[index]);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
      <div data-motion data-state={state} className="absolute inset-0 bg-gray-alpha-500 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        data-motion
        data-state={state}
        style={{ '--pop-y': '0px' }}
        className="relative flex max-h-[min(480px,70dvh)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-gray-400 bg-raised shadow-modal data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
      >
        <div className="flex items-center gap-3 border-b border-gray-400 px-4">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" className="text-gray-700" />
          <input
            data-autofocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={groups[index] ? `command-${index}` : undefined}
            aria-label="Search pages, campaigns, creatives, and domains"
            placeholder="Search or run a command"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 flex-1 bg-transparent copy-14 outline-none focus-visible:shadow-none"
          />
          <kbd className="rounded-[4px] border border-gray-400 px-1.5 font-mono copy-12 text-gray-900">Esc</kbd>
        </div>
        <ul ref={listRef} id="command-list" role="listbox" aria-label="Results" className="overflow-auto p-2">
          {groups.length === 0 && <li className="px-2 py-6 text-center copy-14 text-gray-900">No results for “{query}”</li>}
          {groups.map((item, i) => (
            <li key={`${item.group}-${item.label}-${i}`} role="presentation">
              {(i === 0 || groups[i - 1].group !== item.group) && <p className="px-2 pt-2 pb-1 copy-12 text-gray-700">{item.group}</p>}
              <button
                type="button"
                id={`command-${i}`}
                role="option"
                aria-selected={i === index}
                data-index={i}
                tabIndex={-1}
                onMouseMove={() => setActive(i)}
                onClick={() => run(item)}
                className={cx('flex h-10 w-full items-center gap-3 rounded-sm px-2 text-left copy-14 max-md:h-11', i === index && 'bg-gray-alpha-200')}
              >
                <item.icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-gray-900" />
                <span className={cx('min-w-0 flex-1 truncate', item.mono && 'font-mono copy-13')}>{item.label}</span>
                {i === index && <CornerDownLeft size={14} strokeWidth={1.5} aria-hidden="true" className="text-gray-700" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
