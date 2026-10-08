import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { pop } from './motion';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  keywords?: string;
  run: () => void;
}

/** ⌘K / Ctrl+K: keyboard-first navigation across everything the current user may open. */
export function CommandPalette({ commands, placeholder }: { commands: Command[]; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-command-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  const groups = [...new Set(results.map((r) => r.group))];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.div
            role="dialog"
            aria-modal="true"
            variants={pop}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-muted" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(results.length - 1, a + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === 'Enter') run(results[active]);
                }}
                placeholder={placeholder}
                aria-label={placeholder}
                className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
              />
              <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2" role="listbox">
              {groups.map((g) => (
                <div key={g}>
                  <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{g}</div>
                  {results
                    .filter((r) => r.group === g)
                    .map((c) => {
                      const idx = results.indexOf(c);
                      return (
                        <button
                          key={c.id}
                          role="option"
                          aria-selected={idx === active}
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => run(c)}
                          className={cn('relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm', idx === active ? 'text-fg' : 'text-muted')}
                        >
                          {idx === active && <motion.span layoutId="cmd-active" className="absolute inset-0 rounded-lg bg-surface-2" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                          <span className="relative text-brand-text">{c.icon}</span>
                          <span className="relative flex-1">{c.label}</span>
                          {idx === active && <CornerDownLeft className="relative size-3.5" />}
                        </button>
                      );
                    })}
                </div>
              ))}
              {!results.length && <p className="px-3 py-6 text-center text-sm text-muted">—</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
