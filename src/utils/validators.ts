import brandEmblem from '../assets/images/shadowspace_brand_emblem_1794566908601.jpg';
import afterDarkBanner from '../assets/images/community_banner_afterdark_1794566909216.jpg';
import studioBanner from '../assets/images/community_banner_studio_1794566909443.jpg';
import obsidianAvatar from '../assets/images/avatar_preset_obsidian_1794566909943.jpg';

export const ASSET_IMAGES = {
  brandEmblem,
  afterDarkBanner,
  studioBanner,
  obsidianAvatar,
};

export const FIELD_LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  usernamePattern: /^[a-z0-9_.]+$/,
  displayNameMax: 64,
  bioMax: 500,
  pronounsMax: 40,
  locationMax: 80,
  websiteMax: 256,
  statusMax: 120,
  serverNameMin: 2,
  serverNameMax: 80,
  serverDescMax: 500,
  channelNameMax: 64,
  channelTopicMax: 300,
  messageMax: 4000,
  reasonMax: 500,
  idPattern: /^[a-zA-Z0-9_-]+$/,
};

export function sanitizeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function getDirectConversationId(uidA: string, uidB: string): string {
  const [first, second] = [uidA.trim(), uidB.trim()].sort();
  const candidate = `dm_${first}_${second}`;
  if (candidate.length <= 128 && FIELD_LIMITS.idPattern.test(candidate)) {
    return candidate;
  }
  // Fallback deterministic alphanumeric ID if custom UIDs exceed 62 chars
  let h1 = 2166136261;
  let h2 = 2166136261;
  const combined = `${first}:${second}`;
  for (let i = 0; i < combined.length; i++) {
    h1 ^= combined.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
    h2 ^= combined.charCodeAt(combined.length - 1 - i);
    h2 = Math.imul(h2, 16777619);
  }
  return `dm_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

export function truncateText(val: string, max: number): string {
  return val.trim().slice(0, max);
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsernameFormat(username: string): boolean {
  const clean = normalizeUsername(username);
  return (
    clean.length >= FIELD_LIMITS.usernameMin &&
    clean.length <= FIELD_LIMITS.usernameMax &&
    FIELD_LIMITS.usernamePattern.test(clean)
  );
}

export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim().slice(0, FIELD_LIMITS.websiteMax);
  if (!trimmed) return '';
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    throw new Error('Unsupported website URL protocol.');
  }
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProto);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Website URL must use http:// or https://.');
  }
  return parsed.toString().slice(0, FIELD_LIMITS.websiteMax);
}

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const EXPLICIT_NAME_PATTERN =
  /(^|[^a-z])(nsfw|porn|xxx|nude|nudes|hentai|explicit|sex|erotic)([^a-z]|$)/i;

export function validateMediaFileSafety(file: File): string | null {
  if (!ALLOWED_IMAGE_MIME.has(file.type.toLowerCase())) {
    return 'Unsupported file format. Allowed: PNG, JPG, WEBP, and animated GIF.';
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return 'Image file size must be between 1 byte and 10 MB.';
  }
  if (EXPLICIT_NAME_PATTERN.test(file.name)) {
    return 'File rejected: nudity and sexually explicit imagery are not permitted on ShadowSpace.';
  }
  return null;
}

export async function verifyImageDecodable(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(false);
    };
    img.src = objectUrl;
  });
}

export function formatTimeShort(ts: unknown): string {
  if (!ts) return '';
  let date: Date | null = null;
  if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    date = (ts as { toDate: () => Date }).toDate();
  }
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateSeparator(ts: unknown): string {
  if (!ts) return 'Today';
  let date: Date | null = null;
  if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    date = (ts as { toDate: () => Date }).toDate();
  }
  if (!date || Number.isNaN(date.getTime())) return 'Today';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'SS';
}
