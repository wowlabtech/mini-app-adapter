import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMiniAppAdapter } from '@/components/AdapterProvider';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'loyalka-theme-preference';

export function useAdapterTheme() {
  const adapter = useMiniAppAdapter();

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    const { appearance } = adapter.getEnvironment();
    if (adapter.onAppearanceChange && appearance) {
      return appearance === 'dark';
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {}
    return 'system';
  });

  useEffect(() => {
    if (adapter.onAppearanceChange) {
      return adapter.onAppearanceChange((appearance) => {
        if (appearance) {
          setSystemPrefersDark(appearance === 'dark');
        }
      });
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    return undefined;
  }, [adapter]);

  const isDark = useMemo(() => {
    if (preference === 'dark' || (preference === 'system' && systemPrefersDark)) {
      return true;
    }
    return false;
  }, [preference, systemPrefersDark]);

  const appearance: 'dark' | 'light' = isDark ? 'dark' : 'light';

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    document.documentElement.classList.add('theme-transition');
    setTimeout(() => {
      setTimeout(() => {
        document.documentElement.classList.remove('theme-transition');
      }, 400);
    }, 50);

    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const primaryColor = styles.getPropertyValue('--primary').trim();
    const backgroundColor = styles.getPropertyValue('--background').trim();

    adapter.setColors({
      header: primaryColor,
      background: backgroundColor,
      footer: backgroundColor,
    });
    setPreference(preference === 'dark' ? 'light' : 'dark');
  }, [adapter, preference, setPreference]);

  return {
    isDark,
    appearance,
    preference,
    setPreference,
    toggle,
  } as const;
}
