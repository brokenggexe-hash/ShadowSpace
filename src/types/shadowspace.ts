import type { Timestamp } from 'firebase/firestore';

export type OnlineStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type ProfileVisibility = 'public' | 'friends' | 'private';
export type ServerRole = 'owner' | 'admin' | 'moderator' | 'member';
export type ChannelType = 'text' | 'announcement' | 'voice' | 'private';
export type MediaCategory = 'general' | 'anime' | 'reactions' | 'funny' | 'flirty' | 'community';

export interface ServerPermissions {
  manageServer: boolean;
  manageChannels: boolean;
  manageRoles: boolean;
  manageMessages: boolean;
  moderateMembers: boolean;
  createInvites: boolean;
  pinMessages: boolean;
  sendMessages: boolean;
}

export interface ServerRoleDefinition {
  id: string;
  serverId: string;
  name: string;
  color: string;
  position: number;
  permissions: ServerPermissions;
  isPublicServer: boolean;
  ownerId: string;
  memberUids?: string[];
  createdAt?: Timestamp | string | null;
  updatedAt?: Timestamp | string | null;
}

export interface UserPublic {
  uid: string;
  username: string;
  displayName: string;
  bio?: string;
  pronouns?: string;
  location?: string;
  website?: string;
  statusMessage?: string;
  onlineStatus: OnlineStatus;
  avatarUrl?: string;
  avatarPublicId?: string;
  bannerUrl?: string;
  bannerPublicId?: string;
  accentColor?: string;
  profileBg?: string;
  profileVisibility: ProfileVisibility;
  badges?: string[];
  discordUsername?: string;
  discordAvatar?: string;
  lastUsernameChange?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface UserPrivate {
  uid: string;
  email: string;
  ageVerified: boolean;
  afterDarkConsent: boolean;
  dmPermission: 'everyone' | 'friends' | 'server_members';
  friendRequestPermission: 'everyone' | 'mutual_servers' | 'none';
  discordId?: string;
  suspended: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface UserSettings {
  userId: string;
  theme: 'dark' | 'light';
  accentColor: string;
  fontSize: 'sm' | 'md' | 'lg';
  density: 'compact' | 'comfortable';
  reducedMotion: boolean;
  highContrast: boolean;
  notifyDms: boolean;
  notifyMentions: boolean;
  notifyFriendRequests: boolean;
  notifyServers: boolean;
  showOnlineStatus: boolean;
  mediaAutoPreview: boolean;
  updatedAt?: Timestamp | null;
}

export interface FriendRequest {
  id: string;
  fromUid: string;
  toUid: string;
  fromUsername?: string;
  toUsername?: string;
  participants: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Friendship {
  id: string;
  users: string[];
  createdAt?: Timestamp | null;
}

export interface BlockedUser {
  blockerUid: string;
  blockedUid: string;
  reason?: string;
  createdAt?: Timestamp | null;
}

export interface Server {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  iconPublicId?: string;
  bannerUrl?: string;
  bannerPublicId?: string;
  accentColor?: string;
  ownerId: string;
  isPublic: boolean;
  isAfterDark: boolean;
  category?: string;
  memberCount: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface ServerMember {
  serverId: string;
  userId: string;
  role: ServerRole;
  roleIds?: string[];
  permissions?: ServerPermissions;
  isPublicServer: boolean;
  muted: boolean;
  banned: boolean;
  nickname?: string;
  inviteCode?: string;
  joinedAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface ServerInvitation {
  code: string;
  serverId: string;
  creatorId: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
  createdAt?: Timestamp | null;
}

export interface ChannelCategory {
  id: string;
  serverId: string;
  name: string;
  position: number;
  isPublicServer: boolean;
  ownerId?: string;
  memberUids?: string[];
  createdAt?: Timestamp | null;
}

export interface Channel {
  id: string;
  serverId: string;
  categoryId?: string;
  name: string;
  type: ChannelType;
  topic?: string;
  description?: string;
  isPrivate: boolean;
  isPublic: boolean;
  isAfterDark: boolean;
  position: number;
  ownerId?: string;
  memberUids?: string[];
  allowedRoles?: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AttachmentMetadata {
  url: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  publicId?: string;
  width?: number;
  height?: number;
  format?: string;
}

export interface Message {
  id: string;
  scopeType: 'channel' | 'dm';
  scopeId: string;
  serverId?: string;
  isPublicChannel: boolean;
  participantIds?: string[];
  allowedUids?: string[];
  authorId: string;
  senderId?: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  text?: string;
  attachments?: string[];
  attachmentMeta?: AttachmentMetadata[];
  replyToId?: string;
  replyPreview?: string;
  mentions?: string[];
  pinned: boolean;
  edited: boolean;
  editedAt?: Timestamp | string | null;
  deleted: boolean;
  createdAt?: Timestamp | string | null;
  updatedAt?: Timestamp | string | null;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  name?: string;
  iconUrl?: string;
  ownerId: string;
  participantIds: string[];
  lastMessageText?: string;
  lastMessageAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  scopeId: string;
  isPublicScope: boolean;
  userId: string;
  emoji: string;
  createdAt?: Timestamp | null;
}

export interface PinnedMessage {
  id: string;
  scopeId: string;
  messageId: string;
  serverId?: string;
  isPublicScope: boolean;
  pinnedBy: string;
  contentPreview: string;
  createdAt?: Timestamp | null;
}

export interface NotificationItem {
  id: string;
  userId: string;
  actorId?: string;
  type: 'friend_request' | 'dm' | 'group_message' | 'server_invite' | 'mention' | 'reaction' | 'moderation';
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt?: Timestamp | null;
}

export interface ReportItem {
  id: string;
  reporterId: string;
  targetType: 'user' | 'message' | 'server' | 'media';
  targetId: string;
  serverId?: string;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AuditLogItem {
  id: string;
  serverId?: string;
  actorId: string;
  event: string;
  details: string;
  createdAt?: Timestamp | null;
}

export interface MediaItem {
  id: string;
  uploaderId: string;
  title: string;
  url: string;
  cloudinaryPublicId?: string;
  cloudinaryAssetId?: string;
  category: MediaCategory;
  visibility: 'public' | 'private';
  isAfterDark: boolean;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  format?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}
