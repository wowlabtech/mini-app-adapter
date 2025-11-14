import { useCallback, useEffect, useState } from 'react';

import { useMiniAppAdapter } from '@/components/AdapterProvider';
import type { MiniAppEnvironmentInfo } from '@/types/miniApp';

type SafeAreaInsets = NonNullable<MiniAppEnvironmentInfo['safeArea']>;

const ZERO_SAFE_AREA: SafeAreaInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export function useSafeArea() {
  const adapter = useMiniAppAdapter();

  const computeSafeArea = useCallback(
    () => adapter.computeSafeArea() ?? ZERO_SAFE_AREA,
    [adapter],
  );

  const [safeArea, setSafeArea] = useState<SafeAreaInsets>(computeSafeArea);

  useEffect(() => {
    setSafeArea(computeSafeArea());
    const unsubscribe = adapter.subscribe?.(() => {
      setSafeArea(computeSafeArea());
    });

    return () => unsubscribe?.();
  }, [adapter, computeSafeArea]);

  return safeArea ?? ZERO_SAFE_AREA;
}