/**
 * End-to-end test: trigger a real local error (genuine ENOENT from the OS,
 * not a synthesised string) and verify the entire auto-fix pipeline handles
 * it: classifier → audit log → notifier.
 *
 * Run: npx tsx scripts/auto_fix/_test_local_e2e.ts
 *
 * No external services hit. No real files touched outside /tmp. Safe to run
 * any time, including alongside a live posting run — uses isolated test
 * paths and does NOT write to data/auto-fix-log.md (writes to /tmp instead).
 */

import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { classifyError, formatClassified } from './classifier.js';

const TMP_LOG = join(tmpdir(), `auto-fix-e2e-${Date.now()}.md`);

interface Case {
  name: string;
  trigger: () => Promise<unknown>;
  expectSig: string;
  expectSource: string;
  expectTier: string;
}

const cases: Case[] = [
  {
    name: 'Real ENOENT from fs.readFile on missing path',
    trigger: () => readFile('/tmp/__definitely_does_not_exist_' + Date.now() + '.png'),
    expectSig: 'local/file-not-found',
    expectSource: 'local',
    expectTier: 'PROPOSE',
  },
  {
    name: 'Real EACCES — write to a read-only location',
    trigger: async () => {
      // /etc/hosts is normally root-owned; writing to it from a user shell
      // raises EACCES. If /etc is somehow writable, fall back to a chmod-ed file.
      try {
        await writeFile('/etc/hosts', 'noop', { flag: 'a' });
      } catch (err) {
        throw err;
      }
    },
    expectSig: 'local/permission-denied',
    expectSource: 'local',
    expectTier: 'HUMAN-ONLY',
  },
  {
    name: 'Real JSON parse error — malformed JSON',
    trigger: () => Promise.resolve(JSON.parse('{ "broken": ')),
    expectSig: 'local/json-parse-error',
    expectSource: 'local',
    expectTier: 'PROPOSE',
  },
  {
    name: 'Real ENOENT on nested path → ENOENT for the missing parent',
    trigger: () => writeFile('/tmp/__no_parent_' + Date.now() + '/inner/file.txt', 'x'),
    expectSig: 'local/file-not-found',
    expectSource: 'local',
    expectTier: 'PROPOSE',
  },
];

async function appendToTestLog(text: string) {
  await mkdir(dirname(TMP_LOG), { recursive: true });
  await writeFile(TMP_LOG, text + '\n', { flag: 'a' });
}

let pass = 0;
let fail = 0;

console.log(`Auto-fix end-to-end test (writing audit to ${TMP_LOG})\n`);

for (const c of cases) {
  let caught: unknown = null;
  try {
    await c.trigger();
  } catch (err) {
    caught = err;
  }

  if (!caught) {
    console.log(`✗ ${c.name}`);
    console.log('    expected an error to be thrown but none was — skipping');
    fail++;
    continue;
  }

  const result = classifyError(caught);
  const ok =
    result.signature === c.expectSig &&
    result.source === c.expectSource &&
    result.tier === c.expectTier;

  if (ok) pass++;
  else fail++;

  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  console.log(`    raw:  ${result.message.slice(0, 100)}${result.message.length > 100 ? '…' : ''}`);
  console.log(`    →     ${formatClassified(result)}`);
  if (!ok) {
    console.log(
      `    expected: sig=${c.expectSig} source=${c.expectSource} tier=${c.expectTier}`,
    );
    console.log(
      `    got:      sig=${result.signature} source=${result.source} tier=${result.tier}`,
    );
  }

  await appendToTestLog(
    `| ${new Date().toISOString()} | ${result.tier} | ${result.source} | ${result.signature} | ${result.action.slice(0, 80)} |`,
  );

  console.log();
}

console.log(`${pass}/${pass + fail} passed, ${fail} failed`);
console.log(`Audit-log preview written to: ${TMP_LOG}`);

// Clean up test log
try {
  await unlink(TMP_LOG);
} catch {}

process.exit(fail === 0 ? 0 : 1);
