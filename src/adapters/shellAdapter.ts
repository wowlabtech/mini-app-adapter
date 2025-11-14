import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type { MiniAppCapability } from '@/types/miniApp';
import { requestShellPushPermission } from '@/lib/shell';

export class ShellMiniAppAdapter extends BaseMiniAppAdapter {
  constructor(platform: 'shell_ios' | 'shell_android') {
    super(platform, {
      isWebView: true,
      hasNativeQR: true,
      hasPush: true,
      hasWidgets: true,
    });
  }

  override supports(capability: MiniAppCapability): boolean | Promise<boolean> {
    switch (capability) {
      case 'qrScanner':
        return true;
      case 'notifications':
        return true;
      default:
        return super.supports(capability);
    }
  }

  override async scanQRCode(): Promise<string | null> {
    try {
      const value = await this.shell.openNativeQR();
      return value ?? null;
    } catch (error) {
      console.warn('[tvm-app-adapter] shell.openNativeQR failed:', error);
      return null;
    }
  }

  override async requestNotificationsPermission(): Promise<boolean> {
    return requestShellPushPermission();
  }
}
