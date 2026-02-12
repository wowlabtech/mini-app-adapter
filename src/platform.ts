import type { MiniAppPlatform } from '@/types/miniApp';
import { detectPlatform } from '@/adapters';
import { getActiveAdapter } from '@/registry';

let cachedPlatform: MiniAppPlatform | null = null;

export function getPlatform(): MiniAppPlatform {
  const adapter = getActiveAdapter();
  if (adapter) {
    if (adapter.platform !== 'web') {
      cachedPlatform = adapter.platform;
    }
    return adapter.platform;
  }

  if (cachedPlatform && cachedPlatform !== 'web') {
    return cachedPlatform;
  }

  const detectedPlatform = detectPlatform();
  if (detectedPlatform !== 'web') {
    cachedPlatform = detectedPlatform;
  }
  return detectedPlatform;
}
