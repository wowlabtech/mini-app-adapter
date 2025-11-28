let pixelCode: string | null = null;

export function setVkPixelCode(next: string | null | undefined): void {
  if (typeof next !== 'string') {
    pixelCode = null;
    return;
  }

  const normalized = next.trim();
  pixelCode = normalized || null;
}

export function getVkPixelCode(): string | null {
  return pixelCode;
}
