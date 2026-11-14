import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Accessibility,
  Bell,
  Info,
  KeyRound,
  Link2,
  LogOut,
  Palette,
  Search,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ACCENT_PRESETS, useTheme } from '../contexts/ThemeContext';
import { apiRequest } from '../services/apiClient';
import type { ProfileVisibility } from '../types/shadowspace';
import { ASSET_IMAGES } from '../utils/validators';

interface SettingsModalProps {
  onOpenProfileEditor: () => void;
  onClose: () => void;
}

type SettingsTab =
  | 'account'
  | 'appearance'
  | 'privacy'
  | 'notifications'
  | 'accessibility'
  | 'about';

export function SettingsModal({ onOpenProfileEditor, onClose }: SettingsModalProps) {
  const {
    firebaseUser,
    profile,
    privateAccount,
    changePassword,
    deleteAccount,
    logout,
    refreshProfile,
  } = useAuth();
  const { settings, updateSettings } = useTheme();

  const [tab, setTab] = useState<SettingsTab>('account');
  const [navSearch, setNavSearch] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [discordStatus, setDiscordStatus] = useState<{
    configured: boolean;
    clientIdValid?: boolean;
    redirectUri: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runSettingSave = async (fn: () => Promise<void>, successMessage: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to persist setting.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetch('/api/oauth/discord/status')
      .then((r) => r.json())
      .then((d) => setDiscordStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      if (
        origin !== window.location.origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }
      if (event.data?.type === 'DISCORD_OAUTH_SUCCESS' && firebaseUser) {
        const { discordId, discordUsername, discordAvatar } = event.data.profile || {};
        try {
          await updateDoc(doc(db, 'users', firebaseUser.uid), {
            discordUsername: discordUsername || '',
            discordAvatar: discordAvatar || '',
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'account'), {
            discordId: discordId || '',
            updatedAt: serverTimestamp(),
          });
          await refreshProfile();
          setNotice(`Linked Discord account: ${discordUsername}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed saving Discord link');
        }
      } else if (event.data?.type === 'DISCORD_OAUTH_ERROR') {
        setError(event.data.error || 'Discord authorization failed');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [firebaseUser, refreshProfile]);

  const handleConnectDiscord = async () => {
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<{ url: string }>('/api/oauth/discord/url');
      const popup = window.open(data.url, 'discord_oauth', 'width=540,height=720');
      if (!popup) {
        setError('Popup was blocked by your browser. Allow popups for this site and try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not initiate Discord OAuth2');
    }
  };

  const handleUnlinkDiscord = async () => {
    if (!firebaseUser) return;
    await runSettingSave(async () => {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        discordUsername: '',
        discordAvatar: '',
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'account'), {
        discordId: '',
        updatedAt: serverTimestamp(),
      });
      await refreshProfile();
    }, 'Discord account unlinked.');
  };

  const groups: Array<{
    heading: string;
    items: Array<{ id: SettingsTab; label: string; icon: React.ReactNode; keywords: string }>;
  }> = [
    {
      heading: 'User Settings',
      items: [
        {
          id: 'account',
          label: 'My Account',
          icon: <User className="w-4 h-4" />,
          keywords: 'account password discord email delete',
        },
        {
          id: 'privacy',
          label: 'Privacy & Safety',
          icon: <Shield className="w-4 h-4" />,
          keywords: 'privacy visibility dm presence after dark',
        },
      ],
    },
    {
      heading: 'App Settings',
      items: [
        {
          id: 'appearance',
          label: 'Appearance',
          icon: <Palette className="w-4 h-4" />,
          keywords: 'appearance theme dark light accent font density',
        },
        {
          id: 'notifications',
          label: 'Notifications',
          icon: <Bell className="w-4 h-4" />,
          keywords: 'notifications alerts mentions dms',
        },
        {
          id: 'accessibility',
          label: 'Accessibility',
          icon: <Accessibility className="w-4 h-4" />,
          keywords: 'accessibility reduced motion contrast shortcuts',
        },
        {
          id: 'about',
          label: 'Application',
          icon: <Info className="w-4 h-4" />,
          keywords: 'about shadowspace terms privacy',
        },
      ],
    },
  ];

  const q = navSearch.trim().toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:flex-row bg-zinc-50 dark:bg-[#1b1c21] text-zinc-900 dark:text-[#f2f3f5]">
      {/* Left Navigation Sidebar (Screenshot 170) */}
      <aside className="md:w-[270px] lg:w-[300px] border-b md:border-b-0 md:border-r border-zinc-200 dark:border-white/[0.06] bg-zinc-100 dark:bg-[#17181c] flex md:justify-end shrink-0">
        <div className="w-full md:w-[232px] p-3 md:py-6 md:px-4 flex flex-col gap-3 overflow-y-auto">
          {/* Top Mini User Card */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenProfileEditor();
            }}
            className="hidden md:flex items-center gap-2.5 p-2.5 rounded-lg bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.06] hover:border-white/15 text-left transition-colors"
          >
            <img
              src={profile?.avatarUrl || ASSET_IMAGES.obsidianAvatar}
              alt={profile?.displayName || 'User'}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover shrink-0 bg-[#111214]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate leading-tight">
                {profile?.displayName || 'Member'}
              </p>
              <p className="text-[11px] text-[#949cf7] truncate">Edit Profiles</p>
            </div>
          </button>

          {/* Search Bar */}
          <div className="relative hidden md:block">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="Search"
              className="w-full h-8 pl-8 pr-2.5 rounded-md bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.06] text-xs focus:outline-none focus:border-white/20"
            />
          </div>

          {/* Mobile Header Bar inside Sidebar */}
          <div className="flex md:hidden items-center justify-between">
            <span className="font-display font-bold text-sm">User Settings</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="p-1.5 rounded-md text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav Groups */}
          <div className="flex md:flex-col gap-3 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
            {groups.map((grp) => {
              const items = grp.items.filter(
                (item) =>
                  !q ||
                  item.label.toLowerCase().includes(q) ||
                  item.keywords.includes(q)
              );
              if (items.length === 0) return null;

              return (
                <div key={grp.heading} className="flex md:flex-col gap-0.5 shrink-0">
                  <p className="hidden md:block px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                    {grp.heading}
                  </p>
                  {items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTab(t.id);
                        setError(null);
                        setNotice(null);
                      }}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                        tab === t.id
                          ? 'bg-zinc-200 dark:bg-white/[0.09] text-zinc-900 dark:text-white'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-white/[0.05] hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="hidden md:block flex-1" />
          <div className="hidden md:block h-px bg-white/[0.06]" />

          <button
            type="button"
            onClick={logout}
            className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13px] font-medium text-rose-400 hover:bg-rose-500/15 whitespace-nowrap shrink-0 transition-colors"
          >
            <span>Log Out</span>
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Right Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto relative">
        {/* Desktop Top-Right Circular ESC Close Button */}
        <div className="hidden md:flex fixed top-6 right-8 z-20 flex-col items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-9 h-9 rounded-full border-2 border-zinc-500/70 hover:border-white text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-bold tracking-wider text-zinc-500">ESC</span>
        </div>

        <div className="max-w-3xl w-full px-5 sm:px-10 py-6 sm:py-12 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="font-display font-bold text-xl">
              {tab === 'account'
                ? 'My Account'
                : tab === 'privacy'
                  ? 'Privacy & Safety'
                  : tab === 'about'
                    ? 'ShadowSpace Application'
                    : `${tab.charAt(0).toUpperCase()}${tab.slice(1)}`}
            </h1>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
              {notice}
            </div>
          )}

          {tab === 'account' && (
            <div className="space-y-6">
              {/* Discord Account Summary Card (Screenshot 170) */}
              <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#17181c]">
                <div
                  className="h-24 w-full"
                  style={{ backgroundColor: profile?.accentColor || '#5865f2' }}
                >
                  {profile?.bannerUrl && (
                    <img
                      src={profile.bannerUrl}
                      alt="Profile banner"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>

                <div className="px-5 pb-5">
                  <div className="flex flex-wrap items-end justify-between gap-3 -mt-9 mb-4">
                    <div className="flex items-end gap-3.5">
                      <img
                        src={profile?.avatarUrl || ASSET_IMAGES.obsidianAvatar}
                        alt={profile?.displayName || 'User'}
                        referrerPolicy="no-referrer"
                        className="w-20 h-20 rounded-full object-cover border-[5px] border-white dark:border-[#17181c] bg-[#222328] shrink-0"
                      />
                      <div className="pb-1">
                        <p className="font-display font-bold text-lg leading-tight">
                          {profile?.displayName}
                        </p>
                        <p className="text-xs text-zinc-400">@{profile?.username}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenProfileEditor();
                      }}
                      className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold transition-colors"
                    >
                      Edit User Profile
                    </button>
                  </div>

                  <div className="rounded-lg bg-zinc-50 dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.06] p-4 space-y-3.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Display Name
                        </p>
                        <p className="text-sm font-medium mt-0.5">{profile?.displayName}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenProfileEditor();
                        }}
                        className="px-3 py-1.5 rounded-md bg-zinc-200 dark:bg-[#2b2d34] hover:bg-zinc-300 dark:hover:bg-[#353740] text-xs font-medium"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Username
                        </p>
                        <p className="text-sm font-medium mt-0.5">@{profile?.username}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenProfileEditor();
                        }}
                        className="px-3 py-1.5 rounded-md bg-zinc-200 dark:bg-[#2b2d34] hover:bg-zinc-300 dark:hover:bg-[#353740] text-xs font-medium"
                      >
                        Edit
                      </button>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                        Email
                      </p>
                      <p className="text-sm text-zinc-300 mt-0.5">{firebaseUser?.email}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Password update */}
              <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Password & Authentication</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Update your ShadowSpace login password at any time.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="password"
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 6 chars)"
                    className="flex-1 min-w-[200px] h-10 px-3 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.07] text-sm focus:outline-none focus:border-[#5865f2]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      setNotice(null);
                      try {
                        await changePassword(newPassword);
                        setNewPassword('');
                        setNotice('Password updated.');
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Re-authenticate recently before changing password.'
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> Change Password
                  </button>
                </div>
              </div>

              {/* Discord Account Linking */}
              <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-[#949cf7]" />
                    <h3 className="text-sm font-semibold">Connect Discord Account (Optional)</h3>
                  </div>
                  {profile?.discordUsername ? (
                    <button
                      type="button"
                      onClick={handleUnlinkDiscord}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 text-xs font-medium"
                    >
                      Unlink
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectDiscord}
                      className="px-3.5 py-1.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
                    >
                      Connect Discord
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {profile?.discordUsername
                    ? `Linked as ${profile.discordUsername}. Your ShadowSpace account remains completely independent.`
                    : 'Imports your public Discord username and avatar badge via official OAuth2 without storing passwords or accessing Discord private messages.'}
                </p>
                {discordStatus && !discordStatus.configured && (
                  <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                    Setup note: Configure DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in AI Studio Secrets.
                  </p>
                )}
                {discordStatus && discordStatus.configured && discordStatus.clientIdValid === false && (
                  <p className="text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                    Configuration warning: DISCORD_CLIENT_ID does not look like a valid numeric Discord Application ID.
                  </p>
                )}
                {discordStatus?.redirectUri && (
                  <div className="flex items-center justify-between gap-2 bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.06] rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Discord Developer Portal Redirect URI
                      </p>
                      <p className="text-[11px] font-mono text-zinc-700 dark:text-zinc-300 truncate">
                        {discordStatus.redirectUri}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(discordStatus.redirectUri);
                        setNotice('Copied Discord Redirect URI.');
                      }}
                      className="px-2.5 py-1 rounded-md bg-zinc-200 dark:bg-[#222328] hover:bg-zinc-300 dark:hover:bg-[#2b2d34] text-[11px] font-medium shrink-0"
                    >
                      Copy URI
                    </button>
                  </div>
                )}
              </div>

              {/* Account Removal */}
              <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/5 space-y-2.5">
                <h3 className="text-sm font-semibold text-rose-400">Account Removal</h3>
                <p className="text-xs text-zinc-400">
                  Permanently delete your ShadowSpace account and sign out of all sessions.
                </p>
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-xs font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Account
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await deleteAccount();
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : 'Please sign in again before deleting your account.'
                          );
                        }
                      }}
                      className="px-3.5 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold"
                    >
                      Confirm Permanent Deletion
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Theme
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {(['dark', 'light'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void runSettingSave(
                          () => updateSettings({ theme: mode }),
                          `Switched to ${mode} mode.`
                        )
                      }
                      className={`p-3.5 rounded-lg border text-left text-xs font-semibold capitalize transition-colors disabled:opacity-60 ${
                        settings.theme === mode
                          ? 'border-[#5865f2] bg-[#5865f2]/15 text-[#949cf7]'
                          : 'border-zinc-200 dark:border-white/[0.07] hover:border-white/20'
                      }`}
                    >
                      {mode} Mode
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Accent Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void runSettingSave(
                          () => updateSettings({ accentColor: preset.hex }),
                          `Accent color saved (${preset.label}).`
                        )
                      }
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium disabled:opacity-60 ${
                        settings.accentColor === preset.hex
                          ? 'border-[#5865f2] bg-[#5865f2]/15'
                          : 'border-zinc-200 dark:border-white/[0.07]'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full"
                        style={{ backgroundColor: preset.hex }}
                      />
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-2.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Chat Font Size
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['sm', 'md', 'lg'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void runSettingSave(
                            () => updateSettings({ fontSize: sz }),
                            'Font size saved.'
                          )
                        }
                        className={`py-2 rounded-md border text-xs font-medium uppercase disabled:opacity-60 ${
                          settings.fontSize === sz
                            ? 'border-[#5865f2] bg-[#5865f2]/15 text-[#949cf7]'
                            : 'border-zinc-200 dark:border-white/[0.07]'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-2.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Message Display
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['compact', 'comfortable'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void runSettingSave(
                            () => updateSettings({ density: d }),
                            'Message density saved.'
                          )
                        }
                        className={`py-2 rounded-md border text-xs font-medium capitalize disabled:opacity-60 ${
                          settings.density === d
                            ? 'border-[#5865f2] bg-[#5865f2]/15 text-[#949cf7]'
                            : 'border-zinc-200 dark:border-white/[0.07]'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'privacy' && firebaseUser && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Profile Visibility
                  </label>
                  <select
                    disabled={saving}
                    value={profile?.profileVisibility || 'public'}
                    onChange={(e) => {
                      const val = e.target.value as ProfileVisibility;
                      void runSettingSave(async () => {
                        await updateDoc(doc(db, 'users', firebaseUser.uid), {
                          profileVisibility: val,
                          updatedAt: serverTimestamp(),
                        });
                        await refreshProfile();
                      }, 'Profile visibility updated.');
                    }}
                    className="w-full h-10 px-3 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.07] text-sm disabled:opacity-60"
                  >
                    <option value="public">Public (Discoverable)</option>
                    <option value="friends">Friends Only</option>
                    <option value="private">Private</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Direct Message Permissions
                  </label>
                  <select
                    disabled={saving}
                    value={privateAccount?.dmPermission || 'everyone'}
                    onChange={(e) => {
                      const val = e.target.value;
                      void runSettingSave(async () => {
                        await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'account'), {
                          dmPermission: val,
                          updatedAt: serverTimestamp(),
                        });
                        await refreshProfile();
                      }, 'DM permissions updated.');
                    }}
                    className="w-full h-10 px-3 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.07] text-sm disabled:opacity-60"
                  >
                    <option value="everyone">Everyone on ShadowSpace</option>
                    <option value="server_members">Server Members & Friends</option>
                    <option value="friends">Friends Only</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] cursor-pointer">
                <span className="text-sm font-medium">Show Online Presence Status</span>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={settings.showOnlineStatus}
                  onChange={(e) =>
                    void runSettingSave(
                      () => updateSettings({ showOnlineStatus: e.target.checked }),
                      'Online presence setting saved.'
                    )
                  }
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] cursor-pointer">
                <span className="text-sm font-medium">Auto-preview Media & GIFs</span>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={settings.mediaAutoPreview}
                  onChange={(e) =>
                    void runSettingSave(
                      () => updateSettings({ mediaAutoPreview: e.target.checked }),
                      'Media preview setting saved.'
                    )
                  }
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] cursor-pointer">
                <span className="text-sm font-medium">After Dark 18+ Community Visibility</span>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={Boolean(privateAccount?.afterDarkConsent)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void runSettingSave(async () => {
                      await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'account'), {
                        afterDarkConsent: checked,
                        updatedAt: serverTimestamp(),
                      });
                      await refreshProfile();
                    }, 'After Dark preference saved.');
                  }}
                />
              </label>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="space-y-3">
              {[
                { key: 'notifyDms', label: 'Direct & Group Message Alerts' },
                { key: 'notifyMentions', label: '@Mention Alerts' },
                { key: 'notifyFriendRequests', label: 'Friend Request Alerts' },
                { key: 'notifyServers', label: 'Server & Community Updates' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] cursor-pointer"
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={Boolean(settings[item.key as keyof typeof settings])}
                    onChange={(e) =>
                      void runSettingSave(
                        () => updateSettings({ [item.key]: e.target.checked }),
                        'Notification preferences saved.'
                      )
                    }
                  />
                </label>
              ))}
            </div>
          )}

          {tab === 'accessibility' && (
            <div className="space-y-3">
              <label className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] cursor-pointer">
                <div>
                  <p className="text-sm font-medium">Reduced Motion</p>
                  <p className="text-xs text-zinc-400">Minimize transitions and smooth scrolling</p>
                </div>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={settings.reducedMotion}
                  onChange={(e) =>
                    void runSettingSave(
                      () => updateSettings({ reducedMotion: e.target.checked }),
                      'Accessibility settings saved.'
                    )
                  }
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] cursor-pointer">
                <div>
                  <p className="text-sm font-medium">High Contrast Mode</p>
                  <p className="text-xs text-zinc-400">Boost foreground contrast across surfaces</p>
                </div>
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={settings.highContrast}
                  onChange={(e) =>
                    void runSettingSave(
                      () => updateSettings({ highContrast: e.target.checked }),
                      'Accessibility settings saved.'
                    )
                  }
                />
              </label>

              <div className="p-4 rounded-xl bg-zinc-100 dark:bg-[#17181c] border border-zinc-200 dark:border-white/[0.07] text-xs text-zinc-400 space-y-1">
                <p className="font-semibold text-zinc-200">Keyboard Shortcuts</p>
                <p>Ctrl / Cmd + K — Open Quick Switcher / Search</p>
                <p>Enter — Send message · Escape — Close modal or cancel edit</p>
              </div>
            </div>
          )}

          {tab === 'about' && (
            <div className="space-y-4 text-xs text-zinc-400 leading-relaxed">
              <div className="p-5 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-1.5">
                <h3 className="text-base font-display font-bold text-zinc-100">ShadowSpace</h3>
                <p>Your Space. Your Identity. Your Community.</p>
                <p className="text-zinc-500">
                  100% free communication · Zero paywalls · Shared Web & Android backend
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] space-y-2">
                <h4 className="font-semibold text-zinc-200">Terms & Privacy Principles</h4>
                <p>
                  ShadowSpace respects user privacy with split-collection PII isolation, strict role-based server permissions, encrypted Firebase Authentication, and user-controlled blocking and reporting. Exploitation, non-consensual imagery, and harassment are strictly prohibited.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
