import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import type { MiniAppAdapter } from '@/types/miniApp';
import { setActiveAdapter } from '@/registry';

const AdapterContext = createContext<MiniAppAdapter | null>(null);

interface AdapterProviderProps {
  adapter: MiniAppAdapter;
  children: ReactNode;
}

export function AdapterProvider({ adapter, children }: AdapterProviderProps) {
  const proxiedAdapter = useMemo(() => {
    return new Proxy(adapter, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
    }) as MiniAppAdapter;
  }, [adapter]);

  useEffect(() => {
    setActiveAdapter(proxiedAdapter);
    return () => {
      setActiveAdapter(null);
      if (typeof proxiedAdapter.destroy === 'function') {
        try {
          proxiedAdapter.destroy();
        } catch (error) {
          console.warn('[tvm-app-adapter] adapter destroy failed:', error);
        }
      }
    };
  }, [proxiedAdapter]);

  return <AdapterContext.Provider value={proxiedAdapter}>{children}</AdapterContext.Provider>;
}

export function useMiniAppAdapter(): MiniAppAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) {
    throw new Error('useMiniAppAdapter must be used inside <AdapterProvider/>.');
  }
  return adapter;
}
