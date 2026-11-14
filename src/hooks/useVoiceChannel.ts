import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useRealtime } from '../contexts/RealtimeContext';
import { apiRequest } from '../services/apiClient';
import type { Channel } from '../types/shadowspace';

export interface ActiveVoiceRoom {
  channel: Channel;
  serverName: string;
}

interface IceServersApiResponse {
  ice_servers?: RTCIceServer[];
  iceServers?: RTCIceServer[];
  ttl?: number;
}

const GOOGLE_STUN_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function useVoiceChannel() {
  const { firebaseUser, profile } = useAuth();
  const { sendWs, subscribeVoiceSignals, voiceParticipants } = useRealtime();

  const [activeVoice, setActiveVoice] = useState<ActiveVoiceRoom | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const remoteAudioRef = useRef(new Map<string, HTMLAudioElement>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const reinitializingPeersRef = useRef(new Set<string>());

  const iceConfigRef = useRef<RTCIceServer[]>(GOOGLE_STUN_FALLBACK);
  const iceFetchedAtRef = useRef<number>(0);
  const iceTtlMsRef = useRef<number>(3600 * 1000);
  const iceFetchPromiseRef = useRef<Promise<RTCIceServer[]> | null>(null);

  const analyserTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const refreshIceServers = useCallback(async (force = false): Promise<RTCIceServer[]> => {
    const now = Date.now();
    const ageMs = now - iceFetchedAtRef.current;
    // Reuse existing ephemeral credentials only when recently fetched (within 75% of TTL)
    if (!force && iceFetchedAtRef.current > 0 && ageMs < iceTtlMsRef.current * 0.75) {
      return iceConfigRef.current;
    }

    if (iceFetchPromiseRef.current && !force) {
      return iceFetchPromiseRef.current;
    }

    const reqPromise = (async () => {
      try {
        const res = await apiRequest<IceServersApiResponse>('/api/ice-servers');
        const servers =
          Array.isArray(res?.ice_servers) && res.ice_servers.length > 0
            ? res.ice_servers
            : Array.isArray(res?.iceServers) && res.iceServers.length > 0
              ? res.iceServers
              : null;

        if (servers) {
          iceConfigRef.current = servers;
          iceFetchedAtRef.current = Date.now();
          const ttlSec = typeof res?.ttl === 'number' && res.ttl > 0 ? res.ttl : 3600;
          iceTtlMsRef.current = ttlSec * 1000;
          return servers;
        }
      } catch {
        // Keep/use Google STUN fallback if token endpoint fails
      }
      if (iceConfigRef.current.length === 0) {
        iceConfigRef.current = GOOGLE_STUN_FALLBACK;
      }
      return iceConfigRef.current;
    })();

    iceFetchPromiseRef.current = reqPromise;
    try {
      return await reqPromise;
    } finally {
      if (iceFetchPromiseRef.current === reqPromise) {
        iceFetchPromiseRef.current = null;
      }
    }
  }, []);

  const cleanupMediaAndPeers = useCallback(async () => {
    if (analyserTimerRef.current) {
      window.clearInterval(analyserTimerRef.current);
      analyserTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      await audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    for (const pc of peersRef.current.values()) {
      pc.close();
    }
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    reinitializingPeersRef.current.clear();

    for (const audio of remoteAudioRef.current.values()) {
      audio.pause();
      audio.srcObject = null;
    }
    remoteAudioRef.current.clear();

    iceConfigRef.current = GOOGLE_STUN_FALLBACK;
    iceFetchedAtRef.current = 0;
  }, []);

  const flushPendingCandidates = useCallback(async (peerUid: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerUid);
    if (!queued || queued.length === 0) return;
    pendingCandidatesRef.current.delete(peerUid);
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    }
  }, []);

  const createPeerConnection = useCallback(
    async (peerUid: string, channelId: string, forceFreshIce = false) => {
      const existing = peersRef.current.get(peerUid);
      if (existing) existing.close();

      const freshIceServers = await refreshIceServers(forceFreshIce);
      const pc = new RTCPeerConnection({ iceServers: freshIceServers });
      peersRef.current.set(peerUid, pc);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && peersRef.current.get(peerUid) === pc) {
          sendWs({
            type: 'voice:ice-candidate',
            channelId,
            targetUid: peerUid,
            payload: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        let audio = remoteAudioRef.current.get(peerUid);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          remoteAudioRef.current.set(peerUid, audio);
        }
        audio.srcObject = stream;
        audio.muted = deafened;
        void audio.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        if (peersRef.current.get(peerUid) !== pc) return;
        if (pc.connectionState === 'failed' && !reinitializingPeersRef.current.has(peerUid)) {
          reinitializingPeersRef.current.add(peerUid);
          void (async () => {
            try {
              const renewedIce = await refreshIceServers(true);
              if (peersRef.current.get(peerUid) !== pc || pc.signalingState === 'closed') {
                return;
              }
              try {
                pc.setConfiguration({ iceServers: renewedIce });
              } catch {
                // Ignore if browser rejects setConfiguration mid-transition
              }
              pc.restartIce();
            } finally {
              reinitializingPeersRef.current.delete(peerUid);
            }
          })();
        }
      };

      return pc;
    },
    [deafened, refreshIceServers, sendWs]
  );

  useEffect(() => {
    const unsub = subscribeVoiceSignals(async (msg) => {
      if (!activeVoice) return;
      const channelId = activeVoice.channel.id;
      if (msg.channelId !== channelId) return;

      if (msg.type === 'voice:peer-joined' && msg.uid && msg.uid !== firebaseUser?.uid) {
        const pc = await createPeerConnection(msg.uid, channelId, true);
        if (peersRef.current.get(msg.uid) !== pc) return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs({
          type: 'voice:offer',
          channelId,
          targetUid: msg.uid,
          payload: offer,
        });
      } else if (msg.type === 'voice:offer' && msg.fromUid) {
        const pc = await createPeerConnection(msg.fromUid, channelId, false);
        if (peersRef.current.get(msg.fromUid) !== pc) return;
        await pc.setRemoteDescription(
          new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit)
        );
        await flushPendingCandidates(msg.fromUid, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWs({
          type: 'voice:answer',
          channelId,
          targetUid: msg.fromUid,
          payload: answer,
        });
      } else if (msg.type === 'voice:answer' && msg.fromUid) {
        const pc = peersRef.current.get(msg.fromUid);
        if (pc) {
          await pc.setRemoteDescription(
            new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit)
          );
          await flushPendingCandidates(msg.fromUid, pc);
        }
      } else if (msg.type === 'voice:ice-candidate' && msg.fromUid && msg.payload) {
        const candidate = msg.payload as RTCIceCandidateInit;
        const pc = peersRef.current.get(msg.fromUid);
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        } else {
          const queue = pendingCandidatesRef.current.get(msg.fromUid) || [];
          queue.push(candidate);
          pendingCandidatesRef.current.set(msg.fromUid, queue);
        }
      } else if (msg.type === 'voice:peer-left' && msg.uid) {
        peersRef.current.get(msg.uid)?.close();
        peersRef.current.delete(msg.uid);
        pendingCandidatesRef.current.delete(msg.uid);
        reinitializingPeersRef.current.delete(msg.uid);
        const audio = remoteAudioRef.current.get(msg.uid);
        if (audio) {
          audio.pause();
          audio.srcObject = null;
          remoteAudioRef.current.delete(msg.uid);
        }
      }
    });
    return unsub;
  }, [
    activeVoice,
    createPeerConnection,
    firebaseUser?.uid,
    flushPendingCandidates,
    sendWs,
    subscribeVoiceSignals,
  ]);

  const leaveChannel = useCallback(async () => {
    const prev = activeVoice;
    sendWs({ type: 'voice:leave' });
    setActiveVoice(null);
    setConnectionStatus('idle');
    setSpeaking(false);
    await cleanupMediaAndPeers();
    if (prev && firebaseUser) {
      const sessionId = `${prev.channel.id}_${firebaseUser.uid}`;
      await deleteDoc(doc(db, 'voiceSessions', sessionId)).catch(() => {});
    }
  }, [activeVoice, cleanupMediaAndPeers, firebaseUser, sendWs]);

  const joinChannel = useCallback(
    async (channel: Channel, serverName: string) => {
      if (!firebaseUser) return;
      if (activeVoice?.channel.id === channel.id) return;
      if (activeVoice) await leaveChannel();

      setErrorMsg(null);
      setConnectionStatus('connecting');
      try {
        // Always fetch fresh Twilio NTS / STUN ICE credentials when initializing voice
        await refreshIceServers(true);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        let lastSpeakState = false;
        analyserTimerRef.current = window.setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const isSpeakingNow = !muted && avg > 14;
          if (isSpeakingNow !== lastSpeakState) {
            lastSpeakState = isSpeakingNow;
            setSpeaking(isSpeakingNow);
            sendWs({
              type: 'voice:state',
              muted,
              deafened,
              speaking: isSpeakingNow,
            });
          }
        }, 200);

        setActiveVoice({ channel, serverName });
        setConnectionStatus('connected');
        sendWs({
          type: 'voice:join',
          channelId: channel.id,
          muted: false,
          deafened: false,
        });

        const sessionId = `${channel.id}_${firebaseUser.uid}`;
        await setDoc(doc(db, 'voiceSessions', sessionId), {
          id: sessionId,
          channelId: channel.id,
          serverId: channel.serverId,
          userId: firebaseUser.uid,
          displayName: profile?.displayName || 'Member',
          muted: false,
          deafened: false,
          speaking: false,
          joinedAt: serverTimestamp(),
        }).catch(() => {});
      } catch (err) {
        await cleanupMediaAndPeers();
        setConnectionStatus('error');
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Microphone permission or WebRTC audio initialization failed.'
        );
      }
    },
    [
      activeVoice,
      cleanupMediaAndPeers,
      deafened,
      firebaseUser,
      leaveChannel,
      muted,
      profile?.displayName,
      refreshIceServers,
      sendWs,
    ]
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    sendWs({ type: 'voice:state', muted: next, deafened, speaking: false });
  }, [deafened, muted, sendWs]);

  const toggleDeafen = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    for (const audio of remoteAudioRef.current.values()) {
      audio.muted = next;
    }
    sendWs({ type: 'voice:state', muted: next ? true : muted, deafened: next, speaking: false });
  }, [deafened, muted, sendWs]);

  useEffect(() => {
    return () => {
      void cleanupMediaAndPeers();
    };
  }, [cleanupMediaAndPeers]);

  return {
    activeVoice,
    connectionStatus,
    errorMsg,
    muted,
    deafened,
    speaking,
    participants: activeVoice ? voiceParticipants[activeVoice.channel.id] || [] : [],
    allVoiceParticipants: voiceParticipants,
    joinChannel,
    leaveChannel,
    toggleMute,
    toggleDeafen,
  };
}
