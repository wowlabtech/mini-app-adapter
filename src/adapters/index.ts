import { MaxMiniAppAdapter } from '@/adapters/maxAdapter';
import { TelegramMiniAppAdapter } from '@/adapters/telegramAdapter';
import { VKMiniAppAdapter } from '@/adapters/vkAdapter';
import { WebMiniAppAdapter } from '@/adapters/webAdapter';
import type { MiniAppAdapter, MiniAppPlatform } from '@/types/miniApp';

export function detectPlatform(): MiniAppPlatform {
  if (window.Telegram?.WebApp) {
    return 'telegram';
  }
  if (window.WebApp) {
    return 'max';
  }
  if ((window as typeof window & { MaxMiniApp?: unknown }).MaxMiniApp) {
    return 'max';
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has('vk_app_id') || params.has('vk_platform')) {
    return 'vk';
  }

  return 'web';
}

export function createAdapter(platform: MiniAppPlatform = detectPlatform()): MiniAppAdapter {
  switch (platform) {
    case 'telegram':
      return new TelegramMiniAppAdapter();
    case 'vk':
      return new VKMiniAppAdapter();
    case 'max':
      return new MaxMiniAppAdapter();
    default:
      return new WebMiniAppAdapter();
  }
}
