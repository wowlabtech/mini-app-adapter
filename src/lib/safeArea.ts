import type { MiniAppEnvironmentInfo, MiniAppViewportInsets } from '@/types/miniApp';

const SAFE_AREA_EDGES = ['top', 'right', 'bottom', 'left'] as const;
type SafeAreaEdge = (typeof SAFE_AREA_EDGES)[number];
export type SafeArea = Record<SafeAreaEdge, number>;
type PartialSafeArea = Partial<Record<SafeAreaEdge, number>>;

const DEFAULT_SAFE_AREA: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

function cloneSafeArea(source: SafeArea): SafeArea {
  return { ...source };
}

function addSafeArea(target: SafeArea, source?: PartialSafeArea): void {
  if (!source) {
    return;
  }
  for (const edge of SAFE_AREA_EDGES) {
    const value = source[edge];
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[edge] += value;
    }
  }
}

function applyMinimum(target: SafeArea, source?: PartialSafeArea): void {
  if (!source) {
    return;
  }
  for (const edge of SAFE_AREA_EDGES) {
    const value = source[edge];
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[edge] = Math.max(target[edge], value);
    }
  }
}

function areSafeAreasEqual(a?: SafeArea, b?: SafeArea): boolean {
  if (!a || !b) {
    return false;
  }
  return SAFE_AREA_EDGES.every((edge) => a[edge] === b[edge]);
}

export interface ComputeSafeAreaOptions {
  environment?: Partial<MiniAppEnvironmentInfo['safeArea']>;
  viewport?: MiniAppViewportInsets;
  additions?: PartialSafeArea;
  minimum?: PartialSafeArea;
  css?: PartialSafeArea;
}

export function computeCombinedSafeArea(options: ComputeSafeAreaOptions = {}): SafeArea {
  const safeArea = cloneSafeArea(DEFAULT_SAFE_AREA);

  addSafeArea(safeArea, options.environment as PartialSafeArea | undefined);

  if (options.viewport) {
    addSafeArea(safeArea, options.viewport.safeArea);
    addSafeArea(safeArea, options.viewport.contentSafeArea);
  }

  addSafeArea(safeArea, options.additions);

  applyMinimum(safeArea, options.css);
  applyMinimum(safeArea, options.minimum);

  return safeArea;
}

export function readCssSafeArea(): SafeArea | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined;
  }

  const styles = getComputedStyle(document.documentElement);
  const readEdge = (prop: string) => {
    const value = parseFloat(styles.getPropertyValue(prop));
    return Number.isFinite(value) ? value : 0;
  };

  const top = readEdge('--safe-area-inset-top');
  const right = readEdge('--safe-area-inset-right');
  const bottom = readEdge('--safe-area-inset-bottom');
  const left = readEdge('--safe-area-inset-left');

  if (top || right || bottom || left) {
    return { top, right, bottom, left };
  }

  return undefined;
}

export interface SafeAreaWatcherOptions {
  getSafeArea: () => MiniAppEnvironmentInfo['safeArea'] | undefined;
  onChange: (safeArea: MiniAppEnvironmentInfo['safeArea']) => void;
  windowObj?: Window & typeof globalThis;
  events?: Array<'resize' | 'orientationchange'>;
}

function normalizeSafeArea(value?: MiniAppEnvironmentInfo['safeArea']): SafeArea | undefined {
  if (!value) {
    return undefined;
  }

  const safeArea: SafeArea = { ...DEFAULT_SAFE_AREA };
  addSafeArea(safeArea, value as PartialSafeArea);
  return safeArea;
}

export function createSafeAreaWatcher(options: SafeAreaWatcherOptions): (() => void) | undefined {
  const targetWindow = options.windowObj ?? (typeof window !== 'undefined' ? window : undefined);
  if (!targetWindow) {
    return undefined;
  }

  let previous = normalizeSafeArea(options.getSafeArea());
  if (previous) {
    options.onChange(previous);
    previous = cloneSafeArea(previous);
  }

  const handler = () => {
    const next = normalizeSafeArea(options.getSafeArea());
    if (!next) {
      return;
    }

    if (!previous || !areSafeAreasEqual(previous, next)) {
      options.onChange(next);
      previous = cloneSafeArea(next);
    }
  };

  handler();

  const events = options.events ?? ['resize', 'orientationchange'];
  for (const eventName of events) {
    targetWindow.addEventListener(eventName, handler);
  }

  return () => {
    for (const eventName of events) {
      targetWindow.removeEventListener(eventName, handler);
    }
  };
}
