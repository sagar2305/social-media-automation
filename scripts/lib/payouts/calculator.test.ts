/**
 * Unit tests for the creator-payout calculator.
 *
 * No test framework — the project doesn't use jest/vitest. Just a
 * tiny `assertEq` that throws on mismatch and a `run` runner that
 * counts passes/fails. This file is executable via:
 *
 *   npx tsx scripts/lib/payouts/calculator.test.ts
 *
 * Add a new test by writing `t('description', () => { ... assertEq(...) })`.
 */

import { calculatePayout } from './calculator.js';
import type {
  CampaignPayoutConfig,
  Assignment,
  CalculatorPost,
  ManualAdjustment,
  CalculatorInput,
} from './types.js';

// ─── Tiny test harness ─────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: { name: string; err: unknown }[] = [];

function t(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    process.stdout.write('  ✓ ' + name + '\n');
  } catch (err) {
    failed++;
    failures.push({ name, err });
    process.stdout.write('  ✗ ' + name + '\n');
  }
}

function assertEq<T>(actual: T, expected: T, label?: string): void {
  if (actual === expected) return;
  if (typeof actual === 'object' && typeof expected === 'object') {
    if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  }
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  throw new Error(`assertEq failed${label ? ' (' + label + ')' : ''}\n  actual:   ${a}\n  expected: ${e}`);
}

// ─── Fixture builders ──────────────────────────────────────────

const SNAPSHOT = new Date('2026-05-09T00:00:00Z');

function baseConfig(overrides: Partial<CampaignPayoutConfig> = {}): CampaignPayoutConfig {
  return {
    campaign_id: 'campaign-1',
    mode: 'flat',
    flat_per_post_cents: null,
    cpm_cents: null,
    cpm_view_window_days: 14,
    hybrid_threshold_views: null,
    milestones: [],
    multipliers: [],
    total_budget_cents: null,
    currency: 'USD',
    approval_required: true,
    instant_payout: false,
    ...overrides,
  };
}

function baseAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assignment-1',
    creator_id: 'creator-1',
    campaign_id: 'campaign-1',
    rate_override_cents: null,
    expected_posts: 3,
    due_date: null,
    status: 'active',
    applied_multipliers: [],
    ...overrides,
  };
}

/**
 * Build a published post that's old enough to be CPM-eligible (40
 * days before snapshot — well past any reasonable cpm_view_window_days).
 */
function eligiblePost(id: string, views: number, saves: number = 0): CalculatorPost {
  return {
    id,
    posted_at: new Date(SNAPSHOT.getTime() - 40 * 86400_000).toISOString(),
    views,
    saves,
    status: 'published',
  };
}

function input(
  config: CampaignPayoutConfig,
  assignment: Assignment,
  posts: CalculatorPost[],
  manualAdjustments: ManualAdjustment[] = [],
): CalculatorInput {
  return { config, assignment, posts, metricSnapshotAt: SNAPSHOT, manualAdjustments };
}

// ─── Tests ─────────────────────────────────────────────────────

console.log('\nrunning calculator tests…\n');

t('mode=none returns 0 with empty breakdown', () => {
  const out = calculatePayout(input(baseConfig({ mode: 'none' }), baseAssignment(), []));
  assertEq(out.amount_cents, 0);
  assertEq(out.breakdown, []);
  assertEq(out.rule, 'none');
});

t('flat mode pays per published post', () => {
  const cfg = baseConfig({ mode: 'flat', flat_per_post_cents: 5000 });
  const posts = [eligiblePost('p1', 100), eligiblePost('p2', 100), eligiblePost('p3', 100)];
  const out = calculatePayout(input(cfg, baseAssignment(), posts));
  assertEq(out.amount_cents, 15000, 'three posts × $50 = $150');
  assertEq(out.contributing_post_ids.length, 3);
});

t('flat mode skips drafts and failed posts', () => {
  const cfg = baseConfig({ mode: 'flat', flat_per_post_cents: 5000 });
  const posts: CalculatorPost[] = [
    eligiblePost('p1', 100),
    { ...eligiblePost('p2', 100), status: 'draft' },
    { ...eligiblePost('p3', 100), status: 'failed' },
  ];
  const out = calculatePayout(input(cfg, baseAssignment(), posts));
  assertEq(out.amount_cents, 5000, 'only the one published post earns');
});

t('CPM mode pays per 1000 views', () => {
  const cfg = baseConfig({ mode: 'cpm', cpm_cents: 500 });
  const posts = [eligiblePost('p1', 12500), eligiblePost('p2', 8200)];
  const out = calculatePayout(input(cfg, baseAssignment(), posts));
  // 12500/1000 × $5 = $62.50 + 8200/1000 × $5 = $41.00 → $103.50
  assertEq(out.amount_cents, 6250 + 4100, '$103.50 total');
});

t('CPM mode skips posts inside the view window', () => {
  const cfg = baseConfig({ mode: 'cpm', cpm_cents: 500, cpm_view_window_days: 14 });
  const recentPost: CalculatorPost = {
    id: 'recent',
    posted_at: new Date(SNAPSHOT.getTime() - 7 * 86400_000).toISOString(),
    views: 100_000,
    saves: 0,
    status: 'published',
  };
  const out = calculatePayout(input(cfg, baseAssignment(), [recentPost]));
  assertEq(out.amount_cents, 0, 'recent post still in window — does not earn');
});

t('hybrid mode = base + CPM kicker above threshold', () => {
  const cfg = baseConfig({
    mode: 'hybrid',
    flat_per_post_cents: 5000,
    cpm_cents: 200,
    hybrid_threshold_views: 10_000,
  });
  // Post 1: 12,500 views → 2,500 over threshold → 2.5 × $2 = $5.00
  // Post 2:  7,200 views → 0 over → $0
  // Post 3: 12,800 views → 2,800 over → 2.8 × $2 = $5.60
  // Base: 3 × $50 = $150.00
  // Total: $160.60
  const posts = [eligiblePost('p1', 12_500), eligiblePost('p2', 7_200), eligiblePost('p3', 12_800)];
  const out = calculatePayout(input(cfg, baseAssignment(), posts));
  assertEq(out.amount_cents, 15000 + 500 + 0 + 560, '$160.60 hybrid total');
});

t('milestone mode awards highest tier each post crosses, not all', () => {
  const cfg = baseConfig({
    mode: 'milestone',
    milestones: [
      { views: 100_000, bonus_cents: 5_000 },
      { views: 500_000, bonus_cents: 25_000 },
      { views: 1_000_000, bonus_cents: 75_000 },
    ],
  });
  // 600k views hits 100k AND 500k tiers; should award only 500k ($250).
  const posts = [eligiblePost('p1', 600_000)];
  const out = calculatePayout(input(cfg, baseAssignment(), posts));
  assertEq(out.amount_cents, 25_000, '$250 — 500k tier, not 100k+500k stacked');
});

t('multipliers apply to the subtotal, not individual lines', () => {
  const cfg = baseConfig({
    mode: 'flat',
    flat_per_post_cents: 10_000,    // $100
    multipliers: [
      { id: 'usage_60d', label: 'Usage rights — 60 days', pct: 15 },
      { id: 'rush', label: 'Rush turnaround', pct: 25 },
    ],
  });
  const assignment = baseAssignment({ applied_multipliers: ['usage_60d', 'rush'] });
  const posts = [eligiblePost('p1', 100), eligiblePost('p2', 100)];
  // Subtotal: 2 × $100 = $200
  // +15% usage = +$30
  // +25% rush = +$50  (each multiplier applies to the ORIGINAL subtotal,
  //                    not compounding — that's the simpler/expected behaviour)
  // Total: $280
  const out = calculatePayout(input(cfg, assignment, posts));
  assertEq(out.amount_cents, 20_000 + 3_000 + 5_000);
});

t('rate_override replaces flat rate for this assignment only', () => {
  const cfg = baseConfig({ mode: 'flat', flat_per_post_cents: 5000 });
  // This creator negotiated a $200/post rate
  const assignment = baseAssignment({ rate_override_cents: 20_000 });
  const posts = [eligiblePost('p1', 100), eligiblePost('p2', 100)];
  const out = calculatePayout(input(cfg, assignment, posts));
  assertEq(out.amount_cents, 40_000, '2 posts × $200 override = $400');
});

t('manual adjustments add and subtract correctly', () => {
  const cfg = baseConfig({ mode: 'flat', flat_per_post_cents: 10_000 });
  const adjustments: ManualAdjustment[] = [
    { label: 'Quality bonus on Post 1', cents: 500, kind: 'add', note: null },
    { label: 'Late delivery penalty', cents: 1000, kind: 'subtract', note: '2 days late' },
  ];
  const out = calculatePayout(input(cfg, baseAssignment(), [eligiblePost('p1', 100)], adjustments));
  // $100 + $5 - $10 = $95
  assertEq(out.amount_cents, 10_000 + 500 - 1000);
});

t('total never goes below zero (floor)', () => {
  const cfg = baseConfig({ mode: 'flat', flat_per_post_cents: 1000 });
  const adjustments: ManualAdjustment[] = [
    { label: 'Massive penalty', cents: 50_000, kind: 'subtract', note: null },
  ];
  const out = calculatePayout(input(cfg, baseAssignment(), [eligiblePost('p1', 100)], adjustments));
  assertEq(out.amount_cents, 0, 'flored at zero, never negative');
  // The breakdown should still record the floor adjustment so it's auditable
  const hasFloorLine = out.breakdown.some(line => line.label.startsWith('Floor at $0'));
  assertEq(hasFloorLine, true, 'floor adjustment line present in breakdown');
});

t('determinism: same inputs → byte-identical output', () => {
  const cfg = baseConfig({
    mode: 'hybrid',
    flat_per_post_cents: 5000,
    cpm_cents: 200,
    hybrid_threshold_views: 10_000,
    multipliers: [{ id: 'rush', label: 'Rush', pct: 25 }],
  });
  const assignment = baseAssignment({ applied_multipliers: ['rush'] });
  const posts = [eligiblePost('p1', 12_500), eligiblePost('p2', 8_200)];

  const a = calculatePayout(input(cfg, assignment, posts));
  const b = calculatePayout(input(cfg, assignment, posts));
  assertEq(JSON.stringify(a), JSON.stringify(b), 'two runs are byte-identical');
});

t('breakdown includes subtotal and total marker lines for dashboard rendering', () => {
  const cfg = baseConfig({ mode: 'flat', flat_per_post_cents: 1000 });
  const out = calculatePayout(input(cfg, baseAssignment(), [eligiblePost('p1', 100)]));
  const kinds = out.breakdown.map(l => l.kind);
  assertEq(kinds.includes('base'), true);
  assertEq(kinds.includes('subtotal'), true);
  assertEq(kinds.includes('total'), true);
});

// ─── Run + report ──────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const { name, err } of failures) {
    console.log(`FAIL: ${name}`);
    console.log('  ' + (err instanceof Error ? err.message : String(err)).split('\n').join('\n  '));
    console.log('');
  }
  process.exit(1);
}
process.exit(0);
