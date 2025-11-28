import type { MiniAppPlatform } from '@/types/miniApp';
import { detectPlatform } from '@/adapters';
import { getActiveAdapter } from '@/registry';

let cachedPlatform: MiniAppPlatform | null = null;

export function getPlatform(): MiniAppPlatform {
  const adapter = getActiveAdapter();
  if (adapter) {
    cachedPlatform = adapter.platform;
    return adapter.platform;
  }

  if (cachedPlatform) {
    return cachedPlatform;
  }

  const detectedPlatform = detectPlatform();
  cachedPlatform = detectedPlatform;
  return detectedPlatform;
}
