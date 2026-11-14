import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { UserSettings } from '../types/shadowspace';

export type AccentPreset = {
  id: string;
  label: string;
  hex: string;
};

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'violet', label: 'Electric Violet', hex: '#7c3aed' },
  { id: 'lavender', label: 'Soft Lavender', hex: '#a78bfa' },
  { id: 'crimson', label: 'After Dark Crimson', hex: '#e11d48' },
  { id: 'indigo', label: 'Deep Indigo', hex: '#4f46e5' },
  { id: 'emerald', label: 'Signal Emerald', hex: '#10b981' },
];

export interface ThemeSettingsState {
  theme: 'dark' | 'light';
  accentColor: string;
  fontSize: 'sm' | 'md' | 'lg';
  density: 'compact' | 'comfortable';
  reducedMotion: boolean;
  highContrast: boolean;
  notifyDms: boolean;
  notifyMentions: boolean;
  notifyFriendRequests: boolean;
  notifyServers: boolean;
  showOnlineStatus: boolean;
  mediaAutoPreview: boolean;
}

const DEFAULT_SETTINGS: ThemeSettingsState = {
  theme: 'dark',
  accentColor: '#7c3aed',
  fontSize: 'md',
  density: 'comfortable',
  reducedMotion: false,
  highContrast: false,
  notifyDms: true,
  notifyMentions: true,
  notifyFriendRequests: true,
  notifyServers: true,
  showOnlineStatus: true,
  mediaAutoPreview: true,
};

function sanitizeSettings(raw: Partial<ThemeSettingsState> & Partial<UserSettings>): ThemeSettingsState {
  return {
    theme: raw.theme === 'light' ? 'light' : 'dark',
    accentColor:
      typeof raw.accentColor === 'string' && raw.accentColor.trim().length >= 3
        ? raw.accentColor.trim().slice(0, 32)
        : DEFAULT_SETTINGS.accentColor,
    fontSize: raw.fontSize === 'sm' || raw.fontSize === 'lg' ? raw.fontSize : 'md',
    density: raw.density === 'compact' ? 'compact' : 'comfortable',
    reducedMotion: Boolean(raw.reducedMotion ?? DEFAULT_SETTINGS.reducedMotion),
    highContrast: Boolean(raw.highContrast ?? DEFAULT_SETTINGS.highContrast),
    notifyDms: raw.notifyDms ?? DEFAULT_SETTINGS.notifyDms,
    notifyMentions: raw.notifyMentions ?? DEFAULT_SETTINGS.notifyMentions,
    notifyFriendRequests: raw.notifyFriendRequests ?? DEFAULT_SETTINGS.notifyFriendRequests,
    notifyServers: raw.notifyServers ?? DEFAULT_SETTINGS.notifyServers,
    showOnlineStatus: raw.showOnlineStatus ?? DEFAULT_SETTINGS.showOnlineStatus,
    mediaAutoPreview: raw.mediaAutoPreview ?? DEFAULT_SETTINGS.mediaAutoPreview,
  };
}

interface ThemeContextValue {
  settings: ThemeSettingsState;
  updateSettings: (patch: Partial<ThemeSettingsState>) => Promise<void>;
  loadUserSettings: (uid: string) => Promise<void>;
  clearUserSettingsListener: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'shadowspace_theme_prefs_v1';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettingsState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return sanitizeSettings(JSON.parse(saved) as Partial<ThemeSettingsState>);
      }
    } catch {
      // Ignore storage read errors
    }
    return DEFAULT_SETTINGS;
  });

  const unsubRef = useRef<(() => void) | null>(null);
  const listeningUidRef = useRef<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.setProperty('--ss-accent', settings.accentColor);
    root.style.setProperty('--ss-accent-soft', `${settings.accentColor}26`);

    if (settings.reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }

    if (settings.highContrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }

    const sizePx = settings.fontSize === 'sm' ? '14px' : settings.fontSize === 'lg' ? '17px' : '15px';
    root.style.fontSize = sizePx;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage write errors
    }
  }, [settings]);

  const clearUserSettingsListener = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    listeningUidRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      unsubRef.current?.();
    };
  }, []);

  const loadUserSettings = useCallback(async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, 'userSettings', uid));
      if (snap.exists()) {
        const data = snap.data() as Partial<UserSettings>;
        setSettings((prev) => sanitizeSettings({ ...prev, ...data }));
      }
    } catch (err) {
      console.error('Failed loading user settings:', err);
    }

    if (listeningUidRef.current !== uid) {
      unsubRef.current?.();
      listeningUidRef.current = uid;
      unsubRef.current = onSnapshot(
        doc(db, 'userSettings', uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as Partial<UserSettings>;
            setSettings((prev) => sanitizeSettings({ ...prev, ...data }));
          }
        },
        (err) => {
          console.error('User settings listener error:', err);
        }
      );
    }
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<ThemeSettingsState>) => {
      const prev = settings;
      const next = sanitizeSettings({ ...settings, ...patch });
      const user = auth.currentUser;
      if (user && user.emailVerified) {
        try {
          await setDoc(
            doc(db, 'userSettings', user.uid),
            {
              userId: user.uid,
              ...next,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          setSettings(next);
        } catch (err) {
          setSettings(prev);
          throw err instanceof Error ? err : new Error('Failed to save settings to database.');
        }
      } else {
        setSettings(next);
      }
    },
    [settings]
  );

  return (
    <ThemeContext.Provider
      value={{ settings, updateSettings, loadUserSettings, clearUserSettingsListener }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
