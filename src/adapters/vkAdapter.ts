import bridge, {
  parseURLSearchParamsForGetLaunchParams,
  type AppearanceType,
  type GetLaunchParamsResponse,
  type ParentConfigData,
  type VKBridgeSubscribeHandler,
} from '@vkontakte/vk-bridge';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type { MiniAppEnvironmentInfo, MiniAppInitOptions } from '@/types/miniApp';

export class VKMiniAppAdapter extends BaseMiniAppAdapter {
  private unsubscribe?: () => void;

  constructor() {
    super('vk');
  }

  override async init(_options?: MiniAppInitOptions): Promise<void> {
    if (this.ready) {
      return;
    }

    const handler: VKBridgeSubscribeHandler = (event) => this.handleBridgeEvent(event);
    bridge.subscribe(handler);
    this.unsubscribe = () => bridge.unsubscribe(handler);

    await bridge.send('VKWebAppInit');
    const launchParams = await bridge.send('VKWebAppGetLaunchParams');
    const queryParams = parseURLSearchParamsForGetLaunchParams(window.location.search);

    this.environment = this.composeEnvironment(launchParams, queryParams);
    this.applyAppearance(this.environment.appearance);

    this.ready = true;
  }

  override async setColors(colors: { header?: string; background?: string }): Promise<void> {
    const { header, background } = colors;

    if (header || background) {
      const statusBarStyle: AppearanceType = header
        ? this.resolveStatusBarStyle(header)
        : this.environment.appearance?.includes('dark') ? 'light' : 'dark';

      await bridge.send('VKWebAppSetViewSettings', {
        status_bar_style: statusBarStyle,
        ...(header ? { action_bar_color: header } : {}),
        ...(background ? { navigation_bar_color: background } : {}),
      });
    }

    await super.setColors(colors);
  }

  override getEnvironment(): MiniAppEnvironmentInfo {
    return {
      ...this.environment,
      isWebView: bridge.isWebView(),
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private composeEnvironment(
    launchParams: GetLaunchParamsResponse,
    queryParams: ReturnType<typeof parseURLSearchParamsForGetLaunchParams>,
  ): MiniAppEnvironmentInfo {
    const language = queryParams.vk_language ?? launchParams.vk_language;
    const platform = queryParams.vk_platform ?? launchParams.vk_platform;
    const appId = queryParams.vk_app_id ?? launchParams.vk_app_id;

    return {
      platform: 'vk',
      sdkVersion: platform ? String(platform) : undefined,
      appVersion: typeof appId === 'number' ? `vk-app-${appId}` : undefined,
      languageCode: language ? String(language) : undefined,
      appearance: undefined,
      isWebView: bridge.isWebView(),
    };
  }

  private handleBridgeEvent(event: Parameters<VKBridgeSubscribeHandler>[0]): void {
    const { type, data } = event.detail ?? {};
    if (type !== 'VKWebAppUpdateConfig' || !data) {
      return;
    }

    const config = data as ParentConfigData;
    this.environment.appearance = config.appearance ?? this.environment.appearance;
    this.applyAppearance(this.environment.appearance);

    if ('insets' in config && config.insets) {
      const { top = 0, right = 0, bottom = 0, left = 0 } = config.insets;
      this.environment.safeArea = { top, right, bottom, left };
    }
  }

  private applyAppearance(appearance?: string): void {
    if (!appearance) {
      return;
    }

    document.documentElement.dataset.vkAppearance = appearance;
    const isDark = appearance === 'dark' || appearance === 'space_gray';
    document.documentElement.classList.toggle('dark', isDark);
  }

  private resolveStatusBarStyle(color: string): AppearanceType {
    const hex = color.replace('#', '');
    const normalized = hex.length === 3
      ? hex.split('').map((symbol) => symbol + symbol).join('')
      : hex.slice(0, 6);

    const r = parseInt(normalized.slice(0, 2), 16) / 255;
    const g = parseInt(normalized.slice(2, 4), 16) / 255;
    const b = parseInt(normalized.slice(4, 6), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? 'dark' : 'light';
  }
}
