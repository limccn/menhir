import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Gas baseline guard (menhir-m1 PRD AC: "gas snapshot committed; deviations
 * explained in journal").
 *
 * Reads the committed `gas-snapshot.json` produced by `pnpm gas:snapshot` and
 * asserts the menhir spec §8 band (±20%). This does NOT measure gas itself —
 * measuring is the snapshot script's job. It fails when the committed numbers
 * drift outside the documented budget, which is the regression that matters:
 * a struct-layout or validation change that quietly doubles commit cost.
 *
 * If a change legitimately moves costs, regenerate the snapshot AND update
 * the band here with a journal entry — never loosen the band silently.
 */
const SNAPSHOT = new URL("../gas-snapshot.json", import.meta.url);

const BAND = 0.2;

/**
 * Measured baseline (2026-10-19, `pnpm gas:snapshot`).
 *
 * The batch figure is a DOCUMENTED DEVIATION from menhir spec §8: the spec
 * estimated ~8.3M for a 64-item batch; the measured maximum is 6,511,292
 * (−21.5%, outside the spec's ±20% band). The direction is favourable —
 * per-item cost is ~101.7k once storage is warm, versus ~131k for a cold
 * single commit — so this is not a regression, it is a better estimate.
 *
 * The test therefore asserts two different things:
 *   - an UPPER bound from the spec (never exceed the budget), and
 *   - a LOWER bound from the measured baseline (catch a change that removes
 *     work, e.g. dropping validation or an access check).
 * Loosening either silently is the thing this file exists to prevent.
 */
const MEASURED_BATCH64 = 6_511_292;

interface Stat {
  min: number;
  max: number;
  avg: number;
  median: number;
  count: number;
}

interface Snapshot {
  contracts: Record<
    string,
    { deployment: Stat; functions: Record<string, Stat> }
  >;
}

const SPEC = {
  commit: 140_000,
  retract: 47_000,
  retractWithReplacedBy: 69_000,
  batch64: 8_300_000,
} as const;

function contract(snapshot: Snapshot) {
  const entry = snapshot.contracts["src/MemoryRegistry.sol:MemoryRegistry"];
  assert.ok(entry, "snapshot must contain MemoryRegistry");
  return entry;
}

describe("gas baseline (menhir spec §8 ±20%)", () => {
  it("a committed snapshot exists", () => {
    assert.ok(existsSync(SNAPSHOT), "run `pnpm gas:snapshot` and commit the file");
  });

  it("commit average stays inside the band", () => {
    const { functions } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    const commit = functions.commit;
    assert.ok(commit, "commit must appear in the snapshot");
    const low = SPEC.commit * (1 - BAND);
    const high = SPEC.commit * (1 + BAND);
    // The snapshot's max includes a first-commit case (cold storage); compare
    // the average, which is what the spec's ~140k figure describes.
    assert.ok(
      commit.avg >= low && commit.avg <= high,
      `commit avg ${commit.avg} outside ${low.toFixed(0)}..${high.toFixed(0)}`,
    );
  });

  /**
   * `retract` has THREE paths in the snapshot, distinguished by position:
   *
   *   min    ~26k  idempotent second call — early return, no write
   *   median ~50k  pure delete — one SSTORE (`_retracted[h] = true`)
   *   max    ~75k  delete + replacedBy — two SSTOREs
   *
   * Banding only `max` against the replacedBy figure (the review's finding)
   * would let a pure-delete regression hide underneath it: if that path grew
   * to 73k, every test would still pass while the spec's 47k budget was
   * breached by more than half. Each path is banded at its own position.
   */
  it("retract (pure delete) matches the spec's 47k row", () => {
    const { functions } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    const retract = functions.retract;
    assert.ok(retract, "retract must appear in the snapshot");
    const low = SPEC.retract * (1 - BAND);
    const high = SPEC.retract * (1 + BAND);
    assert.ok(
      retract.median >= low && retract.median <= high,
      `retract median ${retract.median} outside pure-delete band ${low.toFixed(0)}..${high.toFixed(0)}`,
    );
  });

  it("retract (with replacedBy) matches the spec's 69k row", () => {
    const { functions } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    const retract = functions.retract;
    assert.ok(retract, "retract must appear in the snapshot");
    const low = SPEC.retractWithReplacedBy * (1 - BAND);
    const high = SPEC.retractWithReplacedBy * (1 + BAND);
    assert.ok(
      retract.max >= low && retract.max <= high,
      `retract max ${retract.max} outside replacedBy band ${low.toFixed(0)}..${high.toFixed(0)}`,
    );
  });

  it("the three retract paths stay distinguishable", () => {
    // This is what makes the two bands above meaningful. If idempotent ever
    // started writing, its cost would climb into the pure-delete band and the
    // median-of-three assumption behind the pure-delete test would be wrong.
    const { functions } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    const { min, median, max } = functions.retract;
    assert.ok(min < median, `idempotent (${min}) must be cheaper than pure delete (${median})`);
    assert.ok(median < max, `pure delete (${median}) must be cheaper than replacedBy (${max})`);
    assert.ok(
      min < SPEC.retract * 0.7,
      `idempotent ${min} is too close to the pure-delete budget — did the early return change?`,
    );
  });

  it("batch of 64 does not exceed the spec budget (upper bound only)", () => {
    const { functions } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    const batch = functions.commitBatch;
    assert.ok(batch, "commitBatch must appear in the snapshot");
    const upper = SPEC.batch64 * (1 + BAND);
    assert.ok(
      batch.max <= upper,
      `commitBatch max ${batch.max} exceeds spec budget ${upper.toFixed(0)}`,
    );
  });

  it("batch of 64 has not regressed below the measured baseline", () => {
    const { functions } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    const batch = functions.commitBatch;
    assert.ok(batch, "commitBatch must appear in the snapshot");
    // A sudden drop means work disappeared (a validation or ACL check was
    // removed); the real cost is not expected to improve by >20% by accident.
    const lower = MEASURED_BATCH64 * (1 - BAND);
    assert.ok(
      batch.max >= lower,
      `commitBatch max ${batch.max} fell below the measured baseline ${lower.toFixed(0)} — did a check disappear?`,
    );
  });

  it("deployment cost is recorded (no spec band, drift visibility only)", () => {
    const { deployment } = contract(JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot);
    assert.ok(deployment.avg > 0);
  });
});
