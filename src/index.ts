export type {
  MiniAppAdapter,
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
  MiniAppPopupOptions,
  MiniAppQrScanOptions,
  MiniAppPlatform,
  MiniAppViewportState,
} from '@/types/miniApp';

export {
  BaseMiniAppAdapter,
} from '@/adapters/baseAdapter';

export {
  MaxMiniAppAdapter,
} from '@/adapters/maxAdapter';

export {
  ShellMiniAppAdapter,
} from '@/adapters/shellAdapter';

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

export type {
  CreateAdapterOptions,
} from '@/adapters';

export {
  AdapterProvider,
  useMiniAppAdapter,
} from '@/components/AdapterProvider';

export {
  useAdapterTheme,
} from '@/hooks/useAdapterTheme';

export {
  useSafeArea,
} from '@/hooks/useSafeArea';

export {
  getActiveAdapter,
} from '@/registry';

export {
  trackConversionEvent,
  trackPixelEvent,
  configureVkPixel,
} from '@/analytics';

export {
  getPlatform,
} from '@/platform';

export {
  shell,
  createShellAPI,
  isShell,
  isShellIOS,
  isShellAndroid,
  readShellPlatform,
  requestShellPushPermission,
  storeShellToken,
} from '@/lib/shell';
