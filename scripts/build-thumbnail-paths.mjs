#!/usr/bin/env node
/**
 * build-thumbnail-paths.mjs
 * -------------------------------------------------------------------------
 * Writes the Library thumbnail manifest consumed by library/index.html. The
 * manifest maps each object id to the thumbnail's real repo path relative to
 * assets/images/library/thumbnails/meshes/.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = join(ROOT, 'assets/data/library/OAAB_Data_filtered.json');
const THUMB_ROOT = join(ROOT, 'assets/images/library/thumbnails/meshes');
const OUT = join(ROOT, 'assets/data/library/OAAB_Data_thumbnails.json');

async function webpFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await webpFiles(path));
    } else if (entry.isFile() && /\.webp$/i.test(entry.name)) {
      out.push(relative(THUMB_ROOT, path).split(sep).join('/'));
    }
  }
  return out;
}

function meshKey(p) {
  const fwd = String(p || '').replace(/\\/g, '/').toLowerCase();
  const i = fwd.lastIndexOf('oaab/');
  return i === -1 ? null : fwd.slice(i).replace(/\.nif$/i, '.webp');
}

const records = JSON.parse((await readFile(RECORDS, 'utf8')).replace(/^\uFEFF/, ''));
const thumbPaths = await webpFiles(THUMB_ROOT);
const realPathByKey = new Map(thumbPaths.map(p => [p.toLowerCase(), p]));
const seen = new Set();
const thumbnails = [];

for (const record of records) {
  const key = meshKey(record.mesh);
  const path = key && realPathByKey.get(key);
  if (!path || !record.id || seen.has(record.id)) continue;
  seen.add(record.id);
  thumbnails.push({ id: record.id, mesh: path, source: 'OAAB_Data' });
}

thumbnails.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(OUT, JSON.stringify(thumbnails, null, 2) + '\n');
console.log(`Wrote ${OUT} - ${thumbnails.length} thumbnail records.`);
