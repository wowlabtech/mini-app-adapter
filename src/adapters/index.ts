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
    // sessionStorage survives reloads of the same webview; localStorage survives
    // the host re-creating the webview after a long background. We persist to both
    // and never expire so a confirmed non-web platform (e.g. VK) can't silently
    // degrade to the web fallback when launch params / UA signals are gone.
    try {
      if (window.localStorage) {
        storages.push(window.localStorage);
      }
    } catch {
      // Ignore storage access errors (private mode, blocked cookies, etc.).
    }
    try {
      if (window.sessionStorage) {
        storages.push(window.sessionStorage);
      }
    } catch {
      // Ignore storage access errors.
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

  const telegramGlobals = window as typeof window & {
    TelegramWebviewProxy?: unknown;
    TelegramGameProxy?: unknown;
  };
  const hasTelegramGlobal =
    Boolean(window.Telegram?.WebApp)
    || typeof telegramGlobals.TelegramWebviewProxy !== 'undefined'
    || typeof telegramGlobals.TelegramGameProxy !== 'undefined';
  const hasTelegramParams = hasParam('tgWebAppPlatform', 'tgWebAppVersion', 'tgWebAppData', 'tgWebAppLanguage');
  if (
    hasTelegramGlobal
    || hasTelegramParams
    || userAgent.includes('telegram')
  ) {
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
