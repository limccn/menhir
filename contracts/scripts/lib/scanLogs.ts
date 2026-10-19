// Adaptive eth_getLogs-style window scanning shared by maintenance scripts.
//
// Public RPCs do not agree on a maximum block range, and some (Base Sepolia's
// public endpoint among them) reject an oversized request at the HTTP layer
// without putting any range wording in the error text. The caller supplies
// only an initial ceiling; this module discovers the real cap at runtime:
//
//   - 429 / rate-limit and transient transport failures back off and retry the
//     same window;
//   - every other failure shrinks the window — adopting a numeric limit stated
//     by the provider when it gives one, otherwise halving;
//   - the discovered size is kept for the rest of the scan instead of being
//     re-learned window by window;
//   - a one-block window is retried a bounded number of times before giving up.
//
// Windows are always bounded and move forward, so [fromBlock, toBlock] is
// covered exactly once and no `pending` block tag is ever used.

export interface ScanLogsOptions<TLog> {
  fromBlock: bigint;
  toBlock: bigint;
  /** Upper bound for the first request; the provider's real cap may be lower. */
  initialChunkSize: bigint;
  fetchLogs: (fromBlock: bigint, toBlock: bigint) => Promise<readonly TLog[]>;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RETRIES = 6;
const MAX_ATTEMPTS_AT_FLOOR = 4;
const MAX_ATTEMPTS_PER_WINDOW = 64;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 30_000;

// Deliberately "too many requests", not bare "too many": some providers say
// "too many blocks" for a range cap, which must shrink rather than retry.
// Status codes need word boundaries: provider messages often quote block
// numbers, and "48314429" or "48306502" are not 429/502 statuses.
const RATE_LIMIT = /\b429\b|rate.?limit|too many requests/i;
const TRANSIENT = /\b(?:502|503|504)\b|timeout|timed out|network|fetch failed|ECONNRESET/i;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Provider error text can land in any of these fields depending on transport. */
function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || depth > 4) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value !== "object") {
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        parts.push(String(value));
      }
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);

    if (value instanceof Error) parts.push(value.message);
    const record = value as Record<string, unknown>;

    const details = record.details;
    if (typeof details === "string") parts.push(details);
    const shortMessage = record.shortMessage;
    if (typeof shortMessage === "string") parts.push(shortMessage);

    // Hardhat's HTTP layer wraps the response body on ResponseStatusCodeError;
    // providers sometimes put the range wording only in there.
    const body = record.body;
    if (typeof body === "string") {
      parts.push(body);
    } else if (body !== null && typeof body === "object") {
      try {
        parts.push(JSON.stringify(body));
      } catch {
        // A body that cannot be serialized still leaves the other text fields.
      }
    }

    if ("cause" in record) visit(record.cause, depth + 1);
    if (!(value instanceof Error) && typeof record.message === "string") {
      parts.push(record.message);
    }
  };

  visit(error, 0);
  return parts.join(" | ");
}

/** HTTP status as exposed by viem's HttpRequestError / Hardhat's wrapper. */
function errorStatus(error: unknown): number | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current !== "object") break;
    const record = current as Record<string, unknown>;
    const status = record.status ?? record.statusCode;
    if (typeof status === "number") return status;
    current = record.cause;
  }
  return null;
}

/**
 * Pull the provider's stated block limit out of its message when it gives one
 * ("limited to a 200 range", "exceeds 2,000", "maximum of 500") -> 200/2000/500.
 * Returns null when no number is stated.
 */
function statedRangeLimit(text: string): bigint | null {
  const match = /(?:limited to|exceeds|maximum of|max of)\s*(?:a\s+)?(\d[\d,]*)/i.exec(text);
  if (match?.[1] === undefined) return null;
  const value = BigInt(match[1].replace(/,/g, ""));
  return value > 0n ? value : null;
}

function scanError(
  fromBlock: bigint,
  toBlock: bigint,
  cursor: bigint,
  reason: string,
  error: unknown,
): Error {
  const underlying = errorText(error);
  return new Error(
    `log scan failed for blocks ${fromBlock}..${toBlock} at block ${cursor}: ${reason}. ` +
      "Try an RPC with a more permissive getLogs range or check the endpoint.\n" +
      `Underlying: ${underlying.length > 0 ? underlying : String(error)}`,
  );
}

/**
 * Walk [fromBlock, toBlock] with adaptive windows, returning every log in
 * provider order. The caller's `fetchLogs` performs the actual request, so
 * this works with `getLogs` or `getContractEvents` and stays browser-free.
 */
export async function scanLogs<TLog>(options: ScanLogsOptions<TLog>): Promise<TLog[]> {
  const { fromBlock, toBlock, fetchLogs } = options;
  if (toBlock < fromBlock) return [];

  const sleep = options.sleep ?? defaultSleep;
  let chunkSize = options.initialChunkSize > 0n ? options.initialChunkSize : 1n;
  const logs: TLog[] = [];
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    let backoff = BASE_BACKOFF_MS;
    let retries = 0;
    let floorAttempts = 0;
    let attempts = 0;
    let lastError: unknown;

    for (;;) {
      attempts += 1;
      if (attempts > MAX_ATTEMPTS_PER_WINDOW) {
        throw scanError(
          fromBlock,
          toBlock,
          cursor,
          `exceeded ${MAX_ATTEMPTS_PER_WINDOW} attempts`,
          lastError,
        );
      }

      // Recompute the span on every attempt: after shrinking, the retried
      // request must actually be smaller than the one that failed.
      const remaining = toBlock - cursor + 1n;
      const span = chunkSize < remaining ? chunkSize : remaining;
      const end = cursor + span - 1n;

      try {
        const batch = await fetchLogs(cursor, end);
        for (const log of batch) logs.push(log);
        // A successful window is the only thing that advances the cursor.
        cursor = end + 1n;
        break;
      } catch (error) {
        lastError = error;
        const status = errorStatus(error);
        const text = errorText(error);
        const rateLimited = status === 429 || RATE_LIMIT.test(text);
        const transient =
          !rateLimited &&
          (status === 502 ||
            status === 503 ||
            status === 504 ||
            TRANSIENT.test(text));

        if (rateLimited || transient) {
          retries += 1;
          if (span === 1n) floorAttempts += 1;
          if (floorAttempts >= MAX_ATTEMPTS_AT_FLOOR) {
            throw scanError(
              fromBlock,
              toBlock,
              cursor,
              `${floorAttempts} consecutive failures at a 1-block window`,
              error,
            );
          }
          if (retries > MAX_RETRIES) {
            throw scanError(
              fromBlock,
              toBlock,
              cursor,
              `still failing after ${MAX_RETRIES} retries at a ${span}-block window`,
              error,
            );
          }
          await sleep(backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          continue;
        }

        // Any other failure is treated as a provider range cap. That includes
        // an opaque "unexpected status code" response, which is exactly how
        // Base Sepolia rejects an oversized eth_getLogs request.
        if (span === 1n) {
          floorAttempts += 1;
          if (floorAttempts >= MAX_ATTEMPTS_AT_FLOOR) {
            throw scanError(
              fromBlock,
              toBlock,
              cursor,
              `${floorAttempts} consecutive failures at a 1-block window`,
              error,
            );
          }
          await sleep(backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          continue;
        }

        const stated = statedRangeLimit(text);
        // Never re-send the same oversized window: `stated` is only used when
        // it is actually smaller, and halving always shrinks a span >= 2.
        chunkSize = stated !== null && stated < span ? stated : span / 2n;
      }
    }
  }

  return logs;
}
