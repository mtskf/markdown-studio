/**
 * Tests for prepareImageUpload — the pure validation/hashing helper used by
 * the uploadImage message handler in src/provider.ts.
 *
 * Covers the three security invariants from docs/security-audit (H-2):
 *   1. Extension whitelist  — only png|jpg|jpeg|gif|webp|svg
 *   2. Content-hash name    — finalName derived from sha256(content), not user input
 *   3. Size cap             — content > 10MB is rejected
 *
 * Usage: npx tsx test/test-upload-image.ts
 */

import {
  prepareImageUpload,
  MAX_IMAGE_BYTES,
  ALLOWED_EXTENSIONS,
} from "../src/uploadImage";

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, detail?: string) {
  results.push({ name, passed: condition, detail });
}

function b64(buf: Buffer): string {
  return buf.toString("base64");
}

function smallPng(): Buffer {
  // 8-byte PNG signature is enough for the helper — it only inspects size,
  // extension, and content hash, not the bytes themselves.
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function run() {
  // --------------------------------------------------------------------------
  // Extension whitelist
  // --------------------------------------------------------------------------

  for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]) {
    const r = prepareImageUpload(`photo${ext}`, b64(smallPng()));
    assert(`accepts ${ext}`, r.ok, r.ok ? "" : `rejected: ${r.reason}`);
  }

  for (const ext of [".PNG", ".JPG", ".Webp"]) {
    const r = prepareImageUpload(`photo${ext}`, b64(smallPng()));
    assert(
      `accepts uppercase ${ext}`,
      r.ok,
      r.ok ? "" : `rejected: ${r.reason}`,
    );
  }

  const reject: [string, string][] = [
    ["malicious .bashrc", ".bashrc"],
    ["malicious .command", "foo.command"],
    ["malicious .exe", "evil.exe"],
    ["malicious .md", "readme.md"],
    ["no extension", "noext"],
    ["empty filename", ""],
    ["just a dot", "."],
    ["path traversal (basename should help but ext is still wrong)", "../../etc/passwd"],
  ];
  for (const [name, fn] of reject) {
    const r = prepareImageUpload(fn, b64(smallPng()));
    assert(
      `rejects ${name}: ${JSON.stringify(fn)}`,
      !r.ok && r.reason === "extension",
      r.ok ? `accepted as ${r.finalName}` : `wrong reason: ${r.reason}`,
    );
  }

  // --------------------------------------------------------------------------
  // Content-hash filename (dedup)
  // --------------------------------------------------------------------------

  const a = prepareImageUpload("a.png", b64(smallPng()));
  const b = prepareImageUpload("b.png", b64(smallPng()));
  assert(
    "same content → same finalName regardless of input filename",
    a.ok && b.ok && a.finalName === b.finalName,
    a.ok && b.ok ? `a=${a.finalName} b=${b.finalName}` : "one failed",
  );

  // Use a basename guaranteed not to appear in any hex digest (uppercase + 'Z')
  // so the assertion can't false-pass when the random hash happens to include
  // a single hex char from the user input.
  const attack = prepareImageUpload("ATTACK_Z.png", b64(smallPng()));
  assert(
    "finalName does not contain user-supplied basename",
    attack.ok && !attack.finalName.toUpperCase().includes("ATTACK_Z"),
    attack.ok ? `finalName=${attack.finalName}` : "rejected",
  );

  assert(
    "finalName preserves extension",
    a.ok && a.finalName.endsWith(".png"),
    a.ok ? `finalName=${a.finalName}` : "rejected",
  );

  assert(
    "finalName is 16 hex chars + ext",
    a.ok && /^[0-9a-f]{16}\.png$/.test(a.finalName),
    a.ok ? `finalName=${a.finalName}` : "rejected",
  );

  const other = prepareImageUpload(
    "x.png",
    b64(Buffer.from([0x00, 0x01, 0x02, 0x03])),
  );
  assert(
    "different content → different finalName",
    a.ok && other.ok && a.finalName !== other.finalName,
    a.ok && other.ok ? `a=${a.finalName} other=${other.finalName}` : "one failed",
  );

  assert(
    "extension is lower-cased in finalName even if input is upper-case",
    (() => {
      const r = prepareImageUpload("PHOTO.PNG", b64(smallPng()));
      return r.ok && r.finalName.endsWith(".png");
    })(),
  );

  // --------------------------------------------------------------------------
  // Size cap
  // --------------------------------------------------------------------------

  // Just under the limit: a buffer of exactly MAX_IMAGE_BYTES bytes is allowed.
  const atLimit = Buffer.alloc(MAX_IMAGE_BYTES, 0x00);
  const atRes = prepareImageUpload("at.png", b64(atLimit));
  assert(
    `accepts exactly ${MAX_IMAGE_BYTES} bytes`,
    atRes.ok,
    atRes.ok ? "" : `rejected: ${atRes.reason}`,
  );

  // One byte over: rejected with reason "size".
  const overLimit = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x00);
  const overRes = prepareImageUpload("over.png", b64(overLimit));
  assert(
    `rejects ${MAX_IMAGE_BYTES + 1} bytes with reason "size"`,
    !overRes.ok && overRes.reason === "size",
    overRes.ok ? `accepted` : `reason=${overRes.reason}`,
  );

  // Empty content: rejected with reason "data" (not "size").
  const emptyRes = prepareImageUpload("empty.png", "");
  assert(
    "rejects empty content with reason \"data\"",
    !emptyRes.ok && emptyRes.reason === "data",
    emptyRes.ok ? "accepted" : `reason=${emptyRes.reason}`,
  );

  // --------------------------------------------------------------------------
  // Defensive: non-string inputs
  // --------------------------------------------------------------------------

  // @ts-expect-error testing runtime guard
  const badF = prepareImageUpload(undefined, b64(smallPng()));
  assert(
    "rejects undefined filename with reason \"data\"",
    !badF.ok && badF.reason === "data",
  );

  // @ts-expect-error testing runtime guard
  const badD = prepareImageUpload("x.png", undefined);
  assert(
    "rejects undefined data with reason \"data\"",
    !badD.ok && badD.reason === "data",
  );

  // --------------------------------------------------------------------------
  // Exports sanity
  // --------------------------------------------------------------------------

  assert(
    "ALLOWED_EXTENSIONS contains the documented set",
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].every((e) =>
      ALLOWED_EXTENSIONS.has(e),
    ) && ALLOWED_EXTENSIONS.size === 6,
  );

  assert("MAX_IMAGE_BYTES is 10 MiB", MAX_IMAGE_BYTES === 10 * 1024 * 1024);

  // --------------------------------------------------------------------------
  // Report
  // --------------------------------------------------------------------------

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);
  for (const r of failed) {
    console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(
    `\nupload-image: ${passed}/${results.length} passed${failed.length ? `, ${failed.length} failed` : ""}`,
  );
  if (failed.length) process.exit(1);
}

run();
