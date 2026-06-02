import * as path from "path";
import * as crypto from "crypto";

/**
 * Image upload validation + content-addressed naming.
 *
 * The webview can post arbitrary `{ filename, data }` payloads to the
 * extension host (a malicious .md opened in the user's home directory
 * could otherwise drop `.bashrc`, `.command`, or any other dotfile via
 * the upload handler). This helper is the trust boundary:
 *
 *   1. Reject anything outside the image extension whitelist.
 *   2. Reject content larger than `MAX_IMAGE_BYTES` (DoS guard).
 *   3. Derive the on-disk filename from a SHA-256 prefix of the content
 *      so the user-supplied filename never reaches the filesystem and
 *      identical content dedups automatically.
 *
 * Kept pure (no `fs`, no `vscode`) so it can be unit-tested in Node
 * without mocking the extension host — see `test/test-upload-image.ts`.
 */

export const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Base64 encodes 3 bytes → 4 chars (plus up to 2 chars of padding). A string
// longer than this can't decode to <= MAX_IMAGE_BYTES, so reject before
// allocating the Buffer.
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4;

export interface UploadImageOk {
  ok: true;
  content: Buffer;
  finalName: string;
}

export interface UploadImageError {
  ok: false;
  reason: "extension" | "size" | "data";
}

export type UploadImageResult = UploadImageOk | UploadImageError;

export function prepareImageUpload(
  filename: unknown,
  base64Data: unknown,
): UploadImageResult {
  if (typeof filename !== "string" || typeof base64Data !== "string") {
    return { ok: false, reason: "data" };
  }

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "extension" };
  }

  if (base64Data.length > MAX_BASE64_LENGTH) {
    return { ok: false, reason: "size" };
  }

  const content = Buffer.from(base64Data, "base64");
  if (content.length === 0) {
    return { ok: false, reason: "data" };
  }
  if (content.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "size" };
  }

  const hash = crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 16);
  return { ok: true, content, finalName: `${hash}${ext}` };
}
