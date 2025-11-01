import { MaxMiniAppAdapter } from '@/adapters/maxAdapter';
import { TelegramMiniAppAdapter } from '@/adapters/telegramAdapter';
import { VKMiniAppAdapter } from '@/adapters/vkAdapter';
import { WebMiniAppAdapter } from '@/adapters/webAdapter';
import type { MiniAppAdapter, MiniAppPlatform } from '@/types/miniApp';

export function detectPlatform(): MiniAppPlatform {
  if (typeof window === 'undefined') {
    return 'web';
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = (() => {
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    return new URLSearchParams(hash);
  })();

  const getParam = (name: string): string | null =>
    searchParams.get(name) ?? hashParams.get(name);

  const hasParam = (...names: string[]): boolean => names.some((name) => getParam(name));

  const userAgent = navigator.userAgent.toLowerCase();

  if (
    window.Telegram?.WebApp
    || hasParam('tgWebAppPlatform', 'tgWebAppVersion', 'tgWebAppData', 'tgWebAppLanguage')
    || userAgent.includes('telegram')
  ) {
    return 'telegram';
  }

  if (window.WebApp) {
    return 'max';
  }

  if ((window as typeof window & { MaxMiniApp?: unknown }).MaxMiniApp) {
    return 'max';
  }

  if (hasParam('vk_app_id', 'vk_platform')) {
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
