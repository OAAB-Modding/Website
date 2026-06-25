#!/usr/bin/env node
/**
 * Regenerates assets/data/library/mesh_diff_<from>_to_<to>.json from the
 * OAAB-Modding/Data git tags.
 *
 * The library only wants meshes from release package folders: "00 Core" and
 * numbered optional patches. Integration folders may contain copied OAAB mesh
 * paths that collide with real catalogue meshes after path normalization, so
 * they must be excluded at the source.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA_REPO = join(ROOT, '.tmp', 'OAAB_Data.git');
const DATA_REPO = process.env.OAAB_DATA_REPO || DEFAULT_DATA_REPO;
const OUT_DIR = join(ROOT, 'assets', 'data', 'library');

const CHAIN = [
  '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0',
  '1.15.0', '1.16.0', '2.0.0', '2.1.0', '2.2.0', '2.3.0',
  '2.4.0', '2.5.0', '2.6.0',
];

const TAG_ALIASES = {
  // Public release 1.10.0 was tagged as 0.10.0 in OAAB-Modding/Data.
  '1.10.0': '0.10.0',
};

const RELEASE_MESH_RE = /^\d{2} [^/]+\/meshes\/oaab\/.+\.nif$/i;

function git(args) {
  return execFileSync('git', ['-C', DATA_REPO, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tagFor(version) {
  return TAG_ALIASES[version] || version;
}

function changedMeshes(from, to) {
  const diff = git(['diff', '--name-status', '--no-renames', tagFor(from), tagFor(to)]);
  const meshes = [];

  for (const line of diff.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawStatus, ...paths] = line.split('\t');
    const statusCode = rawStatus[0];
    if (!['A', 'M', 'R', 'C'].includes(statusCode)) continue;

    const path = paths[paths.length - 1];
    if (!RELEASE_MESH_RE.test(path)) continue;

    meshes.push({
      status: statusCode === 'A' ? 'A' : 'M',
      path,
    });
  }

  return meshes;
}

function sameJsonFile(file, data) {
  if (!existsSync(file)) return false;
  try {
    const current = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return JSON.stringify(current) === JSON.stringify(data);
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(DATA_REPO)) {
    throw new Error(`Data repo not found: ${DATA_REPO}. Clone OAAB-Modding/Data there or set OAAB_DATA_REPO.`);
  }

  await mkdir(OUT_DIR, { recursive: true });

  for (let i = 1; i < CHAIN.length; i++) {
    const from = CHAIN[i - 1];
    const to = CHAIN[i];
    const meshes = changedMeshes(from, to);
    const out = {
      from,
      to,
      range: `${from}..${to}`,
      count: meshes.length,
      meshes,
    };
    const file = join(OUT_DIR, `mesh_diff_${from}_to_${to}.json`);
    if (sameJsonFile(file, out)) {
      console.log(`${from} -> ${to}: ${meshes.length} meshes unchanged`);
    } else {
      await writeFile(file, JSON.stringify(out, null, 2) + '\n');
      console.log(`${from} -> ${to}: ${meshes.length} meshes updated`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
