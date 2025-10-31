import { createContext, useContext, type ReactNode } from 'react';

import type { MiniAppAdapter } from '@/types/miniApp';

const AdapterContext = createContext<MiniAppAdapter | null>(null);

interface AdapterProviderProps {
  adapter: MiniAppAdapter;
  children: ReactNode;
}

export function AdapterProvider({ adapter, children }: AdapterProviderProps) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>;
}

export function useMiniAppAdapter(): MiniAppAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) {
    throw new Error('useMiniAppAdapter must be used inside <AdapterProvider/>.');
  }
  return adapter;
}
