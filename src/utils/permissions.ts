import type {
  ServerMember,
  ServerPermissions,
  ServerRole,
  ServerRoleDefinition,
} from '../types/shadowspace';

export const DEFAULT_MEMBER_PERMISSIONS: ServerPermissions = {
  manageServer: false,
  manageChannels: false,
  manageRoles: false,
  manageMessages: false,
  moderateMembers: false,
  createInvites: false,
  pinMessages: false,
  sendMessages: true,
};

export const FULL_ADMIN_PERMISSIONS: ServerPermissions = {
  manageServer: true,
  manageChannels: true,
  manageRoles: true,
  manageMessages: true,
  moderateMembers: true,
  createInvites: true,
  pinMessages: true,
  sendMessages: true,
};

export const DEFAULT_MODERATOR_PERMISSIONS: ServerPermissions = {
  manageServer: false,
  manageChannels: false,
  manageRoles: false,
  manageMessages: true,
  moderateMembers: true,
  createInvites: true,
  pinMessages: true,
  sendMessages: true,
};

export const PERMISSION_LABELS: Array<{
  key: keyof ServerPermissions;
  label: string;
  description: string;
}> = [
  {
    key: 'manageServer',
    label: 'Manage Server',
    description: 'Edit server name, icon, banner, color, category, and visibility.',
  },
  {
    key: 'manageChannels',
    label: 'Manage Channels',
    description: 'Create, edit, delete, and reorder channels and categories.',
  },
  {
    key: 'manageRoles',
    label: 'Manage Roles',
    description: 'Create, rename, color, edit permissions, and assign custom roles.',
  },
  {
    key: 'manageMessages',
    label: 'Manage Messages',
    description: 'Delete and moderate messages posted by other members.',
  },
  {
    key: 'moderateMembers',
    label: 'Moderate Members',
    description: 'Mute, unmute, kick, and ban non-owner members.',
  },
  {
    key: 'createInvites',
    label: 'Manage Invites',
    description: 'Create and revoke invitation codes.',
  },
  {
    key: 'pinMessages',
    label: 'Pin Messages',
    description: 'Pin and unpin messages inside channels.',
  },
  {
    key: 'sendMessages',
    label: 'Send Messages',
    description: 'Allow members with this role to send channel messages.',
  },
];

export function basePermissionsForRole(role: ServerRole): ServerPermissions {
  if (role === 'owner' || role === 'admin') {
    return { ...FULL_ADMIN_PERMISSIONS };
  }
  if (role === 'moderator') {
    return { ...DEFAULT_MODERATOR_PERMISSIONS };
  }
  return { ...DEFAULT_MEMBER_PERMISSIONS };
}

export function computeEffectivePermissions(
  baseRole: ServerRole,
  roleIds: string[] = [],
  allRoles: ServerRoleDefinition[] = []
): ServerPermissions {
  if (baseRole === 'owner' || baseRole === 'admin') {
    return { ...FULL_ADMIN_PERMISSIONS };
  }

  const base = basePermissionsForRole(baseRole);
  const assigned = allRoles.filter((r) => roleIds.includes(r.id));
  if (assigned.length === 0) {
    return base;
  }

  const result: ServerPermissions = { ...base };
  let anyDeniesSend = false;

  for (const r of assigned) {
    if (r.permissions.manageServer) result.manageServer = true;
    if (r.permissions.manageChannels) result.manageChannels = true;
    if (r.permissions.manageRoles) result.manageRoles = true;
    if (r.permissions.manageMessages) result.manageMessages = true;
    if (r.permissions.moderateMembers) result.moderateMembers = true;
    if (r.permissions.createInvites) result.createInvites = true;
    if (r.permissions.pinMessages) result.pinMessages = true;
    if (r.permissions.sendMessages === false) {
      anyDeniesSend = true;
    }
  }

  result.sendMessages = !anyDeniesSend;
  return result;
}

export function resolveMemberPermissions(
  member: ServerMember | undefined | null,
  isOwner: boolean,
  allRoles: ServerRoleDefinition[] = []
): ServerPermissions {
  if (isOwner) {
    return { ...FULL_ADMIN_PERMISSIONS };
  }
  if (!member) {
    return {
      manageServer: false,
      manageChannels: false,
      manageRoles: false,
      manageMessages: false,
      moderateMembers: false,
      createInvites: false,
      pinMessages: false,
      sendMessages: false,
    };
  }
  if (member.role === 'owner' || member.role === 'admin') {
    return { ...FULL_ADMIN_PERMISSIONS };
  }
  if ((member.roleIds?.length || 0) > 0 && allRoles.length > 0) {
    return computeEffectivePermissions(member.role, member.roleIds || [], allRoles);
  }
  if (member.permissions) {
    return member.permissions;
  }
  return basePermissionsForRole(member.role);
}
