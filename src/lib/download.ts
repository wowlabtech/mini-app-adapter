const isClient = typeof window !== 'undefined' && typeof document !== 'undefined';

function getFallbackFileName(url: string, provided?: string): string {
  if (provided && provided.trim().length > 0) {
    return provided;
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split('/').filter(Boolean).pop();
    if (path) {
      return path;
    }
  } catch {
    // Ignore parse errors and fall back to generic name.
  }
  return 'download';
}

function triggerAnchorDownload(href: string, fileName: string, { targetBlank }: { targetBlank: boolean }): void {
  if (!isClient) {
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener noreferrer';
  if (targetBlank) {
    anchor.target = '_blank';
  }

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export interface TriggerFileDownloadOptions {
  preferBlob?: boolean;
}

export async function triggerFileDownload(url: string, fileName?: string, options?: TriggerFileDownloadOptions): Promise<void> {
  if (!url) {
    return;
  }

  const safeFileName = getFallbackFileName(url, fileName);
  const preferBlob = options?.preferBlob ?? false;

  if (!isClient) {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  if (preferBlob && typeof fetch === 'function') {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerAnchorDownload(objectUrl, safeFileName, { targetBlank: false });
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      return;
    } catch (error) {
      console.warn('[tvm-app-adapter] blob download failed, falling back to direct link:', error);
    }
  }

  triggerAnchorDownload(url, safeFileName, { targetBlank: true });
}
