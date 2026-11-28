// Builds the changelog from the titles of merged pull requests (needs the GitHub CLI, `gh`, signed
// in or GH_TOKEN set) and writes:
//   src/content/changelog/changelog.json   what the app shows under "What's new"
//   CHANGELOG.md                           the same list for the repository
// The Polish texts (changelog.pl.json) and the English texts that replace titles not fit for a
// rider (changelog.en.json, see `needsText`) are written by hand and never touched.
//
//   npm run changelog              # write both files
//   npm run changelog -- --check   # exit 1 when CHANGELOG.md does not match the JSON (no network)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildChangelog,
  renderMarkdown,
  type Changelog,
  type MergedPr,
} from '../src/shared/changelog';

const REPO = 'Edios/HyperCycling';
const REPO_URL = `https://github.com/${REPO}`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonFile = join(root, 'src', 'content', 'changelog', 'changelog.json');
const mdFile = join(root, 'CHANGELOG.md');
const enFile = join(root, 'src', 'content', 'changelog', 'changelog.en.json');

if (process.argv.includes('--check')) {
  const log = JSON.parse(readFileSync(jsonFile, 'utf8')) as Changelog;
  const md = readFileSync(mdFile, 'utf8').replace(/\r\n/g, '\n');
  if (md !== renderMarkdown(log, REPO_URL)) {
    console.error('CHANGELOG.md does not match changelog.json: run npm run changelog');
    process.exit(1);
  }
  console.log('CHANGELOG.md matches the JSON.');
} else {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      REPO,
      '--state',
      'merged',
      '--limit',
      '1000',
      '--json',
      'number,title,mergedAt',
    ],
    { encoding: 'utf8' },
  );
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
  const en = JSON.parse(readFileSync(enFile, 'utf8')) as Record<string, string>;
  const log = buildChangelog(JSON.parse(raw) as MergedPr[], version, en);
  writeFileSync(jsonFile, JSON.stringify(log, null, 2) + '\n');
  writeFileSync(mdFile, renderMarkdown(log, REPO_URL));
  console.log(`${log.entries.length} changes written (newest #${log.entries[0]?.pr ?? '-'}).`);
}
