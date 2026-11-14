import { auth } from '../config/firebase';
import { apiRequest } from '../services/apiClient';
import { validateMediaFileSafety, verifyImageDecodable } from './validators';

export type UploadPurpose =
  | 'avatar'
  | 'banner'
  | 'server_icon'
  | 'server_banner'
  | 'attachment'
  | 'media_library';

export interface UploadProgressInfo {
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
  state: 'running' | 'paused' | 'success' | 'canceled' | 'error';
}

export interface CloudinaryUploadResult {
  downloadUrl: string;
  publicId: string;
  assetId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  format?: string;
}

export interface ActiveUploadHandle {
  promise: Promise<CloudinaryUploadResult>;
  cancel: () => void;
}

interface SignedUploadResponse {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  publicId: string;
  fullPublicId: string;
  allowedFormats: string;
}

interface CloudinaryApiSuccess {
  secure_url: string;
  public_id: string;
  asset_id?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

const UPLOAD_TIMEOUT_MS = 45_000;

export function startCloudinaryUpload(params: {
  file: File;
  purpose: UploadPurpose;
  scopeId?: string;
  onProgress?: (info: UploadProgressInfo) => void;
}): ActiveUploadHandle {
  const { file, purpose, scopeId, onProgress } = params;
  let activeXhr: XMLHttpRequest | null = null;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    if (activeXhr) {
      activeXhr.abort();
      activeXhr = null;
    }
  };

  const promise = (async (): Promise<CloudinaryUploadResult> => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('You must be signed in before uploading files.');
    }

    const safetyIssue = validateMediaFileSafety(file);
    if (safetyIssue) {
      throw new Error(safetyIssue);
    }

    const decodable = await verifyImageDecodable(file);
    if (!decodable) {
      throw new Error('Could not decode image. Upload a valid PNG, JPG, WEBP, or animated GIF.');
    }

    if (cancelled) {
      throw new Error('Upload was canceled.');
    }

    await user.getIdToken(false);

    const signed = await apiRequest<SignedUploadResponse>('/api/media/sign-upload', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose,
        ...(scopeId ? { scopeId } : {}),
      }),
    });

    if (cancelled) {
      throw new Error('Upload was canceled.');
    }

    onProgress?.({
      percent: 0,
      bytesTransferred: 0,
      totalBytes: file.size,
      state: 'running',
    });

    return await new Promise<CloudinaryUploadResult>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', signed.apiKey);
      formData.append('timestamp', String(signed.timestamp));
      formData.append('signature', signed.signature);
      formData.append('folder', signed.folder);
      formData.append('public_id', signed.publicId);
      formData.append('allowed_formats', signed.allowedFormats);

      const xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open('POST', signed.uploadUrl, true);
      xhr.timeout = UPLOAD_TIMEOUT_MS;

      xhr.upload.onprogress = (event) => {
        const total = event.lengthComputable && event.total > 0 ? event.total : file.size || 1;
        const loaded = event.lengthComputable ? event.loaded : 0;
        const percent = Math.min(99, Math.round((loaded / total) * 100));
        onProgress?.({
          percent,
          bytesTransferred: loaded,
          totalBytes: total,
          state: 'running',
        });
      };

      const fail = (message: string, state: 'canceled' | 'error' = 'error') => {
        activeXhr = null;
        onProgress?.({
          percent: 0,
          bytesTransferred: 0,
          totalBytes: file.size,
          state,
        });
        reject(new Error(message));
      };

      xhr.onabort = () => {
        fail('Upload was canceled.', 'canceled');
      };

      xhr.ontimeout = () => {
        fail('Upload timed out waiting for Cloudinary. Please check your connection and retry.');
      };

      xhr.onerror = () => {
        fail('Network error while uploading image to Cloudinary. Please retry.');
      };

      xhr.onload = () => {
        activeXhr = null;
        let payload: (CloudinaryApiSuccess & { error?: { message?: string } }) | null = null;
        try {
          payload = JSON.parse(xhr.responseText || '{}');
        } catch {
          payload = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && payload?.secure_url) {
          onProgress?.({
            percent: 100,
            bytesTransferred: file.size,
            totalBytes: file.size,
            state: 'success',
          });
          resolve({
            downloadUrl: payload.secure_url,
            publicId: payload.public_id || signed.fullPublicId,
            assetId: payload.asset_id,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: payload.bytes || file.size,
            width: payload.width,
            height: payload.height,
            format: payload.format,
          });
          return;
        }

        const errMsg =
          payload?.error?.message || `Cloudinary upload failed (HTTP ${xhr.status}).`;
        fail(errMsg);
      };

      xhr.send(formData);
    });
  })();

  return { promise, cancel };
}

export async function deleteCloudinaryAsset(
  publicId: string,
  mediaId?: string
): Promise<{ deleted: boolean; result: string }> {
  return apiRequest<{ deleted: boolean; result: string }>('/api/media/delete', {
    method: 'POST',
    body: JSON.stringify({
      publicId,
      ...(mediaId ? { mediaId } : {}),
    }),
  });
}
