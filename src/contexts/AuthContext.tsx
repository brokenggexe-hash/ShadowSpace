import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../config/firebase';
import type { UserPrivate, UserPublic } from '../types/shadowspace';
import {
  deleteCloudinaryAsset,
  startCloudinaryUpload,
  type ActiveUploadHandle,
} from '../utils/cloudinaryUpload';
import {
  ASSET_IMAGES,
  isValidUsernameFormat,
  normalizeUsername,
  truncateText,
} from '../utils/validators';
import { useTheme } from './ThemeContext';

const PLATFORM_OWNER_EMAIL = 'brokengg.exe@gmail.com';

export type UsernameCheckStatus = 'available' | 'taken' | 'invalid' | 'error';

export interface PendingRegistrationProfile {
  username: string;
  displayName: string;
  avatarUrl?: string;
  avatarPublicId?: string;
  ageVerified: boolean;
}

export interface PendingAvatarUploadState {
  status: 'idle' | 'uploading' | 'done' | 'error';
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
  fileName: string | null;
  error: string | null;
}

const INITIAL_UPLOAD_STATE: PendingAvatarUploadState = {
  status: 'idle',
  percent: 0,
  bytesTransferred: 0,
  totalBytes: 0,
  fileName: null,
  error: null,
};

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserPublic | null;
  privateAccount: UserPrivate | null;
  loading: boolean;
  isPlatformAdmin: boolean;
  pendingAvatarUpload: PendingAvatarUploadState;
  hasPendingAvatarFile: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    registration: PendingRegistrationProfile,
    avatarFile?: File | null
  ) => Promise<void>;
  retryPendingAvatarUpload: (replacementFile?: File | null) => Promise<void>;
  cancelPendingAvatarUpload: () => void;
  skipPendingAvatarUpload: () => void;
  resendVerificationEmail: () => Promise<void>;
  refreshVerificationState: () => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  logout: () => Promise<void>;
  checkUsernameAvailability: (
    username: string,
    currentUid?: string
  ) => Promise<UsernameCheckStatus>;
  checkUsernameAvailable: (username: string, currentUid?: string) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
  completeOnboardingProfile: (registration: PendingRegistrationProfile) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PENDING_REG_KEY = 'shadowspace_pending_reg';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { loadUserSettings, clearUserSettingsListener } = useTheme();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserPublic | null>(null);
  const [privateAccount, setPrivateAccount] = useState<UserPrivate | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAvatarUpload, setPendingAvatarUpload] =
    useState<PendingAvatarUploadState>(INITIAL_UPLOAD_STATE);
  const [hasPendingAvatarFile, setHasPendingAvatarFile] = useState(false);

  const pendingAvatarFileRef = useRef<File | null>(null);
  const pendingUploadHandleRef = useRef<ActiveUploadHandle | null>(null);
  const profileUnsubsRef = useRef<Array<() => void>>([]);
  const subscribedUidRef = useRef<string | null>(null);

  const clearProfileListeners = useCallback(() => {
    for (const unsub of profileUnsubsRef.current) {
      unsub();
    }
    profileUnsubsRef.current = [];
    subscribedUidRef.current = null;
  }, []);

  const checkUsernameAvailability = useCallback(
    async (raw: string, currentUid?: string): Promise<UsernameCheckStatus> => {
      const clean = normalizeUsername(raw);
      if (!isValidUsernameFormat(clean)) {
        return 'invalid';
      }
      try {
        const ref = doc(db, 'usernames', clean);
        const snap = await getDocFromServer(ref);
        if (!snap.exists()) {
          return 'available';
        }
        const claimedUid = snap.data()?.uid as string | undefined;
        if (currentUid && claimedUid === currentUid) {
          return 'available';
        }
        return 'taken';
      } catch (err) {
        console.error('Username availability lookup failed:', err);
        return 'error';
      }
    },
    []
  );

  const checkUsernameAvailable = useCallback(
    async (raw: string, currentUid?: string): Promise<boolean> => {
      const status = await checkUsernameAvailability(raw, currentUid);
      return status === 'available';
    },
    [checkUsernameAvailability]
  );

  const runPendingAvatarUpload = useCallback(async (file: File, user: User) => {
    pendingUploadHandleRef.current?.cancel();
    pendingAvatarFileRef.current = file;
    setHasPendingAvatarFile(true);
    setPendingAvatarUpload({
      status: 'uploading',
      percent: 0,
      bytesTransferred: 0,
      totalBytes: file.size,
      fileName: file.name,
      error: null,
    });

    const handle = startCloudinaryUpload({
      file,
      purpose: 'avatar',
      onProgress: (info) => {
        if (info.state === 'running' || info.state === 'paused') {
          setPendingAvatarUpload({
            status: 'uploading',
            percent: info.percent,
            bytesTransferred: info.bytesTransferred,
            totalBytes: info.totalBytes,
            fileName: file.name,
            error: null,
          });
        }
      },
    });
    pendingUploadHandleRef.current = handle;

    try {
      const res = await handle.promise;
      pendingUploadHandleRef.current = null;
      pendingAvatarFileRef.current = null;
      setHasPendingAvatarFile(false);

      // Persist uploaded avatar URL & Cloudinary publicId into pending registration record
      let previousPublicId: string | undefined;
      try {
        const raw = localStorage.getItem(PENDING_REG_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as PendingRegistrationProfile;
          previousPublicId = parsed.avatarPublicId;
          parsed.avatarUrl = res.downloadUrl;
          parsed.avatarPublicId = res.publicId;
          localStorage.setItem(PENDING_REG_KEY, JSON.stringify(parsed));
        }
      } catch {
        // Ignore storage parse failure
      }

      if (previousPublicId && previousPublicId !== res.publicId) {
        void deleteCloudinaryAsset(previousPublicId).catch(() => {});
      }

      await updateProfile(user, { photoURL: res.downloadUrl }).catch(() => {});

      if (user.emailVerified) {
        await updateDoc(doc(db, 'users', user.uid), {
          avatarUrl: res.downloadUrl,
          avatarPublicId: res.publicId,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      setPendingAvatarUpload({
        status: 'done',
        percent: 100,
        bytesTransferred: file.size,
        totalBytes: file.size,
        fileName: file.name,
        error: null,
      });
    } catch (err) {
      pendingUploadHandleRef.current = null;
      const msg = err instanceof Error ? err.message : 'Avatar upload failed.';
      setPendingAvatarUpload((prev) => ({
        ...prev,
        status: 'error',
        error: msg,
      }));
    }
  }, []);

  const retryPendingAvatarUpload = useCallback(
    async (replacementFile?: File | null) => {
      const targetUser = auth.currentUser;
      const file = replacementFile ?? pendingAvatarFileRef.current;
      if (!targetUser || !file) return;
      await runPendingAvatarUpload(file, targetUser);
    },
    [runPendingAvatarUpload]
  );

  const cancelPendingAvatarUpload = useCallback(() => {
    pendingUploadHandleRef.current?.cancel();
    pendingUploadHandleRef.current = null;
    setPendingAvatarUpload((prev) => ({
      ...prev,
      status: 'error',
      error: 'Avatar upload canceled. You can retry or continue with the default avatar.',
    }));
  }, []);

  const skipPendingAvatarUpload = useCallback(() => {
    pendingUploadHandleRef.current?.cancel();
    pendingUploadHandleRef.current = null;
    pendingAvatarFileRef.current = null;
    setHasPendingAvatarFile(false);
    setPendingAvatarUpload(INITIAL_UPLOAD_STATE);
    try {
      const raw = localStorage.getItem(PENDING_REG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PendingRegistrationProfile;
        if (parsed.avatarPublicId) {
          void deleteCloudinaryAsset(parsed.avatarPublicId).catch(() => {});
          delete parsed.avatarPublicId;
        }
        parsed.avatarUrl = ASSET_IMAGES.obsidianAvatar;
        localStorage.setItem(PENDING_REG_KEY, JSON.stringify(parsed));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const provisionUserDocuments = useCallback(
    async (user: User, reg?: PendingRegistrationProfile): Promise<void> => {
      if (!user.emailVerified) return;

      const requestedUsername = reg?.username ? normalizeUsername(reg.username) : '';
      const baseHandle =
        requestedUsername ||
        (user.email?.split('@')[0] || `user_${user.uid.slice(0, 6)}`)
          .toLowerCase()
          .replace(/[^a-z0-9_.]/g, '_')
          .slice(0, 24);

      const chosenUsername =
        isValidUsernameFormat(baseHandle) ? baseHandle : `ss_${user.uid.slice(0, 8)}`;

      let resolvedAutoUsername = chosenUsername;
      if (!requestedUsername) {
        const existingClaim = await getDoc(doc(db, 'usernames', chosenUsername));
        if (existingClaim.exists() && existingClaim.data()?.uid !== user.uid) {
          resolvedAutoUsername = `${chosenUsername.slice(0, 22)}_${user.uid.slice(0, 6).toLowerCase()}`;
        }
      }

      const displayName = truncateText(
        reg?.displayName || user.displayName || resolvedAutoUsername,
        64
      );
      const avatarUrl = reg?.avatarUrl || user.photoURL || ASSET_IMAGES.obsidianAvatar;

      try {
        await runTransaction(db, async (tx) => {
          const userRef = doc(db, 'users', user.uid);
          const existingUserSnap = await tx.get(userRef);
          if (existingUserSnap.exists()) {
            return;
          }

          let finalUsername = resolvedAutoUsername;
          const claimRef = doc(db, 'usernames', finalUsername);
          const claimSnap = await tx.get(claimRef);
          if (claimSnap.exists() && claimSnap.data()?.uid !== user.uid) {
            if (requestedUsername) {
              finalUsername = `${chosenUsername.slice(0, 22)}_${user.uid.slice(0, 6).toLowerCase()}`;
            } else {
              finalUsername = `ss_${user.uid.slice(0, 10).toLowerCase()}`;
            }
          }

          tx.set(doc(db, 'usernames', finalUsername), {
            uid: user.uid,
            username: finalUsername,
            createdAt: serverTimestamp(),
          });
          tx.set(userRef, {
            uid: user.uid,
            username: finalUsername,
            displayName,
            bio: 'Exploring ShadowSpace.',
            pronouns: '',
            location: '',
            website: '',
            statusMessage: '',
            onlineStatus: 'online',
            avatarUrl,
            ...(reg?.avatarPublicId ? { avatarPublicId: reg.avatarPublicId } : {}),
            bannerUrl: ASSET_IMAGES.studioBanner,
            accentColor: '#7c3aed',
            profileBg: '#14161D',
            profileVisibility: 'public',
            badges: ['Founding Member'],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(db, 'users', user.uid, 'private', 'account'), {
            uid: user.uid,
            email: user.email || `${user.uid}@shadowspace.local`,
            ageVerified: Boolean(reg?.ageVerified ?? true),
            afterDarkConsent: false,
            dmPermission: 'everyone',
            friendRequestPermission: 'everyone',
            suspended: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          tx.set(doc(db, 'userSettings', user.uid), {
            userId: user.uid,
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
            updatedAt: serverTimestamp(),
          });
        });
        localStorage.removeItem(PENDING_REG_KEY);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }
    },
    []
  );

  const attachProfileListeners = useCallback(
    (uid: string) => {
      if (subscribedUidRef.current === uid) return;
      clearProfileListeners();
      subscribedUidRef.current = uid;

      const unsubPublic = onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserPublic);
          }
        },
        (err) => {
          console.error('Live profile listener error:', err);
        }
      );

      const unsubPrivate = onSnapshot(
        doc(db, 'users', uid, 'private', 'account'),
        (snap) => {
          if (snap.exists()) {
            setPrivateAccount(snap.data() as UserPrivate);
          }
        },
        (err) => {
          console.error('Live private account listener error:', err);
        }
      );

      profileUnsubsRef.current = [unsubPublic, unsubPrivate];
    },
    [clearProfileListeners]
  );

  const loadProfileData = useCallback(
    async (user: User) => {
      if (!user.emailVerified) {
        clearProfileListeners();
        clearUserSettingsListener();
        setProfile(null);
        setPrivateAccount(null);
        setIsPlatformAdmin(false);
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      let snap;
      try {
        snap = await getDoc(userRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      }

      if (!snap.exists()) {
        let pendingReg: PendingRegistrationProfile | undefined;
        try {
          const raw = localStorage.getItem(PENDING_REG_KEY);
          if (raw) pendingReg = JSON.parse(raw) as PendingRegistrationProfile;
        } catch {
          // Ignore
        }
        await provisionUserDocuments(user, pendingReg);
        snap = await getDoc(userRef);
      }

      if (snap.exists()) {
        setProfile(snap.data() as UserPublic);
      }

      try {
        const privSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'account'));
        if (privSnap.exists()) {
          setPrivateAccount(privSnap.data() as UserPrivate);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}/private/account`);
      }

      attachProfileListeners(user.uid);

      let adminFlag = user.email === PLATFORM_OWNER_EMAIL && user.emailVerified;
      if (!adminFlag) {
        try {
          const admSnap = await getDoc(doc(db, 'admins', user.uid));
          if (admSnap.exists()) adminFlag = true;
        } catch {
          // Not admin
        }
      }
      setIsPlatformAdmin(adminFlag);
      await loadUserSettings(user.uid);
    },
    [
      attachProfileListeners,
      clearProfileListeners,
      clearUserSettingsListener,
      loadUserSettings,
      provisionUserDocuments,
    ]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          await loadProfileData(user);
        } catch (err) {
          console.error('Failed loading ShadowSpace profile:', err);
        }
      } else {
        clearProfileListeners();
        clearUserSettingsListener();
        setProfile(null);
        setPrivateAccount(null);
        setIsPlatformAdmin(false);
      }
      setLoading(false);
    });
    return () => {
      unsub();
      clearProfileListeners();
    };
  }, [clearProfileListeners, clearUserSettingsListener, loadProfileData]);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const registerWithEmail = async (
    email: string,
    password: string,
    registration: PendingRegistrationProfile,
    avatarFile?: File | null
  ) => {
    const normalizedUsername = normalizeUsername(registration.username);
    const availStatus = await checkUsernameAvailability(normalizedUsername);
    if (availStatus === 'invalid') {
      throw new Error(
        'Username must be 3-32 characters (lowercase letters, numbers, underscores, or dots).'
      );
    }
    if (availStatus === 'taken') {
      throw new Error('That username is already taken. Please choose another.');
    }
    if (availStatus === 'error') {
      throw new Error('Unable to verify username availability right now. Please try again.');
    }

    const sanitizedReg: PendingRegistrationProfile = {
      ...registration,
      username: normalizedUsername,
      displayName: truncateText(registration.displayName, 64),
      avatarUrl: registration.avatarUrl || ASSET_IMAGES.obsidianAvatar,
    };
    localStorage.setItem(PENDING_REG_KEY, JSON.stringify(sanitizedReg));

    // Create Auth UID first so signed Cloudinary upload is authorized for this user
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, {
      displayName: sanitizedReg.displayName,
    }).catch(() => {});
    await sendEmailVerification(cred.user);

    if (avatarFile) {
      // Upload directly to Cloudinary after Auth account creation;
      // failures stay recoverable via Retry / Choose Image / Use Default without re-creating Auth user.
      await runPendingAvatarUpload(avatarFile, cred.user);
    } else {
      setPendingAvatarUpload(INITIAL_UPLOAD_STATE);
      pendingAvatarFileRef.current = null;
      setHasPendingAvatarFile(false);
    }
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const refreshVerificationState = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    const updated = auth.currentUser;
    setFirebaseUser(updated);
    if (updated.emailVerified) {
      await loadProfileData(updated);
      return true;
    }
    return false;
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const changePassword = async (newPassword: string) => {
    if (!auth.currentUser) throw new Error('Not signed in');
    await updatePassword(auth.currentUser, newPassword);
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) throw new Error('Not signed in');
    const uid = auth.currentUser.uid;
    const uname = profile?.username;
    try {
      if (uname) {
        await setDoc(
          doc(db, 'users', uid),
          { onlineStatus: 'offline', updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
    } catch {
      // Proceed to delete auth user
    }
    await deleteUser(auth.currentUser);
  };

  const logout = async () => {
    pendingUploadHandleRef.current?.cancel();
    pendingUploadHandleRef.current = null;
    pendingAvatarFileRef.current = null;
    setHasPendingAvatarFile(false);
    setPendingAvatarUpload(INITIAL_UPLOAD_STATE);

    if (auth.currentUser && auth.currentUser.emailVerified && profile) {
      try {
        await setDoc(
          doc(db, 'users', auth.currentUser.uid),
          { onlineStatus: 'offline', updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch {
        // Non-blocking
      }
    }
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (auth.currentUser) {
      await loadProfileData(auth.currentUser);
    }
  };

  const completeOnboardingProfile = async (registration: PendingRegistrationProfile) => {
    if (!auth.currentUser) return;
    await provisionUserDocuments(auth.currentUser, registration);
    await loadProfileData(auth.currentUser);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        privateAccount,
        loading,
        isPlatformAdmin,
        pendingAvatarUpload,
        hasPendingAvatarFile,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        retryPendingAvatarUpload,
        cancelPendingAvatarUpload,
        skipPendingAvatarUpload,
        resendVerificationEmail,
        refreshVerificationState,
        sendPasswordReset,
        changePassword,
        deleteAccount,
        logout,
        checkUsernameAvailability,
        checkUsernameAvailable,
        refreshProfile,
        completeOnboardingProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
