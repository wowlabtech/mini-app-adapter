export type Disposable = (() => void) | { dispose: () => void } | null | undefined;

export class DisposableBag {
  private disposers = new Set<() => void>();

  add(disposable: Disposable): () => void {
    if (!disposable) {
      return () => {};
    }

    const dispose = typeof disposable === 'function'
      ? disposable
      : typeof disposable.dispose === 'function'
        ? disposable.dispose.bind(disposable)
        : undefined;

    if (!dispose) {
      return () => {};
    }

    let called = false;
    const wrapped = () => {
      if (called) {
        return;
      }
      called = true;
      try {
        dispose();
      } catch (error) {
        console.warn('[tvm-app-adapter] disposable failed:', error);
      } finally {
        this.disposers.delete(wrapped);
      }
    };

    this.disposers.add(wrapped);
    return wrapped;
  }

  disposeAll(): void {
    for (const disposer of Array.from(this.disposers)) {
      try {
        disposer();
      } catch (error) {
        console.warn('[tvm-app-adapter] disposeAll failed:', error);
      }
    }
    this.disposers.clear();
  }
}
