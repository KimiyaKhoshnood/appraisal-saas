import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FeatureKey, MeContext, Permission, PublicBranding } from '@appraisal/contracts';
import { tenantApi } from '../lib/api';
import { applyBranding } from '../lib/theme';

type State =
  | { phase: 'booting' }
  | { phase: 'unknown-tenant' }
  | { phase: 'anonymous'; branding: PublicBranding }
  | { phase: 'ready'; branding: PublicBranding; me: MeContext };

interface Session {
  state: State;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadContext: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/**
 * Boot sequence of a tenant page: public branding from the sub-domain (pre-login theme), then
 * a silent refresh from the httpOnly cookie, then /me/context, which drives theme, language,
 * navigation and what the UI offers. The server re-checks everything.
 */
export function TenantSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: 'booting' });
  const queryClient = useQueryClient();

  const loadMe = useCallback(async (branding: PublicBranding) => {
    const me = await tenantApi.get<MeContext>('/api/me/context');
    applyBranding(me.branding);
    setState({ phase: 'ready', branding, me });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let branding: PublicBranding;
      try {
        branding = await tenantApi.get<PublicBranding>('/api/public/branding');
      } catch {
        // 404: no such tenant (or suspended); anything else: the API is unreachable.
        if (!cancelled) setState({ phase: 'unknown-tenant' });
        return;
      }
      applyBranding(branding);
      if (await tenantApi.refresh()) {
        try {
          await loadMe(branding);
          return;
        } catch {
          /* fall through to the login page */
        }
      }
      if (!cancelled) setState({ phase: 'anonymous', branding });
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  useEffect(() => {
    tenantApi.onSessionLost = () => {
      queryClient.clear();
      setState((s) => (s.phase === 'ready' ? { phase: 'anonymous', branding: s.branding } : s));
    };
  }, [queryClient]);

  const value: Session = {
    state,
    login: async (email, password) => {
      if (state.phase !== 'anonymous') return;
      await tenantApi.login(email, password);
      await loadMe(state.branding);
    },
    logout: async () => {
      await tenantApi.logout();
      queryClient.clear();
      if (state.phase === 'ready') {
        applyBranding(state.branding);
        setState({ phase: 'anonymous', branding: state.branding });
      }
    },
    reloadContext: async () => {
      if (state.phase === 'ready') await loadMe(state.branding);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession outside TenantSessionProvider');
  return ctx;
}

/** The authenticated context plus permission/feature helpers. UI hints only, never security. */
export function useMe() {
  const { state, reloadContext, logout } = useSession();
  if (state.phase !== 'ready') throw new Error('useMe requires an authenticated session');
  const { me } = state;
  return {
    me,
    can: (p: Permission) => me.permissions.includes(p),
    has: (f: FeatureKey) => me.features.includes(f),
    reloadContext,
    logout,
  };
}
