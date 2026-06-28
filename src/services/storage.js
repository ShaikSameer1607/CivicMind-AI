import { createClient } from '@supabase/supabase-js';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_VIDEO_SIZE = 20 * 1024 * 1024;
const MAX_AUDIO_SIZE = 15 * 1024 * 1024;

const STORAGE_UNAVAILABLE_MSG =
  'Media persistence is unavailable. AI analysis and issue reporting will continue normally.';

let supabaseInstance = null;

export function isStorageEnabled() {
  // Storage is enabled if Supabase configuration is present
  return !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
}

export function getStorageInfoMessage() {
  return isStorageEnabled()
    ? 'Evidence media is securely stored in Supabase Storage.'
    : STORAGE_UNAVAILABLE_MSG;
}

function getSupabase() {
  if (!isStorageEnabled()) return null;
  if (!supabaseInstance) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    console.log('[DEBUG] init Supabase URL:', url ? 'Present' : 'Missing');
    console.log('[DEBUG] init Supabase Key:', key ? 'Present' : 'Missing');
    supabaseInstance = createClient(url, key);
  }
  return supabaseInstance;
}

function validateFile(file, type) {
  if (!file) throw new Error('No file selected');
  const limits = { image: MAX_IMAGE_SIZE, video: MAX_VIDEO_SIZE, audio: MAX_AUDIO_SIZE };
  const max = limits[type] || MAX_IMAGE_SIZE;
  if (file.size > max) {
    throw new Error(`File too large. Max ${Math.round(max / 1024 / 1024)}MB for ${type}.`);
  }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a single evidence file using Supabase Storage.
 * @returns {Promise<string>} download URL
 */
export async function uploadEvidenceFile(uid, issueId, file, mediaType = 'images') {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase Storage is not configured');

  validateFile(file, mediaType === 'images' ? 'image' : mediaType === 'videos' ? 'video' : 'audio');
  
  const ext = file.name.split('.').pop() || 'tmp';
  const safeName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
  const path = `issues/${mediaType}/${uid}/${issueId}/${safeName}`;
  
  console.log('[DEBUG] Supabase uploading to bucket: civicmind-storage, path:', path);

  const { data, error } = await supabase.storage
    .from('civicmind-storage')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    console.error('[DEBUG] Supabase upload error:', JSON.stringify(error));
    throw new Error('Failed to upload file to Supabase: ' + error.message);
  }
  console.log('[DEBUG] Supabase upload success, data:', JSON.stringify(data));

  const { data: publicUrlData } = supabase.storage
    .from('civicmind-storage')
    .getPublicUrl(path);

  console.log('[DEBUG] Supabase public URL resolved:', publicUrlData?.publicUrl);
  return publicUrlData.publicUrl;
}

/** @param {File[]} files */
export async function uploadEvidenceBatch(uid, issueId, files, mediaType = 'images') {
  const urls = [];
  for (const file of files) {
    urls.push(await uploadEvidenceFile(uid, issueId, file, mediaType));
  }
  return urls;
}

/**
 * Resolve report media for Firestore + agent pipeline.
 * Works seamlessly with Supabase Storage integration.
 *
 * @param {string} uid
 * @param {string} issueId
 * @param {{ images: File[], video: File|null, audio: File|null }} media
 */
export async function resolveReportMedia(uid, issueId, media) {
  const result = {
    imageUrls: [],
    videoUrls: [],
    audioUrls: [],
    pipelineImageUrl: null,
    storageUsed: false,
    infoMessage: null,
  };

  const hasMedia =
    (media.images?.length || 0) > 0 || Boolean(media.video) || Boolean(media.audio);

  if (!hasMedia) return result;

  if (!isStorageEnabled()) {
    if (media.images?.length) {
      result.pipelineImageUrl = await fileToDataUrl(media.images[0]);
    }
    result.infoMessage = STORAGE_UNAVAILABLE_MSG;
    return result;
  }

  try {
    if (media.images?.length) {
      result.imageUrls = await uploadEvidenceBatch(uid, issueId, media.images, 'images');
      result.pipelineImageUrl = result.imageUrls[0];
      result.storageUsed = true;
    }
    if (media.video) {
      result.videoUrls = [await uploadEvidenceFile(uid, issueId, media.video, 'videos')];
      result.storageUsed = true;
    }
    if (media.audio) {
      result.audioUrls = [await uploadEvidenceFile(uid, issueId, media.audio, 'audio')];
      result.storageUsed = true;
    }
  } catch (err) {
    console.error('Failed to process media uploads with Supabase:', err);
    if (media.images?.length) {
      result.pipelineImageUrl = await fileToDataUrl(media.images[0]);
    }
    result.imageUrls = [];
    result.videoUrls = [];
    result.audioUrls = [];
    result.storageUsed = false;
    result.infoMessage = 'Media upload failed. Issue will be reported without media persistence.';
  }

  return result;
}

export { MAX_IMAGE_SIZE, MAX_VIDEO_SIZE, MAX_AUDIO_SIZE, STORAGE_UNAVAILABLE_MSG };
