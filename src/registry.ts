import type { MiniAppAdapter } from '@/types/miniApp';

let currentAdapter: MiniAppAdapter | null = null;

export function setActiveAdapter(adapter: MiniAppAdapter | null): void {
  currentAdapter = adapter;
}

export function getActiveAdapter(): MiniAppAdapter | null {
  return currentAdapter;
}
