import canonicalize from 'canonicalize';
import { keccak256, stringToBytes } from 'viem';
import {
  NonNormalizedInputError,
  SchemaViolationError,
  UnknownKeyError,
} from './errors.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface MemoryContent {
  text: string;
  format: 'text.v0';
  refs?: readonly string[];
  meta?: Record<string, JsonValue>;
}

const ALLOWED_KEYS = new Set(['text', 'format', 'refs', 'meta']);

// Lone surrogate detection (UTF-16 well-formedness, ES2024 String.isWellFormed
// without relying on the newer lib target).
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export function isWellFormedUtf16(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

function assertNormalized(text: string): void {
  if (!isWellFormedUtf16(text)) throw new NonNormalizedInputError();
  if (text.normalize('NFC') !== text) throw new NonNormalizedInputError();
}

/**
 * A JSON object is an object whose prototype is Object.prototype (or null).
 * `typeof x === 'object'` alone would accept Date, Map, Set, RegExp, class
 * instances — all of which `canonicalize` silently rewrites (Date → ISO
 * string, Map → {}), producing a hash for content the user never wrote.
 * R1 (review 2026-10-19): reject them instead (policy: reject, never
 * silently normalize).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertJsonValue(value: unknown, path: string, depth = 0): void {
  if (depth > 64) throw new SchemaViolationError(`meta nested too deep at ${path}`);
  if (value === null) return;
  const t = typeof value;
  if (t === 'string') {
    // R2 (review 2026-10-19): normalization is checked for EVERY string in
    // the hashed object, not just `text`. Otherwise two visually identical
    // memories (NFC vs NFD spelling inside meta) produce different hashes.
    assertNormalized(value as string);
    return;
  }
  if (t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new SchemaViolationError(`non-finite number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertJsonValue(value[i], `${path}[${i}]`, depth + 1);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertNormalized(key);
      assertJsonValue(child, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new SchemaViolationError(`non-JSON value at ${path}`);
}

/**
 * Deep-validate unknown JSON into MemoryContent.
 * Unknown top-level keys are rejected; extension goes through `meta`.
 */
export function parseMemoryContent(input: unknown): MemoryContent {
  if (!isPlainObject(input)) {
    throw new SchemaViolationError('content must be a JSON object');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) throw new UnknownKeyError(key);
  }

  const { text, format, refs, meta } = input;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new SchemaViolationError('text must be a non-empty string');
  }
  if (format !== 'text.v0') {
    throw new SchemaViolationError('format must be "text.v0"');
  }
  assertNormalized(text);

  const out: MemoryContent = { text, format };
  if (refs !== undefined) {
    if (!Array.isArray(refs) || !refs.every((r) => typeof r === 'string')) {
      throw new SchemaViolationError('refs must be an array of strings');
    }
    for (const ref of refs as string[]) assertNormalized(ref);
    out.refs = refs as string[];
  }
  if (meta !== undefined) {
    if (!isPlainObject(meta)) {
      throw new SchemaViolationError('meta must be a JSON object');
    }
    assertJsonValue(meta, 'meta');
    out.meta = meta as Record<string, JsonValue>;
  }
  return out;
}

/**
 * JCS (RFC 8785) canonical UTF-8 bytes of the full content object
 * (menhir spec §3.2, D-4). Throws NonNormalizedInputError if `text` is not
 * NFC or contains lone surrogates.
 */
export function canonicalBytes(content: MemoryContent): Uint8Array {
  // R2: `canonicalBytes` is a public entry point — callers may hand-build a
  // MemoryContent instead of going through parseMemoryContent, so the whole
  // hashed object is re-validated here (not just `text`).
  assertNormalized(content.text);
  if (content.refs !== undefined) {
    for (const ref of content.refs) assertNormalized(ref);
  }
  if (content.meta !== undefined) assertJsonValue(content.meta, 'meta');
  const json = canonicalize(content);
  if (json === undefined) {
    throw new SchemaViolationError('content is not JSON-serializable');
  }
  return stringToBytes(json);
}

/** JCS string form (same bytes as canonicalBytes, as text). */
export function canonicalString(content: MemoryContent): string {
  assertNormalized(content.text);
  if (content.refs !== undefined) {
    for (const ref of content.refs) assertNormalized(ref);
  }
  if (content.meta !== undefined) assertJsonValue(content.meta, 'meta');
  const json = canonicalize(content);
  if (json === undefined) {
    throw new SchemaViolationError('content is not JSON-serializable');
  }
  return json;
}

/** keccak256(canonicalBytes) — 0x-prefixed hex (menhir spec §3.2). */
export function contentHash(content: MemoryContent): `0x${string}` {
  return keccak256(canonicalBytes(content));
}
