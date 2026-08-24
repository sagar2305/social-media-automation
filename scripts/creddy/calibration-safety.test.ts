import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertFreshCalibrationRoot } from './calibration-safety.js';

test('calibration accepts only a fresh direct child of the system temp directory', async () => {
  const valid = await mkdtemp(join(tmpdir(), 'agent01-calibration-valid-'));
  assert.equal(await assertFreshCalibrationRoot(valid), await realpath(valid));

  const nonEmpty = await mkdtemp(join(tmpdir(), 'agent01-calibration-used-'));
  await writeFile(join(nonEmpty, 'marker'), 'used');
  await assert.rejects(() => assertFreshCalibrationRoot(nonEmpty), /new and empty/);

  await assert.rejects(
    () => assertFreshCalibrationRoot(`${valid}/../../Users/sagar100/Documents/agent01-calibration-bypass`),
    /ENOENT|system temporary directory|directory name/,
  );
});
