import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './shared/lib/api';
import { ColorModeProvider } from './shared/lib/color-mode';
import { detectApp } from './shared/lib/host';
import './styles/index.css';

const TenantApp = lazy(() => import('./app/tenant/TenantApp'));
const PlatformApp = lazy(() => import('./features/platform/PlatformApp'));
const Landing = lazy(() => import('./features/landing/Landing'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Client errors (403/404/422) will not get better by retrying.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/** One build for every tenant: the sub-domain picks the application at runtime. */
const app = detectApp();
const Root = app.kind === 'tenant' ? TenantApp : app.kind === 'platform' ? PlatformApp : Landing;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Animations follow the operating system's "reduce motion" setting. */}
    <MotionConfig reducedMotion="user">
      <ColorModeProvider>
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={null}>
            <Root />
          </Suspense>
        </QueryClientProvider>
      </ColorModeProvider>
    </MotionConfig>
  </StrictMode>,
);
