export type {
  MiniAppAdapter,
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
  MiniAppPlatform,
} from '@/types/miniApp';

export {
  BaseMiniAppAdapter,
} from '@/adapters/baseAdapter';

export {
  MaxMiniAppAdapter,
} from '@/adapters/maxAdapter';

export {
  TelegramMiniAppAdapter,
} from '@/adapters/telegramAdapter';

export {
  VKMiniAppAdapter,
} from '@/adapters/vkAdapter';

export {
  WebMiniAppAdapter,
} from '@/adapters/webAdapter';

export {
  createAdapter,
  detectPlatform,
} from '@/adapters';

export {
  AdapterProvider,
  useMiniAppAdapter,
} from '@/components/AdapterProvider';

export {
  getActiveAdapter,
} from '@/registry';
