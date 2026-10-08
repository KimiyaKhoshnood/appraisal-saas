import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { detectApp } from './lib/host';
import './styles/index.css';

const TenantApp = lazy(() => import('./tenant/TenantApp'));
const PlatformApp = lazy(() => import('./platform/PlatformApp'));
const Landing = lazy(() => import('./Landing'));

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
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
