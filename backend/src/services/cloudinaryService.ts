import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

export type MediaPurpose =
  | 'avatar'
  | 'banner'
  | 'server_icon'
  | 'server_banner'
  | 'attachment'
  | 'media_library';

export class CloudinaryServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jpg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
};
const EXPLICIT_FILENAME_PATTERN =
  /(^|[^a-z])(nsfw|porn|xxx|nude|nudes|hentai|explicit|sex|erotic)([^a-z]|$)/i;

function getCloudinaryCredentials() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || '';
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || '';
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || '';

  if (!cloudName || !apiKey || !apiSecret) {
    throw new CloudinaryServiceError(
      500,
      'Cloudinary media storage is not configured on the server.'
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return { cloudName, apiKey, apiSecret };
}

function sanitizeSegment(value: string, fallback: string, maxLen = 48): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
  return cleaned || fallback;
}

export function isUserOwnedCloudinaryPublicId(uid: string, publicId: string): boolean {
  const safeUid = sanitizeSegment(uid, '', 128);
  if (!safeUid || !publicId || publicId.includes('..')) return false;
  if (!/^[a-zA-Z0-9_/-]{10,256}$/.test(publicId)) return false;
  return publicId.startsWith(`shadowspace/users/${safeUid}/`);
}

export interface SignedUploadPayload {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  publicId: string;
  fullPublicId: string;
  allowedFormats: string;
  purpose: MediaPurpose;
}

export function createSignedUploadParams(params: {
  uid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: MediaPurpose;
  scopeId?: string;
}): SignedUploadPayload {
  const { uid, fileName, mimeType, sizeBytes, purpose, scopeId } = params;

  if (EXPLICIT_FILENAME_PATTERN.test(fileName)) {
    throw new CloudinaryServiceError(
      400,
      'Upload rejected: sexually explicit imagery is not permitted on ShadowSpace.'
    );
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new CloudinaryServiceError(
      400,
      'Unsupported file extension. Allowed: png, jpg, jpeg, webp, gif.'
    );
  }

  const expectedExts = MIME_TO_EXTENSIONS[mimeType.toLowerCase()];
  if (!expectedExts || !expectedExts.includes(ext)) {
    throw new CloudinaryServiceError(
      400,
      'File extension does not match image MIME type.'
    );
  }

  if (sizeBytes < 1 || sizeBytes > 10 * 1024 * 1024) {
    throw new CloudinaryServiceError(400, 'File size must be between 1 byte and 10 MB.');
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials();

  const safeUid = sanitizeSegment(uid, 'user', 128);
  const safeScope = sanitizeSegment(scopeId || 'general', 'general', 64);

  let folder: string;
  let prefix: string;
  switch (purpose) {
    case 'avatar':
      folder = `shadowspace/users/${safeUid}/avatars`;
      prefix = 'av';
      break;
    case 'banner':
      folder = `shadowspace/users/${safeUid}/banners`;
      prefix = 'bn';
      break;
    case 'server_icon':
    case 'server_banner':
      folder = `shadowspace/users/${safeUid}/servers/${safeScope}`;
      prefix = purpose === 'server_icon' ? 'si' : 'sb';
      break;
    case 'attachment':
      folder = `shadowspace/users/${safeUid}/attachments/${safeScope}`;
      prefix = 'att';
      break;
    case 'media_library':
    default:
      folder = `shadowspace/users/${safeUid}/gallery`;
      prefix = 'gal';
      break;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const allowedFormats = 'png,jpg,jpeg,webp,gif';

  // Exact subset of parameters sent to Cloudinary multipart upload (sorted automatically by SDK)
  const paramsToSign: Record<string, string | number> = {
    allowed_formats: allowedFormats,
    folder,
    public_id: publicId,
    timestamp,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder,
    publicId,
    fullPublicId: `${folder}/${publicId}`,
    allowedFormats,
    purpose,
  };
}

export async function destroyCloudinaryAsset(
  uid: string,
  publicId: string
): Promise<{ deleted: boolean; result: string }> {
  if (!isUserOwnedCloudinaryPublicId(uid, publicId)) {
    throw new CloudinaryServiceError(
      403,
      'You can only delete Cloudinary assets owned by your account.'
    );
  }

  getCloudinaryCredentials();
  const response = (await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  })) as { result?: string };

  const result = response?.result || 'unknown';
  if (result !== 'ok' && result !== 'not found') {
    throw new CloudinaryServiceError(502, `Cloudinary deletion returned unexpected status: ${result}`);
  }

  return {
    deleted: true,
    result,
  };
}
