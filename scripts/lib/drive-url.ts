/**
 * Google Drive share-link → direct-download URL.
 *
 * Blotato's /v2/media fetches media server-side from whatever URL we hand it.
 * A normal Drive *share* link (`/file/d/<id>/view`) serves an HTML preview
 * page, not the file — Blotato would store the HTML and the post would fail
 * with a media-conversion error that gives no hint about the real cause.
 *
 * docs/blotato-api.md:434 specifies the exact form Blotato expects:
 *   https://drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t
 *
 * The `confirm=t` matters: without it Drive answers large files (>~100MB, i.e.
 * most videos) with a virus-scan interstitial instead of the bytes.
 *
 * The file must be shared as "Anyone with the link" — a private file returns a
 * sign-in page, which again fetches as HTML rather than failing loudly.
 */

/** Extract the Drive file id from any of the link shapes Drive hands out. */
export function extractDriveFileId(url: string): string | null {
  // https://drive.google.com/file/d/<ID>/view?usp=sharing
  const filePath = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (filePath) return filePath[1];

  // https://drive.google.com/open?id=<ID>
  // https://drive.google.com/uc?id=<ID>&export=download
  // https://drive.usercontent.google.com/download?id=<ID>&...
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];

  return null;
}

/** True for any *.google.com Drive host we know how to rewrite. */
export function isDriveUrl(url: string): boolean {
  return /drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com/.test(url);
}

/**
 * Normalise a URL for handing to Blotato.
 *
 * Drive links are rewritten to the direct-download form; everything else is
 * returned untouched, so an already-public S3/CDN/Supabase URL passes straight
 * through. Throws on a Drive URL we can't extract an id from rather than
 * returning it unchanged — silently passing a preview-page URL downstream is
 * exactly the failure this function exists to prevent.
 */
export function toDirectMediaUrl(url: string): string {
  const trimmed = url.trim();
  if (!isDriveUrl(trimmed)) return trimmed;

  // A Drive *folder* link has no single file to download. Callers must expand
  // folders into per-file links themselves (the Drive API needs OAuth, which
  // this repo has no credentials for).
  if (/\/drive\/folders\//.test(trimmed)) {
    throw new Error(
      `"${trimmed}" is a Drive folder link. Share each video as an individual ` +
        `file link ("Anyone with the link"), or list the files in the manifest one per row.`,
    );
  }

  const id = extractDriveFileId(trimmed);
  if (!id) {
    throw new Error(`Could not extract a Drive file id from "${trimmed}"`);
  }
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}
