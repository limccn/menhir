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
  // `String.prototype.normalize` throws RangeError on a lone surrogate, so the
  // well-formedness check must come first or the typed error leaks as a
  // RangeError. Keep this ordering even if the regex is ever replaced.
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

/**
 * Read a value **once** and return an equivalent plain-JSON snapshot.
 *
 * Why a snapshot rather than a validation pass (review 2026-10-20, R3):
 *
 * - **TOCTOU.** Validating then handing the original object to `canonicalize`
 *   reads every property twice. A getter can return a valid value to the gate
 *   and a different (e.g. non-NFC) value to the serializer.
 * - **`toJSON`.** `canonicalize` honours `toJSON`, which the gate never sees.
 *   An object can validate as one thing and serialize as another.
 * - **Non-enumerable / accessor properties.** `Object.entries` sees only
 *   enumerable own properties; the serializer has the same view, but a getter
 *   still makes the two views diverge.
 *
 * Reading once into a fresh plain structure closes all three: the thing that
 * is validated is literally the thing that is serialized, and it has no
 * prototype, no getters and no `toJSON`.
 */
function snapshotJsonValue(value: unknown, path: string, depth = 0): JsonValue {
  if (depth > 64) throw new SchemaViolationError(`value nested too deep at ${path}`);
  if (value === null) return null;

  const t = typeof value;
  if (t === 'string') {
    assertNormalized(value as string);
    return value as string;
  }
  if (t === 'boolean') return value as boolean;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new SchemaViolationError(`non-finite number at ${path}`);
    }
    return value as number;
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (let i = 0; i < value.length; i += 1) {
      out.push(snapshotJsonValue(value[i], `${path}[${i}]`, depth + 1));
    }
    return out;
  }
  if (isPlainObject(value)) {
    // A plain object with an own `toJSON` would still be honoured by the
    // serializer before our snapshot is built. Refuse it outright.
    if (Object.prototype.hasOwnProperty.call(value, 'toJSON')) {
      throw new SchemaViolationError(`toJSON is not allowed at ${path}`);
    }
    const out: Record<string, JsonValue> = {};
    // Own enumerable string keys, read exactly once each.
    for (const key of Object.keys(value)) {
      assertNormalized(key);
      // Define, never assign. `out["__proto__"] = value` would invoke the
      // inherited setter: the key would vanish from Object.keys and the
      // snapshot's prototype would become attacker-controlled (M-2). An own
      // data property matches what JSON.parse itself produces, so the
      // canonical bytes agree with RFC 8785 reference implementations.
      Object.defineProperty(out, key, {
        value: snapshotJsonValue(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
          depth + 1,
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  throw new SchemaViolationError(`non-JSON value at ${path}`);
}

/**
 * Build the exact object that will be hashed: every top-level field validated
 * and snapshotted, in one read.
 *
 * `canonicalBytes`/`canonicalString` are public entry points — a caller can
 * construct `MemoryContent` directly instead of going through
 * `parseMemoryContent`, so the full schema gate must run here too. Before
 * this, a hand-built value could carry unknown keys, `format: 'text.v1'`,
 * `refs: new Set()`, or even a non-string `text` (which surfaced as a raw
 * `TypeError` from `.normalize`).
 */
function snapshotMemoryContent(content: MemoryContent): MemoryContent {
  if (!isPlainObject(content)) {
    throw new SchemaViolationError('content must be a JSON object');
  }
  if (Object.prototype.hasOwnProperty.call(content, 'toJSON')) {
    throw new SchemaViolationError('toJSON is not allowed on content');
  }
  for (const key of Object.keys(content)) {
    if (!ALLOWED_KEYS.has(key)) throw new UnknownKeyError(key);
  }

  const text = content.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new SchemaViolationError('text must be a non-empty string');
  }
  assertNormalized(text);

  const format = content.format;
  if (format !== 'text.v0') {
    throw new SchemaViolationError('format must be "text.v0"');
  }

  const out: MemoryContent = { text, format };

  const refs = content.refs;
  if (refs !== undefined) {
    if (!Array.isArray(refs)) {
      throw new SchemaViolationError('refs must be an array of strings');
    }
    const copied: string[] = [];
    for (let i = 0; i < refs.length; i += 1) {
      const ref: unknown = refs[i];
      if (typeof ref !== 'string') {
        throw new SchemaViolationError(`refs[${i}] must be a string`);
      }
      assertNormalized(ref);
      copied.push(ref);
    }
    out.refs = copied;
  }

  const meta = content.meta;
  if (meta !== undefined) {
    if (!isPlainObject(meta)) {
      throw new SchemaViolationError('meta must be a JSON object');
    }
    out.meta = snapshotJsonValue(meta, 'meta') as Record<string, JsonValue>;
  }

  return out;
}

/**
 * Deep-validate unknown JSON into MemoryContent.
 * Unknown top-level keys are rejected; extension goes through `meta`.
 */
export function parseMemoryContent(input: unknown): MemoryContent {
  // Delegates to the same snapshot used by canonicalString. One gate, not two:
  // a second validation path is a second place for the rules to drift, and the
  // parser's output is what callers hand back to canonicalBytes.
  return snapshotMemoryContent(input as MemoryContent);
}

/**
 * JCS (RFC 8785) canonical UTF-8 bytes of the full content object
 * (menhir spec §3.2, D-4). Throws NonNormalizedInputError if `text` is not
 * NFC or contains lone surrogates.
 */
export function canonicalBytes(content: MemoryContent): Uint8Array {
  return stringToBytes(canonicalString(content));
}

/** JCS string form (same bytes as canonicalBytes, as text). */
export function canonicalString(content: MemoryContent): string {
  // Validate and snapshot in ONE read, then serialize the snapshot. The
  // serializer never touches caller-owned objects, so a getter or toJSON
  // cannot supply different bytes than the ones that were checked (R3).
  const snapshot = snapshotMemoryContent(content);
  const json = canonicalize(snapshot);
  if (json === undefined) {
    throw new SchemaViolationError('content is not JSON-serializable');
  }
  return json;
}

/** keccak256(canonicalBytes) — 0x-prefixed hex (menhir spec §3.2). */
export function contentHash(content: MemoryContent): `0x${string}` {
  return keccak256(canonicalBytes(content));
}
