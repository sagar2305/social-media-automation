import { readdir, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export async function assertFreshCalibrationRoot(configured: string): Promise<string> {
  if (!configured.trim() || !isAbsolute(configured)) {
    throw new Error('Calibration requires an explicit absolute CREDDY_DATA_ROOT');
  }
  const resolved = resolve(configured);
  if (!/^agent01-calibration-[A-Za-z0-9_-]+$/.test(basename(resolved))) {
    throw new Error('Calibration directory name must start with agent01-calibration-');
  }
  const physical = await realpath(resolved);
  const physicalParent = dirname(physical);
  const allowedParents = new Set<string>([
    await realpath(tmpdir()),
    await realpath('/tmp'),
  ]);
  if (!allowedParents.has(physicalParent)) {
    throw new Error('Calibration directory must be a direct child of the system temporary directory');
  }
  if (!(await stat(physical)).isDirectory()) throw new Error('Calibration root must be a directory');
  if ((await readdir(physical)).length > 0) throw new Error('Calibration root must be new and empty');
  return physical;
}
