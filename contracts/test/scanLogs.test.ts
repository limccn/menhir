import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanLogs } from "../scripts/lib/scanLogs.js";

interface RequestRecord {
  fromBlock: bigint;
  toBlock: bigint;
  span: bigint;
  ok: boolean;
}

function record(
  requests: RequestRecord[],
  fromBlock: bigint,
  toBlock: bigint,
  ok: boolean,
): void {
  requests.push({ fromBlock, toBlock, span: toBlock - fromBlock + 1n, ok });
}

// The real failure this module fixes: Base Sepolia rejected a 4,020-block
// window with an opaque HTTP error (no "limited to"/"range" wording), which a
// cap-message-only fix would treat as fatal.
const FROM = 48_306_141n;
const TO = FROM + 4_020n - 1n;

describe("scanLogs", function () {
  it("discovers an unstated 200-block cap by halving, then reuses it", async function () {
    const requests: RequestRecord[] = [];

    const fetchLogs = async (fromBlock: bigint, toBlock: bigint) => {
      const span = toBlock - fromBlock + 1n;
      if (span > 200n) {
        record(requests, fromBlock, toBlock, false);
        throw new Error(
          "Received an unexpected status code from https://sepolia.base.org",
        );
      }
      record(requests, fromBlock, toBlock, true);
      return [{ blockNumber: fromBlock }];
    };

    await scanLogs({
      fromBlock: FROM,
      toBlock: TO,
      initialChunkSize: 10_000n,
      fetchLogs,
      sleep: async () => {},
    });

    assert.equal(requests[0]?.span, 4_020n, "first request is clamped to the range");
    const rejected = requests.filter((request) => !request.ok);
    assert.ok(rejected.length > 0, "the fake provider should reject oversized windows");
    assert.ok(
      rejected.length <= 8,
      `expected logarithmic shrinking, got ${rejected.length} rejections`,
    );

    const firstSuccess = requests.findIndex((request) => request.ok);
    assert.ok(firstSuccess >= 0, "the scan must eventually succeed");
    for (const request of requests.slice(firstSuccess)) {
      assert.ok(request.span <= 200n, `span ${request.span} requested after convergence`);
    }

    // A rejected range-cap request is never retried at the same oversized size.
    for (let index = 0; index < requests.length - 1; index += 1) {
      const request = requests[index];
      const next = requests[index + 1];
      if (request?.ok === false && next !== undefined) {
        assert.ok(next.span < request.span, "oversized windows must shrink");
      }
    }

    // Once converged, the window size is adopted for the rest of the scan.
    const successfulSpans = requests.filter((request) => request.ok).map((request) => request.span);
    const fullWindows = successfulSpans.slice(0, -1);
    assert.ok(fullWindows.length > 0);
    for (const span of fullWindows) {
      assert.equal(span, fullWindows[0], "the converged window size must be reused");
    }

    // Successful windows must tile [FROM, TO] exactly once, in ascending order.
    let covered = 0n;
    let expectedFrom = FROM;
    for (const request of requests) {
      if (!request.ok) continue;
      assert.equal(request.fromBlock, expectedFrom, "successful windows are contiguous");
      expectedFrom = request.toBlock + 1n;
      covered += request.span;
    }
    assert.equal(expectedFrom, TO + 1n, "the scan reached the end of the range");
    assert.equal(covered, TO - FROM + 1n, "every block was covered exactly once");
  });

  it("adopts a provider-stated numeric limit immediately instead of halving", async function () {
    const requests: RequestRecord[] = [];

    const fetchLogs = async (fromBlock: bigint, toBlock: bigint) => {
      const span = toBlock - fromBlock + 1n;
      if (span > 200n) {
        record(requests, fromBlock, toBlock, false);
        throw new Error("eth_getLogs is limited to a 200 range");
      }
      record(requests, fromBlock, toBlock, true);
      return [];
    };

    await scanLogs({
      fromBlock: FROM,
      toBlock: TO,
      initialChunkSize: 10_000n,
      fetchLogs,
      sleep: async () => {},
    });

    assert.equal(requests.filter((request) => !request.ok).length, 1);
    assert.equal(requests[1]?.fromBlock, FROM, "the failed window is retried at the same cursor");
    assert.equal(requests[1]?.span, 200n, "the stated 200-block limit is adopted directly");
    for (const request of requests.slice(1)) {
      assert.ok(request.ok, "every window after adoption fits the cap");
    }
  });

  it("rejects after bounded attempts at a 1-block window instead of looping", async function () {
    let calls = 0;

    const fetchLogs = async () => {
      calls += 1;
      throw new Error("execution reverted: permanent failure");
    };

    await assert.rejects(
      scanLogs({
        fromBlock: 0n,
        toBlock: 999n,
        initialChunkSize: 1_000n,
        fetchLogs,
        sleep: async () => {},
      }),
      /1-block window/,
    );

    assert.ok(calls > 1, "the scan should shrink before giving up");
    assert.ok(calls <= 64, `attempts must stay bounded, got ${calls}`);
  });

  it("covers the range exactly once, in ascending order, with logs returned", async function () {
    const from = 100n;
    const to = 1_049n;
    const requests: RequestRecord[] = [];

    const fetchLogs = async (fromBlock: bigint, toBlock: bigint) => {
      record(requests, fromBlock, toBlock, true);
      const logs: { blockNumber: bigint }[] = [];
      for (let block = fromBlock; block <= toBlock; block += 1n) {
        logs.push({ blockNumber: block });
      }
      return logs;
    };

    const logs = await scanLogs({
      fromBlock: from,
      toBlock: to,
      initialChunkSize: 300n,
      fetchLogs,
      sleep: async () => {},
    });

    assert.equal(logs.length, Number(to - from + 1n));
    for (let index = 0; index < logs.length; index += 1) {
      assert.equal(logs[index]?.blockNumber, from + BigInt(index));
    }

    let expectedFrom = from;
    for (const request of requests) {
      assert.equal(request.fromBlock, expectedFrom);
      expectedFrom = request.toBlock + 1n;
    }
    assert.equal(expectedFrom, to + 1n);
    assert.ok(requests.length > 1, "the range spans multiple windows");
  });

  it("does not read status-like digits embedded in block numbers", async function () {
    const requests: RequestRecord[] = [];

    const fetchLogs = async (fromBlock: bigint, toBlock: bigint) => {
      const span = toBlock - fromBlock + 1n;
      if (span > 200n) {
        record(requests, fromBlock, toBlock, false);
        // Block numbers whose digits contain "429", "502", "503" — substring
        // matching would misread these as rate-limit/transient statuses.
        throw new Error(
          `block range ${fromBlock}..${toBlock} is too large ` +
            "(48310428..48314429 / 48306502..48310503)",
        );
      }
      record(requests, fromBlock, toBlock, true);
      return [];
    };

    await scanLogs({
      fromBlock: FROM,
      toBlock: TO,
      initialChunkSize: 10_000n,
      fetchLogs,
      sleep: async () => {},
    });

    const rejected = requests.filter((request) => !request.ok);
    assert.ok(rejected.length > 0, "the fake provider should reject oversized windows");
    for (let index = 0; index < requests.length - 1; index += 1) {
      const request = requests[index];
      const next = requests[index + 1];
      if (request?.ok === false && next !== undefined) {
        assert.ok(
          next.span < request.span,
          "a range-cap failure must shrink, not retry the same window",
        );
      }
    }

    let expectedFrom = FROM;
    for (const request of requests) {
      if (!request.ok) continue;
      assert.equal(request.fromBlock, expectedFrom, "successful windows are contiguous");
      expectedFrom = request.toBlock + 1n;
    }
    assert.equal(expectedFrom, TO + 1n, "the scan reached the end of the range");
  });

  it("backs off and retries the same window after a 429", async function () {
    const spans: bigint[] = [];
    const sleeps: number[] = [];
    let calls = 0;

    const fetchLogs = async (fromBlock: bigint, toBlock: bigint) => {
      spans.push(toBlock - fromBlock + 1n);
      calls += 1;
      if (calls === 1) {
        const error = new Error("HTTP request failed.");
        Object.assign(error, { status: 429 });
        throw error;
      }
      return [];
    };

    await scanLogs({
      fromBlock: 0n,
      toBlock: 99n,
      initialChunkSize: 100n,
      fetchLogs,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    assert.deepEqual(spans, [100n, 100n], "the window size is unchanged");
    assert.deepEqual(sleeps, [400], "the first backoff is 400 ms");
  });

  it("backs off and retries the same window on a transient transport error", async function () {
    const spans: bigint[] = [];
    let calls = 0;

    const fetchLogs = async (fromBlock: bigint, toBlock: bigint) => {
      spans.push(toBlock - fromBlock + 1n);
      calls += 1;
      if (calls === 1) throw new Error("fetch failed");
      return [];
    };

    await scanLogs({
      fromBlock: 0n,
      toBlock: 99n,
      initialChunkSize: 100n,
      fetchLogs,
      sleep: async () => {},
    });

    assert.deepEqual(spans, [100n, 100n], "the window size is unchanged");
  });
});
