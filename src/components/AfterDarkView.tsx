import React, { useState } from 'react';
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { Flame, Lock, Plus, ShieldCheck, Users } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Server } from '../types/shadowspace';
import { ASSET_IMAGES, generateId } from '../utils/validators';

interface AfterDarkViewProps {
  afterDarkServers: Server[];
  joinedServerIds: Set<string>;
  onSelectServer: (serverId: string) => void;
}

const CONVERSATION_PROMPTS = [
  'Midnight confessions: what small rule do you love breaking on weekends?',
  'Pick a late-night playlist track that sets an unforgettable mood.',
  'Flirty icebreaker: best unspoken compliment someone can give you?',
  'Overrated vs underrated date night ideas after 11 PM.',
];

export function AfterDarkView({
  afterDarkServers,
  joinedServerIds,
  onSelectServer,
}: AfterDarkViewProps) {
  const { firebaseUser, privateAccount, refreshProfile } = useAuth();
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasConsent = Boolean(privateAccount?.afterDarkConsent);

  const handleGrantConsent = async () => {
    if (!firebaseUser || !consentChecked) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'account'), {
        ageVerified: true,
        afterDarkConsent: true,
        updatedAt: serverTimestamp(),
      });
      await refreshProfile();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}/private/account`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAfterDarkLounge = async () => {
    if (!firebaseUser || !hasConsent) return;
    setBusy(true);
    try {
      const srvId = generateId('srv');
      const catId = generateId('cat');
      const chId = generateId('ch');

      const batch = writeBatch(db);
      batch.set(doc(db, 'servers', srvId), {
        id: srvId,
        name: 'Velvet After Dark',
        description: 'Consent-based adult humor, late-night banter, and flirtatious social lounge. Strictly moderated & safe.',
        iconUrl: ASSET_IMAGES.brandEmblem,
        bannerUrl: ASSET_IMAGES.afterDarkBanner,
        ownerId: firebaseUser.uid,
        isPublic: true,
        isAfterDark: true,
        category: 'After Dark',
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
        serverOwnerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channelCategories', catId), {
        id: catId,
        serverId: srvId,
        name: 'After Hours',
        position: 0,
        isPublicServer: true,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'channels', chId), {
        id: chId,
        serverId: srvId,
        categoryId: catId,
        name: 'velvet-lounge',
        type: 'text',
        topic: 'Flirty banter & adult humor · Zero explicit sexual content or harassment.',
        isPrivate: false,
        isPublic: true,
        isAfterDark: true,
        position: 0,
        ownerId: firebaseUser.uid,
        memberUids: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      onSelectServer(srvId);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'servers');
    } finally {
      setBusy(false);
    }
  };

  if (!hasConsent) {
    return (
      <div className="flex-1 bg-[#1b1c21] text-zinc-100 flex items-center justify-center p-6 overflow-y-auto">
        <div className="max-w-lg w-full bg-[#17181c] border border-rose-500/25 rounded-2xl overflow-hidden shadow-2xl">
          <div className="h-40 relative">
            <img
              src={ASSET_IMAGES.afterDarkBanner}
              alt="After Dark Lounge"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#17181c] via-[#17181c]/40 to-transparent" />
            <div className="absolute bottom-3 left-5 flex items-center gap-2 text-rose-400">
              <Flame className="w-5 h-5" />
              <span className="font-display font-bold text-lg text-white">After Dark Access Gate</span>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-zinc-300 leading-relaxed">
              After Dark is ShadowSpace&apos;s consent-gated social lounge for 18+ adult humor, flirty conversation prompts, and late-night community spaces.
            </p>
            <div className="p-3.5 rounded-xl bg-[#111214] border border-white/[0.07] space-y-1.5 text-xs text-zinc-400">
              <p className="font-semibold text-zinc-200">Mandatory Community Safety Rules:</p>
              <p>1. Participants must be 18+ and consent to suggestive/flirty themes.</p>
              <p>2. Explicit pornography, non-consensual imagery, exploitation, or illegal content is strictly prohibited.</p>
              <p>3. You may revoke visibility, block users, or report violations at any time.</p>
            </div>
            <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 rounded border-white/[0.15] bg-[#111214] text-rose-600 focus:ring-rose-500"
              />
              <span>
                I confirm I am 18+ and opt in to view consent-based After Dark communities and prompts.
              </span>
            </label>
            <button
              type="button"
              disabled={!consentChecked || busy}
              onClick={handleGrantConsent}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-[#5865f2] to-rose-600 hover:from-[#4752c4] hover:to-rose-500 text-white text-sm font-semibold disabled:opacity-40 transition-all"
            >
              {busy ? 'Confirming…' : 'Confirm 18+ & Enter After Dark'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#1b1c21] text-zinc-100 overflow-y-auto p-5 sm:p-7">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="relative rounded-2xl overflow-hidden border border-rose-500/25">
          <img
            src={ASSET_IMAGES.afterDarkBanner}
            alt="After Dark"
            referrerPolicy="no-referrer"
            className="w-full h-48 object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#141019] via-[#141019]/80 to-transparent" />
          <div className="absolute inset-0 p-6 flex flex-col justify-end">
            <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold mb-1">
              <ShieldCheck className="w-4 h-4" />
              Consent Verified · Moderated 18+ Space
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
              After Dark Lounge
            </h1>
            <p className="text-xs sm:text-sm text-zinc-300 max-w-xl mt-1">
              Deep charcoal nights, suggestive banter, and curated adult-humor communities with instant blocking & moderation controls.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-[#222328] border border-white/[0.07] p-5 space-y-3">
            <h2 className="font-display font-semibold text-base text-rose-300">
              Tonight&apos;s Conversation Prompts
            </h2>
            <div className="space-y-2.5">
              {CONVERSATION_PROMPTS.map((prompt, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-[#17181c] border border-white/[0.06] text-xs text-zinc-300 leading-relaxed"
                >
                  {prompt}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-[#222328] border border-white/[0.07] p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <h2 className="font-display font-semibold text-base text-rose-200">
                Safety & Visibility Controls
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                After Dark spaces enforce strict consent, zero non-consensual content, and zero explicit pornography. You can opt out anytime in Settings → Privacy.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleCreateAfterDarkLounge}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" />
                {busy ? 'Launching…' : 'Launch After Dark Lounge'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!firebaseUser) return;
                  await updateDoc(doc(db, 'users', firebaseUser.uid, 'private', 'account'), {
                    afterDarkConsent: false,
                    updatedAt: serverTimestamp(),
                  });
                  await refreshProfile();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#17181c] hover:bg-[#2b2d34] border border-white/[0.07] text-xs text-zinc-300"
              >
                <Lock className="w-3.5 h-3.5" />
                Hide After Dark
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="font-display font-semibold text-base">After Dark Communities</h2>
          {afterDarkServers.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No public After Dark communities active yet. Launch one above!
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {afterDarkServers.map((srv) => (
                <div
                  key={srv.id}
                  style={srv.accentColor ? { borderColor: `${srv.accentColor}55` } : undefined}
                  className="rounded-2xl bg-[#222328] border border-rose-500/20 p-4 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={srv.iconUrl || ASSET_IMAGES.brandEmblem}
                          alt={srv.name}
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded-lg object-cover shrink-0"
                        />
                        <h3 className="font-display font-semibold text-sm truncate">{srv.name}</h3>
                      </div>
                      <span className="text-[11px] text-rose-400 shrink-0 inline-flex items-center gap-1">
                        <Users className="w-3 h-3" /> {srv.memberCount}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2">{srv.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectServer(srv.id)}
                    className="w-full h-9 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/30 text-xs font-semibold transition-colors"
                  >
                    {joinedServerIds.has(srv.id) ? 'Enter Lounge' : 'Preview & Join'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
