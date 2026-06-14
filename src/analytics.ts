import type { MiniAppAdapter } from '@/types/miniApp';
import { getActiveAdapter } from '@/registry';
import { getVkPixelCode as readVkPixelCode, setVkPixelCode } from '@/config/vkAnalytics';

type AnalyticsPayload = Record<string, unknown>;

export function configureVkPixel(pixelCode: string): void {
  setVkPixelCode(pixelCode);
}

export function getVkPixelCode(): string | null {
  return readVkPixelCode();
}

export function trackConversionEvent(event: string, payload?: Record<string, unknown>): void {
  const adapter = resolveVkAdapter();
  adapter?.trackConversionEvent(event, payload as AnalyticsPayload | undefined);
}

export function trackPixelEvent(event: string, payload?: Record<string, unknown>): void {
  const adapter = resolveVkAdapter();
  adapter?.trackPixelEvent(event, payload as AnalyticsPayload | undefined);
}

function resolveVkAdapter(): MiniAppAdapter | null {
  const adapter = getActiveAdapter();
  return adapter && adapter.platform === 'vk' ? adapter : null;
}
