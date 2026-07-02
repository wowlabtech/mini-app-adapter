import { retrieveRawLaunchParams } from '@tma.js/bridge';

import { ShellMiniAppAdapter } from '@/adapters/shellAdapter';
import { TelegramMiniAppAdapter } from '@/adapters/telegramAdapter';
import { VKMiniAppAdapter } from '@/adapters/vkAdapter';
import { WebMiniAppAdapter } from '@/adapters/webAdapter';
import { setVkPixelCode } from '@/config/vkAnalytics';
import type { MiniAppAdapter, MiniAppPlatform } from '@/types/miniApp';
import { readShellPlatform } from '@/lib/shell';

const CONFIRMED_PLATFORM_STORAGE_KEY = 'mini-app-adapter:confirmed-platform';

export interface CreateAdapterOptions {
  platform?: MiniAppPlatform;
  vk?: {
    pixelCode?: string;
  };
}

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
  const getPlatformStorages = (): Storage[] => {
    const storages: Storage[] = [];
    // Persist the confirmed platform to sessionStorage ONLY (never localStorage).
    //
    // Why we cache at all: VK-web (iframe on vk.com) and Telegram-web expose their
    // platform solely via launch params in the first URL. react-router strips those
    // params on the first navigation, after which no live signal remains — without a
    // cache the adapter would silently degrade to the `web` fallback mid-session.
    //
    // Why session-scoped: sessionStorage is exactly "this webview/tab session" — it
    // survives SPA navigation and full reloads of the same webview, so the VK-web
    // case stays fixed. But it is cleared when the tab/webview is closed, so a brand
    // browser session can't inherit a stale platform. localStorage was cross-session
    // and never expired, which permanently branded standalone browsers as `telegram`
    // after a single deep-link that carried tgWebApp params — breaking auth there.
    //
    // A killed/relaunched webview loses sessionStorage, but the host always relaunches
    // the mini app with fresh launch params in the URL, so detection re-runs cleanly.
    try {
      if (window.sessionStorage) {
        storages.push(window.sessionStorage);
      }
    } catch {
      // Ignore storage access errors (private mode, blocked cookies, etc.).
    }
    return storages;
  };
  const readConfirmedPlatform = (): MiniAppPlatform | null => {
    for (const storage of getPlatformStorages()) {
      try {
        const raw = storage.getItem(CONFIRMED_PLATFORM_STORAGE_KEY);
        if (!raw) {
          continue;
        }
        const parsed = JSON.parse(raw) as { platform?: MiniAppPlatform };
        if (parsed?.platform && parsed.platform !== 'web') {
          return parsed.platform;
        }
      } catch {
        // Ignore malformed entries.
      }
    }
    return null;
  };
  const persistConfirmedPlatform = (platform: MiniAppPlatform): void => {
    if (platform === 'web') {
      return;
    }
    const payload = JSON.stringify({ platform, ts: Date.now() });
    for (const storage of getPlatformStorages()) {
      try {
        storage.setItem(CONFIRMED_PLATFORM_STORAGE_KEY, payload);
      } catch {
        // Ignore storage errors.
      }
    }
  };

  // One-time cleanup: earlier versions persisted the confirmed platform to
  // localStorage, which permanently branded standalone browsers (e.g. a Safari
  // tab that once opened a tgWebApp deep-link) as a messenger. Drop the legacy
  // entry so already-affected browsers self-heal on next load.
  try {
    window.localStorage?.removeItem(CONFIRMED_PLATFORM_STORAGE_KEY);
  } catch {
    // Ignore storage access errors.
  }

  const shellPlatform = readShellPlatform();
  if (shellPlatform) {
    persistConfirmedPlatform(shellPlatform);
    return shellPlatform;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const hasNativeBridge =
    typeof (window as typeof window & { NativeBridge?: { postMessage?: unknown } }).NativeBridge?.postMessage ===
    'function';

  if (hasNativeBridge) {
    if (userAgent.includes('android')) {
      persistConfirmedPlatform('shell_android');
      return 'shell_android';
    }
    persistConfirmedPlatform('shell_ios');
    return 'shell_ios';
  }

  const canRetrieveTelegramLaunchParams = (): boolean => {
    try {
      return Boolean(retrieveRawLaunchParams());
    } catch {
      return false;
    }
  };
  const hasTelegramParams = hasParam('tgWebAppPlatform', 'tgWebAppVersion', 'tgWebAppData', 'tgWebAppLanguage');
  if (hasTelegramParams || canRetrieveTelegramLaunchParams()) {
    persistConfirmedPlatform('telegram');
    return 'telegram';
  }

  const hasVkParams = hasParam('vk_app_id', 'vk_platform', 'vk_user_id', 'vk_language', 'sign');
  const hasVkUserAgentSignal =
    userAgent.includes('vkclient')
    || userAgent.includes('vk-android')
    || userAgent.includes('vkontakte');
  if (hasVkParams || hasVkUserAgentSignal) {
    persistConfirmedPlatform('vk');
    return 'vk';
  }

  const confirmedPlatform = readConfirmedPlatform();
  if (confirmedPlatform && confirmedPlatform !== 'web') {
    return confirmedPlatform;
  }

  return 'web';
}


export function createAdapter(): MiniAppAdapter;
export function createAdapter(platform: MiniAppPlatform): MiniAppAdapter;
export function createAdapter(options: CreateAdapterOptions): MiniAppAdapter;
export function createAdapter(input?: MiniAppPlatform | CreateAdapterOptions): MiniAppAdapter {
  const options = normalizeCreateAdapterOptions(input);
  const platform = options.platform ?? detectPlatform();

  if (platform === 'vk') {
    setVkPixelCode(options.vk?.pixelCode ?? null);
  }

  switch (platform) {
    case 'shell_ios':
    case 'shell_android':
      return new ShellMiniAppAdapter(platform);
    case 'telegram':
      return new TelegramMiniAppAdapter();
    case 'vk':
      return new VKMiniAppAdapter();
    default:
      return new WebMiniAppAdapter();
  }
}

function normalizeCreateAdapterOptions(input?: MiniAppPlatform | CreateAdapterOptions): CreateAdapterOptions {
  if (!input) {
    return {};
  }

  if (typeof input === 'string') {
    return { platform: input };
  }

  return input;
}
