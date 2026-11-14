import crypto from 'node:crypto';
import { Router } from 'express';
import { PLATFORM_OWNER_EMAIL } from '../config/firebase.ts';
import {
  type AuthedRequest,
  rateLimit,
  requireAuth,
  requirePlatformAdmin,
  requireSignedIn,
} from '../middleware/auth.ts';
import {
  type BatchWriteSpec,
  fsBatchCommit,
  fsCommitWrite,
  fsDeleteDoc,
  fsGetDoc,
  fsRunQuery,
} from '../services/firestoreRest.ts';
import {
  adminReportUpdateSchema,
  adminSuspendSchema,
  cloudinaryDeleteSchema,
  cloudinarySignSchema,
  joinInviteSchema,
  moderationActionSchema,
  sendMessageSchema,
  uploadValidateSchema,
} from '../validators/schemas.ts';
import {
  CloudinaryServiceError,
  createSignedUploadParams,
  destroyCloudinaryAsset,
} from '../services/cloudinaryService.ts';
import { getDynamicIceServers } from '../services/twilioNts.ts';
import { realtimeHub } from '../ws/realtime.ts';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'shadowspace-api',
    onlineUsers: realtimeHub.getOnlineCount(),
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get(
  '/ice-servers',
  requireAuth,
  rateLimit('ice_servers', 30, 60_000),
  async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const resolved = await getDynamicIceServers();
      res.json(resolved);
    } catch (err) {
      next(err);
    }
  }
);

apiRouter.post(
  '/uploads/validate',
  requireSignedIn,
  rateLimit('upload', 25, 60_000),
  (req: AuthedRequest, res) => {
    const parsed = uploadValidateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid upload metadata', details: parsed.error.flatten() });
      return;
    }
    const { fileName, mimeType, sizeBytes, purpose } = parsed.data;
    if (/(^|[^a-z])(nsfw|porn|xxx|nude|nudes|hentai|explicit|sex|erotic)([^a-z]|$)/i.test(fileName)) {
      res.status(400).json({ error: 'Upload rejected: sexually explicit imagery is not permitted on ShadowSpace.' });
      return;
    }
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const allowedExt = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
    if (!allowedExt.has(ext)) {
      res.status(400).json({ error: 'Unsupported file extension. Allowed: png, jpg, jpeg, webp, gif' });
      return;
    }
    const sanitizedName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    res.json({
      valid: true,
      sanitizedName,
      mimeType,
      sizeBytes,
      purpose,
    });
  }
);

apiRouter.post(
  '/media/sign-upload',
  requireSignedIn,
  rateLimit('media_sign', 30, 60_000),
  (req: AuthedRequest, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = cloudinarySignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid upload metadata', details: parsed.error.flatten() });
        return;
      }

      if (parsed.data.purpose !== 'avatar' && !req.user?.emailVerified) {
        res.status(403).json({
          error: 'Please verify your email address before uploading banners, chat attachments, or gallery media.',
        });
        return;
      }

      const signed = createSignedUploadParams({
        uid: req.user!.uid,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
        purpose: parsed.data.purpose,
        scopeId: parsed.data.scopeId,
      });

      res.json(signed);
    } catch (err) {
      if (err instanceof CloudinaryServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

apiRouter.post(
  '/media/delete',
  requireSignedIn,
  rateLimit('media_delete', 30, 60_000),
  async (req: AuthedRequest, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = cloudinaryDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid media deletion payload', details: parsed.error.flatten() });
        return;
      }

      const { publicId, mediaId } = parsed.data;
      if (mediaId) {
        const doc = await fsGetDoc<{ uploaderId?: string; cloudinaryPublicId?: string }>(
          `mediaLibrary/${mediaId}`,
          req.idToken!
        );
        if (doc && doc.uploaderId && doc.uploaderId !== req.user!.uid) {
          res.status(403).json({ error: 'You do not own this media library item.' });
          return;
        }
        if (doc?.cloudinaryPublicId && doc.cloudinaryPublicId !== publicId) {
          res.status(400).json({ error: 'Asset identifier mismatch for media item.' });
          return;
        }
      }

      const deletion = await destroyCloudinaryAsset(req.user!.uid, publicId);
      res.json({
        deleted: deletion.deleted,
        publicId,
        result: deletion.result,
      });
    } catch (err) {
      if (err instanceof CloudinaryServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

// Verified channel message submission (validates server membership & mute state)
apiRouter.post(
  '/channels/:channelId/messages',
  requireAuth,
  rateLimit('message', 30, 30_000),
  async (req: AuthedRequest, res, next) => {
    try {
      const channelId = String(req.params.channelId || '');
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(channelId)) {
        res.status(400).json({ error: 'Invalid channel ID' });
        return;
      }
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid message payload', details: parsed.error.flatten() });
        return;
      }

      const channel = await fsGetDoc<{
        serverId: string;
        isPublic: boolean;
        isPrivate: boolean;
        memberUids?: string[];
      }>(`channels/${channelId}`, req.idToken!);
      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const member = await fsGetDoc<{
        role?: string;
        banned: boolean;
        muted: boolean;
        permissions?: { sendMessages?: boolean };
      }>(
        `serverMembers/${channel.serverId}_${req.user!.uid}`,
        req.idToken!
      );
      if (!member || member.banned) {
        res.status(403).json({ error: 'You are not an active member of this server' });
        return;
      }
      if (member.muted) {
        res.status(403).json({ error: 'You are currently muted in this server' });
        return;
      }
      if (
        member.role !== 'owner' &&
        member.role !== 'admin' &&
        member.permissions &&
        member.permissions.sendMessages === false
      ) {
        res.status(403).json({ error: 'Your server role does not permit sending messages' });
        return;
      }

      const data = parsed.data;
      if (!data.content.trim() && (!data.attachments || data.attachments.length === 0)) {
        res.status(400).json({ error: 'Message content or attachment is required' });
        return;
      }

      const messageId = data.id || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const messageDoc: Record<string, unknown> = {
        id: messageId,
        scopeType: 'channel',
        scopeId: channelId,
        serverId: channel.serverId,
        isPublicChannel: Boolean(channel.isPublic),
        authorId: req.user!.uid,
        senderId: req.user!.uid,
        authorName: data.authorName,
        content: data.content,
        text: data.content,
        pinned: false,
        edited: false,
        deleted: false,
      };
      if (!channel.isPublic) {
        messageDoc.allowedUids = Array.from(
          new Set([...(channel.memberUids || []), req.user!.uid])
        ).slice(0, 50);
      }
      if (data.authorAvatar) messageDoc.authorAvatar = data.authorAvatar;
      if (data.attachments?.length) messageDoc.attachments = data.attachments;
      if (data.replyToId) messageDoc.replyToId = data.replyToId;
      if (data.replyPreview) messageDoc.replyPreview = data.replyPreview;
      if (data.mentions?.length) messageDoc.mentions = data.mentions;

      await fsCommitWrite(
        `messages/${messageId}`,
        messageDoc,
        ['createdAt', 'updatedAt'],
        req.idToken!
      );

      const broadcastPayload = {
        ...messageDoc,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      realtimeHub.broadcastToRoom(channelId, {
        type: 'message:created',
        roomId: channelId,
        message: broadcastPayload,
      });

      res.status(201).json({ message: broadcastPayload });
    } catch (err) {
      next(err);
    }
  }
);

// Live invite preview (reflects server name, icon, banner, description, accentColor, memberCount in real time)
apiRouter.get(
  '/invites/:code',
  requireAuth,
  rateLimit('invite_preview', 30, 60_000),
  async (req: AuthedRequest, res, next) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      if (!/^[a-zA-Z0-9_-]{4,32}$/.test(code)) {
        res.status(400).json({ error: 'Invalid invite code format' });
        return;
      }
      const invite = await fsGetDoc<{
        code: string;
        serverId: string;
        maxUses: number;
        uses: number;
        revoked: boolean;
      }>(`serverInvitations/${code}`, req.idToken!);
      if (!invite || invite.revoked) {
        res.status(404).json({ error: 'Invitation not found or revoked' });
        return;
      }
      const server = await fsGetDoc<{
        id: string;
        name: string;
        description?: string;
        iconUrl?: string;
        bannerUrl?: string;
        accentColor?: string;
        category?: string;
        isPublic: boolean;
        isAfterDark: boolean;
        memberCount: number;
      }>(`servers/${invite.serverId}`, req.idToken!).catch(() => null);

      res.json({
        invite: {
          code: invite.code,
          serverId: invite.serverId,
          maxUses: invite.maxUses,
          uses: invite.uses,
          revoked: invite.revoked,
        },
        server: server || {
          id: invite.serverId,
          name: 'Private Community',
          description: 'Invitation-only ShadowSpace community.',
          isPublic: false,
          isAfterDark: false,
          memberCount: 1,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Join server by invite code
apiRouter.post(
  '/servers/join-invite',
  requireAuth,
  rateLimit('invite_join', 15, 60_000),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = joinInviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid invite code format' });
        return;
      }
      const code = parsed.data.code.trim().toUpperCase();
      const invite = await fsGetDoc<{
        code: string;
        serverId: string;
        creatorId: string;
        maxUses: number;
        uses: number;
        revoked: boolean;
      }>(`serverInvitations/${code}`, req.idToken!);

      if (!invite || invite.revoked) {
        res.status(404).json({ error: 'Invitation not found or revoked' });
        return;
      }
      if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
        res.status(400).json({ error: 'Invitation has reached maximum uses' });
        return;
      }

      const server = await fsGetDoc<{
        id: string;
        name: string;
        ownerId: string;
        isPublic: boolean;
        memberCount: number;
      }>(`servers/${invite.serverId}`, req.idToken!);
      if (!server) {
        res.status(404).json({ error: 'Target server no longer exists' });
        return;
      }

      const memberDocId = `${server.id}_${req.user!.uid}`;
      const existingMember = await fsGetDoc<{ banned: boolean }>(
        `serverMembers/${memberDocId}`,
        req.idToken!
      );
      if (existingMember?.banned) {
        res.status(403).json({ error: 'You are banned from this server' });
        return;
      }

      if (!existingMember) {
        const batchWrites: BatchWriteSpec[] = [
          {
            docPath: `serverMembers/${memberDocId}`,
            fieldsData: {
              serverId: server.id,
              userId: req.user!.uid,
              role: 'member',
              isPublicServer: Boolean(server.isPublic),
              serverOwnerId: server.ownerId,
              muted: false,
              banned: false,
              inviteCode: code,
            },
            serverTimestampFields: ['joinedAt', 'updatedAt'],
          },
          {
            docPath: `serverInvitations/${code}`,
            fieldsData: {
              ...invite,
              uses: invite.uses + 1,
            },
            updateMaskFields: ['uses'],
          },
          {
            docPath: `servers/${server.id}`,
            fieldsData: {
              ...server,
              memberCount: (server.memberCount || 1) + 1,
            },
            serverTimestampFields: ['updatedAt'],
            updateMaskFields: ['memberCount', 'updatedAt'],
          },
        ];

        await fsBatchCommit(batchWrites, req.idToken!);

        // Grant joining member access to non-private channels in this server
        if (!server.isPublic) {
          const pubOrOwnerChannels = await fsRunQuery<{
            id: string;
            type: string;
            isPrivate: boolean;
            memberUids?: string[];
          }>(
            {
              from: [{ collectionId: 'channels' }],
              where: {
                compositeFilter: {
                  op: 'AND',
                  filters: [
                    {
                      fieldFilter: {
                        field: { fieldPath: 'serverId' },
                        op: 'EQUAL',
                        value: { stringValue: server.id },
                      },
                    },
                    {
                      fieldFilter: {
                        field: { fieldPath: 'isPublic' },
                        op: 'EQUAL',
                        value: { booleanValue: true },
                      },
                    },
                  ],
                },
              },
              limit: 50,
            },
            req.idToken!
          ).catch(() => []);

          for (const ch of pubOrOwnerChannels) {
            if (ch.type !== 'private') {
              const nextUids = Array.from(
                new Set([...(ch.memberUids || []), req.user!.uid])
              ).slice(0, 50);
              await fsCommitWrite(
                `channels/${ch.id}`,
                { ...ch, memberUids: nextUids },
                ['updatedAt'],
                req.idToken!,
                ['memberUids', 'updatedAt']
              ).catch(() => {});
            }
          }
        }
      }

      res.json({ joined: true, serverId: server.id, serverName: server.name });
    } catch (err) {
      next(err);
    }
  }
);

// Authoritative server-side moderation endpoint
apiRouter.post(
  '/moderation/action',
  requireAuth,
  rateLimit('moderation', 20, 60_000),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = moderationActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid moderation payload', details: parsed.error.flatten() });
        return;
      }
      const { serverId, targetUserId, action, reason, messageId } = parsed.data;

      const actorMember = await fsGetDoc<{
        role: string;
        banned: boolean;
        permissions?: { moderateMembers?: boolean; manageMessages?: boolean };
      }>(
        `serverMembers/${serverId}_${req.user!.uid}`,
        req.idToken!
      );
      const isGlobalAdmin = req.user!.email === PLATFORM_OWNER_EMAIL;
      const canModerateAction =
        isGlobalAdmin ||
        (actorMember &&
          !actorMember.banned &&
          (['owner', 'admin', 'moderator'].includes(actorMember.role) ||
            Boolean(actorMember.permissions?.moderateMembers) ||
            (action === 'delete_message' && Boolean(actorMember.permissions?.manageMessages))));
      if (!canModerateAction) {
        res.status(403).json({ error: 'Insufficient moderator permissions for this server' });
        return;
      }

      const serverMeta = await fsGetDoc<{ ownerId?: string }>(`servers/${serverId}`, req.idToken!).catch(() => null);
      const targetMemberPath = `serverMembers/${serverId}_${targetUserId}`;
      const targetMember = await fsGetDoc<{ role: string; serverId: string; userId: string }>(
        targetMemberPath,
        req.idToken!
      );

      if (targetMember && targetMember.role === 'owner' && !isGlobalAdmin) {
        res.status(403).json({ error: 'Cannot moderate the server owner' });
        return;
      }

      if (action === 'mute' || action === 'unmute') {
        if (!targetMember) {
          res.status(404).json({ error: 'Target member not found' });
          return;
        }
        await fsCommitWrite(
          targetMemberPath,
          { ...targetMember, muted: action === 'mute' },
          ['updatedAt'],
          req.idToken!,
          ['muted', 'updatedAt']
        );
      } else if (action === 'ban' || action === 'unban') {
        if (!targetMember) {
          res.status(404).json({ error: 'Target member not found' });
          return;
        }
        await fsCommitWrite(
          targetMemberPath,
          { ...targetMember, banned: action === 'ban' },
          ['updatedAt'],
          req.idToken!,
          ['banned', 'updatedAt']
        );
      } else if (action === 'kick') {
        await fsDeleteDoc(targetMemberPath, req.idToken!);
      } else if (action === 'delete_message' && messageId) {
        await fsDeleteDoc(`messages/${messageId}`, req.idToken!);
      }

      const actionId = `mod_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await fsCommitWrite(
        `moderationActions/${actionId}`,
        {
          id: actionId,
          serverId,
          actorId: req.user!.uid,
          targetUserId,
          action,
          reason,
        },
        ['createdAt'],
        req.idToken!
      );

      const logId = `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await fsCommitWrite(
        `auditLogs/${logId}`,
        {
          id: logId,
          serverId,
          ...(serverMeta?.ownerId ? { serverOwnerId: serverMeta.ownerId } : {}),
          staffUids: Array.from(new Set([serverMeta?.ownerId || req.user!.uid, req.user!.uid])),
          actorId: req.user!.uid,
          event: `moderation.${action}`,
          details: `Target ${targetUserId}: ${reason}`,
        },
        ['createdAt'],
        req.idToken!
      );

      realtimeHub.sendToUser(targetUserId, {
        type: 'moderation:notice',
        serverId,
        action,
        reason,
      });

      res.json({ success: true, actionId });
    } catch (err) {
      next(err);
    }
  }
);

// Owner-only Platform Administration routes
apiRouter.get(
  '/admin/overview',
  requireAuth,
  requirePlatformAdmin,
  async (req: AuthedRequest, res, next) => {
    try {
      const [users, servers, reports] = await Promise.all([
        fsRunQuery(
          { from: [{ collectionId: 'users' }], limit: 100 },
          req.idToken!
        ),
        fsRunQuery(
          { from: [{ collectionId: 'servers' }], limit: 100 },
          req.idToken!
        ),
        fsRunQuery(
          { from: [{ collectionId: 'reports' }], limit: 100 },
          req.idToken!
        ),
      ]);

      res.json({
        stats: {
          totalUsers: users.length,
          totalServers: servers.length,
          openReports: reports.filter((r) => r.status === 'open').length,
          onlineSockets: realtimeHub.getOnlineCount(),
        },
        users,
        servers,
        reports,
      });
    } catch (err) {
      next(err);
    }
  }
);

apiRouter.patch(
  '/admin/reports/:reportId',
  requireAuth,
  requirePlatformAdmin,
  async (req: AuthedRequest, res, next) => {
    try {
      const reportId = String(req.params.reportId || '');
      const parsed = adminReportUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      const existing = await fsGetDoc(`reports/${reportId}`, req.idToken!);
      if (!existing) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }
      await fsCommitWrite(
        `reports/${reportId}`,
        { ...existing, status: parsed.data.status },
        ['updatedAt'],
        req.idToken!,
        ['status', 'updatedAt']
      );
      res.json({ updated: true, status: parsed.data.status });
    } catch (err) {
      next(err);
    }
  }
);

apiRouter.post(
  '/admin/suspend',
  requireAuth,
  requirePlatformAdmin,
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = adminSuspendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid suspend payload' });
        return;
      }
      const { targetUserId, suspended, reason } = parsed.data;
      const privPath = `users/${targetUserId}/private/account`;
      const existing = await fsGetDoc(privPath, req.idToken!);
      if (!existing) {
        res.status(404).json({ error: 'User private record not found' });
        return;
      }
      await fsCommitWrite(
        privPath,
        { ...existing, suspended },
        ['updatedAt'],
        req.idToken!,
        ['suspended', 'updatedAt']
      );

      const actionId = `mod_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await fsCommitWrite(
        `moderationActions/${actionId}`,
        {
          id: actionId,
          actorId: req.user!.uid,
          targetUserId,
          action: suspended ? 'suspend' : 'unsuspend',
          reason,
        },
        ['createdAt'],
        req.idToken!
      );

      res.json({ success: true, suspended });
    } catch (err) {
      next(err);
    }
  }
);
