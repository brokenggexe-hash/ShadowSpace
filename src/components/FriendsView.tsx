import React, { useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Ban,
  Check,
  MessageSquare,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import type { BlockedUser, FriendRequest, Friendship, UserPublic } from '../types/shadowspace';
import { generateId, getInitials, normalizeUsername } from '../utils/validators';

interface FriendsViewProps {
  friendships: Friendship[];
  friendRequests: FriendRequest[];
  blockedUsers: BlockedUser[];
  userCache: Record<string, UserPublic>;
  onStartDm: (uid: string) => void;
  onCreateGroupDm: (uids: string[], groupName: string) => void;
  onViewProfile: (uid: string) => void;
}

export function FriendsView({
  friendships,
  friendRequests,
  blockedUsers,
  userCache,
  onStartDm,
  onCreateGroupDm,
  onViewProfile,
}: FriendsViewProps) {
  const { firebaseUser, profile } = useAuth();
  const { onlineUids } = useRealtime();

  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'blocked' | 'add'>('online');
  const [filterText, setFilterText] = useState('');
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResults, setSearchResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [groupMode, setGroupMode] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);

  const friendUids = friendships
    .map((f) => f.users.find((u) => u !== firebaseUser?.uid))
    .filter(Boolean) as string[];

  const onlineFriendUids = friendUids.filter(
    (uid) =>
      onlineUids.has(uid) ||
      (userCache[uid]?.onlineStatus && userCache[uid]?.onlineStatus !== 'offline')
  );

  const pendingIncoming = friendRequests.filter(
    (r) => r.status === 'pending' && r.toUid === firebaseUser?.uid
  );
  const pendingOutgoing = friendRequests.filter(
    (r) => r.status === 'pending' && r.fromUid === firebaseUser?.uid
  );
  const totalPending = pendingIncoming.length + pendingOutgoing.length;

  const handleUserSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeUsername(searchUsername).replace(/^@+/, '');
    if (!clean || !firebaseUser) return;
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const resultsMap = new Map<string, UserPublic>();

      // 1. Exact username lookup via /usernames/{clean}
      const claimSnap = await getDoc(doc(db, 'usernames', clean)).catch(() => null);
      if (claimSnap?.exists()) {
        const targetUid = claimSnap.data()?.uid as string | undefined;
        if (targetUid && targetUid !== firebaseUser.uid) {
          const userSnap = await getDoc(doc(db, 'users', targetUid)).catch(() => null);
          if (userSnap?.exists()) {
            const u = userSnap.data() as UserPublic;
            if (u.profileVisibility !== 'private' || friendUids.includes(u.uid)) {
              resultsMap.set(u.uid, u);
            }
          }
        }
      }

      // 2. Prefix query aligned with firestore.rules (requires profileVisibility != 'private')
      const q = query(
        collection(db, 'users'),
        where('profileVisibility', '!=', 'private'),
        where('username', '>=', clean),
        where('username', '<=', `${clean}\uf8ff`),
        limit(12)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const u = d.data() as UserPublic;
        if (u.uid !== firebaseUser.uid) {
          resultsMap.set(u.uid, u);
        }
      }

      const list = Array.from(resultsMap.values());
      setSearchResults(list);
      if (list.length === 0) setNotice('No matching users found.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const sendFriendRequest = async (target: UserPublic) => {
    if (!firebaseUser || !profile) return;
    setError(null);
    setNotice(null);
    if (friendUids.includes(target.uid)) {
      setNotice(`You are already friends with @${target.username}.`);
      return;
    }
    const alreadyPending = friendRequests.some(
      (r) => r.status === 'pending' && r.participants.includes(target.uid)
    );
    if (alreadyPending) {
      setNotice(`A pending friend request already exists with @${target.username}.`);
      return;
    }

    const reqId = generateId('fr');
    try {
      await setDoc(doc(db, 'friendRequests', reqId), {
        id: reqId,
        fromUid: firebaseUser.uid,
        toUid: target.uid,
        fromUsername: profile.username,
        toUsername: target.username,
        participants: [firebaseUser.uid, target.uid],
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const notifId = generateId('ntf');
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: target.uid,
        actorId: firebaseUser.uid,
        type: 'friend_request',
        title: 'Friend Request',
        body: `${profile.displayName} (@${profile.username}) sent you a friend request.`,
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      setNotice(`Friend request sent to @${target.username}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `friendRequests/${reqId}`);
    }
  };

  const acceptRequest = async (req: FriendRequest) => {
    if (!firebaseUser) return;
    const sorted = [req.fromUid, req.toUid].sort();
    const friendshipId = `${sorted[0]}_${sorted[1]}`;
    const batch = writeBatch(db);
    batch.update(doc(db, 'friendRequests', req.id), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'friendships', friendshipId), {
      id: friendshipId,
      users: sorted,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  };

  const rejectOrCancelRequest = async (
    req: FriendRequest,
    nextStatus: 'rejected' | 'cancelled'
  ) => {
    await updateDoc(doc(db, 'friendRequests', req.id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  };

  const removeFriend = async (friendUid: string) => {
    if (!firebaseUser) return;
    const sorted = [firebaseUser.uid, friendUid].sort();
    await deleteDoc(doc(db, 'friendships', `${sorted[0]}_${sorted[1]}`));
  };

  const unblockUser = async (blockedUid: string) => {
    if (!firebaseUser) return;
    await deleteDoc(doc(db, 'blockedUsers', `${firebaseUser.uid}_${blockedUid}`));
  };

  const renderFriendList = (uids: string[], headingLabel: string) => {
    const q = filterText.trim().toLowerCase();
    const visible = uids.filter((uid) => {
      if (!q) return true;
      const u = userCache[uid];
      return (
        (u?.displayName || '').toLowerCase().includes(q) ||
        (u?.username || '').toLowerCase().includes(q)
      );
    });

    if (uids.length === 0) {
      return (
        <div className="text-center py-16 border border-dashed border-zinc-200 dark:border-white/[0.08] rounded-xl bg-zinc-50 dark:bg-[#17181c]">
          <Users className="w-9 h-9 text-zinc-500 mx-auto mb-2.5" />
          <p className="text-sm font-medium text-zinc-400">
            {tab === 'online'
              ? 'No friends online right now.'
              : 'No friends in this view yet.'}
          </p>
          <button
            type="button"
            onClick={() => setTab('add')}
            className="mt-3 px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
          >
            Find People by Username
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.07] text-sm focus:outline-none focus:border-white/20"
          />
        </div>

        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 px-1">
          {headingLabel} — {visible.length}
        </p>

        {visible.length === 0 ? (
          <p className="text-xs text-zinc-500 px-1 py-4">No matching friends found.</p>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-white/[0.06] border-t border-zinc-200 dark:border-white/[0.06]">
            {visible.map((uid) => {
              const u = userCache[uid];
              const isOnline =
                onlineUids.has(uid) ||
                (u?.onlineStatus && u.onlineStatus !== 'offline');
              const name = u?.displayName || uid.slice(0, 8);
              const dot =
                u?.onlineStatus === 'dnd'
                  ? 'bg-rose-500'
                  : u?.onlineStatus === 'idle'
                    ? 'bg-amber-400'
                    : isOnline
                      ? 'bg-emerald-500'
                      : 'bg-zinc-500';

              return (
                <div
                  key={uid}
                  className="group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-[#222328] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {groupMode && (
                      <input
                        type="checkbox"
                        checked={selectedForGroup.includes(uid)}
                        onChange={(e) => {
                          setSelectedForGroup((prev) =>
                            e.target.checked
                              ? [...prev, uid]
                              : prev.filter((id) => id !== uid)
                          );
                        }}
                        className="rounded border-zinc-700 bg-[#111214] text-[#5865f2]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onViewProfile(uid)}
                      className="relative w-9 h-9 rounded-full bg-[#26282e] flex items-center justify-center text-xs font-semibold shrink-0"
                    >
                      {u?.avatarUrl ? (
                        <img
                          src={u.avatarUrl}
                          alt={name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        getInitials(name)
                      )}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#1b1c21] ${dot}`}
                      />
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onViewProfile(uid)}
                        className="font-semibold text-sm hover:underline truncate block"
                      >
                        {name}
                        <span className="text-xs font-normal text-zinc-500 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          @{u?.username || 'member'}
                        </span>
                      </button>
                      <p className="text-xs text-zinc-400 truncate">
                        {u?.statusMessage || (isOnline ? 'Online' : 'Offline')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartDm(uid)}
                      aria-label="Send direct message"
                      title="Message"
                      className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-[#17181c] hover:bg-[#5865f2] hover:text-white text-zinc-400 flex items-center justify-center transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFriend(uid)}
                      aria-label="Remove friend"
                      title="Remove Friend"
                      className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-[#17181c] hover:bg-rose-500/20 hover:text-rose-400 text-zinc-400 flex items-center justify-center transition-colors"
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#1b1c21] text-zinc-900 dark:text-[#f2f3f5]">
      {/* Discord 48px Friends Top Bar */}
      <header className="min-h-12 px-4 py-2 border-b border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#1b1c21] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 font-semibold text-[15px] pr-2">
            <Users className="w-5 h-5 text-zinc-400" />
            <span>Friends</span>
          </div>
          <span className="hidden sm:inline-block w-px h-5 bg-white/[0.08] mr-1" />

          {(
            [
              { id: 'online', label: 'Online' },
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Pending', badge: totalPending },
              { id: 'blocked', label: 'Blocked' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors ${
                tab === item.id
                  ? 'bg-zinc-200 dark:bg-white/[0.1] text-zinc-900 dark:text-white'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/[0.05] hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <span>{item.label}</span>
              {'badge' in item && item.badge > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setTab('add')}
            className={`px-3 py-1 rounded-md text-[13px] font-semibold whitespace-nowrap transition-colors ${
              tab === 'add'
                ? 'bg-[#248046]/25 text-emerald-300'
                : 'bg-[#248046] hover:bg-[#1a6334] text-white'
            }`}
          >
            Add Friend
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setGroupMode((g) => !g);
            setSelectedForGroup([]);
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            groupMode
              ? 'bg-[#5865f2] text-white'
              : 'bg-zinc-200/70 dark:bg-[#222328] hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          {groupMode ? 'Cancel Group DM' : 'New Group DM'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          {groupMode && (
            <div className="p-4 rounded-xl bg-[#5865f2]/10 border border-[#5865f2]/35 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group conversation name…"
                className="flex-1 min-w-[180px] h-9 px-3 rounded-lg bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-sm"
              />
              <span className="text-xs text-zinc-400">
                {selectedForGroup.length} selected
              </span>
              <button
                type="button"
                disabled={selectedForGroup.length < 2}
                onClick={() => {
                  onCreateGroupDm(selectedForGroup, groupName.trim() || 'ShadowSpace Group');
                  setGroupMode(false);
                  setGroupName('');
                  setSelectedForGroup([]);
                }}
                className="px-4 h-9 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold disabled:opacity-40"
              >
                Create Group ({selectedForGroup.length + 1})
              </button>
            </div>
          )}

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

          {tab === 'online' && renderFriendList(onlineFriendUids, 'Online')}
          {tab === 'all' && renderFriendList(friendUids, 'All Friends')}

          {tab === 'pending' && (
            <div className="space-y-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Incoming Requests — {pendingIncoming.length}
              </p>
              {pendingIncoming.length === 0 ? (
                <p className="text-xs text-zinc-500">No incoming requests.</p>
              ) : (
                <div className="space-y-2">
                  {pendingIncoming.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328]"
                    >
                      <div>
                        <p className="text-sm font-semibold">@{req.fromUsername || req.fromUid}</p>
                        <p className="text-xs text-zinc-400">Incoming Friend Request</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => acceptRequest(req)}
                          className="w-9 h-9 rounded-full bg-[#17181c] hover:bg-emerald-600 text-emerald-400 hover:text-white flex items-center justify-center transition-colors"
                          title="Accept"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectOrCancelRequest(req, 'rejected')}
                          className="w-9 h-9 rounded-full bg-[#17181c] hover:bg-rose-600 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
                          title="Ignore"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 pt-2">
                Sent Requests — {pendingOutgoing.length}
              </p>
              {pendingOutgoing.length === 0 ? (
                <p className="text-xs text-zinc-500">No outgoing requests.</p>
              ) : (
                <div className="space-y-2">
                  {pendingOutgoing.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328]"
                    >
                      <div>
                        <p className="text-sm font-semibold">@{req.toUsername || req.toUid}</p>
                        <p className="text-xs text-zinc-400">Outgoing Friend Request</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => rejectOrCancelRequest(req, 'cancelled')}
                        className="px-3 py-1.5 rounded-lg bg-[#17181c] hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'blocked' && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Blocked Users — {blockedUsers.length}
              </p>
              {blockedUsers.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4">No blocked users.</p>
              ) : (
                blockedUsers.map((b) => (
                  <div
                    key={b.blockedUid}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328]"
                  >
                    <div className="flex items-center gap-2.5">
                      <Ban className="w-4 h-4 text-rose-400" />
                      <span className="text-sm font-medium">
                        @{userCache[b.blockedUid]?.username || b.blockedUid}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => unblockUser(b.blockedUid)}
                      className="px-3 py-1.5 rounded-lg bg-[#17181c] hover:bg-zinc-700 text-xs text-zinc-200"
                    >
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'add' && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display font-bold text-base uppercase tracking-wide">
                  Add Friend
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  You can add friends with their ShadowSpace @username.
                </p>
              </div>
              <form onSubmit={handleUserSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={searchUsername}
                    onChange={(e) => setSearchUsername(e.target.value)}
                    placeholder="Enter a ShadowSpace @username…"
                    className="w-full h-11 pl-9 pr-3 rounded-lg bg-zinc-100 dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-sm focus:outline-none focus:border-[#5865f2]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="px-5 h-11 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold shrink-0"
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>

              <div className="space-y-2">
                {searchResults.map((u) => {
                  const already = friendUids.includes(u.uid);
                  return (
                    <div
                      key={u.uid}
                      className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328]"
                    >
                      <button
                        type="button"
                        onClick={() => onViewProfile(u.uid)}
                        className="flex items-center gap-3 text-left min-w-0"
                      >
                        <img
                          src={u.avatarUrl}
                          alt={u.displayName}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full object-cover bg-[#17181c] shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate hover:underline">
                            {u.displayName}
                          </p>
                          <p className="text-xs text-zinc-400 truncate">@{u.username}</p>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onStartDm(u.uid)}
                          aria-label={`Message @${u.username}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-[#17181c] hover:bg-[#31333c] text-xs font-medium transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Message
                        </button>
                        {already ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium px-2">
                            <UserCheck className="w-4 h-4" /> Friends
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => sendFriendRequest(u)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            Send Request
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
