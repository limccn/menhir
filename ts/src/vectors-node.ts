import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVectors, type Vectors } from './vectors.js';

/**
 * Node-only vector loader. Exported as `@menhir/core/vectors`.
 *
 * The package root stays browser-safe (§1: no `node:*` imports reachable from
 * `.`); only this subpath touches the filesystem. Tests and the Solidity
 * cross-impl harness use it; browser consumers never do.
 */
export function loadVectors(baseDir?: string): Vectors {
  const root =
    baseDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'vectors');
  return parseVectors(
    readFileSync(join(root, 'contents.json'), 'utf8'),
    readFileSync(join(root, 'commitments.json'), 'utf8'),
  );
}
