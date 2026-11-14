import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  CornerUpLeft,
  Edit3,
  Film,
  Flag,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  Megaphone,
  Menu,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Smile,
  Sparkles,
  Sticker,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiRequest } from '../services/apiClient';
import type {
  Channel,
  Conversation,
  MediaItem,
  Message,
  MessageReaction,
  PinnedMessage,
  ServerMember,
  ServerPermissions,
  ServerRole,
  ServerRoleDefinition,
  UserPublic,
} from '../types/shadowspace';
import {
  formatDateSeparator,
  formatTimeShort,
  generateId,
  getInitials,
  truncateText,
} from '../utils/validators';
import { MediaModal } from './MediaModal';

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '💜'];

const EMOJI_GROUPS: Array<{ label: string; items: Array<{ char: string; name: string }> }> = [
  {
    label: 'Frequently Used',
    items: [
      { char: '😂', name: 'joy laugh' },
      { char: '❤️', name: 'heart love' },
      { char: '🔥', name: 'fire lit' },
      { char: '👍', name: 'thumbs up' },
      { char: '😭', name: 'cry sob' },
      { char: '💜', name: 'purple heart shadowspace' },
      { char: '✨', name: 'sparkles magic' },
      { char: '👀', name: 'eyes look' },
    ],
  },
  {
    label: 'People & Faces',
    items: [
      { char: '😀', name: 'grin happy' },
      { char: '😄', name: 'smile' },
      { char: '😉', name: 'wink' },
      { char: '😍', name: 'heart eyes' },
      { char: '🥰', name: 'smiling hearts' },
      { char: '😎', name: 'cool sunglasses' },
      { char: '🤔', name: 'thinking' },
      { char: '😴', name: 'sleepy' },
      { char: '🤯', name: 'mind blown' },
      { char: '🥳', name: 'party celebrate' },
      { char: '🥺', name: 'pleading' },
      { char: '😈', name: 'smiling devil mischievous' },
      { char: '💀', name: 'skull dead' },
      { char: '🤡', name: 'clown' },
      { char: '🫶', name: 'heart hands' },
      { char: '🙌', name: 'raised hands' },
    ],
  },
  {
    label: 'Vibes & Symbols',
    items: [
      { char: '🎉', name: 'party popper' },
      { char: '🚀', name: 'rocket launch' },
      { char: '⚡', name: 'lightning bolt' },
      { char: '🌙', name: 'crescent moon night' },
      { char: '🌹', name: 'rose flower' },
      { char: '🎮', name: 'gaming controller' },
      { char: '🎧', name: 'headphones music' },
      { char: '💎', name: 'diamond gem' },
      { char: '✅', name: 'check verified' },
      { char: '💯', name: 'hundred' },
      { char: '☕', name: 'coffee' },
      { char: '🥂', name: 'cheers toast' },
    ],
  },
];

function getMessageTimeMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'string') return Date.parse(val) || 0;
  if (
    typeof val === 'object' &&
    val !== null &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

interface ChatAreaProps {
  mode: 'channel' | 'dm';
  channel?: Channel | null;
  conversation?: Conversation | null;
  serverName?: string;
  myRole?: ServerRole | null;
  myPermissions?: ServerPermissions | null;
  isMuted?: boolean;
  memberProfiles: Record<string, UserPublic>;
  serverMembers?: ServerMember[];
  serverRoles?: ServerRoleDefinition[];
  isAfterDarkTheme?: boolean;
  showRightPanel?: boolean;
  onOpenMobileMenu: () => void;
  onToggleRightPanel: () => void;
  onViewProfile: (userId: string) => void;
  onEditChannel?: () => void;
}

export function ChatArea({
  mode,
  channel,
  conversation,
  serverName,
  myRole,
  myPermissions,
  isMuted = false,
  memberProfiles,
  serverMembers = [],
  serverRoles = [],
  isAfterDarkTheme,
  showRightPanel,
  onOpenMobileMenu,
  onToggleRightPanel,
  onViewProfile,
  onEditChannel,
}: ChatAreaProps) {
  const { firebaseUser, profile, privateAccount } = useAuth();
  const { settings } = useTheme();
  const {
    joinRoom,
    leaveRoom,
    sendTyping,
    broadcastRoomMessage,
    broadcastRoomMessageUpdate,
    typingByRoom,
    subscribeRoomMessages,
    subscribeRoomMessageUpdates,
  } = useRealtime();

  const scopeId = mode === 'channel' ? channel?.id || '' : conversation?.id || '';
  const isPublicScope = mode === 'channel' ? Boolean(channel?.isPublic) : false;
  const allowFlirty = Boolean(privateAccount?.afterDarkConsent);

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [pins, setPins] = useState<PinnedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<
    Record<string, 'sending' | 'sent' | 'failed'>
  >({});
  const [failedPayloads, setFailedPayloads] = useState<
    Record<string, { clean: string; attachments: string[]; replyTo: Message | null }>
  >({});

  // Popovers & panels
  const [composerTab, setComposerTab] = useState<'gif' | 'sticker' | 'emoji' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [mediaPublicItems, setMediaPublicItems] = useState<MediaItem[]>([]);
  const [mediaMineItems, setMediaMineItems] = useState<MediaItem[]>([]);

  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const liveWindowIdsRef = useRef<Set<string>>(new Set());

  // Role lookup for colored usernames in server channels
  const roleColorByUid = useMemo(() => {
    const map: Record<string, { color: string; name: string }> = {};
    if (mode !== 'channel' || serverRoles.length === 0) return map;
    for (const mem of serverMembers) {
      if (mem.roleIds?.length) {
        const top = serverRoles.find((r) => mem.roleIds?.includes(r.id));
        if (top) {
          map[mem.userId] = { color: top.color, name: top.name };
        }
      }
    }
    return map;
  }, [mode, serverMembers, serverRoles]);

  // Close popovers on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxUrl) setLightboxUrl(null);
        else if (composerTab) setComposerTab(null);
        else if (plusMenuOpen) setPlusMenuOpen(false);
        else if (showPins) setShowPins(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerTab, lightboxUrl, plusMenuOpen, showPins]);

  // Load media library items lazily when GIF/Sticker popover is opened
  useEffect(() => {
    if (!firebaseUser || (composerTab !== 'gif' && composerTab !== 'sticker')) return;

    const unsubPub = onSnapshot(
      query(
        collection(db, 'mediaLibrary'),
        where('visibility', '==', 'public'),
        orderBy('createdAt', 'desc'),
        limit(45)
      ),
      (snap) => setMediaPublicItems(snap.docs.map((d) => d.data() as MediaItem)),
      () => {}
    );
    const unsubMine = onSnapshot(
      query(
        collection(db, 'mediaLibrary'),
        where('uploaderId', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
        limit(45)
      ),
      (snap) => setMediaMineItems(snap.docs.map((d) => d.data() as MediaItem)),
      () => {}
    );
    return () => {
      unsubPub();
      unsubMine();
    };
  }, [composerTab, firebaseUser]);

  // Real-time room messages, reactions, pins
  useEffect(() => {
    if (!scopeId || !firebaseUser) return;
    setMessages([]);
    liveWindowIdsRef.current = new Set();
    setLoading(true);
    setHasMore(true);
    setReplyTo(null);
    setEditingId(null);
    setComposerTab(null);
    setPlusMenuOpen(false);

    joinRoom(scopeId);

    const unsubWs = subscribeRoomMessages(scopeId, (incomingMsg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === incomingMsg.id)) return prev;
        return [...prev, incomingMsg];
      });
    });

    const unsubWsUpdates = subscribeRoomMessageUpdates(scopeId, (updatedMsg) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m))
      );
    });

    const msgQuery =
      mode === 'dm'
        ? query(
            collection(db, 'messages'),
            where('scopeType', '==', 'dm'),
            where('scopeId', '==', scopeId),
            where('participantIds', 'array-contains', firebaseUser.uid),
            orderBy('createdAt', 'desc'),
            limit(40)
          )
        : isPublicScope
          ? query(
              collection(db, 'messages'),
              where('scopeType', '==', 'channel'),
              where('scopeId', '==', scopeId),
              where('isPublicChannel', '==', true),
              orderBy('createdAt', 'desc'),
              limit(40)
            )
          : query(
              collection(db, 'messages'),
              where('scopeType', '==', 'channel'),
              where('scopeId', '==', scopeId),
              where('allowedUids', 'array-contains', firebaseUser.uid),
              orderBy('createdAt', 'desc'),
              limit(40)
            );

    const unsubMessages = onSnapshot(
      msgQuery,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as Message).reverse();
        const nextLiveIds = new Set(docs.map((d) => d.id));
        const removedFromLive = new Set<string>();
        for (const id of liveWindowIdsRef.current) {
          if (!nextLiveIds.has(id)) {
            removedFromLive.add(id);
          }
        }
        liveWindowIdsRef.current = nextLiveIds;

        setError(null);
        setMessages((prev) => {
          const map = new Map<string, Message>();
          for (const m of prev) {
            if (!removedFromLive.has(m.id)) {
              map.set(m.id, m);
            }
          }
          for (const d of docs) {
            map.set(d.id, d);
          }
          return Array.from(map.values()).sort((a, b) => {
            const ta = getMessageTimeMs(a.createdAt) || Date.now();
            const tb = getMessageTimeMs(b.createdAt) || Date.now();
            return ta - tb;
          });
        });
        setDeliveryStatus((prev) => {
          const next = { ...prev };
          for (const d of docs) {
            if (next[d.id] === 'sending' || next[d.id] === 'failed') {
              next[d.id] = 'sent';
            }
          }
          return next;
        });
        setHasMore(snap.docs.length >= 40);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        console.error('Messages listener failed:', err);
        setError(`Real-time sync error: ${err.message}`);
      }
    );

    const reactQuery = isPublicScope
      ? query(
          collection(db, 'messageReactions'),
          where('scopeId', '==', scopeId),
          where('isPublicScope', '==', true),
          limit(200)
        )
      : query(
          collection(db, 'messageReactions'),
          where('userId', '==', firebaseUser.uid),
          limit(200)
        );
    const unsubReactions = onSnapshot(
      reactQuery,
      (snap) => {
        setReactions(
          snap.docs.map((d) => d.data() as MessageReaction).filter((r) => r.scopeId === scopeId)
        );
      },
      () => {}
    );

    const pinsQuery = isPublicScope
      ? query(
          collection(db, 'pinnedMessages'),
          where('scopeId', '==', scopeId),
          where('isPublicScope', '==', true),
          limit(30)
        )
      : query(
          collection(db, 'pinnedMessages'),
          where('pinnedBy', '==', firebaseUser.uid),
          limit(30)
        );
    const unsubPins = onSnapshot(
      pinsQuery,
      (snap) => {
        setPins(snap.docs.map((d) => d.data() as PinnedMessage).filter((p) => p.scopeId === scopeId));
      },
      () => {}
    );

    return () => {
      leaveRoom(scopeId);
      unsubWs();
      unsubWsUpdates();
      unsubMessages();
      unsubReactions();
      unsubPins();
    };
  }, [
    firebaseUser,
    isPublicScope,
    joinRoom,
    leaveRoom,
    mode,
    scopeId,
    subscribeRoomMessages,
    subscribeRoomMessageUpdates,
  ]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: settings.reducedMotion ? 'auto' : 'smooth' });
  }, [messages.length, settings.reducedMotion]);

  const loadOlderMessages = async () => {
    if (!scopeId || !firebaseUser || messages.length === 0 || loadingMore) return;
    const oldest = messages[0];
    if (!oldest?.createdAt) return;
    setLoadingMore(true);
    try {
      const q =
        mode === 'dm'
          ? query(
              collection(db, 'messages'),
              where('scopeType', '==', 'dm'),
              where('scopeId', '==', scopeId),
              where('participantIds', 'array-contains', firebaseUser.uid),
              orderBy('createdAt', 'desc'),
              startAfter(oldest.createdAt),
              limit(30)
            )
          : isPublicScope
            ? query(
                collection(db, 'messages'),
                where('scopeType', '==', 'channel'),
                where('scopeId', '==', scopeId),
                where('isPublicChannel', '==', true),
                orderBy('createdAt', 'desc'),
                startAfter(oldest.createdAt),
                limit(30)
              )
            : query(
                collection(db, 'messages'),
                where('scopeType', '==', 'channel'),
                where('scopeId', '==', scopeId),
                where('allowedUids', 'array-contains', firebaseUser.uid),
                orderBy('createdAt', 'desc'),
                startAfter(oldest.createdAt),
                limit(30)
              );
      const snap = await getDocs(q);
      const older = snap.docs.map((d) => d.data() as Message).reverse();
      if (older.length < 30) setHasMore(false);
      if (older.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !existingIds.has(m.id)), ...prev];
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load earlier messages');
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleTypingChange = (value: string) => {
    setDraft(value);
    if (!scopeId) return;
    sendTyping(scopeId, value.trim().length > 0);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      sendTyping(scopeId, false);
    }, 2500);
  };

  const dispatchMessage = async (
    msgId: string,
    clean: string,
    attachments: string[],
    replyTarget: Message | null
  ) => {
    if (!firebaseUser || !profile || !scopeId) return;
    setSending(true);
    setError(null);
    sendTyping(scopeId, false);

    const nowIso = new Date().toISOString();
    const optimisticMsg: Message = {
      id: msgId,
      scopeType: mode,
      scopeId,
      serverId: mode === 'channel' ? channel?.serverId : undefined,
      isPublicChannel: isPublicScope,
      participantIds: mode === 'dm' ? conversation?.participantIds.slice(0, 20) : undefined,
      senderId: firebaseUser.uid,
      authorId: firebaseUser.uid,
      authorName: profile.displayName,
      authorAvatar: profile.avatarUrl || '',
      text: clean,
      content: clean,
      attachments: attachments.length ? attachments : undefined,
      attachmentMeta: attachments.length
        ? attachments.map((url) => ({
            url,
            mimeType: 'image/*',
          }))
        : undefined,
      replyToId: replyTarget?.id,
      replyPreview: replyTarget
        ? `${replyTarget.authorName}: ${(replyTarget.text ?? replyTarget.content).slice(0, 120)}`
        : undefined,
      pinned: false,
      edited: false,
      deleted: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setDeliveryStatus((prev) => ({ ...prev, [msgId]: 'sending' }));
    setMessages((prev) =>
      prev.some((m) => m.id === msgId) ? prev : [...prev, optimisticMsg]
    );

    try {
      const mentions = Array.from(clean.matchAll(/@([a-z0-9_.]{3,32})/gi))
        .map((m) => m[1].toLowerCase())
        .slice(0, 10);

      if (mode === 'channel' && channel) {
        if (channel.isPublic) {
          const payload: Record<string, unknown> = {
            id: msgId,
            scopeType: 'channel',
            scopeId: channel.id,
            serverId: channel.serverId,
            isPublicChannel: true,
            senderId: firebaseUser.uid,
            authorId: firebaseUser.uid,
            authorName: profile.displayName,
            authorAvatar: profile.avatarUrl || '',
            text: clean,
            content: clean,
            pinned: false,
            edited: false,
            deleted: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (attachments.length) {
            payload.attachments = attachments;
            payload.attachmentMeta = attachments.map((url) => ({
              url,
              mimeType: 'image/*',
            }));
          }
          if (replyTarget) {
            payload.replyToId = replyTarget.id;
            payload.replyPreview = `${replyTarget.authorName}: ${(replyTarget.text ?? replyTarget.content).slice(0, 120)}`;
          }
          if (mentions.length) payload.mentions = mentions;

          await setDoc(doc(db, 'messages', msgId), payload);
          broadcastRoomMessage(channel.id, {
            ...optimisticMsg,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        } else {
          const resp = await apiRequest<{ message: Message }>(
            `/api/channels/${channel.id}/messages`,
            {
              method: 'POST',
              body: JSON.stringify({
                id: msgId,
                content: clean,
                attachments,
                replyToId: replyTarget?.id,
                replyPreview: replyTarget
                  ? `${replyTarget.authorName}: ${(replyTarget.text ?? replyTarget.content).slice(0, 120)}`
                  : undefined,
                mentions,
                authorName: profile.displayName,
                authorAvatar: profile.avatarUrl || '',
              }),
            }
          );
          if (resp?.message) {
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? resp.message : m))
            );
          }
        }
      } else if (mode === 'dm' && conversation) {
        const payload: Record<string, unknown> = {
          id: msgId,
          scopeType: 'dm',
          scopeId: conversation.id,
          isPublicChannel: false,
          participantIds: conversation.participantIds.slice(0, 20),
          senderId: firebaseUser.uid,
          authorId: firebaseUser.uid,
          authorName: profile.displayName,
          authorAvatar: profile.avatarUrl || '',
          text: clean,
          content: clean,
          pinned: false,
          edited: false,
          deleted: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (attachments.length) {
          payload.attachments = attachments;
          payload.attachmentMeta = attachments.map((url) => ({
            url,
            mimeType: 'image/*',
          }));
        }
        if (replyTarget) {
          payload.replyToId = replyTarget.id;
          payload.replyPreview = `${replyTarget.authorName}: ${(replyTarget.text ?? replyTarget.content).slice(0, 120)}`;
        }
        if (mentions.length) payload.mentions = mentions;

        await setDoc(doc(db, 'messages', msgId), payload);
        broadcastRoomMessage(conversation.id, {
          ...optimisticMsg,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await updateDoc(doc(db, 'conversations', conversation.id), {
          lastMessageText: (clean || 'Sent an attachment').slice(0, 180),
          lastMessageAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch((convErr) => {
          console.warn('Could not update conversation summary:', convErr);
        });

        for (const pid of conversation.participantIds) {
          if (pid !== firebaseUser.uid) {
            const notifId = generateId('ntf');
            void setDoc(doc(db, 'notifications', notifId), {
              id: notifId,
              userId: pid,
              actorId: firebaseUser.uid,
              type: conversation.isGroup ? 'group_message' : 'dm',
              title: conversation.isGroup
                ? `${profile.displayName} in ${conversation.name || 'Group Chat'}`
                : `Message from ${profile.displayName}`,
              body: (clean || 'Shared media').slice(0, 200),
              read: false,
              createdAt: serverTimestamp(),
            }).catch(() => {});
          }
        }
      }

      setDeliveryStatus((prev) => ({ ...prev, [msgId]: 'sent' }));
      setFailedPayloads((prev) => {
        if (!(msgId in prev)) return prev;
        const copy = { ...prev };
        delete copy[msgId];
        return copy;
      });
    } catch (err) {
      setDeliveryStatus((prev) => ({ ...prev, [msgId]: 'failed' }));
      setFailedPayloads((prev) => ({
        ...prev,
        [msgId]: { clean, attachments, replyTo: replyTarget },
      }));
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!firebaseUser || !profile || !scopeId || sending) return;
    const clean = truncateText(draft, 4000);
    if (!clean && pendingAttachments.length === 0) return;

    const msgId = generateId('msg');
    const attachmentsSnapshot = [...pendingAttachments];
    const replySnapshot = replyTo;

    setDraft('');
    setPendingAttachments([]);
    setReplyTo(null);

    await dispatchMessage(msgId, clean, attachmentsSnapshot, replySnapshot);
  };

  const handleToggleReaction = async (message: Message, emoji: string) => {
    if (!firebaseUser) return;
    const reactionId = `${message.id}_${firebaseUser.uid}_${emoji.codePointAt(0)?.toString(16) || 'e'}`;
    const existing = reactions.find((r) => r.id === reactionId);
    try {
      if (existing) {
        await deleteDoc(doc(db, 'messageReactions', reactionId));
      } else {
        await setDoc(doc(db, 'messageReactions', reactionId), {
          id: reactionId,
          messageId: message.id,
          scopeId,
          isPublicScope: isPublicScope,
          userId: firebaseUser.uid,
          emoji,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update reaction');
    }
  };

  const handleSaveEdit = async (msg: Message) => {
    const clean = truncateText(editDraft, 4000);
    if (!clean) return;
    setError(null);
    try {
      await updateDoc(doc(db, 'messages', msg.id), {
        text: clean,
        content: clean,
        edited: true,
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      broadcastRoomMessageUpdate(scopeId, {
        ...msg,
        text: clean,
        content: clean,
        edited: true,
        updatedAt: new Date().toISOString(),
      });
      setEditingId(null);
      setEditDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save message edit');
    }
  };

  const handleDeleteMessage = async (msg: Message) => {
    setError(null);
    try {
      await updateDoc(doc(db, 'messages', msg.id), {
        text: '[Message removed]',
        content: '[Message removed]',
        deleted: true,
        updatedAt: serverTimestamp(),
      });
      broadcastRoomMessageUpdate(scopeId, {
        ...msg,
        text: '[Message removed]',
        content: '[Message removed]',
        deleted: true,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete message');
    }
  };

  const handlePinMessage = async (msg: Message) => {
    if (!firebaseUser) return;
    setError(null);
    try {
      const pinId = generateId('pin');
      await setDoc(doc(db, 'pinnedMessages', pinId), {
        id: pinId,
        scopeId,
        messageId: msg.id,
        ...(msg.serverId ? { serverId: msg.serverId } : {}),
        isPublicScope: isPublicScope,
        pinnedBy: firebaseUser.uid,
        contentPreview: `${msg.authorName}: ${msg.content.slice(0, 260)}`,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'messages', msg.id), {
        pinned: true,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      broadcastRoomMessageUpdate(scopeId, {
        ...msg,
        pinned: true,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pin message');
    }
  };

  const handleUnpin = async (pin: PinnedMessage) => {
    setError(null);
    try {
      await deleteDoc(doc(db, 'pinnedMessages', pin.id));
      await updateDoc(doc(db, 'messages', pin.messageId), {
        pinned: false,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      const targetMsg = messages.find((m) => m.id === pin.messageId);
      if (targetMsg) {
        broadcastRoomMessageUpdate(scopeId, {
          ...targetMsg,
          pinned: false,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unpin message');
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !reportTarget || reportReason.trim().length < 3) return;
    const reportId = generateId('rep');
    try {
      await setDoc(doc(db, 'reports', reportId), {
        id: reportId,
        reporterId: firebaseUser.uid,
        targetType: 'message',
        targetId: reportTarget.id,
        serverId: reportTarget.serverId || '',
        reason: truncateText(reportReason, 500),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setReportTarget(null);
      setReportReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    }
  };

  // Search filtering supporting optional Discord-like operators: from:, has:media, pinned:
  const visibleMessages = useMemo(() => {
    const raw = searchTerm.trim().toLowerCase();
    if (!raw) return messages;

    return messages.filter((m) => {
      if (raw.startsWith('from:')) {
        const who = raw.slice(5).trim();
        return (
          m.authorName.toLowerCase().includes(who) ||
          (memberProfiles[m.authorId]?.username || '').toLowerCase().includes(who)
        );
      }
      if (raw === 'has:media' || raw === 'has:image') {
        return Boolean(m.attachments && m.attachments.length > 0);
      }
      if (raw === 'is:pinned' || raw === 'pinned:') {
        return Boolean(m.pinned);
      }
      return (
        m.content.toLowerCase().includes(raw) ||
        m.authorName.toLowerCase().includes(raw)
      );
    });
  }, [memberProfiles, messages, searchTerm]);

  const reactionsByMessage = useMemo(() => {
    const map: Record<string, Record<string, { count: number; mine: boolean }>> = {};
    for (const r of reactions) {
      if (!map[r.messageId]) map[r.messageId] = {};
      if (!map[r.messageId][r.emoji]) map[r.messageId][r.emoji] = { count: 0, mine: false };
      map[r.messageId][r.emoji].count += 1;
      if (r.userId === firebaseUser?.uid) map[r.messageId][r.emoji].mine = true;
    }
    return map;
  }, [firebaseUser?.uid, reactions]);

  const libraryMedia = useMemo(() => {
    const map = new Map<string, MediaItem>();
    for (const m of mediaMineItems) map.set(m.id, m);
    for (const m of mediaPublicItems) if (!map.has(m.id)) map.set(m.id, m);
    const search = pickerSearch.trim().toLowerCase();
    return Array.from(map.values()).filter((item) => {
      if (item.isAfterDark && !allowFlirty) return false;
      if (search && !item.title.toLowerCase().includes(search) && !item.category.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });
  }, [allowFlirty, mediaMineItems, mediaPublicItems, pickerSearch]);

  const typingList = (typingByRoom[scopeId] || []).filter(
    (t) => t.uid !== firebaseUser?.uid
  );

  const otherDmUid =
    mode === 'dm' && conversation && !conversation.isGroup
      ? conversation.participantIds.find((id) => id !== firebaseUser?.uid) || null
      : null;
  const otherDmUser = otherDmUid ? memberProfiles[otherDmUid] : undefined;

  const headerTitle =
    mode === 'channel'
      ? channel?.name || 'channel'
      : conversation?.isGroup
        ? conversation.name || 'Group Conversation'
        : otherDmUser?.displayName || 'Direct Message';

  const canModerate =
    myRole === 'owner' ||
    myRole === 'admin' ||
    myRole === 'moderator' ||
    Boolean(myPermissions?.manageMessages);
  const canPin = mode === 'dm' || canModerate || Boolean(myPermissions?.pinMessages);
  const canSend = mode === 'dm' || (!isMuted && (myPermissions?.sendMessages ?? true));

  const otherStatusDot =
    otherDmUser?.onlineStatus === 'dnd'
      ? 'bg-rose-500'
      : otherDmUser?.onlineStatus === 'idle'
        ? 'bg-amber-400'
        : otherDmUser?.onlineStatus && otherDmUser.onlineStatus !== 'offline'
          ? 'bg-emerald-500'
          : 'bg-zinc-500';

  const sendMediaDirect = (url: string) => {
    if (!canSend || sending) return;
    setComposerTab(null);
    setPlusMenuOpen(false);
    const msgId = generateId('msg');
    void dispatchMessage(msgId, '', [url], replyTo);
    setReplyTo(null);
  };

  return (
    <div
      className={`flex-1 flex flex-col min-w-0 h-full relative ${
        isAfterDarkTheme
          ? 'bg-[#141019] text-zinc-100'
          : 'bg-white dark:bg-[#1b1c21] text-zinc-900 dark:text-[#f2f3f5]'
      }`}
    >
      {/* Discord-style 48px Channel / DM Header */}
      <header
        className={`h-12 px-3 sm:px-4 border-b flex items-center justify-between gap-2.5 shrink-0 relative z-20 ${
          isAfterDarkTheme
            ? 'bg-[#141019] border-rose-500/15'
            : 'bg-white dark:bg-[#1b1c21] border-zinc-200 dark:border-white/[0.07]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation"
            className="md:hidden p-1.5 -ml-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-white/[0.06]"
          >
            <Menu className="w-5 h-5" />
          </button>

          {mode === 'dm' && otherDmUid ? (
            <button
              type="button"
              onClick={() => onViewProfile(otherDmUid)}
              className="flex items-center gap-2.5 min-w-0 text-left group"
            >
              <div className="relative w-6 h-6 rounded-full bg-[#26282e] shrink-0">
                {otherDmUser?.avatarUrl ? (
                  <img
                    src={otherDmUser.avatarUrl}
                    alt={headerTitle}
                    referrerPolicy="no-referrer"
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className="w-full h-full rounded-full flex items-center justify-center text-[10px] font-bold text-zinc-300">
                    {getInitials(headerTitle)}
                  </span>
                )}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#1b1c21] ${otherStatusDot}`}
                />
              </div>
              <span className="font-semibold text-[15px] truncate group-hover:underline">
                {headerTitle}
              </span>
              {otherDmUser?.pronouns && (
                <span className="hidden sm:inline text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {otherDmUser.pronouns}
                </span>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-zinc-400 shrink-0">
                {mode === 'dm' ? (
                  <MessageSquare className="w-5 h-5 text-zinc-400" />
                ) : channel?.type === 'announcement' ? (
                  <Megaphone className="w-5 h-5 text-amber-400" />
                ) : channel?.isPrivate ? (
                  <Lock className="w-5 h-5 text-amber-400" />
                ) : (
                  <Hash className={`w-5 h-5 ${isAfterDarkTheme ? 'text-rose-400' : 'text-zinc-400'}`} />
                )}
              </span>
              <h2 className="font-semibold text-[15px] truncate shrink-0 max-w-[180px] sm:max-w-[260px]">
                {headerTitle}
              </h2>
              {mode === 'channel' && channel?.topic && (
                <>
                  <span className="hidden lg:inline-block w-px h-4 bg-white/10 mx-1 shrink-0" />
                  <span className="hidden lg:inline text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {channel.topic}
                  </span>
                </>
              )}
              {mode === 'channel' && !channel?.topic && serverName && (
                <span className="hidden xl:inline text-xs text-zinc-500 truncate">
                  · {serverName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Top-Right Header Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowPins((s) => !s)}
            aria-label="Pinned messages"
            title="Pinned Messages"
            className={`relative p-1.5 rounded-md transition-colors ${
              showPins
                ? 'bg-white/10 text-zinc-900 dark:text-white'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06]'
            }`}
          >
            <Pin className="w-4 h-4" />
            {pins.length > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-400" />
            )}
          </button>

          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label={mode === 'dm' ? 'Toggle User Profile' : 'Toggle Member List'}
            title={mode === 'dm' ? 'User Profile' : 'Member List'}
            className={`p-1.5 rounded-md transition-colors ${
              showRightPanel
                ? 'bg-white/10 text-zinc-900 dark:text-white'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06]'
            }`}
          >
            <Users className="w-4 h-4" />
          </button>

          {/* Compact Mobile Search Toggle */}
          <button
            type="button"
            onClick={() => setMobileSearchOpen((s) => !s)}
            aria-label="Search messages"
            className={`sm:hidden p-1.5 rounded-md transition-colors ${
              mobileSearchOpen || searchTerm
                ? 'bg-white/10 text-zinc-900 dark:text-white'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-white/[0.06]'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Desktop Embedded Search Input (Screenshot 153 / 154) */}
          <div className="hidden sm:block relative">
            <div
              className={`flex items-center h-7 px-2 rounded-md bg-zinc-200/70 dark:bg-[#111214] border transition-all ${
                searchFocused || searchTerm
                  ? 'w-56 border-white/15'
                  : 'w-36 border-transparent hover:border-white/10'
              }`}
            >
              <input
                type="text"
                value={searchTerm}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search"
                className="flex-1 bg-transparent text-xs focus:outline-none min-w-0 placeholder:text-zinc-500"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="text-zinc-400 hover:text-zinc-100 ml-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              )}
            </div>

            {searchFocused && !searchTerm && (
              <div className="absolute right-0 top-9 w-56 rounded-lg bg-[#222328] border border-white/[0.08] shadow-xl p-2 space-y-1 z-30">
                <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Search Filters
                </p>
                {[
                  { token: 'from:', desc: 'from a member' },
                  { token: 'has:media', desc: 'images or GIFs' },
                  { token: 'is:pinned', desc: 'pinned messages' },
                ].map((opt) => (
                  <button
                    key={opt.token}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSearchTerm(opt.token);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-white/[0.06] text-left"
                  >
                    <span className="font-mono text-zinc-200">{opt.token}</span>
                    <span className="text-[11px] text-zinc-400">{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Search Bar */}
      {mobileSearchOpen && (
        <div className="sm:hidden px-3 py-2 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c] flex items-center gap-2 shrink-0">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search messages or from:name…"
            className="flex-1 bg-transparent text-xs focus:outline-none"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="text-xs text-zinc-400 hover:text-zinc-100"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Pinned Messages Floating Dropdown */}
      {showPins && (
        <div className="absolute right-3 top-13 z-30 w-[calc(100vw-24px)] sm:w-96 max-h-[65vh] flex flex-col rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.08] shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pin className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold">Pinned Messages</span>
              <span className="text-xs text-zinc-500">({pins.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowPins(false)}
              className="p-1 rounded text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 overflow-y-auto space-y-2">
            {pins.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                No pinned messages in this conversation yet.
              </div>
            ) : (
              pins.map((p) => (
                <div
                  key={p.id}
                  className="text-xs p-3 rounded-lg bg-zinc-100 dark:bg-[#17181c] border border-zinc-200 dark:border-white/[0.06] flex items-start justify-between gap-2"
                >
                  <p className="text-zinc-700 dark:text-zinc-200 leading-relaxed break-words">
                    {p.contentPreview}
                  </p>
                  {(canPin || p.pinnedBy === firebaseUser?.uid) && (
                    <button
                      type="button"
                      aria-label="Unpin message"
                      title="Unpin"
                      onClick={() => void handleUnpin(p)}
                      className="text-zinc-400 hover:text-rose-400 shrink-0 p-1 rounded hover:bg-white/[0.05]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4">
        {hasMore && messages.length >= 40 && (
          <div className="text-center pb-3">
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadOlderMessages}
              className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-200/70 dark:bg-[#222328] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white border border-white/[0.06]"
            >
              {loadingMore ? 'Loading earlier messages…' : 'Load older messages'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-500 gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Syncing conversation…
          </div>
        ) : (
          <>
            {/* Discord Channel / DM Welcome Hero (Screenshot 171) */}
            {(!hasMore || messages.length < 40) && !searchTerm && (
              <div className="pt-4 pb-6 mb-4 border-b border-zinc-200 dark:border-white/[0.07]">
                {mode === 'dm' && otherDmUid ? (
                  <div className="space-y-2.5">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-[#26282e] flex items-center justify-center text-xl font-bold text-zinc-200">
                      {otherDmUser?.avatarUrl ? (
                        <img
                          src={otherDmUser.avatarUrl}
                          alt={headerTitle}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        getInitials(headerTitle)
                      )}
                    </div>
                    <h3 className="text-2xl font-display font-bold tracking-tight">
                      {headerTitle}
                    </h3>
                    {otherDmUser?.username && (
                      <p className="text-sm font-medium text-zinc-400">
                        @{otherDmUser.username}
                      </p>
                    )}
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      This is the beginning of your direct message history with{' '}
                      <strong className="text-zinc-700 dark:text-zinc-200">{headerTitle}</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="w-16 h-16 rounded-full bg-zinc-200 dark:bg-[#26282e] flex items-center justify-center text-zinc-700 dark:text-zinc-100">
                      {mode === 'dm' ? (
                        <MessageSquare className="w-8 h-8" />
                      ) : channel?.type === 'announcement' ? (
                        <Megaphone className="w-8 h-8 text-amber-400" />
                      ) : channel?.type === 'voice' ? (
                        <Volume2 className="w-8 h-8 text-emerald-400" />
                      ) : (
                        <Hash className="w-9 h-9" />
                      )}
                    </div>
                    <h3 className="text-2xl font-display font-bold tracking-tight">
                      Welcome to {mode === 'channel' ? `#${headerTitle}!` : headerTitle}
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {mode === 'channel'
                        ? channel?.topic
                          ? channel.topic
                          : `This is the start of the #${headerTitle} channel.`
                        : 'This is the beginning of your group conversation.'}
                    </p>
                    {mode === 'channel' && myPermissions?.manageChannels && onEditChannel && (
                      <button
                        type="button"
                        onClick={onEditChannel}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#5865f2] hover:bg-[#5865f2]/10 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit Channel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {visibleMessages.length === 0 && searchTerm ? (
              <div className="py-16 text-center space-y-2">
                <Search className="w-7 h-7 text-zinc-500 mx-auto" />
                <p className="text-sm font-medium text-zinc-400">
                  No messages match &ldquo;{searchTerm}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="text-xs text-violet-400 hover:underline"
                >
                  Clear search filter
                </button>
              </div>
            ) : (
              <div className={settings.density === 'compact' ? 'space-y-0.5' : 'space-y-1'}>
                {visibleMessages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
                  const dateLabel = formatDateSeparator(msg.createdAt);
                  const prevDateLabel = prevMsg ? formatDateSeparator(prevMsg.createdAt) : null;
                  const showDateDivider = dateLabel !== prevDateLabel;

                  const timeDelta = prevMsg
                    ? Math.abs(getMessageTimeMs(msg.createdAt) - getMessageTimeMs(prevMsg.createdAt))
                    : Infinity;
                  const isGrouped =
                    Boolean(prevMsg) &&
                    !showDateDivider &&
                    !msg.replyPreview &&
                    prevMsg!.authorId === msg.authorId &&
                    timeDelta < 5 * 60 * 1000;

                  const authorProfile = memberProfiles[msg.authorId];
                  const avatar = authorProfile?.avatarUrl || msg.authorAvatar;
                  const displayName = authorProfile?.displayName || msg.authorName;
                  const roleMeta = roleColorByUid[msg.authorId];
                  const isMine = msg.authorId === firebaseUser?.uid;
                  const msgReactions = reactionsByMessage[msg.id] || {};

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateDivider && (
                        <div className="flex items-center gap-3 py-3 select-none">
                          <div className="flex-1 h-px bg-zinc-200 dark:bg-white/[0.07]" />
                          <span className="text-[11px] font-semibold text-zinc-500 tabular-nums">
                            {dateLabel}
                          </span>
                          <div className="flex-1 h-px bg-zinc-200 dark:bg-white/[0.07]" />
                        </div>
                      )}

                      <div
                        className={`group relative rounded-md px-2 hover:bg-zinc-100/80 dark:hover:bg-white/[0.03] transition-colors ${
                          isGrouped ? 'py-0.5' : 'pt-2 pb-1 mt-2'
                        }`}
                      >
                        {/* Curved Reply Spine (Screenshot 154) */}
                        {msg.replyPreview && (
                          <div className="flex items-center gap-1.5 pl-4 mb-1 text-xs text-zinc-400">
                            <span
                              aria-hidden="true"
                              className="w-7 h-3 border-l-2 border-t-2 border-zinc-500/60 rounded-tl-md mt-1 shrink-0"
                            />
                            <CornerUpLeft className="w-3 h-3 text-zinc-500 shrink-0" />
                            <span className="truncate max-w-xl text-zinc-400 hover:text-zinc-200">
                              {msg.replyPreview}
                            </span>
                          </div>
                        )}

                        <div className="flex items-start gap-3.5">
                          {isGrouped ? (
                            <span className="w-10 shrink-0 text-[10px] font-mono text-zinc-500 text-right opacity-0 group-hover:opacity-100 select-none pt-1 tabular-nums">
                              {formatTimeShort(msg.createdAt)}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onViewProfile(msg.authorId)}
                              className="w-10 h-10 rounded-full overflow-hidden bg-[#26282e] shrink-0 mt-0.5 flex items-center justify-center text-xs font-bold text-zinc-200 hover:opacity-90"
                            >
                              {avatar ? (
                                <img
                                  src={avatar}
                                  alt={displayName}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                getInitials(displayName)
                              )}
                            </button>
                          )}

                          <div className="flex-1 min-w-0">
                            {!isGrouped && (
                              <div className="flex items-baseline gap-2 flex-wrap leading-snug">
                                <button
                                  type="button"
                                  onClick={() => onViewProfile(msg.authorId)}
                                  style={roleMeta?.color ? { color: roleMeta.color } : undefined}
                                  className="font-semibold text-[15px] hover:underline text-left"
                                >
                                  {displayName}
                                </button>
                                {roleMeta && (
                                  <span
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300"
                                    style={{ color: roleMeta.color }}
                                  >
                                    {roleMeta.name}
                                  </span>
                                )}
                                <span className="text-[11px] text-zinc-500 tabular-nums">
                                  {formatTimeShort(msg.createdAt)}
                                </span>
                                {msg.edited && !msg.deleted && (
                                  <span className="text-[10px] text-zinc-500">(edited)</span>
                                )}
                                {msg.pinned && (
                                  <span className="text-[10px] text-amber-400 inline-flex items-center gap-0.5">
                                    <Pin className="w-2.5 h-2.5" /> pinned
                                  </span>
                                )}
                                {isMine && deliveryStatus[msg.id] === 'sending' && (
                                  <span className="text-[11px] text-zinc-400">· sending…</span>
                                )}
                                {isMine && deliveryStatus[msg.id] === 'failed' && (
                                  <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-400">
                                    · failed
                                    {failedPayloads[msg.id] && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const payload = failedPayloads[msg.id];
                                          void dispatchMessage(
                                            msg.id,
                                            payload.clean,
                                            payload.attachments,
                                            payload.replyTo
                                          );
                                        }}
                                        className="underline hover:text-rose-300"
                                      >
                                        Retry
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setMessages((prev) =>
                                          prev.filter((item) => item.id !== msg.id)
                                        )
                                      }
                                      className="underline text-zinc-400 hover:text-zinc-200"
                                    >
                                      Dismiss
                                    </button>
                                  </span>
                                )}
                              </div>
                            )}

                            {editingId === msg.id ? (
                              <div className="mt-1.5 space-y-1.5">
                                <input
                                  type="text"
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void handleSaveEdit(msg);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#222328] border border-violet-500 text-sm focus:outline-none"
                                />
                                <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                                  <span>escape to</span>
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="text-violet-400 hover:underline"
                                  >
                                    cancel
                                  </button>
                                  <span>· enter to</span>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(msg)}
                                    className="text-violet-400 hover:underline font-medium"
                                  >
                                    save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              (msg.text ?? msg.content) && (
                                <p
                                  className={`text-[15px] leading-[1.375] break-words whitespace-pre-wrap ${
                                    msg.deleted
                                      ? 'italic text-zinc-500 text-sm'
                                      : 'text-zinc-800 dark:text-[#dbdee1]'
                                  }`}
                                >
                                  {msg.text ?? msg.content}
                                  {isGrouped && msg.edited && !msg.deleted && (
                                    <span className="text-[10px] text-zinc-500 ml-1.5">(edited)</span>
                                  )}
                                </p>
                              )
                            )}

                            {msg.attachments && msg.attachments.length > 0 && !msg.deleted && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {msg.attachments.map((url, aIdx) => (
                                  <button
                                    key={`${msg.id}_att_${aIdx}`}
                                    type="button"
                                    onClick={() => setLightboxUrl(url)}
                                    className="rounded-lg overflow-hidden border border-zinc-200 dark:border-white/[0.08] max-w-xs max-h-64 block bg-[#111214]"
                                  >
                                    <img
                                      src={url}
                                      alt="Message attachment"
                                      referrerPolicy="no-referrer"
                                      className="max-h-64 w-auto object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            )}

                            {Object.keys(msgReactions).length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {Object.entries(msgReactions).map(([emoji, info]) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleToggleReaction(msg, emoji)}
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs border transition-colors ${
                                      info.mine
                                        ? 'bg-[#5865f2]/20 border-[#5865f2]/50 text-indigo-200'
                                        : 'bg-zinc-100 dark:bg-[#222328] border-zinc-200 dark:border-white/[0.07] text-zinc-400 hover:border-white/20'
                                    }`}
                                  >
                                    <span>{emoji}</span>
                                    <span className="font-mono text-[11px] font-semibold tabular-nums">
                                      {info.count}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Floating Discord Top-Right Hover Action Pill (Screenshot 153) */}
                        {!msg.deleted && (
                          <div className="absolute -top-3.5 right-3 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-0.5 bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.08] rounded-md px-1 py-0.5 shadow-lg transition-opacity">
                            {QUICK_EMOJIS.slice(0, 3).map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => handleToggleReaction(msg, em)}
                                aria-label={`React with ${em}`}
                                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-white/[0.07] text-xs"
                              >
                                {em}
                              </button>
                            ))}
                            <span className="w-px h-4 bg-white/[0.08] mx-0.5" />
                            <button
                              type="button"
                              onClick={() => {
                                setReplyTo(msg);
                                inputRef.current?.focus();
                              }}
                              aria-label="Reply"
                              title="Reply"
                              className="p-1.5 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.07]"
                            >
                              <CornerUpLeft className="w-3.5 h-3.5" />
                            </button>
                            {(isMine || canPin) && (
                              <button
                                type="button"
                                onClick={() => handlePinMessage(msg)}
                                aria-label="Pin message"
                                title="Pin Message"
                                className="p-1.5 rounded text-zinc-400 hover:text-amber-400 hover:bg-zinc-100 dark:hover:bg-white/[0.07]"
                              >
                                <Pin className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isMine && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(msg.id);
                                  setEditDraft(msg.content);
                                }}
                                aria-label="Edit message"
                                title="Edit Message"
                                className="p-1.5 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.07]"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {(isMine || canModerate) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteMessage(msg)}
                                aria-label="Delete message"
                                title="Delete Message"
                                className="p-1.5 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-white/[0.07]"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isMine && (
                              <button
                                type="button"
                                onClick={() => setReportTarget(msg)}
                                aria-label="Report message"
                                title="Report Message"
                                className="p-1.5 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-white/[0.07]"
                              >
                                <Flag className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Bottom Composer Region */}
      <div className="px-3 sm:px-4 pb-3 pt-0.5 shrink-0 relative">
        {error && (
          <div className="mb-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Composer Popover: GIFs | Stickers | Emoji (Screenshots 167-169) */}
        {composerTab && (
          <div className="absolute bottom-16 right-4 z-30 w-[calc(100vw-32px)] sm:w-[400px] h-[380px] rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.08] shadow-2xl flex flex-col overflow-hidden">
            {/* Tabs + Search */}
            <div className="p-2.5 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'gif', label: 'GIFs' },
                      { id: 'sticker', label: 'Stickers' },
                      { id: 'emoji', label: 'Emoji' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setComposerTab(t.id)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                        composerTab === t.id
                          ? 'bg-white/10 text-white'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setComposerTab(null)}
                  className="p-1 rounded text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder={
                    composerTab === 'emoji'
                      ? 'Find the perfect emoji'
                      : composerTab === 'sticker'
                        ? 'Search stickers & artwork'
                        : 'Search community GIFs'
                  }
                  className="w-full h-8 pl-8 pr-3 rounded-md bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.06] text-xs focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-3">
              {composerTab === 'emoji' ? (
                <div className="space-y-4">
                  {EMOJI_GROUPS.map((grp) => {
                    const q = pickerSearch.trim().toLowerCase();
                    const filtered = grp.items.filter(
                      (i) => !q || i.name.includes(q) || i.char.includes(q)
                    );
                    if (filtered.length === 0) return null;
                    return (
                      <div key={grp.label} className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                          {grp.label}
                        </p>
                        <div className="grid grid-cols-8 gap-1">
                          {filtered.map((item) => (
                            <button
                              key={`${grp.label}_${item.char}`}
                              type="button"
                              title={item.name}
                              onClick={() => {
                                setDraft((d) => `${d}${item.char}`);
                                inputRef.current?.focus();
                              }}
                              className="h-9 rounded-md hover:bg-white/[0.08] flex items-center justify-center text-xl transition-colors"
                            >
                              {item.char}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const items =
                      composerTab === 'gif'
                        ? libraryMedia.filter(
                            (m) =>
                              m.mimeType === 'image/gif' ||
                              m.format === 'gif' ||
                              m.url.toLowerCase().endsWith('.gif') ||
                              m.category === 'reactions' ||
                              m.category === 'funny'
                          )
                        : libraryMedia.filter((m) => m.mimeType !== 'image/gif');
                    const display = items.length > 0 ? items : libraryMedia;

                    if (display.length === 0) {
                      return (
                        <div className="py-10 text-center space-y-2.5">
                          <Film className="w-8 h-8 text-zinc-500 mx-auto" />
                          <p className="text-xs text-zinc-400">
                            No {composerTab === 'gif' ? 'GIFs' : 'stickers'} uploaded yet.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setComposerTab(null);
                              setShowMediaModal(true);
                            }}
                            className="px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
                          >
                            Upload in Media Studio
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-2 gap-2">
                        {display.slice(0, 24).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => sendMediaDirect(item.url)}
                            className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-[#17181c] border border-white/[0.06] hover:border-violet-500/60 transition-colors"
                          >
                            <img
                              src={item.url}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity text-left">
                              <p className="text-[10px] font-medium text-white truncate">
                                {item.title}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="px-3 py-2 border-t border-white/[0.07] bg-[#17181c] flex items-center justify-between text-[11px] text-zinc-400">
              <span>Powered by ShadowSpace Media</span>
              <button
                type="button"
                onClick={() => {
                  setComposerTab(null);
                  setShowMediaModal(true);
                }}
                className="text-violet-400 hover:underline font-medium"
              >
                Open Media Studio
              </button>
            </div>
          </div>
        )}

        {/* Composer Attachment / Reply Strip */}
        {(replyTo || pendingAttachments.length > 0) && (
          <div className="mb-1.5 rounded-t-lg bg-zinc-100 dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] px-3 py-2 space-y-2">
            {replyTo && (
              <div className="flex items-center justify-between text-xs">
                <span className="truncate text-zinc-400">
                  Replying to <strong className="text-zinc-100">{replyTo.authorName}</strong>:{' '}
                  {replyTo.content.slice(0, 80)}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="text-zinc-400 hover:text-zinc-100 ml-2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((url, idx) => (
                  <div
                    key={url + idx}
                    className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10"
                  >
                    <img
                      src={url}
                      alt="Attachment preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute top-0.5 right-0.5 bg-black/75 text-white rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!canSend ? (
          <div className="px-4 py-2.5 rounded-lg bg-zinc-100 dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] text-xs text-zinc-400">
            {isMuted
              ? 'You are currently muted in this server and cannot send messages.'
              : 'Your server roles do not permit sending messages.'}
          </div>
        ) : (
          <form
            onSubmit={handleSend}
            className="relative flex items-center gap-1.5 bg-zinc-100 dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.07] rounded-lg px-2.5 py-1.5 focus-within:border-white/15 transition-colors"
          >
            {/* + Plus Upload Menu */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setPlusMenuOpen((s) => !s)}
                aria-label="Upload or attach media"
                className="w-7 h-7 rounded-full bg-zinc-300/60 dark:bg-[#31333c] hover:bg-zinc-300 dark:hover:bg-[#3c3f49] text-zinc-700 dark:text-zinc-200 flex items-center justify-center transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              {plusMenuOpen && (
                <div className="absolute bottom-10 left-0 z-30 w-52 rounded-lg bg-white dark:bg-[#17181c] border border-zinc-200 dark:border-white/[0.08] shadow-2xl p-1.5 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      setShowMediaModal(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-600 hover:text-white transition-colors"
                  >
                    <ImagePlus className="w-4 h-4 shrink-0" />
                    Upload Image / GIF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      setComposerTab('gif');
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-600 hover:text-white transition-colors"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    Browse GIFs & Stickers
                  </button>
                </div>
              )}
            </div>

            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => handleTypingChange(e.target.value)}
              placeholder={`Message ${mode === 'channel' ? `#${headerTitle}` : `@${otherDmUser?.username || headerTitle}`}`}
              className="flex-1 bg-transparent text-sm py-1.5 px-1.5 focus:outline-none min-w-0 placeholder:text-zinc-500"
            />

            {/* Right Composer Icons: GIF, Sticker, Emoji, Send */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setPickerSearch('');
                  setComposerTab((t) => (t === 'gif' ? null : 'gif'));
                }}
                aria-label="Open GIF picker"
                title="GIF"
                className={`px-1.5 py-1 rounded text-[11px] font-extrabold tracking-tight border transition-colors ${
                  composerTab === 'gif'
                    ? 'bg-white/15 border-white/25 text-white'
                    : 'border-zinc-500/50 text-zinc-400 hover:text-zinc-100 hover:border-zinc-300'
                }`}
              >
                GIF
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickerSearch('');
                  setComposerTab((t) => (t === 'sticker' ? null : 'sticker'));
                }}
                aria-label="Open Sticker picker"
                title="Stickers"
                className={`p-1.5 rounded transition-colors ${
                  composerTab === 'sticker'
                    ? 'text-white bg-white/10'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Sticker className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickerSearch('');
                  setComposerTab((t) => (t === 'emoji' ? null : 'emoji'));
                }}
                aria-label="Open Emoji picker"
                title="Emoji"
                className={`p-1.5 rounded transition-colors ${
                  composerTab === 'emoji'
                    ? 'text-amber-300 bg-white/10'
                    : 'text-zinc-400 hover:text-amber-300'
                }`}
              >
                <Smile className="w-4 h-4" />
              </button>

              {(draft.trim() || pendingAttachments.length > 0 || sending) && (
                <button
                  type="submit"
                  disabled={sending || (!draft.trim() && pendingAttachments.length === 0)}
                  aria-label="Send message"
                  className="ml-1 p-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </form>
        )}

        {/* Typing indicator bar beneath composer (Discord style) */}
        <div className="h-4 mt-0.5 px-1 flex items-center">
          {typingList.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce" />
                <span className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:120ms]" />
                <span className="w-1 h-1 rounded-full bg-zinc-300 animate-bounce [animation-delay:240ms]" />
              </span>
              <span>
                <strong className="text-zinc-200">
                  {typingList.map((t) => t.displayName).join(', ')}
                </strong>{' '}
                {typingList.length === 1 ? 'is' : 'are'} typing…
              </span>
            </div>
          )}
        </div>
      </div>

      {showMediaModal && (
        <MediaModal
          scopeId={scopeId}
          purpose="attachment"
          onSelectMedia={(url) => {
            setPendingAttachments((prev) => [...prev.slice(0, 4), url]);
            setShowMediaModal(false);
          }}
          onClose={() => setShowMediaModal(false)}
        />
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="fixed top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Expanded media"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
          />
        </div>
      )}

      {reportTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleReportSubmit}
            className="max-w-md w-full bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.08] rounded-xl p-5 space-y-4 shadow-2xl"
          >
            <h3 className="font-display font-semibold text-base">Report Message</h3>
            <p className="text-xs text-zinc-400 line-clamp-2">{reportTarget.content}</p>
            <textarea
              required
              minLength={3}
              maxLength={500}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the safety or rule violation…"
              className="w-full h-24 p-3 rounded-lg bg-zinc-50 dark:bg-[#17181c] border border-zinc-200 dark:border-white/[0.08] text-sm focus:outline-none focus:border-rose-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
