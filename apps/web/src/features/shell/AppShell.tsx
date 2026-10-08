import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { LogOut, Menu, Moon, PanelLeft, Search, Sun, X } from 'lucide-react';
import type { Branding } from '@appraisal/contracts';
import { useI18n } from '../../shared/i18n/i18n';
import { cn } from '../../shared/lib/cn';
import { useColorMode } from '../../shared/lib/color-mode';
import { Avatar, CommandPalette, spring, type Command } from '../../shared/ui';
import { visibleNav, type NavItem } from './nav';
import type { MeContext } from '@appraisal/contracts';

export function BrandMark({ branding, size = 'md' }: { branding: Pick<Branding, 'appName' | 'logoUrl'>; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-12 rounded-2xl text-lg' : 'size-9 rounded-xl text-sm';
  return branding.logoUrl ? (
    <img src={branding.logoUrl} alt="" className={cn(box, 'object-contain')} referrerPolicy="no-referrer" />
  ) : (
    <div className={cn(box, 'grid shrink-0 place-items-center bg-gradient-to-br from-brand to-brand-2 font-bold text-white shadow-md shadow-brand/30')}>
      {branding.appName.slice(0, 1)}
    </div>
  );
}

function NavGroup({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useI18n();
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((g) => (
        <div key={g}>
          {!collapsed && <div className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-muted/80 uppercase">{t(g)}</div>}
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.group === g)
              .map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === '/' || n.to === '/evaluations'}
                    onClick={onNavigate}
                    title={collapsed ? t(n.label) : undefined}
                    className={({ isActive }) =>
                      cn(
                        'focus-ring group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        isActive ? 'text-brand-text' : 'text-muted hover:text-fg',
                        collapsed && 'justify-center px-0',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="nav-active" transition={spring} className="absolute inset-0 rounded-lg bg-brand-soft" />}
                        {isActive && <motion.span layoutId="nav-bar" transition={spring} className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-brand" />}
                        <span className="relative">{n.icon}</span>
                        {!collapsed && <span className="relative truncate font-medium">{t(n.label)}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ me, onLogout, children }: { me: MeContext; onLogout: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const { resolved, toggle } = useColorMode();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = visibleNav(me);

  const commands = useMemo<Command[]>(
    () => [
      ...items.map((n) => ({ id: n.to, label: t(n.label), group: t('shell.navigate'), icon: n.icon, run: () => navigate(n.to) })),
      { id: 'theme', label: t('shell.theme'), group: t('shell.account'), icon: resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />, run: toggle },
      { id: 'logout', label: t('auth.signOut'), group: t('shell.account'), icon: <LogOut className="size-4" />, run: onLogout },
    ],
    [items, t, navigate, resolved, toggle, onLogout],
  );
  const current = items.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center gap-3 px-4 py-4', collapsed && !mobile && 'justify-center px-0')}>
        <BrandMark branding={me.branding} />
        {(!collapsed || mobile) && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{me.branding.appName}</div>
            <div className="truncate text-xs text-muted">{me.tenant.name}</div>
          </div>
        )}
        {mobile && (
          <button className="focus-ring rounded-lg p-1.5 text-muted hover:text-fg" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="size-4" />
          </button>
        )}
      </div>
      <NavGroup items={items} collapsed={collapsed && !mobile} onNavigate={() => setMobileOpen(false)} />
      <div className={cn('border-t border-line p-3', collapsed && !mobile && 'flex flex-col items-center gap-2')}>
        <div className={cn('flex items-center gap-3 rounded-xl p-2', collapsed && !mobile && 'p-0')}>
          <Avatar name={me.user.fullName} />
          {(!collapsed || mobile) && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{me.user.fullName}</div>
              <div className="truncate text-xs text-muted">{me.user.email}</div>
            </div>
          )}
          <button onClick={onLogout} title={t('auth.signOut')} aria-label={t('auth.signOut')} className="focus-ring rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg">
            <LogOut className="size-4 rtl:rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      <motion.aside
        animate={{ width: collapsed ? 72 : 264 }}
        transition={spring}
        className="sticky top-0 hidden h-screen shrink-0 border-e border-line bg-surface/80 backdrop-blur-xl md:block"
      >
        {sidebar(false)}
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-sm md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              className="fixed inset-y-0 start-0 z-50 w-72 border-e border-line bg-surface md:hidden"
              initial={{ x: 'var(--slide-from)' }}
              animate={{ x: 0 }}
              exit={{ x: 'var(--slide-from)' }}
              transition={spring}
              style={{ ['--slide-from' as string]: document.documentElement.dir === 'rtl' ? '100%' : '-100%' }}
            >
              {sidebar(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl md:px-6">
          <button className="focus-ring rounded-lg p-2 text-muted hover:text-fg md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <button
            className="focus-ring hidden rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg md:block"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={t('shell.collapse')}
            title={t('shell.collapse')}
          >
            <PanelLeft className="size-4 rtl:-scale-x-100" />
          </button>
          <AnimatePresence mode="wait">
            <motion.span key={current?.to ?? 'x'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="text-sm font-medium text-fg">
              {current ? t(current.label) : ''}
            </motion.span>
          </AnimatePresence>
          <div className="flex-1" />
          <button
            onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            className="focus-ring hidden h-9 w-64 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-muted transition-colors hover:border-zinc-400/60 sm:flex"
          >
            <Search className="size-4" />
            <span className="flex-1 text-start">{t('shell.search')}</span>
            <kbd className="rounded border border-line px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
          <button onClick={toggle} className="focus-ring relative grid size-9 place-items-center overflow-hidden rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('shell.theme')} title={t('shell.theme')}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={resolved} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </motion.span>
            </AnimatePresence>
          </button>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette commands={commands} placeholder={t('shell.search')} />
    </div>
  );
}
