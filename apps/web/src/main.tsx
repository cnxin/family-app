import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { CartProvider } from './lib/cart';
import { ApiError } from './lib/api';
import { pushToast } from './lib/toast';
import { ToastHost } from './components/toast';
import { App } from './App';
import './index.css';

// 任何写操作失败都必须冒出来。之前失败是静默的，点了没反应看着像功能没做。
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 401) return; // 401 会自动续期或登出，不打扰
        pushToast(error.message, error.requestId);
      } else {
        pushToast('操作没成功，网络或服务可能有问题');
      }
    },
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <App />
            <ToastHost />
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
