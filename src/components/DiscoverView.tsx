import React, { useEffect, useState } from 'react';
import { doc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Compass, KeyRound, Plus, Search, Users } from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiRequest } from '../services/apiClient';
import type { Server } from '../types/shadowspace';
import { ASSET_IMAGES, generateId } from '../utils/validators';

interface InvitePreviewInfo {
  code: string;
  serverId: string;
  serverName: string;
  serverDescription?: string;
  serverIconUrl?: string;
  serverBannerUrl?: string;
  serverAccentColor?: string;
  category?: string;
  isPublic?: boolean;
  isAfterDark?: boolean;
  memberCount?: number;
}

interface DiscoverViewProps {
  publicServers: Server[];
  joinedServerIds: Set<string>;
  onSelectServer: (serverId: string) => void;
  onOpenCreateServer: () => void;
}

export function DiscoverView({
  publicServers,
  joinedServerIds,
  onSelectServer,
  onOpenCreateServer,
}: DiscoverViewProps) {
  const { firebaseUser } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [inviteCode, setInviteCode] = useState('');
  const [invitePreview, setInvitePreview] = useState<InvitePreviewInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const clean = inviteCode.trim().toUpperCase();
    if (clean.length < 4) {
      setInvitePreview(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const info = await apiRequest<InvitePreviewInfo>(`/api/invites/${encodeURIComponent(clean)}`);
        if (!cancelled) setInvitePreview(info);
      } catch {
        if (!cancelled) setInvitePreview(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inviteCode]);

  const categories = ['All', 'General', 'Gaming', 'Creative', 'Tech', 'Music', 'After Dark'];

  const filtered = publicServers.filter((s) => {
    if (category !== 'All') {
      if (category === 'After Dark' && !s.isAfterDark) return false;
      if (category !== 'After Dark' && (s.category || 'General') !== category) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    );
  });

  const handleJoinPublic = async (server: Server) => {
    if (!firebaseUser) return;
    if (joinedServerIds.has(server.id)) {
      onSelectServer(server.id);
      return;
    }
    setBusyId(server.id);
    setError(null);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'serverMembers', `${server.id}_${firebaseUser.uid}`), {
        serverId: server.id,
        userId: firebaseUser.uid,
        role: 'member',
        isPublicServer: true,
        muted: false,
        banned: false,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'servers', server.id), {
        memberCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      onSelectServer(server.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join community');
    } finally {
      setBusyId(null);
    }
  };

  const handleJoinInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim();
    if (!code) return;
    setBusyId('invite');
    setError(null);
    setNotice(null);
    try {
      const resp = await apiRequest<{ joined: boolean; serverId: string; serverName: string }>(
        '/api/servers/join-invite',
        {
          method: 'POST',
          body: JSON.stringify({ code }),
        }
      );
      setInviteCode('');
      setNotice(`Joined ${resp.serverName}!`);
      onSelectServer(resp.serverId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired invite code');
    } finally {
      setBusyId(null);
    }
  };

  const handleBootstrapStarterCommunity = async () => {
    if (!firebaseUser) return;
    setBusyId('bootstrap');
    setError(null);
    try {
      const srvId = generateId('srv');
      const catId = generateId('cat');
      const ch1 = generateId('ch');
      const ch2 = generateId('ch');
      const chVoice = generateId('ch');

      const batch = writeBatch(db);
      batch.set(doc(db, 'servers', srvId), {
        id: srvId,
        name: 'ShadowSpace Commons',
        description: 'Open town square for builders, designers, music heads, and late-night conversations.',
        iconUrl: ASSET_IMAGES.brandEmblem,
        bannerUrl: ASSET_IMAGES.studioBanner,
        ownerId: firebaseUser.uid,
        isPublic: true,
        isAfterDark: false,
        category: 'General',
        memberCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'serverMembers', `${srvId}_${firebaseUser.uid}`), {
        serverId: srvId,
        userId: firebaseUser.uid,
        role: 'owner',
        isPublicServer: true,
        muted: false,
        banned: false,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channelCategories', catId), {
        id: catId,
        serverId: srvId,
        name: 'Commons',
        position: 0,
        isPublicServer: true,
        ownerId: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channels', ch1), {
        id: ch1,
        serverId: srvId,
        categoryId: catId,
        name: 'welcome-lounge',
        type: 'text',
        topic: 'Introduce yourself and connect with fellow ShadowSpace members.',
        isPrivate: false,
        isPublic: true,
        isAfterDark: false,
        position: 0,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channels', ch2), {
        id: ch2,
        serverId: srvId,
        categoryId: catId,
        name: 'announcements',
        type: 'announcement',
        topic: 'Community updates and open events.',
        isPrivate: false,
        isPublic: true,
        isAfterDark: false,
        position: 1,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channels', chVoice), {
        id: chVoice,
        serverId: srvId,
        categoryId: catId,
        name: 'Acoustic Lounge',
        type: 'voice',
        topic: 'Live WebRTC voice room.',
        isPrivate: false,
        isPublic: true,
        isAfterDark: false,
        position: 2,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      onSelectServer(srvId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create starter community');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-6 bg-white dark:bg-[#1b1c21] text-zinc-900 dark:text-[#f2f3f5]">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Discover Communities</h1>
            <p className="text-xs text-zinc-400 mt-1">
              Public servers only · Private servers require an invitation code
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCreateServer}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Create Community
          </button>
        </div>

        {/* Search & Invite Join */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-7 relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search public communities…"
              className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-sm focus:outline-none focus:border-[#5865f2]"
            />
          </div>
          <form onSubmit={handleJoinInvite} className="md:col-span-5 flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter invite code…"
                className="w-full h-10 pl-9 pr-3 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-sm focus:outline-none focus:border-[#5865f2]"
              />
            </div>
            <button
              type="submit"
              disabled={busyId === 'invite'}
              className="px-4 h-10 rounded-lg bg-[#222328] hover:bg-[#2b2d34] border border-white/[0.08] text-white text-xs font-semibold shrink-0"
            >
              Join Code
            </button>
          </form>
        </div>

        {invitePreview && (
          <div
            className="rounded-2xl border bg-white dark:bg-[#12141B] overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4"
            style={{ borderColor: invitePreview.serverAccentColor || '#7c3aed' }}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <img
                src={invitePreview.serverIconUrl || ASSET_IMAGES.brandEmblem}
                alt={invitePreview.serverName}
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-xl object-cover shrink-0 border"
                style={{ borderColor: invitePreview.serverAccentColor || '#7c3aed' }}
              />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                  Live Invite Preview · {invitePreview.code}
                </p>
                <p className="font-display font-semibold text-base truncate">
                  {invitePreview.serverName}
                </p>
                <p className="text-xs text-zinc-400 truncate">
                  {invitePreview.serverDescription || 'ShadowSpace Community'} ·{' '}
                  {invitePreview.memberCount ?? 1} members ·{' '}
                  {invitePreview.isPublic ? 'Public' : 'Private'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleJoinInvite({ preventDefault: () => {} } as React.FormEvent)}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0"
            >
              Accept Invite
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                category === cat
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
            {notice}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-14 border border-dashed border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#17181c] rounded-xl space-y-3">
            <Compass className="w-9 h-9 text-zinc-500 mx-auto" />
            <h2 className="text-base font-display font-semibold">No public communities match yet</h2>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Launch your own ShadowSpace community or initialize the Commons starter server in Firestore.
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                disabled={busyId === 'bootstrap'}
                onClick={handleBootstrapStarterCommunity}
                className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
              >
                {busyId === 'bootstrap' ? 'Creating…' : 'Launch ShadowSpace Commons'}
              </button>
              <button
                type="button"
                onClick={onOpenCreateServer}
                className="px-4 py-2 rounded-lg bg-[#222328] hover:bg-[#2b2d34] border border-white/[0.08] text-zinc-200 text-xs font-semibold"
              >
                Custom Server
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((srv) => {
              const joined = joinedServerIds.has(srv.id);
              return (
                <article
                  key={srv.id}
                  className="rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328] overflow-hidden flex flex-col justify-between shadow-lg"
                  style={srv.accentColor ? { borderColor: `${srv.accentColor}55` } : undefined}
                >
                  <div>
                    <div className="relative">
                      <div className="h-28 bg-[#111214] overflow-hidden">
                        <img
                          src={srv.bannerUrl || ASSET_IMAGES.studioBanner}
                          alt={srv.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                      </div>
                      <img
                        src={srv.iconUrl || ASSET_IMAGES.brandEmblem}
                        alt={srv.name}
                        referrerPolicy="no-referrer"
                        style={srv.accentColor ? { borderColor: srv.accentColor } : undefined}
                        className="w-12 h-12 rounded-2xl object-cover border-[3px] border-[#222328] absolute -bottom-5 left-4 bg-[#17181c] z-10 shadow-md"
                      />
                    </div>
                    <div className="pt-7 px-4 pb-4 space-y-1.5">
                      <h3 className="font-display font-semibold text-base truncate">{srv.name}</h3>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span>{srv.category || 'General'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Users className="w-3.5 h-3.5" /> {srv.memberCount || 1}
                        </span>
                        {srv.isAfterDark && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-rose-400">After Dark</span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 line-clamp-2 pt-1">
                        {srv.description || 'Independent community on ShadowSpace.'}
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      disabled={busyId === srv.id}
                      onClick={() => handleJoinPublic(srv)}
                      className={`w-full h-9 rounded-lg text-xs font-semibold transition-colors ${
                        joined
                          ? 'bg-zinc-200 dark:bg-[#17181c] hover:bg-zinc-300 dark:hover:bg-[#2b2d34] text-zinc-800 dark:text-zinc-200'
                          : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'
                      }`}
                    >
                      {busyId === srv.id ? 'Joining…' : joined ? 'Open Community' : 'Join Community'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
