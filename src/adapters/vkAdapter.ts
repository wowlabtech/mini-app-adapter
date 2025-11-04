import bridge, {
  AnyRequestMethodName,
  parseURLSearchParamsForGetLaunchParams,
  type AppearanceType,
  type GetLaunchParamsResponse,
  type ParentConfigData,
  type VKBridgeSubscribeHandler,
} from '@vkontakte/vk-bridge';

import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type {
  MiniAppCapability,
  MiniAppEnvironmentInfo,
  MiniAppInitOptions,
} from '@/types/miniApp';

export class VKMiniAppAdapter extends BaseMiniAppAdapter {
  private unsubscribe?: () => void;
  private launchParams?: GetLaunchParamsResponse;
  private queryParams?: Record<string, unknown>;

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

    this.launchParams = launchParams;
    this.queryParams = queryParams as Record<string, unknown>;

    this.environment = this.composeEnvironment(launchParams, queryParams);
    this.applyAppearance(this.environment.appearance);
    this.notifyEnvironmentChanged();

    this.ready = true;
  }

  override async setColors(colors: { header?: string; background?: string }): Promise<void> {
    const { header, background } = colors;

    if (header || background) {
      const canApplyViewSettings = await this.isBridgeMethodSupported('VKWebAppSetViewSettings');

      if (canApplyViewSettings) {
        const statusBarStyle: AppearanceType = header
          ? this.resolveStatusBarStyle(header)
          : this.environment.appearance?.includes('dark') ? 'light' : 'dark';

        await bridge.send('VKWebAppSetViewSettings', {
          status_bar_style: statusBarStyle,
          ...(header ? { action_bar_color: header } : {}),
          ...(background ? { navigation_bar_color: background } : {}),
        });
      }
    }

    await super.setColors(colors);
  }

  override getEnvironment(): MiniAppEnvironmentInfo {
    return {
      ...this.environment,
      isWebView: bridge.isWebView(),
    };
  }

  override getLaunchParams(): unknown {
    if (!this.launchParams) {
      return undefined;
    }

    return {
      launchParams: this.launchParams,
      queryParams: this.queryParams,
    };
  }

  override async supports(capability: MiniAppCapability): Promise<boolean> {
    if (capability === 'requestPhone') {
      const [supportsPhoneNumber, supportsPersonalCard] = await Promise.all([
        this.isBridgeMethodSupported('VKWebAppGetPhoneNumber'),
        this.isBridgeMethodSupported('VKWebAppGetPersonalCard'),
      ]);
      return supportsPhoneNumber || supportsPersonalCard;
    }

    return await super.supports(capability);
  }

  override async requestPhone(): Promise<string | null> {
    const [supportsPhoneNumber, supportsPersonalCard] = await Promise.all([
      this.isBridgeMethodSupported('VKWebAppGetPhoneNumber'),
      this.isBridgeMethodSupported('VKWebAppGetPersonalCard'),
    ]);
    if (!supportsPhoneNumber && !supportsPersonalCard) {
      return super.requestPhone();
    }

    try {
      if (supportsPhoneNumber) {
        const result = await bridge.send('VKWebAppGetPhoneNumber');
        const phoneNumber = (result as { phone_number?: unknown }).phone_number;
        return typeof phoneNumber === 'string' && phoneNumber ? phoneNumber : null;
      }

      const card = await bridge.send('VKWebAppGetPersonalCard', { type: ['phone'] });
      const phone = (card as { phone?: unknown }).phone;
      return typeof phone === 'string' && phone ? phone : null;
    } catch (error) {
      console.warn('[tvm-app-adapter] VK requestPhone failed:', error);
      return null;
    }
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
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const cssSafeArea = this.readCssSafeArea();
    return {
      platform: 'vk',
      sdkVersion: platform ? String(platform) : undefined,
      appVersion: typeof appId === 'number' ? `vk-app-${appId}` : undefined,
      languageCode: language ? String(language) : undefined,
      appearance: prefersDark ? 'dark' : 'light',
      isWebView: bridge.isWebView(),
      safeArea: cssSafeArea,
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
    this.notifyEnvironmentChanged();

    if ('insets' in config && config.insets) {
      const { top = 0, right = 0, bottom = 0, left = 0 } = config.insets;
      const hasInsets = top !== 0 || right !== 0 || bottom !== 0 || left !== 0;
      if (!hasInsets) {
        return;
      }

      const prev = this.environment.safeArea;
      const changed =
        !prev ||
        prev.top !== top ||
        prev.right !== right ||
        prev.bottom !== bottom ||
        prev.left !== left;

      if (changed) {
        this.environment.safeArea = { top, right, bottom, left };
        this.notifyEnvironmentChanged();
      }
    }
  }

  private readCssSafeArea(): MiniAppEnvironmentInfo['safeArea'] | undefined {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const style = getComputedStyle(document.documentElement);
    const parse = (prop: string): number => {
      const value = parseFloat(style.getPropertyValue(prop));
      return Number.isFinite(value) ? value : 0;
    };

    const top = parse('--safe-area-inset-top');
    const right = parse('--safe-area-inset-right');
    const bottom = parse('--safe-area-inset-bottom');
    const left = parse('--safe-area-inset-left');

    if (top || right || bottom || left) {
      return { top, right, bottom, left };
    }

    return undefined;
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

  private async isBridgeMethodSupported(method: AnyRequestMethodName): Promise<boolean> {
    if (typeof bridge.supportsAsync === 'function') {
      try {
        return await bridge.supportsAsync(method);
      } catch (error) {
        console.warn('[tvm-app-adapter] VK bridge.supportsAsync failed:', error);
        return false;
      }
    }

    return false;
  }
}
