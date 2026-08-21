import "server-only";

import {
  listCreddyBankItems,
  reconcileCreddyBlotatoDestination,
  type CreddyDestination,
  writeCreddyLiveSyncReport,
} from "@/lib/creddy-file-store";
import {
  getBlotatoPostStatus,
  listBlotatoPosts,
  type BlotatoListedPost,
} from "@/lib/blotato";

const DEFAULT_MIN_INTERVAL_MS = 30_000;
let lastStartedAt = 0;
let running: Promise<CreddyBlotatoSyncResult> | undefined;

export type CreddyBlotatoSyncResult = {
  ok: boolean;
  checkedAt: string;
  cached: boolean;
  checked: number;
  changed: number;
  remoteListCount: number;
  failures: Array<{ id: string; submissionId?: string; error: string }>;
};

function timeDistance(left?: string, right?: string): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime);
}

function correlateListedPost(destination: CreddyDestination, posts: BlotatoListedPost[]): BlotatoListedPost | undefined {
  if (destination.remoteListId) {
    const exact = posts.find((post) => post.id === destination.remoteListId);
    if (exact) return exact;
  }
  const expectedTime = destination.mode === "schedule" ? destination.scheduledFor : destination.submittedAt;
  const candidates = posts.filter((post) =>
    post.platform === destination.platform &&
    (!post.accountId || post.accountId === destination.account) &&
    timeDistance(post.postTime, expectedTime) <= 2 * 60_000,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function performSync(): Promise<CreddyBlotatoSyncResult> {
  const checkedAt = new Date().toISOString();
  const apiKey = process.env.BLOTATO_API_KEY?.trim();
  if (!apiKey) {
    const result: CreddyBlotatoSyncResult = {
      ok: false,
      checkedAt,
      cached: false,
      checked: 0,
      changed: 0,
      remoteListCount: 0,
      failures: [{ id: "configuration", error: "BLOTATO_API_KEY is not configured" }],
    };
    await writeCreddyLiveSyncReport(result);
    return result;
  }

  const before = await listCreddyBankItems();
  const previousStatuses = new Map(before.flatMap((item) => item.destinations.map((destination) => [
    `${item.id}:${destination.submissionId ?? `${destination.platform}:${destination.account}:${destination.format}`}`,
    destination.status,
  ])));
  const active = before.flatMap((item) => item.destinations
    .filter((destination) => destination.submissionId && !["published", "failed"].includes(destination.status))
    .map((destination) => ({ id: item.id, destination })));
  const failures: CreddyBlotatoSyncResult["failures"] = [];

  let listedPosts: BlotatoListedPost[] = [];
  let listAvailable = true;
  try {
    listedPosts = await listBlotatoPosts(apiKey);
  } catch (error) {
    listAvailable = false;
    failures.push({ id: "remote-list", error: (error as Error).message });
  }

  let checked = 0;
  for (const { id, destination } of active) {
    try {
      const remote = await getBlotatoPostStatus(destination.submissionId!, apiKey);
      const listed = listAvailable ? correlateListedPost(destination, listedPosts) : undefined;
      await reconcileCreddyBlotatoDestination({
        id,
        submissionId: destination.submissionId!,
        remoteStatus: remote.status,
        publishedUrl: remote.url ?? listed?.state.postUrl,
        error: remote.error,
        remotePresence: listAvailable ? listed ? "present" : "absent" : "unknown",
        remoteListState: listed?.state.type,
        remoteListId: listed?.id,
      });
      checked += 1;
    } catch (error) {
      failures.push({ id, submissionId: destination.submissionId, error: (error as Error).message });
    }
  }

  const after = await listCreddyBankItems();
  let changed = 0;
  for (const item of after) {
    for (const destination of item.destinations) {
      const key = `${item.id}:${destination.submissionId ?? `${destination.platform}:${destination.account}:${destination.format}`}`;
      if (previousStatuses.get(key) && previousStatuses.get(key) !== destination.status) changed += 1;
    }
  }
  const result: CreddyBlotatoSyncResult = {
    ok: failures.length === 0,
    checkedAt,
    cached: false,
    checked,
    changed,
    remoteListCount: listedPosts.length,
    failures,
  };
  await writeCreddyLiveSyncReport(result);
  return result;
}

export async function syncCreddyBlotatoStatuses(options: {
  force?: boolean;
  minIntervalMs?: number;
} = {}): Promise<CreddyBlotatoSyncResult> {
  if (running) return running;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  if (!options.force && Date.now() - lastStartedAt < minIntervalMs) {
    return {
      ok: true,
      checkedAt: new Date(lastStartedAt).toISOString(),
      cached: true,
      checked: 0,
      changed: 0,
      remoteListCount: 0,
      failures: [],
    };
  }
  lastStartedAt = Date.now();
  running = performSync().finally(() => {
    running = undefined;
  });
  return running;
}
