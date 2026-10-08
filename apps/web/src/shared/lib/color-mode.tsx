import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ColorMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'appraisal:color-mode';

function read(): ColorMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(mode: ColorMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface Ctx {
  mode: ColorMode;
  resolved: 'light' | 'dark';
  setMode: (m: ColorMode) => void;
  toggle: () => void;
}

const ColorModeCtx = createContext<Ctx | null>(null);

/** Per-viewer preference (a convenience, so browser storage is fine; failures fall back to system). */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>(read);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(read()));

  useEffect(() => {
    const apply = () => {
      const r = resolve(mode);
      setResolved(r);
      document.documentElement.classList.toggle('dark', r === 'dark');
    };
    apply();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [mode]);

  const setMode = useCallback((m: ColorMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* private mode: keep it in memory */
    }
  }, []);

  const toggle = useCallback(() => setMode(resolve(mode) === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  return <ColorModeCtx.Provider value={{ mode, resolved, setMode, toggle }}>{children}</ColorModeCtx.Provider>;
}

export function useColorMode(): Ctx {
  const ctx = useContext(ColorModeCtx);
  if (!ctx) throw new Error('useColorMode outside ColorModeProvider');
  return ctx;
}
