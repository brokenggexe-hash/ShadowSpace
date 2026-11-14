import { z } from 'zod';

const idRegex = /^[a-zA-Z0-9_-]+$/;

export const sendMessageSchema = z.object({
  id: z.string().min(1).max(128).regex(idRegex).optional(),
  content: z.string().max(4000).default(''),
  attachments: z.array(z.string().max(2048)).max(5).optional(),
  replyToId: z.string().max(128).optional(),
  replyPreview: z.string().max(200).optional(),
  mentions: z.array(z.string().max(128)).max(10).optional(),
  authorName: z.string().min(1).max(64),
  authorAvatar: z.string().max(2048).optional(),
});

export const joinInviteSchema = z.object({
  code: z.string().min(4).max(32).regex(idRegex),
});

export const moderationActionSchema = z.object({
  serverId: z.string().min(1).max(128).regex(idRegex),
  targetUserId: z.string().min(1).max(128).regex(idRegex),
  action: z.enum(['mute', 'unmute', 'kick', 'ban', 'unban', 'delete_message']),
  reason: z.string().min(1).max(500),
  messageId: z.string().max(128).optional(),
});

export const adminReportUpdateSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
});

export const adminSuspendSchema = z.object({
  targetUserId: z.string().min(1).max(128).regex(idRegex),
  suspended: z.boolean(),
  reason: z.string().min(1).max(500),
});

export const uploadValidateSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  purpose: z.enum(['avatar', 'banner', 'server_icon', 'server_banner', 'attachment', 'media_library']),
});

export const cloudinarySignSchema = uploadValidateSchema.extend({
  scopeId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
});

export const cloudinaryDeleteSchema = z.object({
  publicId: z.string().min(10).max(256).regex(/^[a-zA-Z0-9_/-]+$/),
  mediaId: z.string().min(1).max(128).regex(idRegex).optional(),
});
