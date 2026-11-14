import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyFirebaseIdToken } from '../config/firebase.ts';

interface ClientMeta {
  ws: WebSocket;
  uid: string;
  displayName: string;
  rooms: Set<string>;
  voiceChannelId: string | null;
  voiceState: {
    muted: boolean;
    deafened: boolean;
    speaking: boolean;
  };
}

export interface VoiceParticipantInfo {
  uid: string;
  displayName: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Set<ClientMeta>>();
  private metaByWs = new Map<WebSocket, ClientMeta>();
  private voiceRooms = new Map<string, Map<string, VoiceParticipantInfo>>();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      let authedMeta: ClientMeta | null = null;

      const authTimeout = setTimeout(() => {
        if (!authedMeta && ws.readyState === WebSocket.OPEN) {
          ws.close(4001, 'Authentication timeout');
        }
      }, 15000);

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          const type = String(msg.type || '');

          if (type === 'auth') {
            const token = String(msg.token || '');
            const displayName = String(msg.displayName || 'User').slice(0, 64);
            if (!token) {
              ws.close(4002, 'Missing token');
              return;
            }
            const verified = await verifyFirebaseIdToken(token);
            clearTimeout(authTimeout);
            authedMeta = {
              ws,
              uid: verified.uid,
              displayName,
              rooms: new Set(),
              voiceChannelId: null,
              voiceState: { muted: false, deafened: false, speaking: false },
            };
            this.metaByWs.set(ws, authedMeta);
            const set = this.clients.get(verified.uid) || new Set<ClientMeta>();
            set.add(authedMeta);
            this.clients.set(verified.uid, set);

            this.sendToWs(ws, {
              type: 'auth:ok',
              uid: verified.uid,
              onlineUids: Array.from(this.clients.keys()),
              voiceSnapshot: this.getVoiceSnapshot(),
            });
            this.broadcastAll({
              type: 'presence:update',
              uid: verified.uid,
              status: 'online',
            });
            return;
          }

          if (!authedMeta) {
            this.sendToWs(ws, { type: 'error', message: 'Authenticate first' });
            return;
          }

          switch (type) {
            case 'room:join': {
              const roomId = String(msg.roomId || '');
              if (roomId) authedMeta.rooms.add(roomId);
              break;
            }
            case 'room:leave': {
              const roomId = String(msg.roomId || '');
              if (roomId) authedMeta.rooms.delete(roomId);
              break;
            }
            case 'typing:start':
            case 'typing:stop': {
              const roomId = String(msg.roomId || '');
              if (!roomId) break;
              this.broadcastToRoom(
                roomId,
                {
                  type,
                  roomId,
                  uid: authedMeta.uid,
                  displayName: authedMeta.displayName,
                },
                authedMeta.uid
              );
              break;
            }
            case 'message:sync': {
              const roomId = String(msg.roomId || '');
              if (roomId && msg.message) {
                this.broadcastToRoom(
                  roomId,
                  {
                    type: 'message:created',
                    roomId,
                    message: msg.message,
                  },
                  authedMeta.uid
                );
              }
              break;
            }
            case 'message:update': {
              const roomId = String(msg.roomId || '');
              if (roomId && msg.message) {
                this.broadcastToRoom(
                  roomId,
                  {
                    type: 'message:updated',
                    roomId,
                    message: msg.message,
                  },
                  authedMeta.uid
                );
              }
              break;
            }
            case 'server:update': {
              const serverId = String(msg.serverId || '');
              if (serverId) {
                this.broadcastAll({
                  type: 'server:updated',
                  serverId,
                  actorUid: authedMeta.uid,
                });
              }
              break;
            }
            case 'voice:join': {
              const channelId = String(msg.channelId || '');
              if (!channelId) break;
              if (authedMeta.voiceChannelId && authedMeta.voiceChannelId !== channelId) {
                this.leaveVoiceChannel(authedMeta);
              }
              authedMeta.voiceChannelId = channelId;
              authedMeta.voiceState = {
                muted: Boolean(msg.muted),
                deafened: Boolean(msg.deafened),
                speaking: false,
              };
              const room = this.voiceRooms.get(channelId) || new Map<string, VoiceParticipantInfo>();
              room.set(authedMeta.uid, {
                uid: authedMeta.uid,
                displayName: authedMeta.displayName,
                ...authedMeta.voiceState,
              });
              this.voiceRooms.set(channelId, room);
              this.broadcastVoiceParticipants(channelId);
              this.broadcastToVoicePeers(
                channelId,
                {
                  type: 'voice:peer-joined',
                  channelId,
                  uid: authedMeta.uid,
                  displayName: authedMeta.displayName,
                },
                authedMeta.uid
              );
              break;
            }
            case 'voice:leave': {
              this.leaveVoiceChannel(authedMeta);
              break;
            }
            case 'voice:state': {
              const channelId = authedMeta.voiceChannelId;
              if (!channelId) break;
              authedMeta.voiceState = {
                muted: Boolean(msg.muted),
                deafened: Boolean(msg.deafened),
                speaking: Boolean(msg.speaking),
              };
              const room = this.voiceRooms.get(channelId);
              if (room) {
                room.set(authedMeta.uid, {
                  uid: authedMeta.uid,
                  displayName: authedMeta.displayName,
                  ...authedMeta.voiceState,
                });
                this.broadcastVoiceParticipants(channelId);
              }
              break;
            }
            case 'voice:offer':
            case 'voice:answer':
            case 'voice:ice-candidate': {
              const targetUid = String(msg.targetUid || '');
              const channelId = String(msg.channelId || authedMeta.voiceChannelId || '');
              if (!targetUid || !channelId) break;
              this.sendToUser(targetUid, {
                type,
                channelId,
                fromUid: authedMeta.uid,
                payload: msg.payload,
              });
              break;
            }
            default:
              break;
          }
        } catch (err) {
          this.sendToWs(ws, {
            type: 'error',
            message: err instanceof Error ? err.message : 'Invalid WS frame',
          });
        }
      });

      ws.on('close', () => {
        clearTimeout(authTimeout);
        const meta = this.metaByWs.get(ws);
        if (!meta) return;
        this.metaByWs.delete(ws);
        this.leaveVoiceChannel(meta);
        const set = this.clients.get(meta.uid);
        if (set) {
          set.delete(meta);
          if (set.size === 0) {
            this.clients.delete(meta.uid);
            this.broadcastAll({
              type: 'presence:update',
              uid: meta.uid,
              status: 'offline',
            });
          }
        }
      });
    });
  }

  private leaveVoiceChannel(meta: ClientMeta): void {
    const channelId = meta.voiceChannelId;
    if (!channelId) return;
    meta.voiceChannelId = null;
    const room = this.voiceRooms.get(channelId);
    if (room) {
      room.delete(meta.uid);
      if (room.size === 0) {
        this.voiceRooms.delete(channelId);
      }
      this.broadcastVoiceParticipants(channelId);
      this.broadcastToVoicePeers(
        channelId,
        { type: 'voice:peer-left', channelId, uid: meta.uid },
        meta.uid
      );
    }
  }

  private getVoiceSnapshot(): Record<string, VoiceParticipantInfo[]> {
    const snapshot: Record<string, VoiceParticipantInfo[]> = {};
    for (const [channelId, map] of this.voiceRooms.entries()) {
      snapshot[channelId] = Array.from(map.values());
    }
    return snapshot;
  }

  private broadcastVoiceParticipants(channelId: string): void {
    const participants = Array.from(this.voiceRooms.get(channelId)?.values() || []);
    this.broadcastAll({
      type: 'voice:participants',
      channelId,
      participants,
    });
  }

  private broadcastToVoicePeers(
    channelId: string,
    payload: Record<string, unknown>,
    excludeUid?: string
  ): void {
    const room = this.voiceRooms.get(channelId);
    if (!room) return;
    for (const uid of room.keys()) {
      if (uid !== excludeUid) {
        this.sendToUser(uid, payload);
      }
    }
  }

  public broadcastToRoom(
    roomId: string,
    payload: Record<string, unknown>,
    excludeUid?: string
  ): void {
    for (const meta of this.metaByWs.values()) {
      if (meta.rooms.has(roomId) && meta.uid !== excludeUid) {
        this.sendToWs(meta.ws, payload);
      }
    }
  }

  public sendToUser(uid: string, payload: Record<string, unknown>): void {
    const set = this.clients.get(uid);
    if (!set) return;
    for (const meta of set) {
      this.sendToWs(meta.ws, payload);
    }
  }

  public broadcastAll(payload: Record<string, unknown>): void {
    for (const meta of this.metaByWs.values()) {
      this.sendToWs(meta.ws, payload);
    }
  }

  private sendToWs(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  public getOnlineCount(): number {
    return this.clients.size;
  }
}

export const realtimeHub = new RealtimeHub();
