// Publishes the authors file as the "authors-pack" content pack.
// Runs automatically (GitHub Action) on every push that touches `authors`:
//   1. validates the JSON
//   2. compares against the live manifest — content changed? version bumps
//      automatically (edit → push → publish, no manual version file)
//   3. uploads authors-pack-v<N>.json to Vercel Blob
//   4. upserts the manifest entry (all other packs carried over untouched)
// The Rakia app picks it up within ~6 hours and merges it locally without
// touching authors the user edited on their machine.
//
// Env: BLOB_READ_WRITE_TOKEN (repo secret), RAKIA_SERVER_URL (optional)

import { put } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SERVER_BASE = (process.env.RAKIA_SERVER_URL || 'https://rakia-updates.vercel.app').replace(/\/$/, '');
const SLUG = 'authors-pack';
const TITLE = 'מסד נתוני מחברים';

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('✗ BLOB_READ_WRITE_TOKEN is not set');
  process.exit(1);
}

const raw = await readFile('authors', 'utf-8');
const parsed = JSON.parse(raw); // validates
if (!Array.isArray(parsed.authors) || parsed.authors.length === 0) {
  console.error('✗ הקובץ authors חייב להכיל מערך authors לא ריק');
  process.exit(1);
}
console.log(`✓ JSON תקין — ${parsed.authors.length} מחברים`);

const buf = Buffer.from(raw, 'utf-8');
const hash = createHash('sha256').update(buf).digest('hex');

let manifest = { packs: [] };
try {
  const res = await fetch(`${SERVER_BASE}/content/manifest.json`);
  if (res.ok) manifest = await res.json();
} catch { console.log('(אין manifest חי — פרסום ראשון)'); }

const packs = Array.isArray(manifest.packs) ? manifest.packs : [];
const live = packs.find((p) => p.slug === SLUG);
if (live && live.sha256 === hash) {
  console.log(`✓ אין שינוי תוכן (v${live.contentVersion} כבר חי) — אין מה לפרסם.`);
  process.exit(0);
}
const version = (live?.contentVersion || 0) + 1;

const fileName = `${SLUG}-v${version}.json`;
const { url } = await put(`content/${fileName}`, buf, {
  access: 'public', token, addRandomSuffix: false, allowOverwrite: true,
  contentType: 'application/json',
});
console.log(`✓ ${fileName} הועלה (${Math.round(buf.length / 1024)}KB)`);

const entry = { slug: SLUG, title: TITLE, contentVersion: version, url, sha256: hash, size: buf.length };
const nextManifest = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  packs: [...packs.filter((p) => p.slug !== SLUG), entry],
};
await put('content/manifest.json', Buffer.from(JSON.stringify(nextManifest, null, 2)), {
  access: 'public', token, addRandomSuffix: false, allowOverwrite: true,
  contentType: 'application/json',
});
console.log(`✓ manifest עודכן — authors-pack v${version} חי. האפליקציות יקבלו אותו תוך עד 6 שעות.`);
