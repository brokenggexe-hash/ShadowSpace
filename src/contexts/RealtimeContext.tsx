import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Message } from '../types/shadowspace';
import { useAuth } from './AuthContext';

export interface VoicePeerState {
  uid: string;
  displayName: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

type SignalListener = (msg: {
  type: string;
  channelId: string;
  fromUid?: string;
  uid?: string;
  displayName?: string;
  payload?: unknown;
}) => void;

type RoomMessageListener = (msg: Message) => void;

interface RealtimeContextValue {
  connected: boolean;
  onlineUids: Set<string>;
  typingByRoom: Record<string, Array<{ uid: string; displayName: string }>>;
  voiceParticipants: Record<string, VoicePeerState[]>;
  joinRoom: (roomId: string) => void;
  leaveRoom: (roomId: string) => void;
  sendTyping: (roomId: string, active: boolean) => void;
  broadcastRoomMessage: (roomId: string, message: Message) => void;
  broadcastRoomMessageUpdate: (roomId: string, message: Message) => void;
  broadcastServerUpdate: (serverId: string) => void;
  sendWs: (payload: Record<string, unknown>) => void;
  subscribeRoomMessages: (roomId: string, fn: RoomMessageListener) => () => void;
  subscribeRoomMessageUpdates: (roomId: string, fn: RoomMessageListener) => () => void;
  subscribeServerUpdates: (fn: (serverId: string) => void) => () => void;
  subscribeVoiceSignals: (fn: SignalListener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUids, setOnlineUids] = useState<Set<string>>(new Set());
  const [typingByRoom, setTypingByRoom] = useState<
    Record<string, Array<{ uid: string; displayName: string }>>
  >({});
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoicePeerState[]>>({});

  const roomListenersRef = useRef(new Map<string, Set<RoomMessageListener>>());
  const roomUpdateListenersRef = useRef(new Map<string, Set<RoomMessageListener>>());
  const serverUpdateListenersRef = useRef(new Set<(serverId: string) => void>());
  const voiceListenersRef = useRef(new Set<SignalListener>());
  const joinedRoomsRef = useRef(new Set<string>());
  const typingTimeoutsRef = useRef(new Map<string, number>());

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified) {
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | undefined;

    const connect = async () => {
      if (cancelled) return;
      try {
        const token = await firebaseUser.getIdToken();
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'auth',
              token,
              displayName: profile?.displayName || firebaseUser.displayName || 'Member',
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string) as Record<string, unknown>;
            const type = String(data.type || '');

            if (type === 'auth:ok') {
              setConnected(true);
              setOnlineUids(new Set((data.onlineUids as string[]) || []));
              if (data.voiceSnapshot) {
                setVoiceParticipants(data.voiceSnapshot as Record<string, VoicePeerState[]>);
              }
              for (const roomId of joinedRoomsRef.current) {
                ws.send(JSON.stringify({ type: 'room:join', roomId }));
              }
            } else if (type === 'presence:update') {
              const uid = String(data.uid || '');
              const status = String(data.status || '');
              setOnlineUids((prev) => {
                const next = new Set(prev);
                if (status === 'online') next.add(uid);
                else next.delete(uid);
                return next;
              });
            } else if (type === 'typing:start' || type === 'typing:stop') {
              const roomId = String(data.roomId || '');
              const uid = String(data.uid || '');
              const displayName = String(data.displayName || 'Someone');
              const timeoutKey = `${roomId}:${uid}`;

              const existingTimer = typingTimeoutsRef.current.get(timeoutKey);
              if (existingTimer) window.clearTimeout(existingTimer);

              setTypingByRoom((prev) => {
                const list = (prev[roomId] || []).filter((t) => t.uid !== uid);
                if (type === 'typing:start') {
                  return { ...prev, [roomId]: [...list, { uid, displayName }] };
                }
                return { ...prev, [roomId]: list };
              });

              if (type === 'typing:start') {
                const tid = window.setTimeout(() => {
                  setTypingByRoom((prev) => ({
                    ...prev,
                    [roomId]: (prev[roomId] || []).filter((t) => t.uid !== uid),
                  }));
                }, 4000);
                typingTimeoutsRef.current.set(timeoutKey, tid);
              }
            } else if (type === 'message:created') {
              const roomId = String(data.roomId || '');
              const message = data.message as Message | undefined;
              if (roomId && message) {
                const listeners = roomListenersRef.current.get(roomId);
                listeners?.forEach((fn) => fn(message));
              }
            } else if (type === 'message:updated') {
              const roomId = String(data.roomId || '');
              const message = data.message as Message | undefined;
              if (roomId && message) {
                const listeners = roomUpdateListenersRef.current.get(roomId);
                listeners?.forEach((fn) => fn(message));
              }
            } else if (type === 'server:updated') {
              const serverId = String(data.serverId || '');
              if (serverId) {
                serverUpdateListenersRef.current.forEach((fn) => fn(serverId));
              }
            } else if (type === 'voice:participants') {
              const channelId = String(data.channelId || '');
              const participants = (data.participants as VoicePeerState[]) || [];
              setVoiceParticipants((prev) => ({ ...prev, [channelId]: participants }));
            } else if (
              type === 'voice:peer-joined' ||
              type === 'voice:peer-left' ||
              type === 'voice:offer' ||
              type === 'voice:answer' ||
              type === 'voice:ice-candidate'
            ) {
              voiceListenersRef.current.forEach((fn) =>
                fn(data as unknown as Parameters<SignalListener>[0])
              );
            }
          } catch {
            // Ignore malformed socket frames
          }
        };

        ws.onclose = () => {
          setConnected(false);
          if (!cancelled) {
            reconnectTimer = window.setTimeout(connect, 2500);
          }
        };
      } catch {
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 4000);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [firebaseUser, profile?.displayName]);

  const joinRoom = useCallback(
    (roomId: string) => {
      joinedRoomsRef.current.add(roomId);
      sendWs({ type: 'room:join', roomId });
    },
    [sendWs]
  );

  const leaveRoom = useCallback(
    (roomId: string) => {
      joinedRoomsRef.current.delete(roomId);
      sendWs({ type: 'room:leave', roomId });
    },
    [sendWs]
  );

  const sendTyping = useCallback(
    (roomId: string, active: boolean) => {
      sendWs({ type: active ? 'typing:start' : 'typing:stop', roomId });
    },
    [sendWs]
  );

  const broadcastRoomMessage = useCallback(
    (roomId: string, message: Message) => {
      sendWs({ type: 'message:sync', roomId, message });
    },
    [sendWs]
  );

  const broadcastRoomMessageUpdate = useCallback(
    (roomId: string, message: Message) => {
      sendWs({ type: 'message:update', roomId, message });
    },
    [sendWs]
  );

  const broadcastServerUpdate = useCallback(
    (serverId: string) => {
      sendWs({ type: 'server:update', serverId });
    },
    [sendWs]
  );

  const subscribeRoomMessages = useCallback((roomId: string, fn: RoomMessageListener) => {
    const set = roomListenersRef.current.get(roomId) || new Set<RoomMessageListener>();
    set.add(fn);
    roomListenersRef.current.set(roomId, set);
    return () => {
      const existing = roomListenersRef.current.get(roomId);
      existing?.delete(fn);
    };
  }, []);

  const subscribeRoomMessageUpdates = useCallback((roomId: string, fn: RoomMessageListener) => {
    const set = roomUpdateListenersRef.current.get(roomId) || new Set<RoomMessageListener>();
    set.add(fn);
    roomUpdateListenersRef.current.set(roomId, set);
    return () => {
      const existing = roomUpdateListenersRef.current.get(roomId);
      existing?.delete(fn);
    };
  }, []);

  const subscribeServerUpdates = useCallback((fn: (serverId: string) => void) => {
    serverUpdateListenersRef.current.add(fn);
    return () => {
      serverUpdateListenersRef.current.delete(fn);
    };
  }, []);

  const subscribeVoiceSignals = useCallback((fn: SignalListener) => {
    voiceListenersRef.current.add(fn);
    return () => {
      voiceListenersRef.current.delete(fn);
    };
  }, []);

  return (
    <RealtimeContext.Provider
      value={{
        connected,
        onlineUids,
        typingByRoom,
        voiceParticipants,
        joinRoom,
        leaveRoom,
        sendTyping,
        broadcastRoomMessage,
        broadcastRoomMessageUpdate,
        broadcastServerUpdate,
        sendWs,
        subscribeRoomMessages,
        subscribeRoomMessageUpdates,
        subscribeServerUpdates,
        subscribeVoiceSignals,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}
