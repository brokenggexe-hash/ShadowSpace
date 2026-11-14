import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth, type UsernameCheckStatus } from '../contexts/AuthContext';
import {
  ASSET_IMAGES,
  isValidUsernameFormat,
  normalizeUsername,
  validateMediaFileSafety,
  verifyImageDecodable,
} from '../utils/validators';

interface AuthScreenProps {
  onBackToCalculator: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AuthScreen({ onBackToCalculator }: AuthScreenProps) {
  const {
    firebaseUser,
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
    logout,
    checkUsernameAvailability,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [ageVerified, setAgeVerified] = useState(true);

  const [usernameState, setUsernameState] = useState<'idle' | 'checking' | UsernameCheckStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const registerFileInputRef = useRef<HTMLInputElement | null>(null);
  const verifyFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  useEffect(() => {
    if (mode !== 'register') return;
    const clean = normalizeUsername(username);
    if (!clean) {
      setUsernameState('idle');
      return;
    }
    if (!isValidUsernameFormat(clean)) {
      setUsernameState('invalid');
      return;
    }
    let cancelled = false;
    setUsernameState('checking');
    const timer = window.setTimeout(async () => {
      const status = await checkUsernameAvailability(clean);
      if (!cancelled) {
        setUsernameState(status);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, mode, checkUsernameAvailability]);

  const formatAuthError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('auth/operation-not-allowed')) {
      return 'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Please enable Email/Password there, or sign in with Google below.';
    }
    if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password')) {
      return 'Incorrect email or password.';
    }
    if (raw.includes('auth/email-already-in-use')) {
      return 'An account with this email already exists.';
    }
    if (raw.includes('auth/weak-password')) {
      return 'Password must be at least 6 characters.';
    }
    return raw;
  };

  const handleSelectAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    const safetyIssue = validateMediaFileSafety(file);
    if (safetyIssue) {
      setError(safetyIssue);
      return;
    }

    const decodable = await verifyImageDecodable(file);
    if (!decodable) {
      setError('Could not decode image. Select a valid JPG, PNG, WEBP, or GIF file.');
      return;
    }

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemoveAvatar = () => {
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    if (registerFileInputRef.current) {
      registerFileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else if (mode === 'register') {
        const cleanUser = normalizeUsername(username);
        if (!isValidUsernameFormat(cleanUser)) {
          throw new Error('Invalid username — use 3–32 lowercase letters, numbers, underscores, or dots.');
        }
        if (usernameState === 'taken') {
          throw new Error('That username is already taken.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        if (!displayName.trim()) {
          throw new Error('Display name is required.');
        }
        if (!ageVerified) {
          throw new Error('You must confirm age eligibility to create a ShadowSpace account.');
        }
        await registerWithEmail(
          email,
          password,
          {
            username: cleanUser,
            displayName: displayName.trim(),
            avatarUrl: ASSET_IMAGES.obsidianAvatar,
            ageVerified,
          },
          avatarFile
        );
        setNotice('Verification email sent! Please check your inbox and click the verification link.');
      } else {
        await sendPasswordReset(email);
        setNotice('Password reset instructions sent to your email.');
      }
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  // Email verification pending view (includes avatar upload progress / retry / recovery)
  if (firebaseUser && !firebaseUser.emailVerified) {
    return (
      <div className="min-h-screen bg-[#111214] text-zinc-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#1b1c21] border border-white/[0.08] rounded-2xl p-6 space-y-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#5865f2]/20 border border-[#5865f2]/30 flex items-center justify-center text-[#8ea1e1]">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold">Verify your email</h1>
              <p className="text-xs text-zinc-400">{firebaseUser.email}</p>
            </div>
          </div>

          <p className="text-sm text-zinc-300 leading-relaxed">
            ShadowSpace enforces verified accounts for all messaging and community actions. Click the verification link sent to your email, then refresh below.
          </p>

          {/* Avatar Upload Progress / Recovery Card */}
          {pendingAvatarUpload.status !== 'idle' && (
            <div className="p-3.5 rounded-xl bg-[#111214] border border-white/[0.07] space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-zinc-200 truncate">
                  Avatar: {pendingAvatarUpload.fileName || 'Profile image'}
                </span>
                <span className="font-mono text-zinc-400 tabular-nums shrink-0">
                  {pendingAvatarUpload.status === 'done'
                    ? 'Uploaded'
                    : pendingAvatarUpload.status === 'uploading'
                      ? `${pendingAvatarUpload.percent}%`
                      : 'Failed'}
                </span>
              </div>

              {pendingAvatarUpload.status === 'uploading' && (
                <>
                  <div className="h-1.5 w-full rounded-full bg-[#222328] overflow-hidden">
                    <div
                      className="h-full bg-[#5865f2] transition-all duration-150"
                      style={{ width: `${pendingAvatarUpload.percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Uploading avatar to Cloudinary…</span>
                    <button
                      type="button"
                      onClick={cancelPendingAvatarUpload}
                      className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 font-medium"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </>
              )}

              {pendingAvatarUpload.status === 'done' && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Profile picture uploaded and saved to your account.</span>
                </div>
              )}

              {pendingAvatarUpload.status === 'error' && (
                <div className="space-y-2.5">
                  <p className="text-xs text-rose-300 leading-relaxed">
                    {pendingAvatarUpload.error}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasPendingAvatarFile && (
                      <button
                        type="button"
                        onClick={() => void retryPendingAvatarUpload()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-medium"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Retry Upload
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => verifyFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
                    >
                      <Upload className="w-3.5 h-3.5" /> Choose Different Image
                    </button>
                    <button
                      type="button"
                      onClick={skipPendingAvatarUpload}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs"
                    >
                      Use Default Avatar
                    </button>
                    <input
                      ref={verifyFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={async (e) => {
                        const picked = e.target.files?.[0];
                        e.target.value = '';
                        if (!picked) return;
                        const issue = validateMediaFileSafety(picked);
                        if (issue) {
                          setError(issue);
                          return;
                        }
                        const ok = await verifyImageDecodable(picked);
                        if (!ok) {
                          setError('Could not decode image.');
                          return;
                        }
                        setError(null);
                        void retryPendingAvatarUpload(picked);
                      }}
                      className="hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300">
              {notice}
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={busy || pendingAvatarUpload.status === 'uploading'}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const verified = await refreshVerificationState();
                  if (!verified) setNotice('Not verified yet. Please check your inbox and spam folder.');
                } catch (err) {
                  setError(formatAuthError(err));
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full h-11 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
              {pendingAvatarUpload.status === 'uploading'
                ? `Uploading Avatar (${pendingAvatarUpload.percent}%)…`
                : "I've Verified — Continue"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await resendVerificationEmail();
                  setNotice('Verification email resent.');
                } catch (err) {
                  setError(formatAuthError(err));
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full h-11 rounded-xl bg-[#222328] hover:bg-[#2b2d34] border border-white/[0.07] text-zinc-200 text-sm font-medium transition-colors"
            >
              Resend Verification Email
            </button>
            <button
              type="button"
              onClick={logout}
              className="w-full h-10 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Sign out / Use another account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111214] text-zinc-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#1b1c21] border border-white/[0.08] rounded-2xl p-6 sm:p-7 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToCalculator}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Calculator
          </button>
          <div className="flex items-center gap-2">
            <img
              src={ASSET_IMAGES.brandEmblem}
              alt="ShadowSpace"
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-lg object-cover"
            />
            <span className="text-sm font-display font-bold">ShadowSpace</span>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">
            {mode === 'login'
              ? 'Sign in to ShadowSpace'
              : mode === 'register'
                ? 'Create your identity'
                : 'Reset password'}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Independent accounts · Zero paywalls · End-to-end session security
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 bg-[#111214] border border-white/[0.07] rounded-xl">
          {(['login', 'register', 'reset'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setMode(tab);
                setError(null);
                setNotice(null);
              }}
              className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                mode === tab
                  ? 'bg-[#5865f2] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab === 'login' ? 'Sign In' : tab === 'register' ? 'Register' : 'Reset'}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 leading-relaxed">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 leading-relaxed">
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'register' && (
            <>
              {/* Direct Profile Picture Uploader */}
              <div className="p-3.5 rounded-xl bg-[#111214] border border-white/[0.07] space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">
                    Profile Picture <span className="text-zinc-500">(optional)</span>
                  </label>
                  <span className="text-[11px] text-zinc-500">JPG, PNG, WEBP, GIF · max 10 MB</span>
                </div>

                <div className="flex items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => registerFileInputRef.current?.click()}
                    aria-label="Upload profile picture"
                    className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-dashed border-white/[0.15] hover:border-[#5865f2] bg-[#17181c] shrink-0 group transition-colors"
                  >
                    <img
                      src={avatarPreviewUrl || ASSET_IMAGES.obsidianAvatar}
                      alt="Profile picture preview"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Camera className="w-5 h-5 text-white" />
                    </span>
                  </button>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => registerFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-medium transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {avatarFile ? 'Change Photo' : 'Upload Photo'}
                      </button>

                      {avatarFile && (
                        <button
                          type="button"
                          onClick={handleRemoveAvatar}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#222328] hover:bg-[#2b2d34] text-zinc-300 text-xs transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      )}
                    </div>

                    <p className="text-[11px] text-zinc-400 truncate">
                      {avatarFile
                        ? `${avatarFile.name} (${formatFileSize(avatarFile.size)}) — uploads after signup`
                        : 'Click to upload from your device, or keep default avatar.'}
                    </p>
                  </div>
                </div>

                <input
                  ref={registerFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    e.target.value = '';
                    void handleSelectAvatarFile(picked);
                  }}
                  className="hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Unique Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/\s+/g, '').toLowerCase())}
                    placeholder="e.g. nova.velvet"
                    className="w-full h-10 px-3 pr-9 rounded-xl bg-[#111214] border border-white/[0.08] text-sm text-zinc-100 focus:outline-none focus:border-[#5865f2]"
                  />
                  <span className="absolute right-3 top-2.5">
                    {usernameState === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
                    {usernameState === 'available' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {(usernameState === 'taken' || usernameState === 'invalid') && (
                      <XCircle className="w-4 h-4 text-rose-400" />
                    )}
                    {usernameState === 'error' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  </span>
                </div>
                {usernameState === 'available' && (
                  <p className="text-[11px] text-emerald-400 mt-1">Available</p>
                )}
                {usernameState === 'taken' && (
                  <p className="text-[11px] text-rose-400 mt-1">Already taken</p>
                )}
                {usernameState === 'invalid' && (
                  <p className="text-[11px] text-rose-400 mt-1">
                    Invalid username — use 3–32 lowercase letters, numbers, _ or .
                  </p>
                )}
                {usernameState === 'error' && (
                  <p className="text-[11px] text-amber-400 mt-1">
                    Unable to check right now — verify connection and try again.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={64}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How friends see you"
                  className="w-full h-10 px-3 rounded-xl bg-[#111214] border border-white/[0.08] text-sm text-zinc-100 focus:outline-none focus:border-[#5865f2]"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full h-10 px-3 rounded-xl bg-[#111214] border border-white/[0.08] text-sm text-zinc-100 focus:outline-none focus:border-[#5865f2]"
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-xl bg-[#111214] border border-white/[0.08] text-sm text-zinc-100 focus:outline-none focus:border-[#5865f2]"
              />
            </div>
          )}

          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 px-3 rounded-xl bg-[#111214] border border-white/[0.08] text-sm text-zinc-100 focus:outline-none focus:border-[#5865f2]"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={ageVerified}
                  onChange={(e) => setAgeVerified(e.target.checked)}
                  className="mt-0.5 rounded border-white/[0.15] bg-[#111214] text-[#5865f2] focus:ring-[#5865f2]"
                />
                <span>I confirm I meet minimum age requirements and agree to ShadowSpace community safety rules.</span>
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-xl bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'login' ? (
              <ShieldCheck className="w-4 h-4" />
            ) : mode === 'register' ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <KeyRound className="w-4 h-4" />
            )}
            {mode === 'login'
              ? 'Sign In'
              : mode === 'register'
                ? 'Create Account'
                : 'Send Reset Email'}
          </button>
        </form>

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/[0.07]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[#1b1c21] px-3 text-zinc-500">or continue immediately with</span>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleGoogle}
          className="w-full h-11 rounded-xl bg-[#222328] hover:bg-[#2b2d34] border border-white/[0.08] text-zinc-100 text-sm font-medium inline-flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.4c-.2 1.2-1.5 3.6-5.4 3.6-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z"
            />
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
