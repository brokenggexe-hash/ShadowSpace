import React, { useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Download,
  Film,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { MediaCategory, MediaItem } from '../types/shadowspace';
import {
  deleteCloudinaryAsset,
  startCloudinaryUpload,
  type ActiveUploadHandle,
  type UploadProgressInfo,
} from '../utils/cloudinaryUpload';
import { generateId } from '../utils/validators';

interface MediaModalProps {
  scopeId: string;
  purpose?: 'attachment' | 'avatar' | 'banner' | 'server_icon' | 'server_banner';
  onSelectMedia: (url: string) => void;
  onClose: () => void;
}

const CATEGORIES: Array<{ id: MediaCategory | 'all' | 'mine'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'My Uploads' },
  { id: 'general', label: 'General' },
  { id: 'anime', label: 'Anime' },
  { id: 'reactions', label: 'Reactions' },
  { id: 'funny', label: 'Funny' },
  { id: 'flirty', label: 'Flirty' },
  { id: 'community', label: 'Community' },
];

export function MediaModal({
  scopeId,
  purpose = 'attachment',
  onSelectMedia,
  onClose,
}: MediaModalProps) {
  const { firebaseUser, privateAccount } = useAuth();
  const [publicItems, setPublicItems] = useState<MediaItem[]>([]);
  const [myItems, setMyItems] = useState<MediaItem[]>([]);
  const [category, setCategory] = useState<MediaCategory | 'all' | 'mine'>('all');
  const [uploadCategory, setUploadCategory] = useState<MediaCategory>('community');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    purpose === 'avatar' || purpose === 'banner' ? 'private' : 'public'
  );
  const [uploadInfo, setUploadInfo] = useState<UploadProgressInfo | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [failedUpload, setFailedUpload] = useState<{
    file: File;
    replaceItem?: MediaItem;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState('');

  const activeUploadRef = useRef<ActiveUploadHandle | null>(null);
  const allowFlirty = Boolean(privateAccount?.afterDarkConsent);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        activeUploadRef.current?.cancel();
        activeUploadRef.current = null;
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      activeUploadRef.current?.cancel();
    };
  }, [onClose]);

  useEffect(() => {
    if (!firebaseUser) return;
    const publicQuery = query(
      collection(db, 'mediaLibrary'),
      where('visibility', '==', 'public'),
      orderBy('createdAt', 'desc'),
      limit(60)
    );
    const mineQuery = query(
      collection(db, 'mediaLibrary'),
      where('uploaderId', '==', firebaseUser.uid),
      orderBy('createdAt', 'desc'),
      limit(60)
    );

    const unsubPublic = onSnapshot(
      publicQuery,
      (snap) => {
        setPublicItems(snap.docs.map((d) => d.data() as MediaItem));
      },
      (err) => {
        console.error('Public media gallery snapshot failed:', err);
        setError('Unable to load shared media gallery right now.');
      }
    );

    const unsubMine = onSnapshot(
      mineQuery,
      (snap) => {
        setMyItems(snap.docs.map((d) => d.data() as MediaItem));
      },
      (err) => {
        console.error('User media snapshot failed:', err);
      }
    );

    return () => {
      unsubPublic();
      unsubMine();
    };
  }, [firebaseUser]);

  const executeUpload = async (file: File, replaceItem?: MediaItem) => {
    if (!firebaseUser) return;
    setError(null);
    setFailedUpload(null);

    if (!replaceItem && uploadCategory === 'flirty' && !allowFlirty) {
      setError('Enable After Dark consent in After Dark settings before uploading Flirty category media.');
      return;
    }

    if (replaceItem) {
      setReplacingId(replaceItem.id);
    }

    activeUploadRef.current?.cancel();
    const handle = startCloudinaryUpload({
      file,
      purpose,
      scopeId,
      onProgress: (info) => {
        if (info.state === 'running' || info.state === 'paused') {
          setUploadInfo(info);
        }
      },
    });
    activeUploadRef.current = handle;

    try {
      const result = await handle.promise;
      activeUploadRef.current = null;

      if (replaceItem) {
        const oldPublicId = replaceItem.cloudinaryPublicId;
        const updatePayload: Record<string, unknown> = {
          url: result.downloadUrl,
          cloudinaryPublicId: result.publicId,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          updatedAt: serverTimestamp(),
        };
        if (result.assetId) updatePayload.cloudinaryAssetId = result.assetId;
        if (typeof result.width === 'number') updatePayload.width = result.width;
        if (typeof result.height === 'number') updatePayload.height = result.height;
        if (result.format) updatePayload.format = result.format;

        await updateDoc(doc(db, 'mediaLibrary', replaceItem.id), updatePayload);

        if (oldPublicId && oldPublicId !== result.publicId) {
          void deleteCloudinaryAsset(oldPublicId).catch(() => {});
        }
        setReplacingId(null);
        setUploadInfo(null);
        return;
      }

      const mediaId = generateId('med');
      const cleanTitle = (title.trim() || file.name.replace(/\.[^/.]+$/, '')).slice(0, 80);
      const newDoc: Record<string, unknown> = {
        id: mediaId,
        uploaderId: firebaseUser.uid,
        title: cleanTitle,
        url: result.downloadUrl,
        cloudinaryPublicId: result.publicId,
        category: uploadCategory,
        visibility,
        isAfterDark: uploadCategory === 'flirty',
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        createdAt: serverTimestamp(),
      };
      if (result.assetId) newDoc.cloudinaryAssetId = result.assetId;
      if (typeof result.width === 'number') newDoc.width = result.width;
      if (typeof result.height === 'number') newDoc.height = result.height;
      if (result.format) newDoc.format = result.format;

      await setDoc(doc(db, 'mediaLibrary', mediaId), newDoc);

      setUploadInfo(null);
      setTitle('');
      onSelectMedia(result.downloadUrl);
    } catch (err) {
      activeUploadRef.current = null;
      setUploadInfo(null);
      setReplacingId(null);
      setFailedUpload({ file, replaceItem });
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleDeleteItem = async (item: MediaItem) => {
    if (!firebaseUser || item.uploaderId !== firebaseUser.uid) return;
    setError(null);
    setDeletingId(item.id);
    try {
      if (item.cloudinaryPublicId) {
        await deleteCloudinaryAsset(item.cloudinaryPublicId, item.id);
      }
      await deleteDoc(doc(db, 'mediaLibrary', item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete media asset.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void executeUpload(file);
  };

  const handleReplaceFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    item: MediaItem
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void executeUpload(file, item);
  };

  const handleCancelUpload = () => {
    activeUploadRef.current?.cancel();
    activeUploadRef.current = null;
    setReplacingId(null);
    setUploadInfo(null);
  };

  // Merge public & personal uploads cleanly by id
  const mergedMap = new Map<string, MediaItem>();
  for (const item of myItems) mergedMap.set(item.id, item);
  for (const item of publicItems) {
    if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
  }
  const allItems = Array.from(mergedMap.values()).sort((a, b) => {
    const aMs = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
    const bMs = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
    return bMs - aMs;
  });

  const filteredItems = allItems.filter((item) => {
    if (item.isAfterDark && !allowFlirty) return false;
    if (category === 'mine') return item.uploaderId === firebaseUser?.uid;
    if (category === 'all') {
      return item.visibility === 'public' || item.uploaderId === firebaseUser?.uid;
    }
    return (
      item.category === category &&
      (item.visibility === 'public' || item.uploaderId === firebaseUser?.uid)
    );
  });

  const isUploading = uploadInfo !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white dark:bg-[#1b1c21] border border-zinc-200 dark:border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 bg-white dark:bg-[#17181c] border-b border-zinc-200 dark:border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-[#5865f2]" />
            <h2 className="font-display font-semibold text-base">Media & GIF Studio</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              handleCancelUpload();
              onClose();
            }}
            aria-label="Close Media Studio"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400 flex flex-wrap items-center justify-between gap-2">
              <span className="flex-1 min-w-[200px]">{error}</span>
              {failedUpload && !isUploading && (
                <button
                  type="button"
                  onClick={() =>
                    void executeUpload(failedUpload.file, failedUpload.replaceItem)
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium shrink-0"
                >
                  <RotateCcw className="w-3 h-3" /> Retry Upload
                </button>
              )}
            </div>
          )}

          {/* Upload panel */}
          <div className="bg-zinc-50 dark:bg-[#17181c] border border-zinc-200 dark:border-white/[0.07] rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                Upload Image or Animated GIF (PNG, JPG, WEBP, GIF · max 10 MB)
              </span>
              <span className="text-[11px] text-zinc-500">Zero explicit sexual imagery allowed</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Caption / title"
                className="h-9 px-3 rounded-lg bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-xs focus:outline-none focus:border-[#5865f2]"
              />
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as MediaCategory)}
                className="h-9 px-3 rounded-lg bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-xs focus:outline-none focus:border-[#5865f2]"
              >
                <option value="community">Community Upload</option>
                <option value="general">General</option>
                <option value="anime">Anime</option>
                <option value="reactions">Reactions</option>
                <option value="funny">Funny</option>
                {allowFlirty && <option value="flirty">Flirty (After Dark)</option>}
              </select>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                className="h-9 px-3 rounded-lg bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-xs focus:outline-none focus:border-[#5865f2]"
              >
                <option value="public">Public Gallery</option>
                <option value="private">Private Attachment</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold cursor-pointer transition-colors">
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {isUploading ? `Uploading ${uploadInfo.percent}%` : 'Choose Image / GIF'}
                <input
                  type="file"
                  disabled={isUploading}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {isUploading && (
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-medium"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              )}

              <div className="flex-1 flex items-center gap-2 min-w-[220px]">
                <input
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="Or paste safe HTTPS image / GIF URL…"
                  className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-[#111214] border border-zinc-200 dark:border-white/[0.08] text-xs focus:outline-none focus:border-[#5865f2]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (externalUrl.startsWith('https://')) {
                      onSelectMedia(externalUrl.trim());
                    } else {
                      setError('URL must start with https://');
                    }
                  }}
                  className="px-3 h-9 rounded-lg bg-zinc-200 dark:bg-[#222328] hover:bg-zinc-300 dark:hover:bg-[#2b2d34] text-xs font-medium"
                >
                  Use URL
                </button>
              </div>
            </div>

            {isUploading && (
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-[#222328] overflow-hidden">
                  <div
                    className="h-full bg-[#5865f2] transition-all duration-150"
                    style={{ width: `${uploadInfo.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500 tabular-nums">
                  <span>
                    {replacingId ? 'Replacing media on Cloudinary…' : 'Uploading to Cloudinary…'}
                  </span>
                  <span>
                    {Math.round(uploadInfo.bytesTransferred / 1024)} KB /{' '}
                    {Math.max(1, Math.round(uploadInfo.totalBytes / 1024))} KB ({uploadInfo.percent}%)
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Category filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {CATEGORIES.map((cat) => {
              if (cat.id === 'flirty' && !allowFlirty) return null;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    category === cat.id
                      ? 'bg-[#5865f2] text-white'
                      : 'bg-zinc-100 dark:bg-[#222328] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {!allowFlirty && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Flirty category media is hidden until After Dark consent is enabled.</span>
            </div>
          )}

          {/* Gallery */}
          {filteredItems.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-zinc-200 dark:border-white/[0.08] rounded-xl">
              <ImagePlus className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-zinc-400">No media in this category yet</p>
              <p className="text-xs text-zinc-500 mt-1">Upload an image or GIF above to share it.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredItems.map((item) => {
                const isOwner = item.uploaderId === firebaseUser?.uid;
                const isBusy = replacingId === item.id || deletingId === item.id;
                return (
                  <div
                    key={item.id}
                    className="group relative rounded-xl overflow-hidden border border-zinc-200 dark:border-white/[0.07] bg-zinc-100 dark:bg-[#17181c]"
                  >
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onSelectMedia(item.url)}
                      className="w-full aspect-square block overflow-hidden relative"
                    >
                      <img
                        src={item.url}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      {item.visibility === 'private' && (
                        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-medium text-zinc-200">
                          Private
                        </span>
                      )}
                    </button>
                    <div className="p-2 flex items-center justify-between gap-1.5 text-xs">
                      <span className="truncate font-medium" title={item.title}>
                        {item.title}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <a
                          href={item.url}
                          download={item.title}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Download media"
                          className="p-1 text-zinc-400 hover:text-zinc-100"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        {isOwner && (
                          <>
                            <label
                              title="Replace uploaded image"
                              className="p-1 text-zinc-400 hover:text-violet-400 cursor-pointer"
                            >
                              {replacingId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              <input
                                type="file"
                                disabled={isUploading || isBusy}
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                onChange={(e) => handleReplaceFileChange(e, item)}
                                className="hidden"
                              />
                            </label>
                            <button
                              type="button"
                              disabled={isBusy}
                              aria-label="Delete media"
                              title="Delete media"
                              onClick={() => void handleDeleteItem(item)}
                              className="p-1 text-zinc-400 hover:text-rose-400 disabled:opacity-50"
                            >
                              {deletingId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
