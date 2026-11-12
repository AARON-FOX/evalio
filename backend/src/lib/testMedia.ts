import { supabaseAdmin } from './supabaseAdmin.js';

export const TEST_IMAGE_BUCKET = 'evalio-test-images';
export const MAX_TEST_IMAGE_BYTES = 3 * 1024 * 1024;
export const TEST_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

const pathFormat = /^[a-f\d-]{36}\/[a-f\d-]{36}\/[a-f\d-]{36}\.(jpg|jpeg|png|webp|gif)$/i;

export function isOwnImagePath(path: string, userId: string): boolean {
  return pathFormat.test(path) && path.startsWith(`${userId}/`);
}

// Media are stored as immutable UUID-named objects. All versions in a series
// may reference the SAME object; never delete it on question edit/delete.
export async function verifyImageReferences(paths: (string | null | undefined)[], ownerId: string) {
  for (const path of new Set(paths.filter((s): s is string => !!s))) {
    if (!isOwnImagePath(path, ownerId)) {
      throw new Error('invalid_media_path');
    }
    const { data, error } = await supabaseAdmin.storage
      .from(TEST_IMAGE_BUCKET)
      .info(path);
    if (error || !data) throw new Error('image_not_uploaded');
  }
}

export type MediaOption = {
  image_path?: string | null;
  image_only?: boolean;
};
export type MediaQuestion = {
  image_path?: string | null;
  options?: MediaOption[];
};

// Call ONLY AFTER the route has checked owner/student access to the exact test
// version. This function never makes an authorization decision by itself.
export async function withSignedQuestionImages<T extends MediaQuestion>(questions: T[]) {
  const paths = [...new Set(questions.flatMap(q => [
    q.image_path,
    ...(q.options ?? []).map(o => o.image_path),
  ]).filter((s): s is string => !!s))];

  const signed = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 50) {
    const { data, error } = await supabaseAdmin.storage
      .from(TEST_IMAGE_BUCKET).createSignedUrls(paths.slice(i, i + 50), 3600);
    if (error || !data) throw new Error('image_signing_failed');
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
    }
  }
  return questions.map(q => ({
    ...q,
    imageUrl: q.image_path ? signed.get(q.image_path) ?? null : null,
    options: q.options?.map(o => ({
      ...o,
      imageUrl: o.image_path ? signed.get(o.image_path) ?? null : null,
      imageOnly: !!o.image_only,
    })),
  }));
}
