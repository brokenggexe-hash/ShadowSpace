import React, { useEffect, useRef, useState } from 'react';
import { updateProfile } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ExternalLink,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  MessageSquare,
  Pencil,
  RotateCcw,
  Shield,
  Upload,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth, type UsernameCheckStatus } from '../contexts/AuthContext';
import type { OnlineStatus, Server, UserPublic } from '../types/shadowspace';
import {
  deleteCloudinaryAsset,
  startCloudinaryUpload,
  type ActiveUploadHandle,
} from '../utils/cloudinaryUpload';
import {
  ASSET_IMAGES,
  FIELD_LIMITS,
  generateId,
  isValidUsernameFormat,
  normalizeUsername,
  normalizeWebsiteUrl,
  truncateText,
} from '../utils/validators';
import { MediaModal } from './MediaModal';

interface ProfileModalProps {
  targetUid: string;
  mutualServers: Server[];
  isFriend: boolean;
  isBlocked: boolean;
  initialEditing?: boolean;
  onStartDm: (uid: string) => void;
  onClose: () => void;
}

const STATUS_META: Record<
  OnlineStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  online: { label: 'Online', dotClass: 'bg-emerald-500', textClass: 'text-emerald-400' },
  idle: { label: 'Idle', dotClass: 'bg-amber-400', textClass: 'text-amber-400' },
  dnd: { label: 'Do Not Disturb', dotClass: 'bg-rose-500', textClass: 'text-rose-400' },
  offline: { label: 'Offline', dotClass: 'bg-zinc-500', textClass: 'text-zinc-400' },
};

const PRONOUN_SUGGESTIONS = ['she/her', 'he/him', 'they/them', 'she/they', 'he/they', 'any/all'];
const ACCENT_SWATCHES = ['#7c3aed', '#8b5cf6', '#ec4899', '#38bdf8', '#10b981', '#f59e0b'];

export function ProfileModal({
  targetUid,
  mutualServers,
  isFriend,
  isBlocked,
  initialEditing = false,
  onStartDm,
  onClose,
}: ProfileModalProps) {
  const {
    firebaseUser,
    profile: myProfile,
    refreshProfile,
    checkUsernameAvailability,
  } = useAuth();
  const isSelf = firebaseUser?.uid === targetUid;

  const [target, setTarget] = useState<UserPublic | null>(isSelf ? myProfile : null);
  const [editing, setEditing] = useState(Boolean(isSelf && initialEditing));

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [bio, setBio] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [onlineStatus, setOnlineStatus] = useState<OnlineStatus>('online');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarPublicId, setAvatarPublicId] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerPublicId, setBannerPublicId] = useState('');
  const [accentColor, setAccentColor] = useState('#7c3aed');
  const [profileBg, setProfileBg] = useState('#14161D');

  const [usernameState, setUsernameState] = useState<
    'unchanged' | 'checking' | UsernameCheckStatus
  >('unchanged');
  const [uploadProgress, setUploadProgress] = useState<{
    target: 'avatar' | 'banner';
    percent: number;
    bytesTransferred: number;
    totalBytes: number;
  } | null>(null);
  const [failedUpload, setFailedUpload] = useState<{
    file: File;
    kind: 'avatar' | 'banner';
  } | null>(null);
  const [mediaTarget, setMediaTarget] = useState<'avatar' | 'banner' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeUploadRef = useRef<ActiveUploadHandle | null>(null);

  useEffect(() => {
    return () => {
      activeUploadRef.current?.cancel();
    };
  }, []);

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
    if (isSelf) {
      if (myProfile) setTarget(myProfile);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'users', targetUid),
      (snap) => {
        if (snap.exists()) {
          setTarget(snap.data() as UserPublic);
        }
      },
      (err) => {
        console.error('Profile listener failed:', err);
      }
    );
    return () => unsub();
  }, [isSelf, myProfile, targetUid]);

  const syncDraftFromTarget = (source: UserPublic) => {
    setDisplayName(source.displayName || '');
    setUsername(source.username || '');
    setPronouns(source.pronouns || '');
    setLocation(source.location || '');
    setWebsite(source.website || '');
    setBio(source.bio || '');
    setStatusMessage(source.statusMessage || '');
    setOnlineStatus(source.onlineStatus || 'online');
    setAvatarUrl(source.avatarUrl || ASSET_IMAGES.obsidianAvatar);
    setAvatarPublicId(source.avatarPublicId || '');
    setBannerUrl(source.bannerUrl || ASSET_IMAGES.studioBanner);
    setBannerPublicId(source.bannerPublicId || '');
    setAccentColor(source.accentColor || '#5865f2');
    setProfileBg(source.profileBg || '#1b1c21');
    setUsernameState('unchanged');
  };

  useEffect(() => {
    if (target && !editing) {
      syncDraftFromTarget(target);
    }
  }, [target, editing]);

  // Live username availability checking when editing
  useEffect(() => {
    if (!editing || !target || !firebaseUser) return;
    const clean = normalizeUsername(username);
    if (!clean) {
      setUsernameState('invalid');
      return;
    }
    if (clean === target.username) {
      setUsernameState('unchanged');
      return;
    }
    if (!isValidUsernameFormat(clean)) {
      setUsernameState('invalid');
      return;
    }
    let cancelled = false;
    setUsernameState('checking');
    const timer = window.setTimeout(async () => {
      const status = await checkUsernameAvailability(clean, firebaseUser.uid);
      if (!cancelled) {
        setUsernameState(status);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, editing, target, firebaseUser, checkUsernameAvailability]);

  const startDirectUpload = async (file: File, kind: 'avatar' | 'banner') => {
    if (!firebaseUser) return;
    setError(null);
    setNotice(null);
    setFailedUpload(null);

    activeUploadRef.current?.cancel();
    const handle = startCloudinaryUpload({
      file,
      purpose: kind,
      onProgress: (info) => {
        if (info.state === 'running' || info.state === 'paused') {
          setUploadProgress({
            target: kind,
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
      if (kind === 'avatar') {
        const unsavedPrevious =
          avatarPublicId && avatarPublicId !== (target?.avatarPublicId || '')
            ? avatarPublicId
            : '';
        setAvatarUrl(result.downloadUrl);
        setAvatarPublicId(result.publicId);
        if (unsavedPrevious && unsavedPrevious !== result.publicId) {
          void deleteCloudinaryAsset(unsavedPrevious).catch(() => {});
        }
      } else {
        const unsavedPrevious =
          bannerPublicId && bannerPublicId !== (target?.bannerPublicId || '')
            ? bannerPublicId
            : '';
        setBannerUrl(result.downloadUrl);
        setBannerPublicId(result.publicId);
        if (unsavedPrevious && unsavedPrevious !== result.publicId) {
          void deleteCloudinaryAsset(unsavedPrevious).catch(() => {});
        }
      }
      setUploadProgress(null);
      setNotice(
        `${kind === 'avatar' ? 'Avatar' : 'Banner'} uploaded! Click Save Changes to apply.`
      );
    } catch (err) {
      activeUploadRef.current = null;
      setUploadProgress(null);
      setFailedUpload({ file, kind });
      setError(err instanceof Error ? err.message : 'Cloudinary upload failed');
    }
  };

  const handleDirectImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'avatar' | 'banner'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void startDirectUpload(file, kind);
  };

  const handleCancelDirectUpload = () => {
    activeUploadRef.current?.cancel();
    activeUploadRef.current = null;
    setUploadProgress(null);
  };

  const handleSave = async () => {
    if (!firebaseUser || !target) return;
    setError(null);
    setNotice(null);

    const cleanUser = normalizeUsername(username);
    if (!isValidUsernameFormat(cleanUser)) {
      setError('Invalid username — use 3–32 lowercase letters, numbers, underscores, or dots.');
      return;
    }

    const cleanDisplayName = truncateText(displayName, FIELD_LIMITS.displayNameMax);
    if (!cleanDisplayName) {
      setError('Display name is required.');
      return;
    }

    let normalizedSite = '';
    try {
      normalizedSite = normalizeWebsiteUrl(website);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid website URL.');
      return;
    }

    setSaving(true);
    try {
      const usernameChanged = cleanUser !== target.username;
      if (usernameChanged) {
        if (target.lastUsernameChange && typeof target.lastUsernameChange.toMillis === 'function') {
          const daysSince =
            (Date.now() - target.lastUsernameChange.toMillis()) / (1000 * 60 * 60 * 24);
          if (daysSince < 7) {
            throw new Error(
              `Username cooldown active. Try again in ${Math.ceil(7 - daysSince)} day(s).`
            );
          }
        }
        const availStatus = await checkUsernameAvailability(cleanUser, firebaseUser.uid);
        if (availStatus === 'taken') {
          throw new Error('That username is already taken.');
        }
        if (availStatus === 'invalid') {
          throw new Error('Invalid username format.');
        }
        if (availStatus === 'error') {
          throw new Error('Unable to verify username availability right now.');
        }
      }

      await runTransaction(db, async (tx) => {
        const userRef = doc(db, 'users', firebaseUser.uid);
        if (usernameChanged) {
          const newClaimRef = doc(db, 'usernames', cleanUser);
          const newClaimSnap = await tx.get(newClaimRef);
          if (newClaimSnap.exists() && newClaimSnap.data()?.uid !== firebaseUser.uid) {
            throw new Error('That username is already taken.');
          }
          if (target.username) {
            tx.delete(doc(db, 'usernames', target.username));
          }
          tx.set(newClaimRef, {
            uid: firebaseUser.uid,
            username: cleanUser,
            createdAt: serverTimestamp(),
          });
        }

        const updateFields: Record<string, unknown> = {
          username: cleanUser,
          displayName: cleanDisplayName,
          bio: truncateText(bio, FIELD_LIMITS.bioMax),
          pronouns: truncateText(pronouns, FIELD_LIMITS.pronounsMax),
          location: truncateText(location, FIELD_LIMITS.locationMax),
          website: normalizedSite,
          statusMessage: truncateText(statusMessage, FIELD_LIMITS.statusMax),
          onlineStatus,
          avatarUrl: avatarUrl || ASSET_IMAGES.obsidianAvatar,
          avatarPublicId,
          bannerUrl: bannerUrl || ASSET_IMAGES.studioBanner,
          bannerPublicId,
          accentColor,
          profileBg,
          updatedAt: serverTimestamp(),
        };
        if (usernameChanged) {
          updateFields.lastUsernameChange = serverTimestamp();
        }
        tx.update(userRef, updateFields);
      });

      if (target.avatarPublicId && target.avatarPublicId !== avatarPublicId) {
        void deleteCloudinaryAsset(target.avatarPublicId).catch(() => {});
      }
      if (target.bannerPublicId && target.bannerPublicId !== bannerPublicId) {
        void deleteCloudinaryAsset(target.bannerPublicId).catch(() => {});
      }

      await updateProfile(firebaseUser, {
        displayName: cleanDisplayName,
        photoURL: avatarUrl || ASSET_IMAGES.obsidianAvatar,
      }).catch(() => {});

      await refreshProfile();
      setEditing(false);
      setNotice('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleResetProfile = async () => {
    if (!firebaseUser) return;
    setSaving(true);
    setError(null);
    const oldAvatarPublicId = target?.avatarPublicId;
    const oldBannerPublicId = target?.bannerPublicId;
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        bio: 'Exploring ShadowSpace.',
        pronouns: '',
        location: '',
        website: '',
        statusMessage: '',
        avatarUrl: ASSET_IMAGES.obsidianAvatar,
        avatarPublicId: '',
        bannerUrl: ASSET_IMAGES.studioBanner,
        bannerPublicId: '',
        accentColor: '#7c3aed',
        profileBg: '#14161D',
        updatedAt: serverTimestamp(),
      });
      await updateProfile(firebaseUser, {
        photoURL: ASSET_IMAGES.obsidianAvatar,
      }).catch(() => {});
      if (oldAvatarPublicId) {
        void deleteCloudinaryAsset(oldAvatarPublicId).catch(() => {});
      }
      if (oldBannerPublicId) {
        void deleteCloudinaryAsset(oldBannerPublicId).catch(() => {});
      }
      await refreshProfile();
      setEditing(false);
      setNotice('Profile reset to defaults.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSendFriendRequest = async () => {
    if (!firebaseUser || !myProfile || !target) return;
    const reqId = generateId('fr');
    try {
      await setDoc(doc(db, 'friendRequests', reqId), {
        id: reqId,
        fromUid: firebaseUser.uid,
        toUid: target.uid,
        fromUsername: myProfile.username,
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
        title: 'New Friend Request',
        body: `${myProfile.displayName} (@${myProfile.username}) wants to connect.`,
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      setNotice('Friend request sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request');
    }
  };

  const handleToggleBlock = async () => {
    if (!firebaseUser || !target) return;
    setError(null);
    setNotice(null);
    const blockId = `${firebaseUser.uid}_${target.uid}`;
    try {
      if (isBlocked) {
        await deleteDoc(doc(db, 'blockedUsers', blockId));
        setNotice('User unblocked.');
      } else {
        await setDoc(doc(db, 'blockedUsers', blockId), {
          blockerUid: firebaseUser.uid,
          blockedUid: target.uid,
          reason: 'Blocked via profile',
          createdAt: serverTimestamp(),
        });
        setNotice('User blocked.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update block status');
    }
  };

  if (!target) {
    return (
      <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
        <div className="bg-[#12141B] border border-zinc-800 rounded-2xl p-6 text-sm text-zinc-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          Loading profile…
        </div>
      </div>
    );
  }

  const createdStr =
    target.createdAt && typeof target.createdAt.toDate === 'function'
      ? target.createdAt.toDate().toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'Member';

  const activeData = editing
    ? {
        displayName: displayName || target.displayName,
        username: normalizeUsername(username) || target.username,
        pronouns,
        location,
        website,
        bio,
        statusMessage,
        onlineStatus,
        avatarUrl: avatarUrl || ASSET_IMAGES.obsidianAvatar,
        bannerUrl: bannerUrl || ASSET_IMAGES.studioBanner,
        accentColor,
        profileBg,
      }
    : {
        displayName: target.displayName,
        username: target.username,
        pronouns: target.pronouns || '',
        location: target.location || '',
        website: target.website || '',
        bio: target.bio || '',
        statusMessage: target.statusMessage || '',
        onlineStatus: target.onlineStatus || 'online',
        avatarUrl: target.avatarUrl || ASSET_IMAGES.obsidianAvatar,
        bannerUrl: target.bannerUrl || ASSET_IMAGES.studioBanner,
        accentColor: target.accentColor || '#7c3aed',
        profileBg: target.profileBg || '#14161D',
      };

  const renderProfileCard = (previewOnly: boolean) => {
    const statusMeta = STATUS_META[activeData.onlineStatus] || STATUS_META.online;
    let safeWebsiteDisplay = activeData.website.trim();
    if (safeWebsiteDisplay) {
      safeWebsiteDisplay = safeWebsiteDisplay.replace(/^https?:\/\//i, '');
    }

    const cardSurface = activeData.profileBg || '#1b1c21';
    const ringAccent = activeData.accentColor || '#5865f2';

    return (
      <div
        className="w-full rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl flex flex-col bg-[#1b1c21] text-zinc-100"
        style={{ backgroundColor: cardSurface }}
      >
        {/* Positioned Profile Header (containing block for banner + overlapping avatar) */}
        <div className="relative w-full shrink-0">
          {/* Banner wrapper with its own overflow-hidden */}
          <div className="relative z-0 h-36 sm:h-44 w-full bg-zinc-900 overflow-hidden">
            <img
              src={activeData.bannerUrl}
              alt="Profile banner"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            <div
              className="absolute bottom-0 inset-x-0 h-0.5 opacity-70"
              style={{ backgroundColor: ringAccent }}
            />
            {!previewOnly && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close profile"
                className="absolute top-3 right-3 z-10 p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Full Circular Avatar positioned independently above banner */}
          <div className="absolute left-5 sm:left-6 -bottom-12 sm:-bottom-14 z-20">
            <div className="relative">
              <div
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-full p-[3px] shadow-2xl"
                style={{
                  backgroundColor: cardSurface,
                  boxShadow: `0 0 0 2.5px ${ringAccent}`,
                }}
              >
                <img
                  src={activeData.avatarUrl}
                  alt={activeData.displayName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-cover bg-zinc-900 border-[4px]"
                  style={{ borderColor: cardSurface }}
                />
              </div>
              <span
                title={statusMeta.label}
                aria-label={statusMeta.label}
                className={`absolute bottom-1 right-1 z-10 w-6 h-6 rounded-full border-[4px] ${statusMeta.dotClass}`}
                style={{ borderColor: cardSurface }}
              />
            </div>
          </div>
        </div>

        {/* Profile Content */}
        <div className="relative z-10 px-5 sm:px-6 pt-3 pb-6 flex-1">
          {/* Action Row aligned right with clearance for the overlapping avatar */}
          <div className="min-h-[3.25rem] sm:min-h-[3.75rem] pl-28 sm:pl-32 flex items-start justify-end gap-2 flex-wrap">
            {!previewOnly && (
              <>
                {isSelf ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setEditing(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors shadow-sm"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Profile
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onStartDm(target.uid);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Message
                    </button>
                    {!isFriend && (
                      <button
                        type="button"
                        onClick={handleSendFriendRequest}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium transition-colors"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Add Friend
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleToggleBlock}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/15 text-rose-400 text-xs font-medium hover:bg-rose-500/25 transition-colors"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      {isBlocked ? 'Unblock' : 'Block'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {!previewOnly && error && (
            <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}
          {!previewOnly && notice && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
              {notice}
            </div>
          )}

          {/* Identity Block */}
          <div className="mt-3 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-display font-bold text-white leading-tight break-words">
                  {activeData.displayName}
                </h2>
                {target.badges && target.badges.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[11px] font-medium text-violet-300">
                    <Shield className="w-3 h-3" />
                    {target.badges[0]}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
                <span className="font-mono text-zinc-300">@{activeData.username}</span>
                {activeData.pronouns && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-zinc-200">
                      {activeData.pronouns}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className={`inline-flex items-center gap-1.5 font-medium ${statusMeta.textClass}`}>
                  <span className={`w-2 h-2 rounded-full ${statusMeta.dotClass}`} />
                  {statusMeta.label}
                </span>
              </div>
            </div>

            {activeData.statusMessage && (
              <div className="px-3.5 py-2.5 rounded-xl bg-black/30 border border-white/10 text-xs text-zinc-200">
                {activeData.statusMessage}
              </div>
            )}

            {/* Bio */}
            <div className="rounded-xl bg-black/25 border border-white/10 p-4 space-y-3">
              <div className="space-y-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  About Me
                </h3>
                <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                  {activeData.bio || 'No biography added yet.'}
                </p>
              </div>

              {/* Optional Metadata Row: Pronouns, Location, Website, Member Since */}
              <div className="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-zinc-300">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Calendar className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span>Joined {createdStr}</span>
                </div>

                {activeData.location && (
                  <div className="flex items-center gap-2 text-zinc-300 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="truncate">{activeData.location}</span>
                  </div>
                )}

                {activeData.website && (
                  <div className="flex items-center gap-2 min-w-0 sm:col-span-2">
                    <Globe className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <a
                      href={
                        /^https?:\/\//i.test(activeData.website)
                          ? activeData.website
                          : `https://${activeData.website}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200 hover:underline truncate"
                    >
                      <span className="truncate">{safeWebsiteDisplay}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {target.discordUsername && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-xs">
                {target.discordAvatar && (
                  <img
                    src={target.discordAvatar}
                    alt="Discord avatar"
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full"
                  />
                )}
                <span className="text-indigo-300">
                  Linked Discord: <strong>{target.discordUsername}</strong>
                </span>
              </div>
            )}

            {!previewOnly && !isSelf && mutualServers.length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <h3 className="text-xs font-semibold text-zinc-400 mb-2">
                  Mutual Communities ({mutualServers.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {mutualServers.map((s) => (
                    <span
                      key={s.id}
                      className="text-xs text-zinc-200 bg-zinc-800/80 px-2.5 py-1 rounded-lg"
                    >
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!editing) {
    return (
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="max-w-xl w-full max-h-[92vh] overflow-y-auto rounded-2xl">
          {renderProfileCard(false)}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="max-w-4xl w-full rounded-2xl border border-white/[0.08] bg-[#1b1c21] text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Editor Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/[0.07] bg-[#17181c] shrink-0">
          <div>
            <h2 className="font-display font-bold text-base sm:text-lg">Edit Profile</h2>
            <p className="text-xs text-zinc-400">
              Customize your identity, avatar, and banner — 100% free on ShadowSpace
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              syncDraftFromTarget(target);
              setEditing(false);
            }}
            aria-label="Close editor"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.07]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Editor Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex flex-wrap items-center justify-between gap-2">
              <span className="flex-1 min-w-[200px]">{error}</span>
              {failedUpload && !uploadProgress && (
                <button
                  type="button"
                  onClick={() => void startDirectUpload(failedUpload.file, failedUpload.kind)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium shrink-0"
                >
                  <RotateCcw className="w-3 h-3" /> Retry Upload
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
              {notice}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Form Column */}
            <div className="lg:col-span-7 space-y-4">
              {/* Avatar & Banner Uploaders */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-[#17181c] border border-white/[0.07]">
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-zinc-300">
                    Profile Avatar (Image / GIF)
                  </span>
                  <div className="flex items-center gap-3">
                    <img
                      src={avatarUrl || ASSET_IMAGES.obsidianAvatar}
                      alt="Avatar draft"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover border-2 border-violet-500 shrink-0"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer">
                        {uploadProgress?.target === 'avatar' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        {uploadProgress?.target === 'avatar'
                          ? `${uploadProgress.percent}%`
                          : 'Upload'}
                        <input
                          type="file"
                          disabled={uploadProgress !== null}
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(e) => handleDirectImageUpload(e, 'avatar')}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setMediaTarget('avatar')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs"
                      >
                        <ImagePlus className="w-3.5 h-3.5" /> Gallery
                      </button>
                      {(avatarPublicId || avatarUrl !== ASSET_IMAGES.obsidianAvatar) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (avatarPublicId && avatarPublicId !== (target.avatarPublicId || '')) {
                              void deleteCloudinaryAsset(avatarPublicId).catch(() => {});
                            }
                            setAvatarUrl(ASSET_IMAGES.obsidianAvatar);
                            setAvatarPublicId('');
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-zinc-300">
                    Profile Banner (Image / GIF)
                  </span>
                  <div className="flex items-center gap-3">
                    <img
                      src={bannerUrl || ASSET_IMAGES.studioBanner}
                      alt="Banner draft"
                      referrerPolicy="no-referrer"
                      className="w-20 h-12 rounded-lg object-cover border border-zinc-700 shrink-0"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer">
                        {uploadProgress?.target === 'banner' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        {uploadProgress?.target === 'banner'
                          ? `${uploadProgress.percent}%`
                          : 'Upload'}
                        <input
                          type="file"
                          disabled={uploadProgress !== null}
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(e) => handleDirectImageUpload(e, 'banner')}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setMediaTarget('banner')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs"
                      >
                        <ImagePlus className="w-3.5 h-3.5" /> Gallery
                      </button>
                      {(bannerPublicId || bannerUrl !== ASSET_IMAGES.studioBanner) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (bannerPublicId && bannerPublicId !== (target.bannerPublicId || '')) {
                              void deleteCloudinaryAsset(bannerPublicId).catch(() => {});
                            }
                            setBannerUrl(ASSET_IMAGES.studioBanner);
                            setBannerPublicId('');
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {uploadProgress && (
                  <div className="sm:col-span-2 space-y-1.5 pt-1 border-t border-zinc-800/80">
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-violet-500 transition-all duration-150"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="tabular-nums">
                        Uploading {uploadProgress.target}:{' '}
                        {Math.round(uploadProgress.bytesTransferred / 1024)} KB /{' '}
                        {Math.max(1, Math.round(uploadProgress.totalBytes / 1024))} KB ({uploadProgress.percent}%)
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelDirectUpload}
                        className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 font-medium"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  </div>
                )}

                <p className="sm:col-span-2 text-[11px] text-zinc-500">
                  Supports PNG, JPG, WEBP, and animated GIFs up to 10 MB via Cloudinary. No explicit sexual imagery.
                </p>
              </div>

              {/* Display Name & Username */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.displayNameMax}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    className="w-full h-10 px-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Unique Username
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.usernameMax}
                      value={username}
                      onChange={(e) =>
                        setUsername(e.target.value.replace(/\s+/g, '').toLowerCase())
                      }
                      className="w-full h-10 px-3 pr-9 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                    />
                    <span className="absolute right-3 top-3">
                      {usernameState === 'checking' && (
                        <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                      )}
                      {usernameState === 'available' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      )}
                      {(usernameState === 'taken' || usernameState === 'invalid') && (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      {usernameState === 'error' && (
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                      )}
                    </span>
                  </div>
                  {usernameState === 'unchanged' && (
                    <p className="text-[11px] text-zinc-500 mt-1">Current username</p>
                  )}
                  {usernameState === 'available' && (
                    <p className="text-[11px] text-emerald-400 mt-1">Available</p>
                  )}
                  {usernameState === 'taken' && (
                    <p className="text-[11px] text-rose-400 mt-1">Already taken</p>
                  )}
                  {usernameState === 'invalid' && (
                    <p className="text-[11px] text-rose-400 mt-1">
                      Invalid username — 3–32 lowercase chars, numbers, _ or .
                    </p>
                  )}
                  {usernameState === 'error' && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      Unable to check right now
                    </p>
                  )}
                </div>
              </div>

              {/* Pronouns & Online Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Pronouns (optional)
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.pronounsMax}
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    placeholder="e.g. they/them"
                    className="w-full h-10 px-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {PRONOUN_SUGGESTIONS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPronouns(p)}
                        className="px-2 py-0.5 rounded-md bg-zinc-800/80 hover:bg-zinc-700 text-[10px] text-zinc-300"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Online Status
                  </label>
                  <select
                    value={onlineStatus}
                    onChange={(e) => setOnlineStatus(e.target.value as OnlineStatus)}
                    className="w-full h-10 px-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  >
                    <option value="online">Online</option>
                    <option value="idle">Idle</option>
                    <option value="dnd">Do Not Disturb</option>
                    <option value="offline">Appear Offline</option>
                  </select>
                </div>
              </div>

              {/* Custom Status */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Custom Status
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.statusMax}
                  value={statusMessage}
                  onChange={(e) => setStatusMessage(e.target.value)}
                  placeholder="Share what you're up to…"
                  className="w-full h-10 px-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Bio */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-zinc-300">
                    Bio / About Me
                  </label>
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    {bio.length}/{FIELD_LIMITS.bioMax}
                  </span>
                </div>
                <textarea
                  maxLength={FIELD_LIMITS.bioMax}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell people a bit about yourself…"
                  className="w-full h-24 p-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>

              {/* Location & Website */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Location (optional)
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.locationMax}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Seattle, WA"
                    className="w-full h-10 px-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Website / Social Link (optional)
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.websiteMax}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://your-site.com"
                    className="w-full h-10 px-3 rounded-xl bg-[#0B0C10] border border-zinc-800 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Accent & Surface Colors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Avatar Ring Accent
                  </label>
                  <div className="flex items-center gap-2">
                    {ACCENT_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setAccentColor(hex)}
                        aria-label={`Select accent ${hex}`}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${
                          accentColor === hex ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-7 h-7 rounded-md cursor-pointer bg-transparent border-0"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Card Surface Tint
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={profileBg}
                      onChange={(e) => setProfileBg(e.target.value)}
                      className="w-8 h-8 rounded-md cursor-pointer bg-transparent"
                    />
                    <span className="text-xs font-mono text-zinc-400">{profileBg}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Preview Column */}
            <div className="lg:col-span-5 space-y-2 lg:sticky lg:top-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Live Profile Preview
              </p>
              {renderProfileCard(true)}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="px-5 sm:px-6 py-4 border-t border-white/[0.07] bg-[#17181c] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            disabled={saving}
            onClick={handleResetProfile}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                syncDraftFromTarget(target);
                setError(null);
                setEditing(false);
              }}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                saving ||
                uploadProgress !== null ||
                usernameState === 'taken' ||
                usernameState === 'invalid' ||
                usernameState === 'checking'
              }
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {mediaTarget && (
        <MediaModal
          scopeId={firebaseUser?.uid || 'profile'}
          purpose={mediaTarget}
          onSelectMedia={(url) => {
            if (mediaTarget === 'avatar') {
              if (avatarPublicId && avatarPublicId !== (target.avatarPublicId || '')) {
                void deleteCloudinaryAsset(avatarPublicId).catch(() => {});
              }
              setAvatarUrl(url);
              setAvatarPublicId('');
            } else {
              if (bannerPublicId && bannerPublicId !== (target.bannerPublicId || '')) {
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
