import type { MiniAppScanErrorCode } from '@/types/miniApp';

/**
 * Maps a getUserMedia rejection to a {@link MiniAppScanErrorCode}. The browser
 * rejects with a DOMException whose `name` carries the reason; DOMException is
 * an Error subclass, so the name survives the throw.
 */
export function classifyGetUserMediaError(error: unknown): MiniAppScanErrorCode {
  const name = error instanceof Error ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no_camera';
    case 'NotReadableError':
    case 'AbortError':
      return 'camera_busy';
    default:
      return 'unknown';
  }
}
