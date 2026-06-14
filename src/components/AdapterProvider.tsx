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
    // Cache bound methods so the proxy returns a stable reference per property.
    // Without this every access (adapter.foo) produces a new bound function,
    // breaking referential equality and leaking allocations.
    const boundCache = new Map<PropertyKey, unknown>();
    return new Proxy(adapter, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        let bound = boundCache.get(prop);
        if (!bound) {
          bound = (value as (...args: unknown[]) => unknown).bind(target);
          boundCache.set(prop, bound);
        }
        return bound;
      },
    }) as MiniAppAdapter;
  }, [adapter]);

  useEffect(() => {
    setActiveAdapter(proxiedAdapter);
    // The adapter lifecycle is owned by whoever created it (it usually lives for
    // the whole page). We only attach/detach it from the registry here. Calling
    // destroy() on unmount would tear the adapter down on a StrictMode double-mount
    // or any provider remount and leave a dead, non-reinitialized instance behind.
    return () => {
      setActiveAdapter(null);
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
