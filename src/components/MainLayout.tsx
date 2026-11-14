import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  Crown,
  Flame,
  FolderPlus,
  Globe,
  Hash,
  HeadphoneOff,
  Headphones,
  Home,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { useVoiceChannel } from '../hooks/useVoiceChannel';
import type {
  BlockedUser,
  Channel,
  ChannelCategory,
  Conversation,
  FriendRequest,
  Friendship,
  NotificationItem,
  OnlineStatus,
  Server,
  ServerMember,
  ServerRoleDefinition,
  UserPublic,
} from '../types/shadowspace';
import { resolveMemberPermissions } from '../utils/permissions';
import {
  ASSET_IMAGES,
  formatDateSeparator,
  formatTimeShort,
  generateId,
  getDirectConversationId,
  getInitials,
} from '../utils/validators';
import { AdminDashboard } from './AdminDashboard';
import { AfterDarkView } from './AfterDarkView';
import { ChatArea } from './ChatArea';
import { DiscoverView } from './DiscoverView';
import { FriendsView } from './FriendsView';
import { GlobalSearchModal } from './GlobalSearchModal';
import { NotificationsDrawer } from './NotificationsDrawer';
import { ProfileModal } from './ProfileModal';
import {
  QuickCreateCategoryModal,
  QuickCreateChannelModal,
  ServerModal,
} from './ServerModal';
import { SettingsModal } from './SettingsModal';
import { VoiceBar } from './VoiceBar';

type NavDestination = 'home' | 'dms' | 'friends' | 'discover' | 'afterdark' | 'server' | 'admin';

function statusDotClass(status?: OnlineStatus | string, isOnlineFallback?: boolean): string {
  if (status === 'dnd') return 'bg-rose-500';
  if (status === 'idle') return 'bg-amber-400';
  if (status === 'offline') return isOnlineFallback ? 'bg-emerald-500' : 'bg-zinc-500';
  if (status === 'online' || isOnlineFallback) return 'bg-emerald-500';
  return 'bg-zinc-500';
}

function statusLabel(status?: OnlineStatus | string): string {
  if (status === 'dnd') return 'Do Not Disturb';
  if (status === 'idle') return 'Idle';
  if (status === 'offline') return 'Invisible';
  return 'Online';
}

export function MainLayout() {
  const { firebaseUser, profile, refreshProfile, isPlatformAdmin } = useAuth();
  const { onlineUids, subscribeServerUpdates } = useRealtime();
  const voice = useVoiceChannel();

  const [nav, setNav] = useState<NavDestination>('home');
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  // Real-time Firestore collections
  const [userCache, setUserCache] = useState<Record<string, UserPublic>>({});
  const [myMemberships, setMyMemberships] = useState<ServerMember[]>([]);
  const [serversMap, setServersMap] = useState<Record<string, Server>>({});
  const [publicServers, setPublicServers] = useState<Server[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerMember[]>([]);
  const [serverRoles, setServerRoles] = useState<ServerRoleDefinition[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Discord-style sidebar interactions
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(false);
  const [copiedServerId, setCopiedServerId] = useState(false);

  // Modals
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showManageServer, setShowManageServer] = useState(false);
  const [manageInitialTab, setManageInitialTab] = useState<
    'overview' | 'channels' | 'roles' | 'invites' | 'members' | 'audit'
  >('overview');
  const [manageEditChannelId, setManageEditChannelId] = useState<string | null>(null);
  const [quickCreateChannelCatId, setQuickCreateChannelCatId] = useState<string | null>(null);
  const [quickCreateCategoryOpen, setQuickCreateCategoryOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [profileModalUid, setProfileModalUid] = useState<string | null>(null);
  const [profileModalEdit, setProfileModalEdit] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  // Keep current user's latest profile synced immediately across chat, sidebar, and member list
  useEffect(() => {
    if (profile?.uid) {
      setUserCache((prev) => ({ ...prev, [profile.uid]: profile }));
    }
  }, [profile]);

  // Cmd/Ctrl + K global search shortcut & Escape popovers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearch((s) => !s);
      } else if (e.key === 'Escape') {
        setServerMenuOpen(false);
        setUserPopoverOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close server dropdown when switching server
  useEffect(() => {
    setServerMenuOpen(false);
  }, [activeServerId, nav]);

  // Core Firestore listeners
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified) return;

    const unsubs: Array<() => void> = [];

    // 1. Public users directory (non-private)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'users'), where('profileVisibility', '!=', 'private'), limit(100)),
        (snap) => {
          setUserCache((prev) => {
            const next = { ...prev };
            for (const d of snap.docs) {
              const u = d.data() as UserPublic;
              next[u.uid] = u;
            }
            return next;
          });
        },
        () => {}
      )
    );

    // 2. Public servers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'servers'), where('isPublic', '==', true), limit(50)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as Server);
          setPublicServers(list);
          setServersMap((prev) => {
            const next = { ...prev };
            for (const s of list) next[s.id] = s;
            return next;
          });
        },
        () => {}
      )
    );

    // 3. My server memberships
    unsubs.push(
      onSnapshot(
        query(collection(db, 'serverMembers'), where('userId', '==', firebaseUser.uid), limit(50)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ServerMember).filter((m) => !m.banned);
          setMyMemberships(list);
        },
        () => {}
      )
    );

    // 3b. Realtime server update signal fallback (re-fetches doc if requested via WS)
    unsubs.push(
      subscribeServerUpdates((serverId) => {
        void getDoc(doc(db, 'servers', serverId))
          .then((srvSnap) => {
            if (srvSnap.exists()) {
              const srv = srvSnap.data() as Server;
              setServersMap((prev) => ({ ...prev, [srv.id]: srv }));
            }
          })
          .catch(() => {});
      })
    );

    // 4. Conversations (1-on-1 & Group DMs)
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'conversations'),
          where('participantIds', 'array-contains', firebaseUser.uid),
          limit(50)
        ),
        (snap) => {
          setConversations(snap.docs.map((d) => d.data() as Conversation));
        },
        (err) => {
          console.error('Conversations listener failed:', err);
        }
      )
    );

    // 5. Friendships & Friend requests
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'friendships'),
          where('users', 'array-contains', firebaseUser.uid),
          limit(100)
        ),
        (snap) => {
          setFriendships(snap.docs.map((d) => d.data() as Friendship));
        },
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'friendRequests'),
          where('participants', 'array-contains', firebaseUser.uid),
          limit(60)
        ),
        (snap) => {
          setFriendRequests(snap.docs.map((d) => d.data() as FriendRequest));
        },
        () => {}
      )
    );

    // 6. Blocked users
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'blockedUsers'),
          where('blockerUid', '==', firebaseUser.uid),
          limit(60)
        ),
        (snap) => {
          setBlockedUsers(snap.docs.map((d) => d.data() as BlockedUser));
        },
        () => {}
      )
    );

    // 7. Notifications
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'notifications'),
          where('userId', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc'),
          limit(40)
        ),
        (snap) => {
          setNotifications(snap.docs.map((d) => d.data() as NotificationItem));
        },
        () => {}
      )
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [firebaseUser, subscribeServerUpdates]);

  const joinedServerIdsKey = useMemo(
    () =>
      myMemberships
        .map((m) => m.serverId)
        .sort()
        .join(','),
    [myMemberships]
  );

  // Live onSnapshot listeners for every joined server (keeps private & public server edits live)
  useEffect(() => {
    if (!firebaseUser || !joinedServerIdsKey) return;
    const ids = joinedServerIdsKey.split(',').filter(Boolean);
    const unsubs = ids.map((srvId) =>
      onSnapshot(
        doc(db, 'servers', srvId),
        (snap) => {
          if (snap.exists()) {
            const srv = snap.data() as Server;
            setServersMap((prev) => ({ ...prev, [srv.id]: srv }));
          }
        },
        () => {}
      )
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [firebaseUser, joinedServerIdsKey]);

  // Hydrate profiles for any DM participants not present in public directory cache
  useEffect(() => {
    if (!firebaseUser || conversations.length === 0) return;
    const missingUids = new Set<string>();
    for (const conv of conversations) {
      for (const pid of conv.participantIds) {
        if (pid && !userCache[pid]) {
          missingUids.add(pid);
        }
      }
    }
    if (missingUids.size === 0) return;

    let active = true;
    void Promise.all(
      Array.from(missingUids).map(async (uid) => {
        const snap = await getDoc(doc(db, 'users', uid)).catch(() => null);
        return snap?.exists() ? (snap.data() as UserPublic) : null;
      })
    ).then((fetched) => {
      if (!active) return;
      const valid = fetched.filter(Boolean) as UserPublic[];
      if (valid.length === 0) return;
      setUserCache((prev) => {
        const next = { ...prev };
        for (const u of valid) next[u.uid] = u;
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [conversations, firebaseUser, userCache]);

  const activeServerIsPublic = activeServerId ? (serversMap[activeServerId]?.isPublic ?? true) : true;

  // Active server channels, categories, roles & members
  useEffect(() => {
    if (!activeServerId || !firebaseUser) {
      setChannels([]);
      setCategories([]);
      setServerMembers([]);
      setServerRoles([]);
      return;
    }

    const chanQ = activeServerIsPublic
      ? query(
          collection(db, 'channels'),
          where('serverId', '==', activeServerId),
          where('isPublic', '==', true),
          limit(60)
        )
      : query(
          collection(db, 'channels'),
          where('serverId', '==', activeServerId),
          where('memberUids', 'array-contains', firebaseUser.uid),
          limit(60)
        );

    const unsubChan = onSnapshot(
      chanQ,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Channel)
          .sort((a, b) => a.position - b.position);
        setChannels(list);
        setActiveChannelId((prevId) => {
          if (prevId && list.some((c) => c.id === prevId)) return prevId;
          const firstText = list.find((c) => c.type !== 'voice') || list[0];
          return firstText && firstText.type !== 'voice' ? firstText.id : prevId;
        });
      },
      () => {}
    );

    const catMap = new Map<string, ChannelCategory>();
    const unsubsExtra: Array<() => void> = [];

    if (activeServerIsPublic) {
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'channelCategories'),
            where('serverId', '==', activeServerId),
            where('isPublicServer', '==', true),
            limit(30)
          ),
          (snap) => {
            setCategories(
              snap.docs
                .map((d) => d.data() as ChannelCategory)
                .sort((a, b) => a.position - b.position)
            );
          },
          () => {}
        )
      );
    } else {
      const flushCats = () => {
        setCategories(
          Array.from(catMap.values()).sort((a, b) => a.position - b.position)
        );
      };
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'channelCategories'),
            where('serverId', '==', activeServerId),
            where('memberUids', 'array-contains', firebaseUser.uid),
            limit(30)
          ),
          (snap) => {
            for (const d of snap.docs) catMap.set(d.id, d.data() as ChannelCategory);
            flushCats();
          },
          () => {}
        )
      );
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'channelCategories'),
            where('serverId', '==', activeServerId),
            where('ownerId', '==', firebaseUser.uid),
            limit(30)
          ),
          (snap) => {
            for (const d of snap.docs) catMap.set(d.id, d.data() as ChannelCategory);
            flushCats();
          },
          () => {}
        )
      );
    }

    const memMap = new Map<string, ServerMember>();
    if (activeServerIsPublic) {
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'serverMembers'),
            where('serverId', '==', activeServerId),
            where('isPublicServer', '==', true),
            limit(100)
          ),
          (snap) => {
            setServerMembers(
              snap.docs
                .map((d) => d.data() as ServerMember)
                .filter((m) => m.serverId === activeServerId && !m.banned)
            );
          },
          () => {}
        )
      );
    } else {
      const flushMembers = () => {
        setServerMembers(
          Array.from(memMap.values()).filter((m) => m.serverId === activeServerId && !m.banned)
        );
      };
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'serverMembers'),
            where('serverId', '==', activeServerId),
            where('memberUids', 'array-contains', firebaseUser.uid),
            limit(100)
          ),
          (snap) => {
            for (const d of snap.docs) memMap.set(d.id, d.data() as ServerMember);
            flushMembers();
          },
          () => {}
        )
      );
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'serverMembers'),
            where('userId', '==', firebaseUser.uid),
            limit(50)
          ),
          (snap) => {
            for (const d of snap.docs) {
              const m = d.data() as ServerMember;
              if (m.serverId === activeServerId) memMap.set(d.id, m);
            }
            flushMembers();
          },
          () => {}
        )
      );
    }

    // Server custom roles
    const roleMap = new Map<string, ServerRoleDefinition>();
    if (activeServerIsPublic) {
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'serverRoles'),
            where('serverId', '==', activeServerId),
            where('isPublicServer', '==', true),
            limit(40)
          ),
          (snap) => {
            setServerRoles(
              snap.docs
                .map((d) => d.data() as ServerRoleDefinition)
                .sort((a, b) => a.position - b.position)
            );
          },
          () => {}
        )
      );
    } else {
      const flushRoles = () => {
        setServerRoles(
          Array.from(roleMap.values()).sort((a, b) => a.position - b.position)
        );
      };
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'serverRoles'),
            where('serverId', '==', activeServerId),
            where('memberUids', 'array-contains', firebaseUser.uid),
            limit(40)
          ),
          (snap) => {
            for (const d of snap.docs) roleMap.set(d.id, d.data() as ServerRoleDefinition);
            flushRoles();
          },
          () => {}
        )
      );
      unsubsExtra.push(
        onSnapshot(
          query(
            collection(db, 'serverRoles'),
            where('serverId', '==', activeServerId),
            where('ownerId', '==', firebaseUser.uid),
            limit(40)
          ),
          (snap) => {
            for (const d of snap.docs) roleMap.set(d.id, d.data() as ServerRoleDefinition);
            flushRoles();
          },
          () => {}
        )
      );
    }

    return () => {
      unsubChan();
      for (const u of unsubsExtra) u();
    };
  }, [activeServerId, activeServerIsPublic, firebaseUser]);

  const joinedServers = useMemo(() => {
    return myMemberships
      .map((m) => serversMap[m.serverId])
      .filter(Boolean) as Server[];
  }, [myMemberships, serversMap]);

  const joinedServerIds = useMemo(
    () => new Set(myMemberships.map((m) => m.serverId)),
    [myMemberships]
  );

  const activeServer = activeServerId ? serversMap[activeServerId] || null : null;
  const activeChannel = channels.find((c) => c.id === activeChannelId) || null;
  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;
  const myMemberRecord =
    myMemberships.find((m) => m.serverId === activeServerId) || null;
  const myRole = myMemberRecord?.role || null;
  const isServerOwner = Boolean(
    activeServer && firebaseUser && activeServer.ownerId === firebaseUser.uid
  );
  const myPermissions = useMemo(
    () => resolveMemberPermissions(myMemberRecord, isServerOwner, serverRoles),
    [myMemberRecord, isServerOwner, serverRoles]
  );

  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const pendingReqCount = friendRequests.filter(
    (r) => r.status === 'pending' && r.toUid === firebaseUser?.uid
  ).length;

  const sortedConversations = useMemo(() => {
    const toMs = (val: unknown): number => {
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
    };
    return [...conversations].sort(
      (a, b) =>
        (toMs(b.lastMessageAt) || toMs(b.updatedAt) || toMs(b.createdAt)) -
        (toMs(a.lastMessageAt) || toMs(a.updatedAt) || toMs(a.createdAt))
    );
  }, [conversations]);

  const startDirectMessage = async (targetUid: string) => {
    if (!firebaseUser || targetUid === firebaseUser.uid) return;

    if (!userCache[targetUid]) {
      const targetSnap = await getDoc(doc(db, 'users', targetUid)).catch(() => null);
      if (targetSnap?.exists()) {
        const targetUser = targetSnap.data() as UserPublic;
        setUserCache((prev) => ({ ...prev, [targetUser.uid]: targetUser }));
      }
    }

    const deterministicId = getDirectConversationId(firebaseUser.uid, targetUid);
    const existing =
      conversations.find((c) => c.id === deterministicId) ||
      conversations.find(
        (c) =>
          !c.isGroup &&
          c.participantIds.length === 2 &&
          c.participantIds.includes(targetUid) &&
          c.participantIds.includes(firebaseUser.uid)
      );

    if (existing) {
      setActiveConversationId(existing.id);
      setNav('dms');
      return;
    }

    const convRef = doc(db, 'conversations', deterministicId);
    const sortedParticipants = [firebaseUser.uid, targetUid].sort();
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(convRef);
      if (!snap.exists()) {
        tx.set(convRef, {
          id: deterministicId,
          isGroup: false,
          ownerId: firebaseUser.uid,
          participantIds: sortedParticipants,
          lastMessageText: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    setActiveConversationId(deterministicId);
    setNav('dms');
  };

  const createGroupDm = async (uids: string[], groupName: string) => {
    if (!firebaseUser) return;
    const convId = generateId('grp');
    const participantIds = Array.from(new Set([firebaseUser.uid, ...uids])).slice(0, 20);
    await setDoc(doc(db, 'conversations', convId), {
      id: convId,
      isGroup: true,
      name: groupName.slice(0, 80),
      ownerId: firebaseUser.uid,
      participantIds,
      lastMessageText: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setActiveConversationId(convId);
    setNav('dms');
  };

  const openServer = (serverId: string, channelId?: string) => {
    setActiveServerId(serverId);
    if (channelId) setActiveChannelId(channelId);
    setNav('server');
    setMobileDrawerOpen(false);
  };

  const handleSetMyStatus = async (status: OnlineStatus) => {
    if (!firebaseUser || statusUpdating) return;
    setStatusUpdating(true);
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        onlineStatus: status,
        updatedAt: serverTimestamp(),
      });
      await refreshProfile();
    } catch {
      // Ignore transient write errors cleanly
    } finally {
      setStatusUpdating(false);
    }
  };

  const friendUidSet = new Set(
    friendships.map((f) => f.users.find((u) => u !== firebaseUser?.uid)).filter(Boolean) as string[]
  );
  const blockedUidSet = new Set(blockedUsers.map((b) => b.blockedUid));

  // DM peer for Profile Side Panel (Screenshot 172)
  const dmOtherUid =
    nav === 'dms' && activeConversation && !activeConversation.isGroup
      ? activeConversation.participantIds.find((id) => id !== firebaseUser?.uid) || null
      : null;
  const dmOtherUser = dmOtherUid ? userCache[dmOtherUid] : undefined;

  // Member grouping for Server Right Sidebar (Screenshots 153 / 157 / 171)
  const memberUids = useMemo(() => {
    if (nav === 'server' && activeServer) {
      return serverMembers.map((m) => m.userId);
    }
    if (nav === 'dms' && activeConversation) {
      return activeConversation.participantIds;
    }
    return Array.from(friendUidSet);
  }, [activeConversation, activeServer, friendUidSet, nav, serverMembers]);

  const filteredMemberUids = useMemo(
    () =>
      memberUids.filter((uid) => {
        const u = userCache[uid];
        if (!memberSearch.trim()) return true;
        const q = memberSearch.toLowerCase();
        return (
          (u?.displayName || '').toLowerCase().includes(q) ||
          (u?.username || '').toLowerCase().includes(q)
        );
      }),
    [memberSearch, memberUids, userCache]
  );

  const isUidOnline = (uid: string) => {
    const status = userCache[uid]?.onlineStatus;
    if (status === 'offline') return false;
    return uid === firebaseUser?.uid || onlineUids.has(uid) || Boolean(status);
  };

  const onlineMemberUids = useMemo(
    () => filteredMemberUids.filter((uid) => isUidOnline(uid)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredMemberUids, firebaseUser?.uid, onlineUids, userCache]
  );
  const offlineMemberUids = useMemo(
    () => filteredMemberUids.filter((uid) => !isUidOnline(uid)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredMemberUids, firebaseUser?.uid, onlineUids, userCache]
  );

  // Group online server members by highest custom role, then general Online
  const onlineRoleBuckets = useMemo(() => {
    if (nav !== 'server') {
      return [{ id: '_online', label: 'Online', color: undefined as string | undefined, uids: onlineMemberUids }];
    }
    const buckets: Array<{ id: string; label: string; color?: string; uids: string[] }> = [];
    const roleMap = new Map<string, string[]>();
    const unroled: string[] = [];

    for (const uid of onlineMemberUids) {
      const mem = serverMembers.find((m) => m.userId === uid);
      const topRole = mem?.roleIds?.length
        ? serverRoles.find((r) => mem.roleIds?.includes(r.id))
        : undefined;
      if (topRole) {
        const arr = roleMap.get(topRole.id) || [];
        arr.push(uid);
        roleMap.set(topRole.id, arr);
      } else {
        unroled.push(uid);
      }
    }

    for (const role of serverRoles) {
      const uids = roleMap.get(role.id);
      if (uids && uids.length > 0) {
        buckets.push({ id: role.id, label: role.name, color: role.color, uids });
      }
    }
    if (unroled.length > 0) {
      buckets.push({ id: '_online', label: 'Online', uids: unroled });
    }
    return buckets;
  }, [nav, onlineMemberUids, serverMembers, serverRoles]);

  const isAfterDarkActive =
    nav === 'afterdark' || (nav === 'server' && Boolean(activeServer?.isAfterDark));

  const openManageServer = (
    tab: 'overview' | 'channels' | 'roles' | 'invites' | 'members' | 'audit',
    channelId: string | null = null
  ) => {
    setServerMenuOpen(false);
    setManageInitialTab(tab);
    setManageEditChannelId(channelId);
    setShowManageServer(true);
  };

  const toggleRightDrawerResponsive = () => {
    if (window.innerWidth >= 1024) {
      setShowRightPanel((s) => !s);
    } else {
      setMobileRightOpen((s) => !s);
    }
  };

  /* -------------------- Shared Server Rail Buttons -------------------- */
  const renderServerRailItems = (isMobile = false) => (
    <>
      {/* Home / Direct Messages Orb */}
      <div className="relative group flex items-center justify-center w-full">
        <span
          className={`absolute left-0 w-1 rounded-r-full bg-white transition-all ${
            nav === 'home' || nav === 'dms' || nav === 'friends'
              ? 'h-9 opacity-100'
              : 'h-4 opacity-0 group-hover:opacity-100'
          }`}
        />
        <button
          type="button"
          onClick={() => {
            setNav(nav === 'dms' ? 'home' : activeConversationId ? 'dms' : 'home');
            if (isMobile) setMobileDrawerOpen(false);
          }}
          title="Home & Direct Messages"
          className={`w-12 h-12 flex items-center justify-center transition-all duration-200 overflow-hidden ${
            nav === 'home' || nav === 'dms' || nav === 'friends'
              ? 'rounded-[16px] bg-[#5865f2] text-white shadow-lg shadow-indigo-950/50'
              : 'rounded-[24px] hover:rounded-[16px] bg-white dark:bg-[#222328] text-zinc-500 dark:text-zinc-200 hover:bg-[#5865f2] hover:text-white'
          }`}
        >
          <img
            src={ASSET_IMAGES.brandEmblem}
            alt="ShadowSpace"
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-lg object-cover"
          />
        </button>
      </div>

      {/* Pending Friend Requests Orb Badge */}
      {pendingReqCount > 0 && (
        <div className="relative group flex items-center justify-center w-full">
          <span
            className={`absolute left-0 w-1 rounded-r-full bg-white transition-all ${
              nav === 'friends' ? 'h-9 opacity-100' : 'h-4 opacity-0 group-hover:opacity-100'
            }`}
          />
          <button
            type="button"
            onClick={() => {
              setNav('friends');
              if (isMobile) setMobileDrawerOpen(false);
            }}
            title="Pending Friend Requests"
            className={`relative w-12 h-12 flex items-center justify-center transition-all duration-200 ${
              nav === 'friends'
                ? 'rounded-[16px] bg-violet-600 text-white'
                : 'rounded-[24px] hover:rounded-[16px] bg-white dark:bg-[#222328] text-zinc-300 hover:bg-violet-600 hover:text-white'
            }`}
          >
            <Users className="w-5 h-5" />
            <span className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 border-2 border-[#111214] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
              {pendingReqCount}
            </span>
          </button>
        </div>
      )}

      <div className="w-8 h-[2px] rounded-full bg-zinc-300 dark:bg-white/[0.08] my-1 shrink-0" />

      {/* Joined Server Icons */}
      <div className="flex flex-col items-center gap-2 w-full">
        {joinedServers.map((srv) => {
          const active = nav === 'server' && activeServerId === srv.id;
          return (
            <div key={srv.id} className="relative group flex items-center justify-center w-full">
              <span
                className={`absolute left-0 w-1 rounded-r-full bg-white transition-all ${
                  active ? 'h-10 opacity-100' : 'h-5 opacity-0 group-hover:opacity-100'
                }`}
              />
              <button
                type="button"
                onClick={() => openServer(srv.id)}
                title={srv.name}
                style={
                  active && srv.accentColor
                    ? { boxShadow: `0 0 0 2px ${srv.accentColor}` }
                    : undefined
                }
                className={`w-12 h-12 overflow-hidden transition-all duration-200 shrink-0 flex items-center justify-center ${
                  active
                    ? 'rounded-[16px] bg-violet-600 text-white'
                    : 'rounded-[24px] hover:rounded-[16px] bg-white dark:bg-[#222328] text-zinc-200 hover:bg-violet-600'
                }`}
              >
                {srv.iconUrl ? (
                  <img
                    src={srv.iconUrl}
                    alt={srv.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-bold">{getInitials(srv.name)}</span>
                )}
              </button>
            </div>
          );
        })}

        {/* Add a Server (+) */}
        <div className="relative group flex items-center justify-center w-full">
          <button
            type="button"
            onClick={() => {
              setShowCreateServer(true);
              if (isMobile) setMobileDrawerOpen(false);
            }}
            title="Add a Server"
            className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-white dark:bg-[#222328] text-emerald-400 hover:bg-emerald-600 hover:text-white flex items-center justify-center transition-all duration-200 shrink-0"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Discover Communities */}
        <div className="relative group flex items-center justify-center w-full">
          <span
            className={`absolute left-0 w-1 rounded-r-full bg-white transition-all ${
              nav === 'discover' ? 'h-9 opacity-100' : 'h-4 opacity-0 group-hover:opacity-100'
            }`}
          />
          <button
            type="button"
            onClick={() => {
              setNav('discover');
              if (isMobile) setMobileDrawerOpen(false);
            }}
            title="Discover Communities"
            className={`w-12 h-12 flex items-center justify-center transition-all duration-200 shrink-0 ${
              nav === 'discover'
                ? 'rounded-[16px] bg-emerald-600 text-white'
                : 'rounded-[24px] hover:rounded-[16px] bg-white dark:bg-[#222328] text-emerald-400 hover:bg-emerald-600 hover:text-white'
            }`}
          >
            <Compass className="w-5 h-5" />
          </button>
        </div>

        {/* After Dark Lounge */}
        <div className="relative group flex items-center justify-center w-full">
          <span
            className={`absolute left-0 w-1 rounded-r-full bg-rose-400 transition-all ${
              nav === 'afterdark' ? 'h-9 opacity-100' : 'h-4 opacity-0 group-hover:opacity-100'
            }`}
          />
          <button
            type="button"
            onClick={() => {
              setNav('afterdark');
              if (isMobile) setMobileDrawerOpen(false);
            }}
            title="After Dark Lounge"
            className={`w-12 h-12 flex items-center justify-center transition-all duration-200 shrink-0 ${
              nav === 'afterdark'
                ? 'rounded-[16px] bg-rose-600 text-white shadow-lg shadow-rose-950/50'
                : 'rounded-[24px] hover:rounded-[16px] bg-white dark:bg-[#222328] text-rose-400 hover:bg-rose-600 hover:text-white'
            }`}
          >
            <Flame className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1" />

      {/* Bottom Rail Utilities */}
      <button
        type="button"
        onClick={() => {
          setShowGlobalSearch(true);
          if (isMobile) setMobileDrawerOpen(false);
        }}
        title="Quick Switcher / Search (Ctrl+K)"
        className="w-11 h-11 rounded-[22px] hover:rounded-[14px] bg-white dark:bg-[#222328] text-zinc-400 hover:text-white hover:bg-white/[0.1] flex items-center justify-center transition-all shrink-0"
      >
        <Search className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => {
          setShowNotifications(true);
          if (isMobile) setMobileDrawerOpen(false);
        }}
        title="Inbox & Notifications"
        className="relative w-11 h-11 rounded-[22px] hover:rounded-[14px] bg-white dark:bg-[#222328] text-zinc-400 hover:text-white hover:bg-white/[0.1] flex items-center justify-center transition-all shrink-0"
      >
        <Bell className="w-4 h-4" />
        {unreadNotifCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 border-2 border-[#111214] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
            {unreadNotifCount}
          </span>
        )}
      </button>

      {isPlatformAdmin && (
        <button
          type="button"
          onClick={() => {
            setNav('admin');
            if (isMobile) setMobileDrawerOpen(false);
          }}
          title="Platform Administration"
          className={`w-11 h-11 rounded-[22px] hover:rounded-[14px] flex items-center justify-center transition-all shrink-0 ${
            nav === 'admin'
              ? 'rounded-[14px] bg-amber-600 text-white'
              : 'bg-white dark:bg-[#222328] text-amber-400 hover:bg-amber-600 hover:text-white'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
        </button>
      )}
    </>
  );

  /* -------------------- Shared Right Sidebar Content (Members or DM Profile) -------------------- */
  const renderRightSidebarContent = (isDrawer = false) => {
    // 1. DM 1-on-1 User Profile Side Panel (Screenshot 172)
    if (nav === 'dms' && activeConversation && !activeConversation.isGroup && dmOtherUid) {
      const target = dmOtherUser;
      const dot = statusDotClass(target?.onlineStatus, onlineUids.has(dmOtherUid));
      return (
        <div className="flex-1 flex flex-col overflow-y-auto bg-zinc-50 dark:bg-[#17181c]">
          {isDrawer && (
            <div className="h-12 px-4 border-b border-white/[0.07] flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold">Profile</span>
              <button
                type="button"
                onClick={() => setMobileRightOpen(false)}
                className="p-1.5 rounded text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Banner */}
          <div
            className="h-24 w-full relative overflow-hidden shrink-0"
            style={{
              backgroundColor: target?.accentColor || '#5865f2',
            }}
          >
            {target?.bannerUrl && (
              <img
                src={target.bannerUrl}
                alt="Profile banner"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            )}
          </div>

          {/* Avatar overlapping banner bottom-left */}
          <div className="px-4 relative z-10 flex items-end justify-between -mt-10 mb-3">
            <div className="relative w-20 h-20 rounded-full border-[5px] border-zinc-50 dark:border-[#17181c] bg-[#222328] shrink-0">
              {target?.avatarUrl ? (
                <img
                  src={target.avatarUrl}
                  alt={target.displayName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <span className="w-full h-full rounded-full flex items-center justify-center text-lg font-bold text-zinc-200">
                  {getInitials(target?.displayName || 'User')}
                </span>
              )}
              <span
                className={`absolute bottom-0 right-0 w-5 h-5 rounded-full border-[3.5px] border-zinc-50 dark:border-[#17181c] ${dot}`}
              />
            </div>

            {target?.badges && target.badges.length > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[10px] font-semibold text-amber-300 mb-1">
                {target.badges[0]}
              </span>
            )}
          </div>

          <div className="px-3.5 pb-4 space-y-3">
            {/* Identity Header */}
            <div className="px-1">
              <h3 className="font-display font-bold text-lg leading-tight truncate">
                {target?.displayName || 'ShadowSpace Member'}
              </h3>
              <p className="text-xs text-zinc-400 truncate mt-0.5">
                @{target?.username || 'member'}
                {target?.pronouns ? ` · ${target.pronouns}` : ''}
              </p>
              {target?.statusMessage && (
                <p className="text-xs text-zinc-300 mt-2 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
                  {target.statusMessage}
                </p>
              )}
            </div>

            {/* About Me & Details Card */}
            <div className="rounded-xl bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.06] p-3.5 space-y-3 text-xs">
              {target?.bio && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    About Me
                  </p>
                  <p className="text-zinc-200 leading-relaxed whitespace-pre-wrap">
                    {target.bio}
                  </p>
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Member Since
                </p>
                <p className="text-zinc-300">
                  {formatDateSeparator(target?.createdAt)}
                </p>
              </div>

              {(target?.location || target?.website || target?.discordUsername) && (
                <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                  {target.location && (
                    <div className="flex items-center gap-1.5 text-zinc-300">
                      <MapPin className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">{target.location}</span>
                    </div>
                  )}
                  {target.website && (
                    <a
                      href={target.website}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-sky-400 hover:underline"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{target.website}</span>
                    </a>
                  )}
                  {target.discordUsername && (
                    <div className="flex items-center gap-1.5 text-indigo-300">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Discord: {target.discordUsername}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setMobileRightOpen(false);
                setProfileModalEdit(false);
                setProfileModalUid(dmOtherUid);
              }}
              className="w-full h-9 rounded-lg bg-zinc-200 dark:bg-[#26282e] hover:bg-zinc-300 dark:hover:bg-[#31333c] text-xs font-semibold text-zinc-900 dark:text-zinc-100 transition-colors"
            >
              View Full Profile
            </button>
          </div>
        </div>
      );
    }

    // 2. Server Members / Group DM List (Screenshots 153 / 157 / 171)
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-zinc-50 dark:bg-[#17181c]">
        <div className="h-12 px-3 border-b border-zinc-200 dark:border-white/[0.07] flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members"
              className="w-full h-7 pl-8 pr-2 rounded-md bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.06] text-xs focus:outline-none focus:border-white/20"
            />
          </div>
          {isDrawer && (
            <button
              type="button"
              onClick={() => setMobileRightOpen(false)}
              className="p-1.5 rounded text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {onlineRoleBuckets.map((bucket) => (
            <div key={bucket.id} className="space-y-0.5">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 truncate">
                {bucket.label} — {bucket.uids.length}
              </p>
              {bucket.uids.map((uid) => {
                const u = userCache[uid];
                const name =
                  u?.displayName ||
                  (uid === firebaseUser?.uid ? profile?.displayName : uid.slice(0, 8)) ||
                  'Member';
                const isOwner = nav === 'server' && activeServer?.ownerId === uid;
                const dot = statusDotClass(u?.onlineStatus, uid === firebaseUser?.uid || onlineUids.has(uid));

                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => {
                      setMobileRightOpen(false);
                      setProfileModalEdit(false);
                      setProfileModalUid(uid);
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-200/70 dark:hover:bg-white/[0.05] text-left transition-colors"
                  >
                    <div className="relative w-8 h-8 rounded-full bg-[#26282e] shrink-0">
                      <img
                        src={u?.avatarUrl || ASSET_IMAGES.obsidianAvatar}
                        alt={name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full rounded-full object-cover"
                      />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-50 dark:border-[#17181c] ${dot}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p
                          className="text-sm font-medium truncate"
                          style={bucket.color ? { color: bucket.color } : undefined}
                        >
                          {name}
                        </p>
                        {isOwner && (
                          <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                      </div>
                      {u?.statusMessage && (
                        <p className="text-[11px] text-zinc-400 truncate">{u.statusMessage}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}

          {offlineMemberUids.length > 0 && (
            <div className="space-y-0.5">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Offline — {offlineMemberUids.length}
              </p>
              {offlineMemberUids.map((uid) => {
                const u = userCache[uid];
                const name = u?.displayName || uid.slice(0, 8);
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => {
                      setMobileRightOpen(false);
                      setProfileModalEdit(false);
                      setProfileModalUid(uid);
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md opacity-45 hover:opacity-100 hover:bg-zinc-200/70 dark:hover:bg-white/[0.05] text-left transition-all"
                  >
                    <div className="relative w-8 h-8 rounded-full bg-[#26282e] shrink-0">
                      <img
                        src={u?.avatarUrl || ASSET_IMAGES.obsidianAvatar}
                        alt={name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full rounded-full object-cover"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-50 dark:border-[#17181c] bg-zinc-500" />
                    </div>
                    <p className="text-sm truncate">{name}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* -------------------- Channel / DM List Content -------------------- */
  const renderSecondSidebarContent = () => (
    <div
      className={`flex-1 min-w-0 flex flex-col border-r border-zinc-200 dark:border-white/[0.07] ${
        isAfterDarkActive ? 'bg-[#120f17]' : 'bg-zinc-50 dark:bg-[#17181c]'
      }`}
    >
      {/* Top 48px Header */}
      {nav === 'server' && activeServer ? (
        <div
          className="h-12 px-3.5 border-b border-zinc-200 dark:border-white/[0.07] flex items-center justify-between gap-2 shrink-0 relative"
          style={
            activeServer.accentColor
              ? { borderBottomColor: `${activeServer.accentColor}44` }
              : undefined
          }
        >
          <button
            type="button"
            onClick={() => setServerMenuOpen((s) => !s)}
            className="flex-1 flex items-center justify-between gap-2 text-left font-semibold text-[15px] hover:text-white transition-colors min-w-0 py-1.5 px-1 rounded-md hover:bg-white/[0.04]"
          >
            <span className="truncate">{activeServer.name}</span>
            {serverMenuOpen ? (
              <X className="w-4 h-4 text-zinc-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowLeftPanel(false)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="hidden md:inline-flex p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] shrink-0"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>

          {/* Server Dropdown Menu (Screenshot 159) */}
          {serverMenuOpen && (
            <div className="absolute left-2.5 right-2.5 top-13 z-40 rounded-lg bg-[#111214] border border-white/[0.08] shadow-2xl p-1.5 space-y-0.5 text-[13px] font-medium">
              <button
                type="button"
                onClick={() => openManageServer('invites')}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[#949cf7] hover:bg-[#5865f2] hover:text-white transition-colors"
              >
                <span>Invite People</span>
                <UserPlus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => openManageServer('overview')}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-zinc-200 hover:bg-[#5865f2] hover:text-white transition-colors"
              >
                <span>Server Settings</span>
                <Settings className="w-4 h-4" />
              </button>

              {myPermissions.manageChannels && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setServerMenuOpen(false);
                      setQuickCreateChannelCatId('');
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-zinc-200 hover:bg-[#5865f2] hover:text-white transition-colors"
                  >
                    <span>Create Channel</span>
                    <Plus className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setServerMenuOpen(false);
                      setQuickCreateCategoryOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-zinc-200 hover:bg-[#5865f2] hover:text-white transition-colors"
                  >
                    <span>Create Category</span>
                    <FolderPlus className="w-4 h-4" />
                  </button>
                </>
              )}

              <div className="h-px bg-white/[0.08] my-1" />

              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(activeServer.id);
                  setCopiedServerId(true);
                  setTimeout(() => setCopiedServerId(false), 1500);
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-zinc-300 hover:bg-white/[0.08] transition-colors"
              >
                <span>{copiedServerId ? 'Copied Server ID' : 'Copy Server ID'}</span>
                {copiedServerId ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => openManageServer('overview')}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md text-rose-400 hover:bg-rose-600 hover:text-white transition-colors"
              >
                <span>{isServerOwner ? 'Delete / Manage Server' : 'Leave Server'}</span>
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="h-12 px-2.5 border-b border-zinc-200 dark:border-white/[0.07] flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowGlobalSearch(true)}
            className="flex-1 h-7 px-2.5 rounded-md bg-zinc-200/70 dark:bg-[#111214] text-left text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-200 truncate transition-colors"
          >
            Find or start a conversation
          </button>
          <button
            type="button"
            onClick={() => setShowLeftPanel(false)}
            aria-label="Collapse sidebar"
            className="hidden md:inline-flex p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] shrink-0"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Channel List / DM List Scroll Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2.5 space-y-3">
        {nav === 'server' && activeServer ? (
          <>
            {/* Quick Channels & Roles Directory Link (Screenshot 153) */}
            <button
              type="button"
              onClick={() => openManageServer('channels')}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="truncate">Channels & Roles</span>
            </button>

            <div className="h-px bg-white/[0.06] mx-1" />

            <div className="space-y-3">
              {(() => {
                const catGroups: Array<{
                  id: string;
                  name: string;
                  isRealCategory: boolean;
                  items: Channel[];
                }> = categories.map((cat) => ({
                  id: cat.id,
                  name: cat.name,
                  isRealCategory: true,
                  items: channels.filter((c) => c.categoryId === cat.id),
                }));
                const catIdSet = new Set(categories.map((c) => c.id));
                const uncategorized = channels.filter(
                  (c) => !c.categoryId || !catIdSet.has(c.categoryId)
                );
                if (uncategorized.length > 0 || catGroups.length === 0) {
                  catGroups.unshift({
                    id: '_uncategorized',
                    name: catGroups.length > 0 ? 'General' : 'Text & Voice',
                    isRealCategory: false,
                    items: uncategorized,
                  });
                }

                return catGroups
                  .filter((g) => g.items.length > 0 || g.isRealCategory)
                  .map((group) => {
                    const isCollapsed = Boolean(collapsedCategories[group.id]);
                    return (
                      <div key={group.id} className="space-y-0.5">
                        <div className="flex items-center justify-between px-1 group">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedCategories((prev) => ({
                                ...prev,
                                [group.id]: !prev[group.id],
                              }))
                            }
                            className="flex items-center gap-1 min-w-0 flex-1 text-left py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-3 h-3 shrink-0" />
                            ) : (
                              <ChevronDown className="w-3 h-3 shrink-0" />
                            )}
                            <span className="truncate">{group.name}</span>
                          </button>

                          {myPermissions.manageChannels && (
                            <button
                              type="button"
                              title={`Create channel in ${group.name}`}
                              onClick={() =>
                                setQuickCreateChannelCatId(
                                  group.isRealCategory ? group.id : ''
                                )
                              }
                              className="p-0.5 rounded text-zinc-400 hover:text-white opacity-70 hover:opacity-100"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {!isCollapsed &&
                          group.items.map((ch) => {
                            const isVoice = ch.type === 'voice';
                            const isSelected = activeChannelId === ch.id;
                            const isInThisVoice = voice.activeVoice?.channel.id === ch.id;
                            const peers = voice.allVoiceParticipants[ch.id] || [];

                            return (
                              <div key={ch.id} className="space-y-0.5">
                                <div
                                  className={`group flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors ${
                                    isSelected || isInThisVoice
                                      ? isAfterDarkActive
                                        ? 'bg-rose-500/20 text-rose-100'
                                        : 'bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-900 dark:text-white'
                                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-zinc-200'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isVoice) {
                                        void voice.joinChannel(ch, activeServer.name);
                                      } else {
                                        setActiveChannelId(ch.id);
                                        setMobileDrawerOpen(false);
                                      }
                                    }}
                                    className="flex-1 min-w-0 flex items-center gap-2 text-left text-[14px] font-medium"
                                  >
                                    {isVoice ? (
                                      <Volume2 className="w-4 h-4 text-zinc-400 shrink-0" />
                                    ) : ch.type === 'announcement' ? (
                                      <Megaphone className="w-4 h-4 text-amber-400 shrink-0" />
                                    ) : ch.isPrivate ? (
                                      <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                                    ) : (
                                      <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
                                    )}
                                    <span className="truncate">{ch.name}</span>
                                  </button>

                                  {/* Hover actions: Invite + Edit Channel (Screenshot 153 / 166) */}
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                                    <button
                                      type="button"
                                      title="Create Invite"
                                      onClick={() => openManageServer('invites')}
                                      className="p-1 rounded text-zinc-400 hover:text-white"
                                    >
                                      <UserPlus className="w-3.5 h-3.5" />
                                    </button>
                                    {myPermissions.manageChannels && (
                                      <button
                                        type="button"
                                        title={`Edit #${ch.name}`}
                                        onClick={() => openManageServer('channels', ch.id)}
                                        className="p-1 rounded text-zinc-400 hover:text-white"
                                      >
                                        <Settings className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {isVoice && peers.length > 0 && (
                                  <div className="pl-6 py-0.5 space-y-1">
                                    {peers.map((p) => {
                                      const peerUser = userCache[p.uid];
                                      return (
                                        <div
                                          key={p.uid}
                                          className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-white/[0.04] text-xs"
                                        >
                                          <div className="flex items-center gap-2 min-w-0">
                                            <img
                                              src={
                                                peerUser?.avatarUrl ||
                                                ASSET_IMAGES.obsidianAvatar
                                              }
                                              alt={p.displayName}
                                              referrerPolicy="no-referrer"
                                              className={`w-5 h-5 rounded-full object-cover shrink-0 ${
                                                p.speaking
                                                  ? 'ring-2 ring-emerald-400'
                                                  : ''
                                              }`}
                                            />
                                            <span
                                              className={`truncate ${
                                                p.speaking
                                                  ? 'text-emerald-300 font-semibold'
                                                  : 'text-zinc-300'
                                              }`}
                                            >
                                              {p.displayName}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1 text-zinc-500 shrink-0">
                                            {p.muted && <MicOff className="w-3 h-3 text-rose-400" />}
                                            {p.deafened && <HeadphoneOff className="w-3 h-3 text-rose-400" />}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  });
              })()}
            </div>
          </>
        ) : (
          <>
            {/* Discord Home / Friends / Discover / After Dark Quick Navigation */}
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setNav('home');
                  setMobileDrawerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                  nav === 'home'
                    ? 'bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-900 dark:text-white'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <Home className="w-4 h-4 shrink-0" />
                <span>Home</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNav('friends');
                  setMobileDrawerOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                  nav === 'friends'
                    ? 'bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-900 dark:text-white'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Friends</span>
                </span>
                {pendingReqCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold tabular-nums">
                    {pendingReqCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setNav('discover');
                  setMobileDrawerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                  nav === 'discover'
                    ? 'bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-900 dark:text-white'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <Compass className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Discover</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNav('afterdark');
                  setMobileDrawerOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                  nav === 'afterdark'
                    ? 'bg-rose-600/20 text-rose-200'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-white/[0.04] hover:text-rose-300'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Flame className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>After Dark</span>
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                  18+
                </span>
              </button>
            </div>

            <div className="h-px bg-white/[0.06] mx-1" />

            {/* Direct Messages List */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Direct Messages
                </span>
                <button
                  type="button"
                  title="New Direct Message"
                  onClick={() => {
                    setNav('friends');
                    setMobileDrawerOpen(false);
                  }}
                  className="text-zinc-400 hover:text-white p-0.5 rounded"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {sortedConversations.length === 0 ? (
                <p className="text-xs text-zinc-500 px-2 py-2 leading-relaxed">
                  No conversations yet. Add a friend to message directly.
                </p>
              ) : (
                sortedConversations.map((conv) => {
                  const otherUid = conv.participantIds.find((id) => id !== firebaseUser?.uid);
                  const other = otherUid ? userCache[otherUid] : undefined;
                  const label = conv.isGroup
                    ? conv.name || 'Group Chat'
                    : other?.displayName || 'Direct Message';
                  const dot = statusDotClass(
                    other?.onlineStatus,
                    Boolean(otherUid && onlineUids.has(otherUid))
                  );
                  const timeLabel = formatTimeShort(conv.lastMessageAt || conv.updatedAt);
                  const active = nav === 'dms' && activeConversationId === conv.id;

                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => {
                        setActiveConversationId(conv.id);
                        setNav('dms');
                        setMobileDrawerOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors ${
                        active
                          ? 'bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-900 dark:text-white'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      <div className="relative w-8 h-8 rounded-full bg-[#26282e] shrink-0 flex items-center justify-center text-xs font-semibold">
                        {!conv.isGroup && other?.avatarUrl ? (
                          <img
                            src={other.avatarUrl}
                            alt={label}
                            referrerPolicy="no-referrer"
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          getInitials(label)
                        )}
                        {!conv.isGroup && otherUid && (
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#17181c] ${dot}`}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <p className="text-[13px] font-medium truncate">{label}</p>
                          {timeLabel && (
                            <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
                              {timeLabel}
                            </span>
                          )}
                        </div>
                        {conv.lastMessageText && (
                          <p className="text-[11px] text-zinc-500 truncate">
                            {conv.lastMessageText}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Voice Connection Dock */}
      <VoiceBar
        activeVoice={voice.activeVoice}
        connectionStatus={voice.connectionStatus}
        errorMsg={voice.errorMsg}
        muted={voice.muted}
        deafened={voice.deafened}
        speaking={voice.speaking}
        participants={voice.participants}
        onToggleMute={voice.toggleMute}
        onToggleDeafen={voice.toggleDeafen}
        onLeave={() => void voice.leaveChannel()}
      />

      {/* Bottom User Dock + Mini-Profile & Status Switcher Popover (Screenshot 156) */}
      <div className="relative p-2 border-t border-zinc-200 dark:border-white/[0.06] flex items-center justify-between gap-1 bg-zinc-100 dark:bg-[#131418] shrink-0">
        {userPopoverOpen && profile && firebaseUser && (
          <div className="absolute bottom-14 left-2 z-50 w-[290px] rounded-xl bg-[#222328] border border-white/[0.08] shadow-2xl overflow-hidden text-zinc-100">
            {/* Banner */}
            <div
              className="h-16 w-full relative overflow-hidden"
              style={{ backgroundColor: profile.accentColor || '#5865f2' }}
            >
              {profile.bannerUrl && (
                <img
                  src={profile.bannerUrl}
                  alt="My banner"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            {/* Overlapping Circular Avatar */}
            <div className="px-3.5 relative z-10 flex items-end justify-between -mt-8 mb-2">
              <div className="relative w-16 h-16 rounded-full border-[4px] border-[#222328] bg-[#17181c] shrink-0">
                <img
                  src={profile.avatarUrl || ASSET_IMAGES.obsidianAvatar}
                  alt={profile.displayName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-cover"
                />
                <span
                  className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-[3px] border-[#222328] ${statusDotClass(
                    profile.onlineStatus,
                    true
                  )}`}
                />
              </div>
              {profile.statusMessage && (
                <span className="text-[11px] text-zinc-200 bg-[#17181c] border border-white/[0.08] rounded-lg px-2 py-1 max-w-[170px] truncate mb-1">
                  {profile.statusMessage}
                </span>
              )}
            </div>

            <div className="px-3.5 pb-3.5 space-y-2.5">
              <div>
                <p className="font-display font-bold text-base leading-tight truncate">
                  {profile.displayName}
                </p>
                <p className="text-xs text-zinc-400 truncate">
                  @{profile.username}
                  {profile.pronouns ? ` · ${profile.pronouns}` : ''}
                </p>
              </div>

              <div className="rounded-lg bg-[#17181c] border border-white/[0.06] p-1 space-y-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setUserPopoverOpen(false);
                    setProfileModalEdit(true);
                    setProfileModalUid(firebaseUser.uid);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-white/[0.06] text-zinc-200 font-medium"
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                    Edit Profile
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                </button>

                <div className="h-px bg-white/[0.06] my-1" />

                <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Online Status
                </p>
                <div className="grid grid-cols-2 gap-1 px-1 pb-1">
                  {(
                    [
                      { id: 'online', label: 'Online', dot: 'bg-emerald-500' },
                      { id: 'idle', label: 'Idle', dot: 'bg-amber-400' },
                      { id: 'dnd', label: 'DND', dot: 'bg-rose-500' },
                      { id: 'offline', label: 'Invisible', dot: 'bg-zinc-500' },
                    ] as const
                  ).map((st) => {
                    const activeSt = (profile.onlineStatus || 'online') === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        disabled={statusUpdating}
                        onClick={() => void handleSetMyStatus(st.id)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                          activeSt
                            ? 'bg-[#5865f2]/20 text-white font-semibold'
                            : 'text-zinc-300 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                        <span className="truncate">{st.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="h-px bg-white/[0.06] my-1" />

                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(firebaseUser.uid);
                    setCopiedUserId(true);
                    setTimeout(() => setCopiedUserId(false), 1500);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-white/[0.06] text-zinc-300"
                >
                  <span className="flex items-center gap-2">
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    {copiedUserId ? 'User ID Copied!' : 'Copy User ID'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setUserPopoverOpen((s) => !s)}
          className="flex-1 flex items-center gap-2 min-w-0 p-1 rounded-md hover:bg-white/[0.06] text-left transition-colors"
        >
          <div className="relative w-8 h-8 rounded-full bg-[#26282e] shrink-0">
            <img
              src={profile?.avatarUrl || ASSET_IMAGES.obsidianAvatar}
              alt={profile?.displayName || 'User'}
              referrerPolicy="no-referrer"
              className="w-full h-full rounded-full object-cover"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#131418] ${statusDotClass(
                profile?.onlineStatus,
                true
              )}`}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate leading-tight">
              {profile?.displayName || 'Member'}
            </p>
            <p className="text-[11px] text-zinc-400 truncate leading-tight">
              {profile?.statusMessage || statusLabel(profile?.onlineStatus)}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (voice.activeVoice) voice.toggleMute();
              else setShowSettings(true);
            }}
            aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
            title={voice.activeVoice ? (voice.muted ? 'Unmute' : 'Mute') : 'Voice & Audio Settings'}
            className={`p-1.5 rounded-md transition-colors ${
              voice.muted
                ? 'text-rose-400 hover:bg-rose-500/15'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08]'
            }`}
          >
            {voice.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => {
              if (voice.activeVoice) voice.toggleDeafen();
              else setShowSettings(true);
            }}
            aria-label={voice.deafened ? 'Undeafen audio' : 'Deafen audio'}
            title={voice.activeVoice ? (voice.deafened ? 'Undeafen' : 'Deafen') : 'Voice & Audio Settings'}
            className={`p-1.5 rounded-md transition-colors ${
              voice.deafened
                ? 'text-rose-400 hover:bg-rose-500/15'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08]'
            }`}
          >
            {voice.deafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Open User Settings"
            title="User Settings"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  const mobilePageTitle =
    nav === 'home'
      ? 'ShadowSpace'
      : nav === 'friends'
        ? 'Friends'
        : nav === 'discover'
          ? 'Discover'
          : nav === 'afterdark'
            ? 'After Dark'
            : nav === 'admin'
              ? 'Platform Admin'
              : nav === 'server'
                ? activeServer?.name || 'Server'
                : 'Direct Messages';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-[#1b1c21] text-zinc-900 dark:text-[#f2f3f5]">
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* 1. LEFT SERVER RAIL (Desktop) */}
        <nav
          aria-label="Servers and destinations"
          className="hidden md:flex w-[72px] flex-col items-center py-3 gap-2 bg-zinc-200/80 dark:bg-[#111214] border-r border-zinc-200 dark:border-white/[0.05] shrink-0 overflow-y-auto no-scrollbar"
        >
          {renderServerRailItems(false)}
        </nav>

        {/* 2. DESKTOP CHANNEL / DM SIDEBAR */}
        {showLeftPanel && (
          <aside className="hidden md:flex w-60 shrink-0 min-h-0">
            {renderSecondSidebarContent()}
          </aside>
        )}

        {/* MOBILE COMBINED NAVIGATION DRAWER (Server Rail + Channel/DM Sidebar) */}
        {mobileDrawerOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div
              className="fixed inset-0 bg-black/65"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <div className="relative z-10 flex h-full w-[312px] max-w-[88vw] shadow-2xl">
              <div className="w-[68px] bg-[#111214] py-3 flex flex-col items-center gap-2 overflow-y-auto no-scrollbar border-r border-white/[0.06] shrink-0">
                {renderServerRailItems(true)}
              </div>
              <div className="flex-1 flex min-w-0 h-full">
                {renderSecondSidebarContent()}
              </div>
            </div>
          </div>
        )}

        {/* 3. MAIN CONTENT VIEWPORT */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-white dark:bg-[#1b1c21]">
          {!showLeftPanel && (
            <div className="hidden md:flex items-center justify-between px-3 h-10 border-b border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#17181c] shrink-0">
              <button
                type="button"
                onClick={() => setShowLeftPanel(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-100"
              >
                <PanelLeftOpen className="w-4 h-4" /> Show Sidebar
              </button>
            </div>
          )}

          {/* Compact mobile header when view doesn't render ChatArea's own header */}
          {!(nav === 'server' && activeChannel) && !(nav === 'dms' && activeConversation) && (
            <div className="md:hidden h-12 px-3 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(true)}
                  aria-label="Open navigation"
                  className="p-1.5 -ml-1 rounded-md text-zinc-400 hover:text-white"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <span className="font-semibold text-sm truncate">{mobilePageTitle}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowNotifications(true)}
                aria-label="Notifications"
                className="relative p-1.5 rounded-md text-zinc-400 hover:text-white"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                )}
              </button>
            </div>
          )}

          {nav === 'home' && (
            <div className="flex-1 overflow-y-auto p-5 sm:p-8 bg-white dark:bg-[#1b1c21]">
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-display font-bold tracking-tight">
                      Welcome back, {profile?.displayName}
                    </h1>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Your Space. Your Identity. Your Community.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowGlobalSearch(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-200/70 dark:bg-[#222328] border border-white/[0.06] text-xs font-medium hover:bg-[#26282e]"
                    >
                      <Search className="w-3.5 h-3.5" /> Quick Switcher
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateServer(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" /> Create Server
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <button
                    type="button"
                    onClick={() => setNav('discover')}
                    className="p-5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#222328] text-left hover:border-emerald-500/50 transition-colors"
                  >
                    <Compass className="w-5 h-5 text-emerald-400 mb-2.5" />
                    <h2 className="font-display font-semibold text-sm">Discover Communities</h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Browse public servers or join via invitation code.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNav('friends')}
                    className="p-5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#222328] text-left hover:border-[#5865f2]/60 transition-colors"
                  >
                    <Users className="w-5 h-5 text-[#949cf7] mb-2.5" />
                    <h2 className="font-display font-semibold text-sm">Friends & DMs</h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      {friendships.length} friends · {pendingReqCount} pending requests
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNav('afterdark')}
                    className="p-5 rounded-xl border border-rose-500/20 bg-[#19131c] text-left hover:border-rose-500/50 transition-colors"
                  >
                    <Flame className="w-5 h-5 text-rose-400 mb-2.5" />
                    <h2 className="font-display font-semibold text-sm text-white">After Dark</h2>
                    <p className="text-xs text-zinc-400 mt-1">
                      Consent-gated 18+ lounge with custom styling.
                    </p>
                  </button>
                </div>

                <div className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Your Communities ({joinedServers.length})
                  </h2>
                  {joinedServers.length === 0 ? (
                    <div className="p-8 rounded-xl border border-dashed border-zinc-200 dark:border-white/[0.1] bg-zinc-50 dark:bg-[#17181c] text-center space-y-2.5">
                      <p className="text-sm font-medium text-zinc-400">
                        You haven&apos;t joined any communities yet
                      </p>
                      <button
                        type="button"
                        onClick={() => setNav('discover')}
                        className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
                      >
                        Explore Public Communities
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {joinedServers.map((srv) => (
                        <button
                          key={srv.id}
                          type="button"
                          onClick={() => openServer(srv.id)}
                          style={srv.accentColor ? { borderColor: `${srv.accentColor}44` } : undefined}
                          className="flex items-center gap-3 p-3.5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328] hover:bg-[#26282e] text-left transition-colors"
                        >
                          <img
                            src={srv.iconUrl || ASSET_IMAGES.brandEmblem}
                            alt={srv.name}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-2xl object-cover shrink-0 bg-[#17181c]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm truncate">{srv.name}</p>
                            <p className="text-xs text-zinc-400 truncate mt-0.5">
                              {srv.memberCount} members · {srv.isPublic ? 'Public' : 'Private'}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {nav === 'friends' && (
            <FriendsView
              friendships={friendships}
              friendRequests={friendRequests}
              blockedUsers={blockedUsers}
              userCache={userCache}
              onStartDm={startDirectMessage}
              onCreateGroupDm={createGroupDm}
              onViewProfile={(uid) => {
                setProfileModalEdit(false);
                setProfileModalUid(uid);
              }}
            />
          )}

          {nav === 'discover' && (
            <DiscoverView
              publicServers={publicServers}
              joinedServerIds={joinedServerIds}
              onSelectServer={(id) => openServer(id)}
              onOpenCreateServer={() => setShowCreateServer(true)}
            />
          )}

          {nav === 'afterdark' && (
            <AfterDarkView
              afterDarkServers={publicServers.filter((s) => s.isAfterDark)}
              joinedServerIds={joinedServerIds}
              onSelectServer={(id) => openServer(id)}
            />
          )}

          {nav === 'admin' && isPlatformAdmin && <AdminDashboard />}

          {nav === 'server' && activeChannel && (
            <ChatArea
              mode="channel"
              channel={activeChannel}
              serverName={activeServer?.name}
              myRole={myRole}
              myPermissions={myPermissions}
              isMuted={Boolean(myMemberRecord?.muted)}
              memberProfiles={userCache}
              serverMembers={serverMembers}
              serverRoles={serverRoles}
              isAfterDarkTheme={Boolean(activeServer?.isAfterDark)}
              showRightPanel={showRightPanel}
              onOpenMobileMenu={() => setMobileDrawerOpen(true)}
              onToggleRightPanel={toggleRightDrawerResponsive}
              onViewProfile={(uid) => {
                setProfileModalEdit(false);
                setProfileModalUid(uid);
              }}
              onEditChannel={
                myPermissions.manageChannels
                  ? () => openManageServer('channels', activeChannel.id)
                  : undefined
              }
            />
          )}

          {nav === 'server' && !activeChannel && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <Hash className="w-10 h-10 text-zinc-500" />
              <p className="text-sm text-zinc-400">
                Select or create a text channel in {activeServer?.name || 'this server'}.
              </p>
              <button
                type="button"
                onClick={() => openManageServer('channels')}
                className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
              >
                Manage Channels
              </button>
            </div>
          )}

          {nav === 'dms' && activeConversation && (
            <ChatArea
              mode="dm"
              conversation={activeConversation}
              memberProfiles={userCache}
              showRightPanel={showRightPanel}
              onOpenMobileMenu={() => setMobileDrawerOpen(true)}
              onToggleRightPanel={toggleRightDrawerResponsive}
              onViewProfile={(uid) => {
                setProfileModalEdit(false);
                setProfileModalUid(uid);
              }}
            />
          )}

          {nav === 'dms' && !activeConversation && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <MessageSquare className="w-9 h-9 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-400">
                Select a conversation or start one from Friends
              </p>
              <button
                type="button"
                onClick={() => setNav('friends')}
                className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
              >
                Open Friends
              </button>
            </div>
          )}
        </main>

        {/* 4. DESKTOP RIGHT SIDEBAR (Role-grouped Server Members OR DM User Profile Card) */}
        {showRightPanel && (nav === 'server' || nav === 'dms') && (
          <aside className="hidden lg:flex w-60 flex-col border-l border-zinc-200 dark:border-white/[0.07] shrink-0 min-h-0">
            {renderRightSidebarContent(false)}
          </aside>
        )}

        {/* MOBILE / TABLET SLIDE-OVER RIGHT SIDEBAR (<lg) */}
        {mobileRightOpen && (nav === 'server' || nav === 'dms') && (
          <div className="lg:hidden fixed inset-0 z-40 flex justify-end">
            <div
              className="fixed inset-0 bg-black/65"
              onClick={() => setMobileRightOpen(false)}
            />
            <aside className="relative z-10 w-64 max-w-[85vw] h-full flex flex-col border-l border-white/[0.08] shadow-2xl">
              {renderRightSidebarContent(true)}
            </aside>
          </div>
        )}
      </div>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden h-14 pb-safe border-t border-zinc-200 dark:border-white/[0.07] bg-white/95 dark:bg-[#111214]/95 backdrop-blur-md grid grid-cols-5 items-center shrink-0"
      >
        {[
          { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" /> },
          { id: 'dms', label: 'DMs', icon: <MessageSquare className="w-5 h-5" /> },
          {
            id: 'servers',
            label: 'Servers',
            icon: <Compass className="w-5 h-5" />,
            action: () => setMobileDrawerOpen(true),
          },
          { id: 'friends', label: 'Friends', icon: <Users className="w-5 h-5" /> },
          {
            id: 'settings',
            label: 'Settings',
            icon: <Settings className="w-5 h-5" />,
            action: () => setShowSettings(true),
          },
        ].map((item) => {
          const active = nav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.action) item.action();
                else setNav(item.id as NavDestination);
              }}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? 'text-[#949cf7]' : 'text-zinc-500'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Modals */}
      {showCreateServer && (
        <ServerModal
          mode="create"
          onCreated={(srvId) => openServer(srvId)}
          onClose={() => setShowCreateServer(false)}
        />
      )}

      {showManageServer && activeServer && (
        <ServerModal
          mode="manage"
          server={activeServer}
          channels={channels}
          categories={categories}
          members={serverMembers}
          roles={serverRoles}
          memberProfiles={userCache}
          myRole={myRole}
          myPermissions={myPermissions}
          initialTab={manageInitialTab}
          initialEditChannelId={manageEditChannelId}
          onLeftOrDeleted={() => {
            setActiveServerId(null);
            setActiveChannelId(null);
            setNav('home');
          }}
          onClose={() => {
            setManageEditChannelId(null);
            setShowManageServer(false);
          }}
        />
      )}

      {quickCreateChannelCatId !== null && activeServer && (
        <QuickCreateChannelModal
          server={activeServer}
          categories={categories}
          members={serverMembers}
          initialCategoryId={quickCreateChannelCatId}
          nextPosition={channels.length}
          onClose={() => setQuickCreateChannelCatId(null)}
        />
      )}

      {quickCreateCategoryOpen && activeServer && (
        <QuickCreateCategoryModal
          server={activeServer}
          members={serverMembers}
          nextPosition={categories.length}
          onClose={() => setQuickCreateCategoryOpen(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          onOpenProfileEditor={() => {
            if (firebaseUser) {
              setProfileModalEdit(true);
              setProfileModalUid(firebaseUser.uid);
            }
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showNotifications && (
        <NotificationsDrawer
          notifications={notifications}
          onClose={() => setShowNotifications(false)}
        />
      )}

      {showGlobalSearch && (
        <GlobalSearchModal
          servers={publicServers}
          channels={channels}
          users={Object.values(userCache)}
          onSelectServer={(id) => openServer(id)}
          onSelectChannel={(srvId, chId) => openServer(srvId, chId)}
          onSelectUser={(uid) => {
            setProfileModalEdit(false);
            setProfileModalUid(uid);
          }}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}

      {profileModalUid && (
        <ProfileModal
          targetUid={profileModalUid}
          mutualServers={joinedServers}
          isFriend={friendUidSet.has(profileModalUid)}
          isBlocked={blockedUidSet.has(profileModalUid)}
          initialEditing={profileModalEdit}
          onStartDm={(uid) => void startDirectMessage(uid)}
          onClose={() => {
            setProfileModalEdit(false);
            setProfileModalUid(null);
          }}
        />
      )}
    </div>
  );
}
