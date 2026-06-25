#!/usr/bin/env node
/**
 * build-release-assets.mjs
 * -------------------------------------------------------------------------
 * Precomputes library/../release-assets.json — the per-release provenance the
 * Library page reads to badge "New / Updated in X.Y.0" and drive its Release
 * filter. Run in CI (see .github/workflows/release-assets.yml) so the live
 * site never hits the GitHub API.
 *
 * Rules (per request):
 *   • Only "major" releases — tags matching  X.Y.0  — get an entry.
 *     Hotfix tags (X.Y.1, X.Y.2, …) are ignored as standalone entries.
 *   • Each major's diff is computed against the PREVIOUS major (X.Y-1.0 / the
 *     prior X.Y.0 in version order), via the GitHub compare API. Because that
 *     compares tag-to-tag, any intermediate hotfix work is naturally absorbed
 *     into the next major's "what changed".
 *   • Changed mesh files (*.nif) are mapped back to TES3 object IDs through the
 *     site's own OAAB_Data_filtered.json. One mesh can back several object IDs,
 *     so a single changed file may badge multiple library cards.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/build-release-assets.mjs
 *   (token optional locally but strongly recommended — raises the API rate
 *    limit from 60/hr to 1000+/hr and is provided automatically in Actions.)
 */

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_REPO = 'OAAB-Modding/Data';        // source of releases + meshes
const API = 'https://api.github.com';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = join(ROOT, 'assets/data/library/OAAB_Data_filtered.json'); // site-local catalogue
const OUT = join(ROOT, 'release-assets.json');

const TOKEN = process.env.GITHUB_TOKEN || '';
const headers = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const MAJOR_RE = /^v?(\d+)\.(\d+)\.0$/;        // X.Y.0 only

async function gh(path) {
  const res = await fetch(API + path, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

// --- 1. All X.Y.0 tags, ascending by (major, minor) ------------------------
async function majorTags() {
  const tags = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/repos/${DATA_REPO}/tags?per_page=100&page=${page}`);
    if (!batch.length) break;
    for (const t of batch) {
      const m = MAJOR_RE.exec(t.name);
      if (m) tags.push({ name: t.name, key: [+m[1], +m[2]] });
    }
    if (batch.length < 100) break;
  }
  tags.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  return tags;
}

// --- 2. mesh path -> [object IDs, ...] from the site catalogue -------------
//   OAAB_Data_filtered.json mesh: "OAAB\\m\\foo.nif"  (relative to Morrowind's Meshes/)
//   compare filename:  ".../Meshes/OAAB/m/foo.nif"
//   Normalise both to a lowercase, forward-slash key beginning at "oaab/".
function meshKey(p) {
  const fwd = String(p).replace(/\\/g, '/').toLowerCase();
  const i = fwd.lastIndexOf('oaab/');
  return i === -1 ? null : fwd.slice(i);
}
async function meshToIds() {
  const records = JSON.parse((await readFile(RECORDS, 'utf8')).replace(/^\uFEFF/, ''));
  const map = new Map();
  for (const r of records) {
    if (!r.id) continue;
    const k = meshKey(r.mesh || '');
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r.id);
  }
  return map;
}

// --- 3. changed .nif files between two tags --------------------------------
async function changedMeshes(base, head) {
  const files = [];
  for (let page = 1; ; page++) {
    const cmp = await gh(`/repos/${DATA_REPO}/compare/${base}...${head}?per_page=100&page=${page}`);
    const fs = cmp.files || [];
    files.push(...fs);
    // compare paginates the file list; stop when a short page comes back.
    if (fs.length < 100) break;
  }
  return files.filter(f => /\.nif$/i.test(f.filename));
}

async function main() {
  const tags = await majorTags();
  if (tags.length < 2) throw new Error('need at least two X.Y.0 tags to diff');
  const m2i = await meshToIds();

  const releases = [];
  for (let i = 1; i < tags.length; i++) {
    const base = tags[i - 1].name, head = tags[i].name;
    const added = new Set(), modified = new Set();
    for (const f of await changedMeshes(base, head)) {
      // renamed files carry the new path in `filename`; treat as modified.
      const ids = m2i.get(meshKey(f.filename)) || [];
      const bucket = f.status === 'added' ? added : modified;
      ids.forEach(id => bucket.add(id));
    }
    // An id that's both added & modified across grouped meshes counts as added.
    modified.forEach(id => { if (added.has(id)) modified.delete(id); });
    releases.push({
      version: head.replace(/^v/, ''),
      added: [...added].sort(),
      modified: [...modified].sort(),
    });
  }

  releases.reverse(); // newest-first; newest entry wins an id's default badge
  const out = {
    _comment: 'Auto-generated by scripts/build-release-assets.mjs — do not edit by hand. '
      + 'Only X.Y.0 releases; each diffed against the previous X.Y.0 tag.',
    generated: new Date().toISOString(),
    repo: DATA_REPO,
    releases,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT} — ${releases.length} releases, `
    + `${releases.reduce((n, r) => n + r.added.length + r.modified.length, 0)} object touches.`);
}

main().catch(e => { console.error(e); process.exit(1); });
