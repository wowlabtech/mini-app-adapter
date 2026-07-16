import { BaseMiniAppAdapter } from '@/adapters/baseAdapter';
import type { MiniAppCapability, MiniAppScanResult } from '@/types/miniApp';
import { requestShellPushPermission, ShellQrError } from '@/lib/shell';

export class ShellMiniAppAdapter extends BaseMiniAppAdapter {
  constructor(platform: 'shell_ios' | 'shell_android') {
    super(platform, {
      isWebView: true,
      hasNativeQR: true,
      hasPush: true,
      hasWidgets: true,
    });
  }

  override async supports(capability: MiniAppCapability): Promise<boolean> {
    switch (capability) {
      case 'qrScanner':
        return true;
      case 'notifications':
        return true;
      default:
        return super.supports(capability);
    }
  }

  override async scanQRCode(): Promise<MiniAppScanResult> {
    try {
      const value = await this.shell.openNativeQR();
      return value ? { status: 'success', data: value } : { status: 'cancelled' };
    } catch (error) {
      console.warn('[tvm-app-adapter] shell.openNativeQR failed:', error);
      return mapShellQrError(error);
    }
  }

  override async requestNotificationsPermission(): Promise<boolean> {
    return requestShellPushPermission();
  }
}

function mapShellQrError(error: unknown): MiniAppScanResult {
  // Native reason delivered over the nativeQRError bridge channel.
  if (error instanceof ShellQrError) {
    return error.reason === 'cancelled'
      ? { status: 'cancelled' }
      : { status: 'error', code: error.reason, cause: error };
  }

  // No error channel yet on this native build: a denied/cancelled scan never
  // calls back and openNativeQR rejects with the 60s timeout instead.
  if (error instanceof Error && /timed out/i.test(error.message)) {
    return { status: 'error', code: 'timeout', cause: error };
  }

  return { status: 'error', code: 'unknown', cause: error };
}
