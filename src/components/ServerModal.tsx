import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Edit3,
  Hash,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  Megaphone,
  Palette,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  Upload,
  UserX,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { apiRequest } from '../services/apiClient';
import type {
  AuditLogItem,
  Channel,
  ChannelCategory,
  ChannelType,
  Server,
  ServerInvitation,
  ServerMember,
  ServerPermissions,
  ServerRole,
  ServerRoleDefinition,
  UserPublic,
} from '../types/shadowspace';
import {
  deleteCloudinaryAsset,
  startCloudinaryUpload,
  type ActiveUploadHandle,
} from '../utils/cloudinaryUpload';
import {
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_MODERATOR_PERMISSIONS,
  PERMISSION_LABELS,
  computeEffectivePermissions,
} from '../utils/permissions';
import { ASSET_IMAGES, generateId, truncateText } from '../utils/validators';
import { MediaModal } from './MediaModal';

type ManageTab = 'overview' | 'channels' | 'roles' | 'invites' | 'members' | 'audit';

interface InvitePreviewData {
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
  uses?: number;
  maxUses?: number;
}

const SERVER_ACCENT_SWATCHES = [
  '#7c3aed',
  '#5865f2',
  '#ec4899',
  '#e11d48',
  '#38bdf8',
  '#10b981',
  '#f59e0b',
];

const SERVER_TEMPLATES: Array<{
  id: string;
  label: string;
  category: string;
  hint: string;
}> = [
  { id: 'gaming', label: 'Gaming', category: 'Gaming', hint: 'Squad up, voice lobbies & LFG' },
  { id: 'friends', label: 'Friends', category: 'General', hint: 'Chill hangout for your circle' },
  { id: 'study', label: 'Study Group', category: 'Tech', hint: 'Focus rooms, notes & Q&A' },
  { id: 'creative', label: 'Creative Studio', category: 'Creative', hint: 'Art, showcase & critique' },
  { id: 'music', label: 'Music Lounge', category: 'Music', hint: 'Listening parties & production' },
];

/* -------------------------------------------------------------------------- */
/* QUICK CREATE CHANNEL MODAL (Screenshot 163)                                */
/* -------------------------------------------------------------------------- */

interface QuickCreateChannelModalProps {
  server: Server;
  categories: ChannelCategory[];
  members: ServerMember[];
  initialCategoryId?: string;
  nextPosition: number;
  onClose: () => void;
}

export function QuickCreateChannelModal({
  server,
  categories,
  members,
  initialCategoryId = '',
  nextPosition,
  onClose,
}: QuickCreateChannelModalProps) {
  const { firebaseUser } = useAuth();
  const [chType, setChType] = useState<ChannelType>('text');
  const [chName, setChName] = useState('');
  const [categoryId, setCategoryId] = useState(initialCategoryId || categories[0]?.id || '');
  const [isPrivate, setIsPrivate] = useState(!server.isPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeCategoryName =
    categories.find((c) => c.id === categoryId)?.name || 'General';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = chName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
    if (!raw || !firebaseUser) return;
    setBusy(true);
    setError(null);
    try {
      const chId = generateId('ch');
      const memberUidList = Array.from(
        new Set([firebaseUser.uid, server.ownerId, ...members.map((m) => m.userId)])
      ).slice(0, 50);

      const finalType: ChannelType = isPrivate && chType === 'text' ? 'private' : chType;
      const effectivePrivate = isPrivate || finalType === 'private' || !server.isPublic;

      await setDoc(doc(db, 'channels', chId), {
        id: chId,
        serverId: server.id,
        categoryId: categoryId || '',
        name: raw,
        type: finalType,
        topic: '',
        description: '',
        isPrivate: effectivePrivate,
        isPublic: !effectivePrivate && server.isPublic,
        isAfterDark: server.isAfterDark,
        position: nextPosition,
        ownerId: firebaseUser.uid,
        memberUids: memberUidList,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-xl bg-[#222328] border border-white/[0.08] shadow-2xl overflow-hidden text-zinc-100"
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-white leading-tight">
              Create Channel
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">in {activeCategoryName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-300">Channel Type</label>
            {[
              {
                id: 'text' as ChannelType,
                title: 'Text',
                desc: 'Send messages, images, GIFs, emoji, opinions, and puns',
                icon: <Hash className="w-5 h-5 text-zinc-300" />,
              },
              {
                id: 'voice' as ChannelType,
                title: 'Voice',
                desc: 'Hang out together with real-time WebRTC voice audio',
                icon: <Volume2 className="w-5 h-5 text-zinc-300" />,
              },
              {
                id: 'announcement' as ChannelType,
                title: 'Announcement',
                desc: 'Share updates, events, and highlights with your community',
                icon: <Megaphone className="w-5 h-5 text-zinc-300" />,
              },
            ].map((item) => {
              const selected = chType === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setChType(item.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    selected
                      ? 'bg-[#2b2d34] border-violet-500/60'
                      : 'bg-[#1b1c21] border-white/[0.05] hover:bg-[#26282e]'
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-100">{item.title}</p>
                    <p className="text-[11px] text-zinc-400 leading-snug">{item.desc}</p>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selected ? 'border-violet-500' : 'border-zinc-500'
                    }`}
                  >
                    {selected && <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-300">Channel Name</label>
            <div className="flex items-center gap-2 h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] focus-within:border-violet-500">
              {chType === 'voice' ? (
                <Volume2 className="w-4 h-4 text-zinc-400 shrink-0" />
              ) : isPrivate ? (
                <Lock className="w-4 h-4 text-zinc-400 shrink-0" />
              ) : (
                <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
              )}
              <input
                type="text"
                autoFocus
                required
                value={chName}
                onChange={(e) => setChName(e.target.value)}
                placeholder="new-channel"
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
            </div>
          </div>

          {categories.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-300">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-start justify-between gap-4 pt-1">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                <Lock className="w-3.5 h-3.5 text-zinc-400" />
                <span>Private Channel</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                Only selected members and roles will be able to view this channel.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              onClick={() => setIsPrivate((v) => !v)}
              className={`w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                isPrivate ? 'bg-violet-600' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  isPrivate ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[#1b1c21] border-t border-white/[0.06] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !chName.trim()}
            className="px-4 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create Channel'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* QUICK CREATE CATEGORY MODAL (Screenshot 164)                               */
/* -------------------------------------------------------------------------- */

interface QuickCreateCategoryModalProps {
  server: Server;
  members: ServerMember[];
  nextPosition: number;
  onClose: () => void;
}

export function QuickCreateCategoryModal({
  server,
  members,
  nextPosition,
  onClose,
}: QuickCreateCategoryModalProps) {
  const { firebaseUser } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = truncateText(name, 60);
    if (!clean || !firebaseUser) return;
    setBusy(true);
    setError(null);
    try {
      const catId = generateId('cat');
      const memberUidList = Array.from(
        new Set([server.ownerId, firebaseUser.uid, ...members.map((m) => m.userId)])
      ).slice(0, 50);
      await setDoc(doc(db, 'channelCategories', catId), {
        id: catId,
        serverId: server.id,
        name: clean,
        position: nextPosition,
        isPublicServer: server.isPublic,
        ownerId: firebaseUser.uid,
        memberUids: memberUidList,
        createdAt: serverTimestamp(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-xl bg-[#222328] border border-white/[0.08] shadow-2xl overflow-hidden text-zinc-100"
      >
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-white">Create Category</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-300">Category Name</label>
            <input
              type="text"
              autoFocus
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New Category"
              className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Categories group related text and voice channels neatly in {server.name}.
          </p>
        </div>

        <div className="px-5 py-3.5 bg-[#1b1c21] border-t border-white/[0.06] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="px-4 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create Category'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MAIN SERVER MODAL (CREATE WIZARD + FULL-SCREEN SERVER/CHANNEL SETTINGS)    */
/* -------------------------------------------------------------------------- */

interface ServerModalProps {
  mode: 'create' | 'manage';
  server?: Server | null;
  channels?: Channel[];
  categories?: ChannelCategory[];
  members?: ServerMember[];
  roles?: ServerRoleDefinition[];
  memberProfiles?: Record<string, UserPublic>;
  myRole?: ServerRole | null;
  myPermissions?: ServerPermissions | null;
  initialTab?: ManageTab;
  initialEditChannelId?: string | null;
  onCreated?: (serverId: string) => void;
  onLeftOrDeleted?: () => void;
  onClose: () => void;
}

export function ServerModal({
  mode,
  server,
  channels = [],
  categories = [],
  members = [],
  roles = [],
  memberProfiles = {},
  myRole,
  myPermissions,
  initialTab = 'overview',
  initialEditChannelId = null,
  onCreated,
  onLeftOrDeleted,
  onClose,
}: ServerModalProps) {
  const { firebaseUser, profile } = useAuth();
  const { broadcastServerUpdate } = useRealtime();

  // Create Wizard steps: 'template' | 'audience' | 'customize' | 'join'
  const [createStep, setCreateStep] = useState<'template' | 'audience' | 'customize' | 'join'>('template');
  const [joinCode, setJoinCode] = useState('');
  const [joinPreview, setJoinPreview] = useState<InvitePreviewData | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  const [tab, setTab] = useState<ManageTab>(initialTab);

  // Server Overview / Create state
  const [name, setName] = useState(server?.name || '');
  const [description, setDescription] = useState(server?.description || '');
  const [category, setCategory] = useState(server?.category || 'General');
  const [isPublic, setIsPublic] = useState(server ? server.isPublic : true);
  const [isAfterDark, setIsAfterDark] = useState(server ? server.isAfterDark : false);
  const [iconUrl, setIconUrl] = useState(server?.iconUrl || ASSET_IMAGES.brandEmblem);
  const [iconPublicId, setIconPublicId] = useState(server?.iconPublicId || '');
  const [bannerUrl, setBannerUrl] = useState(server?.bannerUrl || ASSET_IMAGES.studioBanner);
  const [bannerPublicId, setBannerPublicId] = useState(server?.bannerPublicId || '');
  const [accentColor, setAccentColor] = useState(server?.accentColor || '#7c3aed');
  const [dirtyOverview, setDirtyOverview] = useState(false);

  // Cloudinary upload state for server icon / banner
  const [uploadProgress, setUploadProgress] = useState<{
    target: 'server_icon' | 'server_banner';
    percent: number;
    bytesTransferred: number;
    totalBytes: number;
  } | null>(null);
  const [failedUpload, setFailedUpload] = useState<{
    file: File;
    target: 'server_icon' | 'server_banner';
  } | null>(null);
  const [mediaTarget, setMediaTarget] = useState<'server_icon' | 'server_banner' | null>(null);
  const activeUploadRef = useRef<ActiveUploadHandle | null>(null);

  // Channel creation & editing
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<ChannelType>('text');
  const [newChannelTopic, setNewChannelTopic] = useState('');
  const [newChannelDescription, setNewChannelDescription] = useState('');
  const [newChannelCategoryId, setNewChannelCategoryId] = useState(categories[0]?.id || '');
  const [newCategoryName, setNewCategoryName] = useState('');

  const [editingChannelId, setEditingChannelId] = useState<string | null>(initialEditChannelId);
  const [editChName, setEditChName] = useState('');
  const [editChTopic, setEditChTopic] = useState('');
  const [editChDescription, setEditChDescription] = useState('');
  const [editChCategoryId, setEditChCategoryId] = useState('');
  const [editChType, setEditChType] = useState<ChannelType>('text');
  const [editChPrivate, setEditChPrivate] = useState(false);
  const [editChAllowedRoles, setEditChAllowedRoles] = useState<string[]>([]);

  // Category editing
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');

  // Custom Roles management
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#8b5cf6');
  const [newRolePerms, setNewRolePerms] = useState<ServerPermissions>({
    ...DEFAULT_MEMBER_PERMISSIONS,
  });
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleColor, setEditRoleColor] = useState('#8b5cf6');
  const [editRolePerms, setEditRolePerms] = useState<ServerPermissions>({
    ...DEFAULT_MEMBER_PERMISSIONS,
  });

  // Invites & Audit
  const [invites, setInvites] = useState<ServerInvitation[]>([]);
  const [previewCode, setPreviewCode] = useState('');
  const [invitePreview, setInvitePreview] = useState<InvitePreviewData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOwner = Boolean(
    myRole === 'owner' || (server && firebaseUser && server.ownerId === firebaseUser.uid)
  );
  const canManageServer =
    isOwner || myRole === 'admin' || Boolean(myPermissions?.manageServer);
  const canManageChannels =
    isOwner || myRole === 'admin' || Boolean(myPermissions?.manageChannels);
  const canManageRoles =
    isOwner || myRole === 'admin' || Boolean(myPermissions?.manageRoles);
  const canModerateMembers =
    isOwner ||
    myRole === 'admin' ||
    myRole === 'moderator' ||
    Boolean(myPermissions?.moderateMembers);
  const canCreateInvites =
    isOwner ||
    myRole === 'admin' ||
    myRole === 'moderator' ||
    Boolean(myPermissions?.createInvites);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mediaTarget) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mediaTarget, onClose]);

  useEffect(() => {
    return () => {
      activeUploadRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Reset / sync Overview form when switching servers or saving cleanly
  useEffect(() => {
    if (mode === 'create') {
      setName(profile?.displayName ? `${profile.displayName}'s Server` : '');
      setDescription('');
      setCategory('General');
      setIsPublic(true);
      setIsAfterDark(false);
      setIconUrl(ASSET_IMAGES.brandEmblem);
      setIconPublicId('');
      setBannerUrl(ASSET_IMAGES.studioBanner);
      setBannerPublicId('');
      setAccentColor('#7c3aed');
      setDirtyOverview(false);
      return;
    }
    if (server && !dirtyOverview) {
      setName(server.name || '');
      setDescription(server.description || '');
      setCategory(server.category || 'General');
      setIsPublic(Boolean(server.isPublic));
      setIsAfterDark(Boolean(server.isAfterDark));
      setIconUrl(server.iconUrl || ASSET_IMAGES.brandEmblem);
      setIconPublicId(server.iconPublicId || '');
      setBannerUrl(server.bannerUrl || ASSET_IMAGES.studioBanner);
      setBannerPublicId(server.bannerPublicId || '');
      setAccentColor(server.accentColor || '#7c3aed');
    }
  }, [mode, server, dirtyOverview, profile?.displayName]);

  // Sync editing channel fields if initialEditChannelId is provided
  useEffect(() => {
    if (!editingChannelId) return;
    const ch = channels.find((c) => c.id === editingChannelId);
    if (ch) {
      setEditChName(ch.name);
      setEditChTopic(ch.topic || '');
      setEditChDescription(ch.description || '');
      setEditChCategoryId(ch.categoryId || '');
      setEditChType(ch.type);
      setEditChPrivate(Boolean(ch.isPrivate));
      setEditChAllowedRoles(ch.allowedRoles || []);
    }
  }, [editingChannelId, channels]);

  useEffect(() => {
    if (!newChannelCategoryId && categories.length > 0) {
      setNewChannelCategoryId(categories[0].id);
    }
  }, [categories, newChannelCategoryId]);

  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => a.position - b.position),
    [channels]
  );

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories]
  );

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => a.position - b.position),
    [roles]
  );

  const roleById = useMemo(() => {
    const map: Record<string, ServerRoleDefinition> = {};
    for (const r of roles) map[r.id] = r;
    return map;
  }, [roles]);

  // Load Invites or Audit Logs when tab is opened
  useEffect(() => {
    if (mode !== 'manage' || !server || !firebaseUser) return;
    if (tab === 'invites') {
      const fetchInvites = async () => {
        try {
          const collected = new Map<string, ServerInvitation>();
          const snaps = await Promise.all([
            getDocs(
              query(
                collection(db, 'serverInvitations'),
                where('creatorId', '==', firebaseUser.uid),
                limit(25)
              )
            ).catch(() => null),
            getDocs(
              query(
                collection(db, 'serverInvitations'),
                where('serverOwnerId', '==', firebaseUser.uid),
                limit(25)
              )
            ).catch(() => null),
            getDocs(
              query(
                collection(db, 'serverInvitations'),
                where('staffUids', 'array-contains', firebaseUser.uid),
                limit(25)
              )
            ).catch(() => null),
          ]);
          for (const snap of snaps) {
            if (!snap) continue;
            for (const d of snap.docs) {
              const inv = d.data() as ServerInvitation;
              if (inv.serverId === server.id) {
                collected.set(inv.code, inv);
              }
            }
          }
          setInvites(Array.from(collected.values()));
        } catch {
          // Ignore invite query failures
        }
      };
      void fetchInvites();
    } else if (tab === 'audit') {
      const fetchLogs = async () => {
        try {
          const collected = new Map<string, AuditLogItem>();
          const snaps = await Promise.all([
            getDocs(
              query(
                collection(db, 'auditLogs'),
                where('actorId', '==', firebaseUser.uid),
                orderBy('createdAt', 'desc'),
                limit(30)
              )
            ).catch(() => null),
            getDocs(
              query(
                collection(db, 'auditLogs'),
                where('serverOwnerId', '==', firebaseUser.uid),
                limit(30)
              )
            ).catch(() => null),
          ]);
          for (const snap of snaps) {
            if (!snap) continue;
            for (const d of snap.docs) {
              const log = d.data() as AuditLogItem;
              if (log.serverId === server.id) {
                collected.set(log.id, log);
              }
            }
          }
          setAuditLogs(Array.from(collected.values()));
        } catch {
          // Ignore audit log query failures
        }
      };
      void fetchLogs();
    }
  }, [firebaseUser, mode, server, tab]);

  // Live preview inside Join a Server wizard step
  useEffect(() => {
    if (mode !== 'create' || createStep !== 'join') return;
    const clean = joinCode.trim().toUpperCase();
    if (clean.length < 4) {
      setJoinPreview(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const info = await apiRequest<InvitePreviewData>(`/api/invites/${encodeURIComponent(clean)}`);
        if (!cancelled) setJoinPreview(info);
      } catch {
        if (!cancelled) setJoinPreview(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [createStep, joinCode, mode]);

  const startServerMediaUpload = async (
    file: File,
    purpose: 'server_icon' | 'server_banner'
  ) => {
    if (!firebaseUser) return;
    setError(null);
    setNotice(null);
    setFailedUpload(null);

    activeUploadRef.current?.cancel();
    const handle = startCloudinaryUpload({
      file,
      purpose,
      onProgress: (info) => {
        if (info.state === 'running' || info.state === 'paused') {
          setUploadProgress({
            target: purpose,
            percent: info.percent,
            bytesTransferred: info.bytesTransferred,
            totalBytes: info.totalBytes,
          });
        }
      },
    });
    activeUploadRef.current = handle;

    try {
      const result = await handle.promise;
      activeUploadRef.current = null;
      setUploadProgress(null);
      setDirtyOverview(true);

      if (purpose === 'server_icon') {
        const unsavedPrev =
          iconPublicId && iconPublicId !== (server?.iconPublicId || '')
            ? iconPublicId
            : '';
        setIconUrl(result.downloadUrl);
        setIconPublicId(result.publicId);
        if (unsavedPrev && unsavedPrev !== result.publicId) {
          void deleteCloudinaryAsset(unsavedPrev).catch(() => {});
        }
      } else {
        const unsavedPrev =
          bannerPublicId && bannerPublicId !== (server?.bannerPublicId || '')
            ? bannerPublicId
            : '';
        setBannerUrl(result.downloadUrl);
        setBannerPublicId(result.publicId);
        if (unsavedPrev && unsavedPrev !== result.publicId) {
          void deleteCloudinaryAsset(unsavedPrev).catch(() => {});
        }
      }
      setNotice(
        `${purpose === 'server_icon' ? 'Server icon' : 'Server banner'} uploaded.${
          mode === 'manage' ? ' Click Save Changes to apply.' : ''
        }`
      );
    } catch (err) {
      activeUploadRef.current = null;
      setUploadProgress(null);
      setFailedUpload({ file, target: purpose });
      setError(err instanceof Error ? err.message : 'Cloudinary upload failed');
    }
  };

  const handleFileInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    purpose: 'server_icon' | 'server_banner'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void startServerMediaUpload(file, purpose);
  };

  const handleJoinViaCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = joinCode.trim();
    if (!clean) return;
    setJoinBusy(true);
    setError(null);
    try {
      const resp = await apiRequest<{ joined: boolean; serverId: string; serverName: string }>(
        '/api/servers/join-invite',
        {
          method: 'POST',
          body: JSON.stringify({ code: clean }),
        }
      );
      onCreated?.(resp.serverId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired invite code');
    } finally {
      setJoinBusy(false);
    }
  };

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      setError('You must be signed in to create a server.');
      return;
    }
    if (!firebaseUser.emailVerified) {
      setError('Please verify your email address before creating a server.');
      return;
    }
    const cleanName = truncateText(name, 80);
    if (cleanName.length < 2) {
      setError('Server name must be at least 2 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await firebaseUser.getIdToken(false);
      const srvId = generateId('srv');
      const catId = generateId('cat');
      const chGeneral = generateId('ch');
      const chVoice = generateId('ch');
      const modRoleId = generateId('role');
      const vipRoleId = generateId('role');

      const resolvedBanner =
        bannerUrl || (isAfterDark ? ASSET_IMAGES.afterDarkBanner : ASSET_IMAGES.studioBanner);
      const resolvedIcon = iconUrl || ASSET_IMAGES.brandEmblem;

      const batch = writeBatch(db);
      batch.set(doc(db, 'servers', srvId), {
        id: srvId,
        name: cleanName,
        description: truncateText(description, 500),
        iconUrl: resolvedIcon,
        ...(iconPublicId ? { iconPublicId } : {}),
        bannerUrl: resolvedBanner,
        ...(bannerPublicId ? { bannerPublicId } : {}),
        accentColor: accentColor || '#7c3aed',
        ownerId: firebaseUser.uid,
        isPublic,
        isAfterDark,
        category: isAfterDark ? 'After Dark' : category,
        memberCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'serverMembers', `${srvId}_${firebaseUser.uid}`), {
        serverId: srvId,
        userId: firebaseUser.uid,
        role: 'owner',
        isPublicServer: isPublic,
        muted: false,
        banned: false,
        serverOwnerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channelCategories', catId), {
        id: catId,
        serverId: srvId,
        name: 'Text Channels',
        position: 0,
        isPublicServer: isPublic,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channels', chGeneral), {
        id: chGeneral,
        serverId: srvId,
        categoryId: catId,
        name: 'general',
        type: 'text',
        topic: `Welcome to ${cleanName}`,
        description: 'Main community discussion channel.',
        isPrivate: !isPublic,
        isPublic,
        isAfterDark,
        position: 0,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channels', chVoice), {
        id: chVoice,
        serverId: srvId,
        categoryId: catId,
        name: 'Voice Lounge',
        type: 'voice',
        isPrivate: !isPublic,
        isPublic,
        isAfterDark,
        position: 1,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'serverRoles', modRoleId), {
        id: modRoleId,
        serverId: srvId,
        name: 'Moderator',
        color: '#10b981',
        position: 0,
        permissions: DEFAULT_MODERATOR_PERMISSIONS,
        isPublicServer: isPublic,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'serverRoles', vipRoleId), {
        id: vipRoleId,
        serverId: srvId,
        name: 'VIP Member',
        color: '#a78bfa',
        position: 1,
        permissions: { ...DEFAULT_MEMBER_PERMISSIONS, pinMessages: true, createInvites: true },
        isPublicServer: isPublic,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      onCreated?.(srvId);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create server';
      setError(
        msg.includes('permissions')
          ? `Server creation blocked by security rules: ${msg}`
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server || !canManageServer) return;
    const cleanName = truncateText(name, 80);
    if (cleanName.length < 2) {
      setError('Server name must be at least 2 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const visibilityChanged = Boolean(server.isPublic) !== Boolean(isPublic);
      const memberUidList = Array.from(
        new Set([server.ownerId, ...members.map((m) => m.userId)])
      ).slice(0, 50);

      const batch = writeBatch(db);
      batch.update(doc(db, 'servers', server.id), {
        name: cleanName,
        description: truncateText(description, 500),
        category: isAfterDark ? 'After Dark' : category,
        isPublic,
        isAfterDark,
        iconUrl: iconUrl || ASSET_IMAGES.brandEmblem,
        iconPublicId: iconPublicId || '',
        bannerUrl: bannerUrl || ASSET_IMAGES.studioBanner,
        bannerPublicId: bannerPublicId || '',
        accentColor: accentColor || '#7c3aed',
        updatedAt: serverTimestamp(),
      });

      if (visibilityChanged) {
        for (const m of members) {
          batch.update(doc(db, 'serverMembers', `${server.id}_${m.userId}`), {
            isPublicServer: isPublic,
            serverOwnerId: server.ownerId,
            memberUids: memberUidList,
            updatedAt: serverTimestamp(),
          });
        }
        for (const cat of categories) {
          batch.update(doc(db, 'channelCategories', cat.id), {
            isPublicServer: isPublic,
            memberUids: memberUidList,
          });
        }
        for (const r of roles) {
          batch.update(doc(db, 'serverRoles', r.id), {
            isPublicServer: isPublic,
            memberUids: memberUidList,
            updatedAt: serverTimestamp(),
          });
        }
        for (const ch of channels) {
          if (ch.type !== 'private') {
            batch.update(doc(db, 'channels', ch.id), {
              isPublic,
              isPrivate: !isPublic,
              isAfterDark,
              memberUids: memberUidList,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.update(doc(db, 'channels', ch.id), {
              isAfterDark,
              updatedAt: serverTimestamp(),
            });
          }
        }
      } else if (Boolean(server.isAfterDark) !== Boolean(isAfterDark)) {
        for (const ch of channels) {
          batch.update(doc(db, 'channels', ch.id), {
            isAfterDark,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();

      if (server.iconPublicId && server.iconPublicId !== iconPublicId) {
        void deleteCloudinaryAsset(server.iconPublicId).catch(() => {});
      }
      if (server.bannerPublicId && server.bannerPublicId !== bannerPublicId) {
        void deleteCloudinaryAsset(server.bannerPublicId).catch(() => {});
      }

      broadcastServerUpdate(server.id);
      setDirtyOverview(false);
      setNotice('Server settings saved and synced across the workspace.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update server');
    } finally {
      setBusy(false);
    }
  };

  // Channel handlers
  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server || !newChannelName.trim()) return;
    setError(null);
    setNotice(null);
    const chId = generateId('ch');
    const cleanName = newChannelName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .slice(0, 64);
    try {
      const memberUidList = Array.from(
        new Set([firebaseUser?.uid || server.ownerId, ...members.map((m) => m.userId)])
      ).slice(0, 50);
      await setDoc(doc(db, 'channels', chId), {
        id: chId,
        serverId: server.id,
        categoryId: newChannelCategoryId || categories[0]?.id || '',
        name: cleanName,
        type: newChannelType,
        topic: truncateText(newChannelTopic, 300),
        description: truncateText(newChannelDescription, 500),
        isPrivate: newChannelType === 'private' || !server.isPublic,
        isPublic: newChannelType !== 'private' && server.isPublic,
        isAfterDark: server.isAfterDark,
        position: sortedChannels.length,
        ownerId: firebaseUser?.uid || server.ownerId,
        memberUids: memberUidList,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewChannelName('');
      setNewChannelTopic('');
      setNewChannelDescription('');
      setNotice(`Channel #${cleanName} created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Channel creation failed');
    }
  };

  const handleSaveChannelEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server || !editingChannelId) return;
    const cleanName = editChName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .slice(0, 64);
    if (!cleanName) {
      setError('Channel name cannot be empty.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const effectivePrivate = editChType === 'private' || editChPrivate || !server.isPublic;
      await updateDoc(doc(db, 'channels', editingChannelId), {
        name: cleanName,
        topic: truncateText(editChTopic, 300),
        description: truncateText(editChDescription, 500),
        categoryId: editChCategoryId || '',
        type: editChType,
        isPrivate: effectivePrivate,
        isPublic: !effectivePrivate && server.isPublic,
        allowedRoles: editChAllowedRoles.slice(0, 25),
        updatedAt: serverTimestamp(),
      });
      setEditingChannelId(null);
      setNotice(`Channel #${cleanName} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Channel update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveChannel = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= sortedChannels.length) return;
    setError(null);
    try {
      const reordered = [...sortedChannels];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(targetIdx, 0, moved);

      const batch = writeBatch(db);
      reordered.forEach((ch, idx) => {
        batch.update(doc(db, 'channels', ch.id), {
          position: idx,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setNotice(`Moved #${moved.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder channels');
    }
  };

  const handleAddCategory = async () => {
    if (!server || !newCategoryName.trim()) return;
    setError(null);
    try {
      const catId = generateId('cat');
      const memberUidList = Array.from(
        new Set([server.ownerId, ...members.map((m) => m.userId)])
      ).slice(0, 50);
      await setDoc(doc(db, 'channelCategories', catId), {
        id: catId,
        serverId: server.id,
        name: truncateText(newCategoryName, 60),
        position: sortedCategories.length,
        isPublicServer: server.isPublic,
        ownerId: firebaseUser?.uid || server.ownerId,
        memberUids: memberUidList,
        createdAt: serverTimestamp(),
      });
      setNewCategoryName('');
      setNotice('Category added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
    }
  };

  const handleSaveCategoryRename = async (catId: string) => {
    const clean = truncateText(editCatName, 60);
    if (!clean) return;
    setError(null);
    try {
      await updateDoc(doc(db, 'channelCategories', catId), { name: clean });
      setEditingCatId(null);
      setNotice('Category renamed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename category');
    }
  };

  const handleMoveCategory = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= sortedCategories.length) return;
    setError(null);
    try {
      const reordered = [...sortedCategories];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(targetIdx, 0, moved);
      const batch = writeBatch(db);
      reordered.forEach((c, idx) => {
        batch.update(doc(db, 'channelCategories', c.id), { position: idx });
      });
      await batch.commit();
      setNotice('Categories reordered.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder categories');
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    setError(null);
    try {
      const batch = writeBatch(db);
      for (const ch of channels) {
        if (ch.categoryId === catId) {
          batch.update(doc(db, 'channels', ch.id), {
            categoryId: '',
            updatedAt: serverTimestamp(),
          });
        }
      }
      batch.delete(doc(db, 'channelCategories', catId));
      await batch.commit();
      setNotice('Category deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
    }
  };

  // Custom Roles handlers
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server || !canManageRoles) return;
    const cleanName = truncateText(newRoleName, 40);
    if (!cleanName) {
      setError('Role name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const roleId = generateId('role');
      const memberUidList = Array.from(
        new Set([server.ownerId, ...members.map((m) => m.userId)])
      ).slice(0, 50);
      await setDoc(doc(db, 'serverRoles', roleId), {
        id: roleId,
        serverId: server.id,
        name: cleanName,
        color: newRoleColor || '#7c3aed',
        position: sortedRoles.length,
        permissions: newRolePerms,
        isPublicServer: server.isPublic,
        ownerId: server.ownerId,
        memberUids: memberUidList,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewRoleName('');
      setNewRolePerms({ ...DEFAULT_MEMBER_PERMISSIONS });
      setNotice(`Role "${cleanName}" created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRoleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server || !editingRoleId || !canManageRoles) return;
    const cleanName = truncateText(editRoleName, 40);
    if (!cleanName) {
      setError('Role name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updatedRoleList = sortedRoles.map((r) =>
        r.id === editingRoleId
          ? { ...r, name: cleanName, color: editRoleColor, permissions: editRolePerms }
          : r
      );

      const batch = writeBatch(db);
      batch.update(doc(db, 'serverRoles', editingRoleId), {
        name: cleanName,
        color: editRoleColor,
        permissions: editRolePerms,
        updatedAt: serverTimestamp(),
      });

      for (const m of members) {
        if (m.roleIds?.includes(editingRoleId) && m.role !== 'owner' && m.userId !== firebaseUser?.uid) {
          const nextPerms = computeEffectivePermissions(m.role, m.roleIds, updatedRoleList);
          batch.update(doc(db, 'serverMembers', `${server.id}_${m.userId}`), {
            permissions: nextPerms,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      setEditingRoleId(null);
      setNotice(`Role "${cleanName}" saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    if (!server || !canManageRoles) return;
    setBusy(true);
    setError(null);
    try {
      const remainingRoles = sortedRoles.filter((r) => r.id !== roleId);
      const batch = writeBatch(db);
      batch.delete(doc(db, 'serverRoles', roleId));

      for (const m of members) {
        if (m.roleIds?.includes(roleId) && m.role !== 'owner' && m.userId !== firebaseUser?.uid) {
          const nextRoleIds = m.roleIds.filter((id) => id !== roleId);
          const nextPerms = computeEffectivePermissions(m.role, nextRoleIds, remainingRoles);
          batch.update(doc(db, 'serverMembers', `${server.id}_${m.userId}`), {
            roleIds: nextRoleIds,
            permissions: nextPerms,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      if (editingRoleId === roleId) setEditingRoleId(null);
      setNotice('Role deleted and member permissions updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveRole = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= sortedRoles.length) return;
    setError(null);
    try {
      const reordered = [...sortedRoles];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(targetIdx, 0, moved);
      const batch = writeBatch(db);
      reordered.forEach((r, idx) => {
        batch.update(doc(db, 'serverRoles', r.id), {
          position: idx,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setNotice('Role hierarchy updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder roles');
    }
  };

  const handleToggleMemberCustomRole = async (member: ServerMember, roleId: string) => {
    if (!server || !canManageRoles || member.role === 'owner') return;
    if (member.userId === firebaseUser?.uid && !isOwner) {
      setError('Non-owners cannot modify their own role assignments.');
      return;
    }
    setError(null);
    try {
      const existing = member.roleIds || [];
      const nextRoleIds = existing.includes(roleId)
        ? existing.filter((id) => id !== roleId)
        : [...existing, roleId].slice(0, 20);
      const nextPerms = computeEffectivePermissions(member.role, nextRoleIds, sortedRoles);
      await updateDoc(doc(db, 'serverMembers', `${server.id}_${member.userId}`), {
        roleIds: nextRoleIds,
        permissions: nextPerms,
        updatedAt: serverTimestamp(),
      });
      setNotice('Member custom roles updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign custom role');
    }
  };

  const handleGenerateInvite = async () => {
    if (!server || !firebaseUser) return;
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    setError(null);
    try {
      const staffUids = Array.from(
        new Set(
          [
            server.ownerId,
            firebaseUser.uid,
            ...members
              .filter((m) => m.role === 'owner' || m.role === 'admin' || m.role === 'moderator')
              .map((m) => m.userId),
          ].filter(Boolean)
        )
      ).slice(0, 20);

      await setDoc(doc(db, 'serverInvitations', code), {
        code,
        serverId: server.id,
        creatorId: firebaseUser.uid,
        serverOwnerId: server.ownerId,
        staffUids,
        maxUses: 50,
        uses: 0,
        revoked: false,
        createdAt: serverTimestamp(),
      });
      setInvites((prev) => [
        {
          code,
          serverId: server.id,
          creatorId: firebaseUser.uid,
          maxUses: 50,
          uses: 0,
          revoked: false,
        },
        ...prev,
      ]);
      setPreviewCode(code);
      setNotice(`Created invite code: ${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    }
  };

  const handleLoadInvitePreview = async (codeToCheck: string) => {
    const clean = codeToCheck.trim().toUpperCase();
    if (!clean) return;
    setError(null);
    try {
      const data = await apiRequest<InvitePreviewData>(`/api/invites/${encodeURIComponent(clean)}`);
      setInvitePreview(data);
    } catch (err) {
      setInvitePreview(null);
      setError(err instanceof Error ? err.message : 'Could not fetch invite preview');
    }
  };

  const handleModAction = async (
    targetUid: string,
    action: 'mute' | 'unmute' | 'kick' | 'ban' | 'unban'
  ) => {
    if (!server) return;
    setError(null);
    try {
      await apiRequest('/api/moderation/action', {
        method: 'POST',
        body: JSON.stringify({
          serverId: server.id,
          targetUserId: targetUid,
          action,
          reason: `Server ${action} by ${myRole}`,
        }),
      });
      setNotice(`Applied ${action} to member.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Moderation failed');
    }
  };

  const handleRoleChange = async (member: ServerMember, nextRole: ServerRole) => {
    if (!server || !firebaseUser) return;
    setError(null);
    try {
      if (nextRole === 'owner') {
        if (!isOwner) {
          setError('Only the server owner can transfer ownership.');
          return;
        }
        const batch = writeBatch(db);
        const ownerPerms = computeEffectivePermissions('owner', member.roleIds || [], sortedRoles);
        const prevOwnerMember = members.find((m) => m.userId === firebaseUser.uid);
        const adminPerms = computeEffectivePermissions(
          'admin',
          prevOwnerMember?.roleIds || [],
          sortedRoles
        );

        batch.update(doc(db, 'servers', server.id), {
          ownerId: member.userId,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'serverMembers', `${server.id}_${member.userId}`), {
          role: 'owner',
          permissions: ownerPerms,
          serverOwnerId: member.userId,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'serverMembers', `${server.id}_${firebaseUser.uid}`), {
          role: 'admin',
          permissions: adminPerms,
          serverOwnerId: member.userId,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        broadcastServerUpdate(server.id);
        setNotice('Server ownership transferred.');
        return;
      }

      const nextPerms = computeEffectivePermissions(nextRole, member.roleIds || [], sortedRoles);
      await updateDoc(doc(db, 'serverMembers', `${server.id}_${member.userId}`), {
        role: nextRole,
        permissions: nextPerms,
        updatedAt: serverTimestamp(),
      });
      setNotice('Member role updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role update failed');
    }
  };

  /* ------------------------------------------------------------------------ */
  /* MODE 1: CREATE SERVER MULTI-STEP WIZARD (Screenshots 153, 154, 155)      */
  /* ------------------------------------------------------------------------ */
  if (mode === 'create') {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[440px] rounded-xl bg-[#222328] border border-white/[0.08] shadow-2xl overflow-hidden text-zinc-100 max-h-[92vh] flex flex-col"
        >
          {/* Step 1: Create Your Server */}
          {createStep === 'template' && (
            <>
              <div className="px-5 pt-5 pb-3 text-center relative">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
                <h2 className="font-display font-bold text-xl text-white">Create Your Server</h2>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  Your server is where you and your friends hang out. Make yours and start talking.
                </p>
              </div>

              <div className="px-4 pb-4 space-y-3 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setCategory('General');
                    setCreateStep('audience');
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#2b2d34] hover:bg-[#353740] border border-white/[0.07] text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                      <Plus className="w-5 h-5" />
                    </span>
                    <span className="text-sm font-semibold text-white">Create My Own</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </button>

                <div className="pt-1 space-y-2">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Start from a template
                  </p>
                  <div className="space-y-1.5">
                    {SERVER_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setCategory(tpl.category);
                          setName(
                            profile?.displayName
                              ? `${profile.displayName}'s ${tpl.label}`
                              : `${tpl.label} Lounge`
                          );
                          setCreateStep('audience');
                        }}
                        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-[#1b1c21] hover:bg-[#2b2d34] border border-white/[0.06] text-left transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-100">{tpl.label}</p>
                          <p className="text-[11px] text-zinc-500 truncate">{tpl.hint}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 bg-[#1b1c21] border-t border-white/[0.06] text-center space-y-2.5">
                <p className="text-sm font-semibold text-zinc-100">Have an invite already?</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setCreateStep('join');
                  }}
                  className="w-full h-10 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-100 text-xs font-semibold transition-colors"
                >
                  Join a Server
                </button>
              </div>
            </>
          )}

          {/* Step 2: Tell Us More About Your Server */}
          {createStep === 'audience' && (
            <>
              <div className="px-5 pt-5 pb-3 text-center relative">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
                <h2 className="font-display font-bold text-xl text-white">
                  Tell Us More About Your Server
                </h2>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  In order to help you with your setup, is your new server for just a few friends or a larger community?
                </p>
              </div>

              <div className="px-5 py-4 space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsPublic(true);
                    setCreateStep('customize');
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-lg bg-[#2b2d34] hover:bg-[#353740] border border-white/[0.07] text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">For a club or community</p>
                      <p className="text-[11px] text-zinc-400">Discoverable in ShadowSpace Explore</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsPublic(false);
                    setCreateStep('customize');
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-lg bg-[#2b2d34] hover:bg-[#353740] border border-white/[0.07] text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center">
                      <Lock className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">For me and my friends</p>
                      <p className="text-[11px] text-zinc-400">Private server · Join by invite only</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </button>

                <p className="text-center text-xs text-zinc-400 pt-2">
                  Not sure? You can{' '}
                  <button
                    type="button"
                    onClick={() => setCreateStep('customize')}
                    className="text-violet-400 hover:underline font-medium"
                  >
                    skip this question
                  </button>{' '}
                  for now.
                </p>
              </div>

              <div className="px-5 py-3.5 bg-[#1b1c21] border-t border-white/[0.06] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCreateStep('template')}
                  className="text-xs font-medium text-zinc-300 hover:text-white"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {/* Step 3: Customize Your Server */}
          {createStep === 'customize' && (
            <form onSubmit={handleCreateServer} className="flex flex-col max-h-[92vh]">
              <div className="px-5 pt-5 pb-3 text-center relative shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
                <h2 className="font-display font-bold text-xl text-white">
                  Customize Your Server
                </h2>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  Give your new server a personality with a name and an icon. You can always change it later.
                </p>
              </div>

              <div className="px-5 pb-5 space-y-4 overflow-y-auto">
                {error && (
                  <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between gap-2">
                    <span>{error}</span>
                    {failedUpload && !uploadProgress && (
                      <button
                        type="button"
                        onClick={() => void startServerMediaUpload(failedUpload.file, failedUpload.target)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 text-rose-200 shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" /> Retry
                      </button>
                    )}
                  </div>
                )}

                {/* Circular Icon Upload */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <label className="relative w-20 h-20 rounded-full border-2 border-dashed border-zinc-600 hover:border-violet-400 bg-[#17181c] flex flex-col items-center justify-center cursor-pointer overflow-hidden group transition-colors">
                    {iconUrl && iconUrl !== ASSET_IMAGES.brandEmblem ? (
                      <img
                        src={iconUrl}
                        alt="Server icon"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <>
                        <Camera className="w-5 h-5 text-zinc-300" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 mt-1">
                          {uploadProgress?.target === 'server_icon'
                            ? `${uploadProgress.percent}%`
                            : 'Upload'}
                        </span>
                      </>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center shadow">
                      <Plus className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="file"
                      disabled={uploadProgress !== null}
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => handleFileInput(e, 'server_icon')}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setMediaTarget('server_icon')}
                    className="text-[11px] text-violet-400 hover:underline"
                  >
                    Or choose from Media Studio
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Server Name
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Midnight Architects"
                    className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-zinc-200"
                    >
                      <option value="General">General</option>
                      <option value="Gaming">Gaming</option>
                      <option value="Creative">Creative</option>
                      <option value="Tech">Tech</option>
                      <option value="Music">Music</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                      Visibility
                    </label>
                    <select
                      value={isPublic ? 'public' : 'private'}
                      onChange={(e) => setIsPublic(e.target.value === 'public')}
                      className="w-full h-9 px-2.5 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-zinc-200"
                    >
                      <option value="public">Public Community</option>
                      <option value="private">Private (Invite Only)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    maxLength={500}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is your server about?"
                    className="w-full h-16 p-2.5 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-zinc-200 resize-none focus:outline-none focus:border-violet-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAfterDark}
                    onChange={(e) => setIsAfterDark(e.target.checked)}
                    className="rounded border-zinc-700 bg-[#111214] text-rose-500"
                  />
                  <span>18+ After Dark Community (Charcoal &amp; Crimson lounge)</span>
                </label>
              </div>

              <div className="px-5 py-3.5 bg-[#1b1c21] border-t border-white/[0.06] flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => setCreateStep('audience')}
                  className="text-xs font-medium text-zinc-300 hover:text-white"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy || uploadProgress !== null}
                  className="px-6 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          )}

          {/* Join a Server via Invite Code */}
          {createStep === 'join' && (
            <form onSubmit={handleJoinViaCode}>
              <div className="px-5 pt-5 pb-3 text-center relative">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
                >
                  <X className="w-4 h-4" />
                </button>
                <h2 className="font-display font-bold text-xl text-white">Join a Server</h2>
                <p className="text-xs text-zinc-400 mt-1.5">
                  Enter an invite code below to join an existing ShadowSpace server.
                </p>
              </div>

              <div className="px-5 py-4 space-y-3">
                {error && (
                  <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Invite Code
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="e.g. A1B2C3D4"
                    className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-sm font-mono text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                {joinPreview && (
                  <div className="p-3 rounded-lg bg-[#1b1c21] border border-white/[0.08] flex items-center gap-3">
                    <img
                      src={joinPreview.serverIconUrl || ASSET_IMAGES.brandEmblem}
                      alt={joinPreview.serverName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {joinPreview.serverName}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {joinPreview.memberCount ?? 1} members ·{' '}
                        {joinPreview.isPublic ? 'Public' : 'Private'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-[#1b1c21] border-t border-white/[0.06] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setCreateStep('template');
                  }}
                  className="text-xs font-medium text-zinc-300 hover:text-white"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={joinBusy || !joinCode.trim()}
                  className="px-5 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {joinBusy ? 'Joining…' : 'Join Server'}
                </button>
              </div>
            </form>
          )}
        </div>

        {mediaTarget && (
          <MediaModal
            scopeId={firebaseUser?.uid || 'server_create'}
            purpose={mediaTarget}
            onSelectMedia={(url) => {
              if (mediaTarget === 'server_icon') {
                setIconUrl(url);
                setIconPublicId('');
              } else {
                setBannerUrl(url);
                setBannerPublicId('');
              }
              setMediaTarget(null);
            }}
            onClose={() => setMediaTarget(null)}
          />
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* MODE 2: FULL-SCREEN DISCORD-STYLE SERVER & CHANNEL SETTINGS (160 & 166)  */
  /* ------------------------------------------------------------------------ */

  const editingChannel = editingChannelId
    ? channels.find((c) => c.id === editingChannelId) || null
    : null;

  const createdDateStr =
    server?.createdAt && typeof server.createdAt.toDate === 'function'
      ? server.createdAt.toDate().toLocaleDateString([], { month: 'short', year: 'numeric' })
      : 'Active';

  return (
    <div className="fixed inset-0 z-50 bg-[#1b1c21] text-zinc-100 flex flex-col md:flex-row">
      {/* Left Navigation Column */}
      <aside className="md:w-[232px] lg:w-[250px] bg-[#17181c] border-b md:border-b-0 md:border-r border-white/[0.06] flex md:flex-col shrink-0 overflow-x-auto md:overflow-y-auto">
        <div className="hidden md:flex items-center gap-2.5 px-4 pt-6 pb-3">
          <img
            src={server?.iconUrl || ASSET_IMAGES.brandEmblem}
            alt={server?.name || 'Server'}
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-lg object-cover shrink-0 border border-white/10"
          />
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 truncate">
            {server?.name}
          </span>
        </div>

        <div className="flex md:flex-col gap-0.5 px-3 py-2.5 md:py-1 flex-1">
          {[
            { id: 'overview' as ManageTab, label: 'Server Profile' },
            { id: 'channels' as ManageTab, label: 'Channels' },
            { id: 'roles' as ManageTab, label: 'Roles' },
            { id: 'invites' as ManageTab, label: 'Invites' },
            { id: 'members' as ManageTab, label: 'Members' },
            { id: 'audit' as ManageTab, label: 'Audit Log' },
          ].map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  if (item.id !== 'channels') setEditingChannelId(null);
                  setError(null);
                  setNotice(null);
                }}
                className={`px-3 py-2 rounded-md text-[13px] font-medium text-left whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-white/[0.1] text-white'
                    : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}

          <div className="hidden md:block my-2 h-px bg-white/[0.07]" />

          {isOwner ? (
            <button
              type="button"
              onClick={async () => {
                if (!server) return;
                try {
                  await deleteDoc(doc(db, 'servers', server.id));
                  onLeftOrDeleted?.();
                  onClose();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to delete server');
                }
              }}
              className="hidden md:flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium text-rose-400 hover:bg-rose-500/10"
            >
              <span>Delete Server</span>
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (!server || !firebaseUser) return;
                try {
                  await deleteDoc(doc(db, 'serverMembers', `${server.id}_${firebaseUser.uid}`));
                  onLeftOrDeleted?.();
                  onClose();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to leave server');
                }
              }}
              className="hidden md:flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium text-rose-400 hover:bg-rose-500/10"
            >
              <span>Leave Server</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="md:hidden px-3 py-2 text-zinc-400 hover:text-white shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </aside>

      {/* Main Content Scrollable Area */}
      <div className="flex-1 overflow-y-auto relative">
        {/* Top-right ESC Close Button (Desktop) */}
        <div className="hidden md:flex flex-col items-center gap-1 fixed top-6 right-8 z-20">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings (ESC)"
            className="w-9 h-9 rounded-full border-2 border-zinc-500 hover:border-white text-zinc-300 hover:text-white flex items-center justify-center transition-colors bg-[#1b1c21]/80 backdrop-blur-xs"
          >
            <X className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            ESC
          </span>
        </div>

        <div className="max-w-[820px] px-5 sm:px-10 py-8 sm:py-10 space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between gap-2">
              <span>{error}</span>
              {failedUpload && !uploadProgress && (
                <button
                  type="button"
                  onClick={() => void startServerMediaUpload(failedUpload.file, failedUpload.target)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/20 text-rose-200 shrink-0"
                >
                  <RotateCcw className="w-3 h-3" /> Retry Upload
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
              {notice}
            </div>
          )}

          {/* TAB: SERVER PROFILE (Screenshot 160 with Live Preview Card) */}
          {tab === 'overview' && (
            <form onSubmit={handleUpdateServer} className="space-y-6">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Server Profile</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Customize how your server appears in invite links, community headers, and Discover.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
                {/* Form Controls */}
                <div className="lg:col-span-7 space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Name</label>
                    <input
                      type="text"
                      disabled={!canManageServer}
                      minLength={2}
                      maxLength={80}
                      value={name}
                      onChange={(e) => {
                        setDirtyOverview(true);
                        setName(e.target.value);
                      }}
                      className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-60"
                    />
                  </div>

                  <div className="h-px bg-white/[0.06]" />

                  {/* Icon */}
                  <div className="space-y-2.5">
                    <div>
                      <p className="text-xs font-semibold text-zinc-300">Icon</p>
                      <p className="text-[11px] text-zinc-400">
                        We recommend an image of at least 512×512 (PNG, JPG, WEBP, GIF).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManageServer && (
                        <>
                          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer">
                            {uploadProgress?.target === 'server_icon' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Upload className="w-3.5 h-3.5" />
                            )}
                            {uploadProgress?.target === 'server_icon'
                              ? `Uploading ${uploadProgress.percent}%`
                              : 'Change Server Icon'}
                            <input
                              type="file"
                              disabled={uploadProgress !== null}
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={(e) => handleFileInput(e, 'server_icon')}
                              className="hidden"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setMediaTarget('server_icon')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs font-medium"
                          >
                            <ImagePlus className="w-3.5 h-3.5" /> Media Gallery
                          </button>
                          {(iconPublicId || iconUrl !== ASSET_IMAGES.brandEmblem) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (iconPublicId && iconPublicId !== (server?.iconPublicId || '')) {
                                  void deleteCloudinaryAsset(iconPublicId).catch(() => {});
                                }
                                setDirtyOverview(true);
                                setIconUrl(ASSET_IMAGES.brandEmblem);
                                setIconPublicId('');
                              }}
                              className="px-3 py-2 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10"
                            >
                              Reset
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.06]" />

                  {/* Banner & Accent */}
                  <div className="space-y-2.5">
                    <div>
                      <p className="text-xs font-semibold text-zinc-300">Banner &amp; Accent</p>
                      <p className="text-[11px] text-zinc-400">
                        Upload a custom banner image/GIF or pick a signature theme color.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManageServer && (
                        <>
                          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-white text-xs font-semibold cursor-pointer">
                            {uploadProgress?.target === 'server_banner' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Upload className="w-3.5 h-3.5" />
                            )}
                            {uploadProgress?.target === 'server_banner'
                              ? `Uploading ${uploadProgress.percent}%`
                              : 'Upload Banner'}
                            <input
                              type="file"
                              disabled={uploadProgress !== null}
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={(e) => handleFileInput(e, 'server_banner')}
                              className="hidden"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setMediaTarget('server_banner')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs font-medium"
                          >
                            <ImagePlus className="w-3.5 h-3.5" /> Gallery
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      {SERVER_ACCENT_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          disabled={!canManageServer}
                          onClick={() => {
                            setDirtyOverview(true);
                            setAccentColor(hex);
                          }}
                          className={`w-7 h-7 rounded-md border-2 transition-transform disabled:opacity-50 ${
                            accentColor === hex ? 'border-white scale-105' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                      <input
                        type="color"
                        disabled={!canManageServer}
                        value={accentColor}
                        onChange={(e) => {
                          setDirtyOverview(true);
                          setAccentColor(e.target.value);
                        }}
                        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                      />
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.06]" />

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Description
                    </label>
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      How did your server get started? Why should people join?
                    </p>
                    <textarea
                      disabled={!canManageServer}
                      maxLength={500}
                      value={description}
                      onChange={(e) => {
                        setDirtyOverview(true);
                        setDescription(e.target.value);
                      }}
                      placeholder="Tell the world a bit about this server."
                      className="w-full h-24 p-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white resize-none focus:outline-none focus:border-violet-500 disabled:opacity-60"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Category
                      </label>
                      <select
                        disabled={!canManageServer || isAfterDark}
                        value={isAfterDark ? 'After Dark' : category}
                        onChange={(e) => {
                          setDirtyOverview(true);
                          setCategory(e.target.value);
                        }}
                        className="w-full h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white disabled:opacity-60"
                      >
                        <option value="General">General</option>
                        <option value="Gaming">Gaming</option>
                        <option value="Creative">Creative</option>
                        <option value="Tech">Tech</option>
                        <option value="Music">Music</option>
                        {isAfterDark && <option value="After Dark">After Dark</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Visibility
                      </label>
                      <select
                        disabled={!canManageServer}
                        value={isPublic ? 'public' : 'private'}
                        onChange={(e) => {
                          setDirtyOverview(true);
                          setIsPublic(e.target.value === 'public');
                        }}
                        className="w-full h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white disabled:opacity-60"
                      >
                        <option value="public">Public (Discoverable)</option>
                        <option value="private">Private (Invite Only)</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManageServer}
                      checked={isAfterDark}
                      onChange={(e) => {
                        setDirtyOverview(true);
                        setIsAfterDark(e.target.checked);
                      }}
                    />
                    <span>18+ After Dark Community</span>
                  </label>

                  {canManageServer && (
                    <div className="pt-2 flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={busy || uploadProgress !== null}
                        className="inline-flex items-center gap-1.5 px-5 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Save Changes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDirtyOverview(false);
                          setNotice(null);
                        }}
                        className="text-xs text-zinc-400 hover:text-white"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Server Card Preview (Right Column like Screenshot 160) */}
                <div className="lg:col-span-5 lg:sticky lg:top-8">
                  <div className="rounded-xl overflow-hidden bg-[#111214] border border-white/[0.08] shadow-xl">
                    <div className="h-24 relative">
                      <img
                        src={bannerUrl || ASSET_IMAGES.studioBanner}
                        alt="Server preview banner"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#111214] via-black/25 to-transparent" />
                      <div
                        className="absolute bottom-0 inset-x-0 h-0.5"
                        style={{ backgroundColor: accentColor }}
                      />
                    </div>
                    <div className="px-4 pb-4 -mt-7 relative">
                      <img
                        src={iconUrl || ASSET_IMAGES.brandEmblem}
                        alt="Server preview icon"
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded-2xl object-cover border-4 border-[#111214] bg-[#1b1c21]"
                      />
                      <h3 className="font-display font-bold text-base text-white mt-2 truncate">
                        {name || server?.name}
                      </h3>
                      <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-1">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          {server?.isPublic ? 'Public' : 'Private'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-zinc-500" />
                          {server?.memberCount || members.length || 1} Members
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1">Est. {createdDateStr}</p>
                      {description && (
                        <p className="text-xs text-zinc-300 mt-2.5 line-clamp-3 leading-relaxed">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* TAB: CHANNELS (Either Channel Settings View Screenshot 166 OR Channels Manager) */}
          {tab === 'channels' && editingChannel && canManageChannels && (
            <form onSubmit={handleSaveChannelEdit} className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <button
                    type="button"
                    onClick={() => setEditingChannelId(null)}
                    className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:underline mb-2"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> All Channels
                  </button>
                  <h2 className="font-display font-bold text-xl text-white flex items-center gap-2">
                    <Hash className="w-5 h-5 text-zinc-400" />
                    {editingChannel.name} — Channel Overview
                  </h2>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Channel Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editChName}
                    onChange={(e) => setEditChName(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-300">Channel Topic</label>
                    <span className="text-[11px] font-mono text-zinc-500">
                      {editChTopic.length}/300
                    </span>
                  </div>
                  <textarea
                    maxLength={300}
                    value={editChTopic}
                    onChange={(e) => setEditChTopic(e.target.value)}
                    placeholder="Let everyone know how to use this channel!"
                    className="w-full h-24 p-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white resize-none focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Channel Type
                    </label>
                    <select
                      value={editChType}
                      onChange={(e) => setEditChType(e.target.value as ChannelType)}
                      className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    >
                      <option value="text">Text</option>
                      <option value="announcement">Announcement</option>
                      <option value="voice">Voice</option>
                      <option value="private">Private</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Category
                    </label>
                    <select
                      value={editChCategoryId}
                      onChange={(e) => setEditChCategoryId(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    >
                      <option value="">Uncategorized</option>
                      {sortedCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Channel Description
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    value={editChDescription}
                    onChange={(e) => setEditChDescription(e.target.value)}
                    placeholder="Detailed channel purpose"
                    className="w-full h-10 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                  />
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">Private Channel</p>
                    <p className="text-xs text-zinc-400">
                      Restrict access to selected custom roles &amp; members.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editChPrivate || editChType === 'private'}
                    onClick={() => setEditChPrivate((v) => !v)}
                    className={`w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                      editChPrivate || editChType === 'private' ? 'bg-violet-600' : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                        editChPrivate || editChType === 'private' ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {sortedRoles.length > 0 && (
                  <div className="space-y-2">
                    <span className="block text-xs font-semibold text-zinc-300">
                      Allowed Custom Roles (optional filter)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {sortedRoles.map((r) => {
                        const selected = editChAllowedRoles.includes(r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() =>
                              setEditChAllowedRoles((prev) =>
                                selected ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                              )
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${
                              selected
                                ? 'border-violet-500 bg-violet-600/20 text-white'
                                : 'border-white/[0.08] bg-[#111214] text-zinc-400'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: r.color }}
                            />
                            {r.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await deleteDoc(doc(db, 'channels', editingChannel.id));
                      setEditingChannelId(null);
                      setNotice(`Deleted #${editingChannel.name}.`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to delete channel');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-600 text-rose-400 hover:text-white text-xs font-semibold transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Channel
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingChannelId(null)}
                    className="px-4 h-9 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-xs font-medium text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-5 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                  >
                    <Check className="w-3.5 h-3.5" /> Save Changes
                  </button>
                </div>
              </div>
            </form>
          )}

          {tab === 'channels' && (!editingChannel || !canManageChannels) && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display font-bold text-xl text-white">
                  Channels &amp; Categories
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Organize text, announcement, voice, and private channels across categories.
                </p>
              </div>

              {canManageChannels && (
                <div className="space-y-4 p-4 rounded-xl bg-[#17181c] border border-white/[0.06]">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Create Channel
                  </h3>
                  <form
                    onSubmit={handleAddChannel}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2"
                  >
                    <input
                      type="text"
                      required
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      placeholder="channel-name"
                      className="h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    />
                    <select
                      value={newChannelType}
                      onChange={(e) => setNewChannelType(e.target.value as ChannelType)}
                      className="h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    >
                      <option value="text">Text Channel</option>
                      <option value="announcement">Announcement</option>
                      <option value="voice">Voice Channel</option>
                      <option value="private">Private Channel</option>
                    </select>
                    <select
                      value={newChannelCategoryId}
                      onChange={(e) => setNewChannelCategoryId(e.target.value)}
                      className="h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    >
                      <option value="">Uncategorized</option>
                      {sortedCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Channel
                    </button>
                    <input
                      type="text"
                      value={newChannelTopic}
                      onChange={(e) => setNewChannelTopic(e.target.value)}
                      placeholder="Topic (optional)"
                      className="sm:col-span-2 h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    />
                    <input
                      type="text"
                      value={newChannelDescription}
                      onChange={(e) => setNewChannelDescription(e.target.value)}
                      placeholder="Channel description (optional)"
                      className="sm:col-span-2 h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    />
                  </form>

                  <div className="pt-3 border-t border-white/[0.06] space-y-2.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Categories
                    </h4>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="New category name…"
                        className="flex-1 h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={handleAddCategory}
                        className="px-3.5 h-9 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs font-medium"
                      >
                        Add Category
                      </button>
                    </div>

                    {sortedCategories.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {sortedCategories.map((cat, cIdx) => (
                          <div
                            key={cat.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#111214] border border-white/[0.06] text-xs"
                          >
                            {editingCatId === cat.id ? (
                              <div className="flex items-center gap-2 flex-1">
                                <input
                                  type="text"
                                  value={editCatName}
                                  onChange={(e) => setEditCatName(e.target.value)}
                                  className="flex-1 h-7 px-2 rounded bg-[#1b1c21] border border-violet-500 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSaveCategoryRename(cat.id)}
                                  className="px-2 py-1 rounded bg-violet-600 text-white text-[11px]"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCatId(null)}
                                  className="px-2 py-1 text-zinc-400 text-[11px]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="font-medium truncate">{cat.name}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={cIdx === 0}
                                    onClick={() => void handleMoveCategory(cIdx, -1)}
                                    className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                                  >
                                    <ArrowUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={cIdx === sortedCategories.length - 1}
                                    onClick={() => void handleMoveCategory(cIdx, 1)}
                                    className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                                  >
                                    <ArrowDown className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCatId(cat.id);
                                      setEditCatName(cat.name);
                                    }}
                                    className="p-1 text-zinc-400 hover:text-violet-400"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteCategory(cat.id)}
                                    className="p-1 text-zinc-400 hover:text-rose-400"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {sortedChannels.map((ch, idx) => {
                  const catName =
                    sortedCategories.find((c) => c.id === ch.categoryId)?.name || 'Uncategorized';
                  return (
                    <div
                      key={ch.id}
                      className="p-3 rounded-lg bg-[#17181c] border border-white/[0.06] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {ch.type === 'voice' ? (
                            <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : ch.isPrivate ? (
                            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
                          )}
                          <span className="text-sm font-medium text-white truncate">{ch.name}</span>
                          <span className="text-xs text-zinc-500 capitalize">
                            · {ch.type} · {catName}
                          </span>
                        </div>
                        {(ch.topic || ch.description) && (
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {ch.topic || ch.description}
                          </p>
                        )}
                      </div>
                      {canManageChannels && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setEditingChannelId(ch.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs"
                          >
                            <Edit3 className="w-3 h-3" /> Edit
                          </button>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => void handleMoveChannel(idx, -1)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === sortedChannels.length - 1}
                            onClick={() => void handleMoveChannel(idx, 1)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await deleteDoc(doc(db, 'channels', ch.id));
                                setNotice(`Deleted #${ch.name}.`);
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : 'Failed to delete channel'
                                );
                              }
                            }}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: ROLES */}
          {tab === 'roles' && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Roles &amp; Permissions</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Create custom colored roles with granular server permissions.
                </p>
              </div>

              {canManageRoles && (
                <form
                  onSubmit={handleCreateRole}
                  className="p-4 rounded-xl bg-[#17181c] border border-white/[0.06] space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-violet-400" />
                    <h3 className="text-xs font-semibold text-zinc-200">Create Custom Role</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      maxLength={40}
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      placeholder="Role name (e.g. Community Host)"
                      className="sm:col-span-2 h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={newRoleColor}
                        onChange={(e) => setNewRoleColor(e.target.value)}
                        className="w-9 h-9 rounded cursor-pointer bg-transparent"
                      />
                      <span className="text-xs font-mono text-zinc-400">{newRoleColor}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PERMISSION_LABELS.map((perm) => (
                      <label
                        key={perm.key}
                        className="flex items-start gap-2 p-2.5 rounded-lg border border-white/[0.06] bg-[#111214] text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newRolePerms[perm.key]}
                          onChange={(e) =>
                            setNewRolePerms((prev) => ({
                              ...prev,
                              [perm.key]: e.target.checked,
                            }))
                          }
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium text-zinc-200 block">{perm.label}</span>
                          <span className="text-[11px] text-zinc-500">{perm.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" /> Create Role
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2.5">
                {sortedRoles.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-6 text-center">
                    No custom roles created yet.
                  </p>
                ) : (
                  sortedRoles.map((r, rIdx) => {
                    const isEditingRole = editingRoleId === r.id;
                    const enabledPerms = PERMISSION_LABELS.filter((p) => r.permissions[p.key]).map(
                      (p) => p.label
                    );
                    return (
                      <div
                        key={r.id}
                        className="p-3.5 rounded-xl bg-[#17181c] border border-white/[0.06] space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: r.color }}
                              />
                              <span className="font-semibold text-sm truncate" style={{ color: r.color }}>
                                {r.name}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-500 mt-0.5">
                              {enabledPerms.length ? enabledPerms.join(' · ') : 'No permissions'}
                            </p>
                          </div>

                          {canManageRoles && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isEditingRole) {
                                    setEditingRoleId(null);
                                  } else {
                                    setEditingRoleId(r.id);
                                    setEditRoleName(r.name);
                                    setEditRoleColor(r.color);
                                    setEditRolePerms({ ...r.permissions });
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs"
                              >
                                <Edit3 className="w-3 h-3" /> Edit
                              </button>
                              <button
                                type="button"
                                disabled={rIdx === 0}
                                onClick={() => void handleMoveRole(rIdx, -1)}
                                className="p-1.5 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={rIdx === sortedRoles.length - 1}
                                onClick={() => void handleMoveRole(rIdx, 1)}
                                className="p-1.5 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteRole(r.id)}
                                className="p-1.5 rounded-md text-zinc-400 hover:text-rose-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {isEditingRole && canManageRoles && (
                          <form
                            onSubmit={handleSaveRoleEdit}
                            className="pt-3 border-t border-white/[0.06] space-y-3"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <input
                                type="text"
                                required
                                maxLength={40}
                                value={editRoleName}
                                onChange={(e) => setEditRoleName(e.target.value)}
                                className="sm:col-span-2 h-9 px-2.5 rounded-lg bg-[#111214] border border-white/[0.08] text-xs text-white"
                              />
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={editRoleColor}
                                  onChange={(e) => setEditRoleColor(e.target.value)}
                                  className="w-9 h-9 rounded cursor-pointer bg-transparent"
                                />
                                <span className="text-xs font-mono text-zinc-400">{editRoleColor}</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {PERMISSION_LABELS.map((perm) => (
                                <label
                                  key={perm.key}
                                  className="flex items-start gap-2 p-2.5 rounded-lg border border-white/[0.06] bg-[#111214] text-xs cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={editRolePerms[perm.key]}
                                    onChange={(e) =>
                                      setEditRolePerms((prev) => ({
                                        ...prev,
                                        [perm.key]: e.target.checked,
                                      }))
                                    }
                                    className="mt-0.5"
                                  />
                                  <span>
                                    <span className="font-medium text-zinc-200 block">{perm.label}</span>
                                    <span className="text-[11px] text-zinc-500">{perm.description}</span>
                                  </span>
                                </label>
                              ))}
                            </div>

                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingRoleId(null)}
                                className="px-3 py-1.5 rounded-md text-xs text-zinc-400"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={busy}
                                className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                              >
                                <Check className="w-3.5 h-3.5" /> Save Role
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB: INVITES */}
          {tab === 'invites' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display font-bold text-xl text-white">Invites</h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Generate invitation codes so people can join private or public servers.
                  </p>
                </div>
                {canCreateInvites && (
                  <button
                    type="button"
                    onClick={handleGenerateInvite}
                    className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> Generate Code
                  </button>
                )}
              </div>

              <div className="p-4 rounded-xl bg-[#17181c] border border-white/[0.06] space-y-2.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={previewCode}
                    onChange={(e) => setPreviewCode(e.target.value.toUpperCase())}
                    placeholder="Enter invite code to inspect live invite preview…"
                    className="flex-1 h-9 px-3 rounded-lg bg-[#111214] border border-white/[0.08] text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onClick={() => void handleLoadInvitePreview(previewCode)}
                    className="px-3.5 h-9 rounded-lg bg-[#2b2d34] hover:bg-[#353740] text-zinc-200 text-xs font-medium shrink-0"
                  >
                    Preview Invite
                  </button>
                </div>
                {invitePreview && (
                  <div
                    className="rounded-xl overflow-hidden border bg-[#111214] p-3 flex items-center gap-3"
                    style={{ borderColor: invitePreview.serverAccentColor || '#7c3aed' }}
                  >
                    <img
                      src={invitePreview.serverIconUrl || ASSET_IMAGES.brandEmblem}
                      alt={invitePreview.serverName}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-xl object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">
                        {invitePreview.serverName}
                      </p>
                      <p className="text-xs text-zinc-400 truncate">
                        {invitePreview.serverDescription || 'No description'} ·{' '}
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3 h-3" /> {invitePreview.memberCount ?? 1}
                        </span>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {invites.map((inv) => (
                  <div
                    key={inv.code}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-[#17181c] border border-white/[0.06]"
                  >
                    <div>
                      <p className="font-mono font-semibold text-sm text-white">{inv.code}</p>
                      <p className="text-xs text-zinc-500 tabular-nums">
                        Uses: {inv.uses}/{inv.maxUses} · {inv.revoked ? 'Revoked' : 'Active'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleLoadInvitePreview(inv.code)}
                        className="px-2.5 py-1.5 rounded-md bg-[#2b2d34] text-zinc-200 hover:bg-[#353740] text-xs"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(inv.code);
                          setNotice(`Copied invite code ${inv.code}`);
                        }}
                        className="p-2 rounded-md bg-[#2b2d34] text-zinc-200 hover:bg-[#353740]"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {!inv.revoked && canCreateInvites && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await updateDoc(doc(db, 'serverInvitations', inv.code), {
                                revoked: true,
                              });
                              setInvites((prev) =>
                                prev.map((i) =>
                                  i.code === inv.code ? { ...i, revoked: true } : i
                                )
                              );
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : 'Failed to revoke invite'
                              );
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-md bg-rose-500/15 text-rose-400 text-xs"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: MEMBERS */}
          {tab === 'members' && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Server Members</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Manage roles, custom role badges, and moderation states.
                </p>
              </div>
              <div className="space-y-2.5">
                {members.map((m) => {
                  const u = memberProfiles[m.userId];
                  const isSelf = m.userId === firebaseUser?.uid;
                  const assignedRoles = (m.roleIds || [])
                    .map((rid) => roleById[rid])
                    .filter(Boolean);
                  const canEditThisMemberRoles =
                    canManageRoles &&
                    m.role !== 'owner' &&
                    (!isSelf || isOwner);

                  return (
                    <div
                      key={m.userId}
                      className="p-3.5 rounded-xl bg-[#17181c] border border-white/[0.06] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {u?.displayName || m.userId.slice(0, 8)}{' '}
                            <span className="text-xs font-normal text-zinc-400 capitalize">
                              · {m.role}
                            </span>
                          </p>
                          <p className="text-xs text-zinc-500">
                            {m.banned ? 'Banned' : m.muted ? 'Muted' : 'Active'}
                          </p>
                        </div>

                        {!isSelf && (canManageRoles || canModerateMembers) && m.role !== 'owner' && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {canManageRoles && (
                              <select
                                value={m.role}
                                onChange={(e) =>
                                  void handleRoleChange(m, e.target.value as ServerRole)
                                }
                                className="h-8 px-2.5 rounded-md bg-[#111214] border border-white/[0.08] text-xs text-white"
                              >
                                <option value="member">Member</option>
                                <option value="moderator">Moderator</option>
                                <option value="admin">Admin</option>
                                {isOwner && <option value="owner">Transfer Owner</option>}
                              </select>
                            )}
                            {canModerateMembers && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleModAction(m.userId, m.muted ? 'unmute' : 'mute')
                                  }
                                  className="px-2.5 py-1.5 rounded-md bg-[#2b2d34] text-zinc-200 text-xs"
                                >
                                  {m.muted ? 'Unmute' : 'Mute'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleModAction(m.userId, 'kick')}
                                  title="Kick"
                                  className="p-1.5 rounded-md bg-amber-500/15 text-amber-400"
                                >
                                  <UserX className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleModAction(m.userId, m.banned ? 'unban' : 'ban')
                                  }
                                  title={m.banned ? 'Unban' : 'Ban'}
                                  className="p-1.5 rounded-md bg-rose-500/15 text-rose-400"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {(assignedRoles.length > 0 || (canEditThisMemberRoles && sortedRoles.length > 0)) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.06]">
                          {sortedRoles.map((r) => {
                            const hasRole = (m.roleIds || []).includes(r.id);
                            if (!canEditThisMemberRoles && !hasRole) return null;
                            return (
                              <button
                                key={r.id}
                                type="button"
                                disabled={!canEditThisMemberRoles}
                                onClick={() => void handleToggleMemberCustomRole(m, r.id)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-colors ${
                                  hasRole
                                    ? 'bg-white/[0.06] text-white'
                                    : 'border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                                }`}
                                style={hasRole ? { borderColor: r.color } : undefined}
                              >
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: r.color }}
                                />
                                {r.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: AUDIT LOGS */}
          {tab === 'audit' && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display font-bold text-xl text-white">Audit Log</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Moderation &amp; administrative actions taken inside this server.
                </p>
              </div>
              {auditLogs.length === 0 ? (
                <div className="text-center py-12 rounded-xl bg-[#17181c] border border-white/[0.06] text-xs text-zinc-500">
                  <Shield className="w-6 h-6 mx-auto mb-2 text-zinc-500" />
                  No moderation or audit events recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-xl bg-[#17181c] border border-white/[0.06] text-xs space-y-1"
                    >
                      <p className="font-mono font-semibold text-violet-400">{log.event}</p>
                      <p className="text-zinc-300">{log.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {mediaTarget && (
        <MediaModal
          scopeId={server?.id || firebaseUser?.uid || 'server_media'}
          purpose={mediaTarget}
          onSelectMedia={(url) => {
            setDirtyOverview(true);
            if (mediaTarget === 'server_icon') {
              if (iconPublicId && iconPublicId !== (server?.iconPublicId || '')) {
                void deleteCloudinaryAsset(iconPublicId).catch(() => {});
              }
              setIconUrl(url);
              setIconPublicId('');
            } else {
              if (bannerPublicId && bannerPublicId !== (server?.bannerPublicId || '')) {
                void deleteCloudinaryAsset(bannerPublicId).catch(() => {});
              }
              setBannerUrl(url);
              setBannerPublicId('');
            }
            setMediaTarget(null);
          }}
          onClose={() => setMediaTarget(null)}
        />
      )}
    </div>
  );
}
