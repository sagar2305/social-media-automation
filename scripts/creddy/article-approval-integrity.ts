import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { safeDataPath } from './pipeline-store.js';
import type { ContentBankRecord } from './pipeline-types.js';

function approvedFile(root: string, path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  const normalized = resolve(path);
  const rel = relative(resolve(root), normalized);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${label} path is outside the Creddy data root`);
  return normalized;
}

export async function computeArticleApprovalFingerprint(
  root: string,
  record: Pick<ContentBankRecord, 'contentPackageId' | 'contentDraftId' | 'visualPlanId' | 'articlePreviewPath'>,
): Promise<string> {
  if (!record.articlePreviewPath) throw new Error('Article preview is missing');
  const inputs: Array<[string, string]> = [
    ['preview', approvedFile(root, record.articlePreviewPath, 'Article preview')],
  ];
  if (record.contentDraftId) {
    inputs.push(['draft', safeDataPath(root, '06-content-drafts', `${record.contentDraftId}.json`)]);
    if (!record.visualPlanId) throw new Error('Article visual plan is missing');
    inputs.push(['visual-plan', safeDataPath(root, '06-visual-plans', `${record.visualPlanId}.json`)]);
  } else {
    inputs.push(['package', safeDataPath(root, '06-content-packages', `${record.contentPackageId}.json`)]);
  }
  const hash = createHash('sha256');
  for (const [label, path] of inputs) {
    hash.update(label).update('\0').update(await readFile(path)).update('\0');
  }
  return hash.digest('hex');
}
