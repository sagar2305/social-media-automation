import { readFile, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { log } from './api-client.js';
import type { PostMetrics } from './pull_analytics.js';

interface ExperimentResult {
  experimentId: string;
  account: string;
  variantA: { hookStyle: string; postId: string; saveRate: number; views: number };
  variantB: { hookStyle: string; postId: string; saveRate: number; views: number };
  winner: 'A' | 'B' | 'inconclusive';
  relativeDiff: number;
}

function parseTrackerMetrics(content: string): Map<string, { hookStyle: string; saveRate: number; views: number; date: string }> {
  const map = new Map();
  const lines = content.split('\n').filter((l) => l.startsWith('|') && !l.includes('Post ID') && !l.includes('---'));

  for (const line of lines) {
    const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
    const postId = cols[0];
    if (!postId || postId === '-') continue;

    const saveRateStr = cols[10] || '0';
    const viewsStr = cols[5] || '0';

    map.set(postId, {
      hookStyle: cols[2] || '',
      saveRate: parseFloat(saveRateStr.replace('%', '')) || 0,
      views: parseInt(viewsStr.replace(/,/g, ''), 10) || 0,
      date: cols[1] || '',
    });
  }

  return map;
}

function parseExperiments(content: string): { active: string | null; completed: string[] } {
  const activeMatch = content.match(/## Active Experiments?\n([\s\S]*?)(?=\n## Completed|---\n## Completed|$)/);
  const active = activeMatch?.[1]?.trim() || null;

  const completedMatch = content.match(/## Completed Experiments\n([\s\S]*?)$/);
  const completed = completedMatch?.[1]?.trim().split('\n### ').filter(Boolean) || [];

  return { active: active?.includes('None') ? null : active, completed };
}

async function evaluateExperiment(experimentLog: string, tracker: string): Promise<ExperimentResult | null> {
  const experiments = parseExperiments(experimentLog);
  if (!experiments.active) return null;

  const metrics = parseTrackerMetrics(tracker);

  // Extract experiment details from active section (handle both old and new format)
  // New format: "**Variant A:** question hook, 8-slide emoji_overlay — Post IDs: ..."
  // Old format: "**Variant A:** question hook — Post ID: pending"
  const idMatch = experiments.active.match(/Experiment #(\w+)/);
  const accountMatch = experiments.active.match(/Account:\*?\*?\s*@?([\w.]+)/i);
  const styleAMatch = experiments.active.match(/Variant A:\*?\*?\s*(\w+)\s*hook/i)
    || experiments.active.match(/Variant A:\s*(\w+)/);
  const styleBMatch = experiments.active.match(/Variant B:\*?\*?\s*(\w+)\s*hook/i)
    || experiments.active.match(/Variant B:\s*(\w+)/);

  if (!idMatch || !styleAMatch || !styleBMatch) return null;

  const experimentId = idMatch[1];
  const account = accountMatch?.[1] || 'yournotetaker';
  const styleA = styleAMatch[1];
  const styleB = styleBMatch[1];

  // Find posts matching each variant
  let variantAMetrics = { hookStyle: styleA, postId: '', saveRate: 0, views: 0 };
  let variantBMetrics = { hookStyle: styleB, postId: '', saveRate: 0, views: 0 };

  for (const [postId, data] of metrics) {
    if (data.hookStyle === styleA && !variantAMetrics.postId) {
      variantAMetrics = { ...data, postId };
    }
    if (data.hookStyle === styleB && !variantBMetrics.postId) {
      variantBMetrics = { ...data, postId };
    }
  }

  // Need both variants with data to evaluate
  if (!variantAMetrics.postId || !variantBMetrics.postId) {
    log(`Experiment #${experimentId}: waiting for both variants to have data`);
    return null;
  }

  // Check if both posts are at least 48h old
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const aData = metrics.get(variantAMetrics.postId);
  const bData = metrics.get(variantBMetrics.postId);

  if (!aData || !bData || aData.date > twoDaysAgo || bData.date > twoDaysAgo) {
    log(`Experiment #${experimentId}: waiting for 48h of data`);
    return null;
  }

  // Compare save rates
  const diff = variantAMetrics.saveRate - variantBMetrics.saveRate;
  const avgRate = (variantAMetrics.saveRate + variantBMetrics.saveRate) / 2;
  const relativeDiff = avgRate > 0 ? Math.abs(diff) / avgRate : 0;

  let winner: 'A' | 'B' | 'inconclusive';
  if (relativeDiff > 0.2) {
    winner = diff > 0 ? 'A' : 'B';
  } else {
    winner = 'inconclusive';
  }

  return {
    experimentId,
    account,
    variantA: variantAMetrics,
    variantB: variantBMetrics,
    winner,
    relativeDiff: Math.round(relativeDiff * 100),
  };
}

async function updateFormatWinners(result: ExperimentResult): Promise<void> {
  const path = join(config.paths.memory, 'FORMAT-WINNERS.md');
  let content = await readFile(path, 'utf-8').catch(() => '');

  const winnerStyle = result.winner === 'A' ? result.variantA.hookStyle : result.variantB.hookStyle;
  const winnerRate = result.winner === 'A' ? result.variantA.saveRate : result.variantB.saveRate;
  const winnerViews = result.winner === 'A' ? result.variantA.views : result.variantB.views;

  // Add or update format rankings section
  const rankingHeader = '## Format Rankings\n\n| Rank | Format | Hook Style | Avg Save Rate | Avg Views | Last Used |\n|------|--------|-----------|---------------|-----------|-----------|';

  if (!content.includes('## Format Rankings') || content.includes('_Will be populated')) {
    content = content.replace(/## Format Rankings[\s\S]*$/, '');
    content += `\n${rankingHeader}\n| 1 | 7-slide | ${winnerStyle} | ${winnerRate}% | ${winnerViews.toLocaleString()} | ${new Date().toISOString().slice(0, 10)} |\n`;
  } else {
    // Append new winner entry
    content += `| - | 7-slide | ${winnerStyle} | ${winnerRate}% | ${winnerViews.toLocaleString()} | ${new Date().toISOString().slice(0, 10)} |\n`;
  }

  await writeFile(path, content);
  log(`Updated FORMAT-WINNERS.md: ${winnerStyle} promoted`);
}

async function updateLessonsLearned(result: ExperimentResult): Promise<void> {
  const path = join(config.paths.memory, 'LESSONS-LEARNED.md');
  let content = await readFile(path, 'utf-8').catch(() => '');

  const winnerStyle = result.winner === 'A' ? result.variantA.hookStyle : result.variantB.hookStyle;
  const loserStyle = result.winner === 'A' ? result.variantB.hookStyle : result.variantA.hookStyle;

  const insight = `\n- **${new Date().toISOString().slice(0, 10)}:** ${winnerStyle} hooks outperformed ${loserStyle} by ${result.relativeDiff}% relative save rate. ${winnerStyle} → keep using. ${loserStyle} → deprioritize.`;

  if (content.includes('## Insights')) {
    content = content.replace('## Insights', `## Insights${insight}`);
  } else {
    content += `\n## Insights${insight}\n`;
  }

  await writeFile(path, content);
  log(`Updated LESSONS-LEARNED.md with experiment insight`);
}

async function completeExperiment(result: ExperimentResult): Promise<void> {
  const path = join(config.paths.memory, 'EXPERIMENT-LOG.md');
  let content = await readFile(path, 'utf-8').catch(() => '');

  const verdictText = result.winner === 'inconclusive'
    ? 'INCONCLUSIVE — need more data'
    : `WINNER: Variant ${result.winner} (${result.winner === 'A' ? result.variantA.hookStyle : result.variantB.hookStyle}). Save rate +${result.relativeDiff}% relative.`;

  const completedEntry = `
### Experiment #${result.experimentId} — ${new Date().toISOString().slice(0, 10)}
- **Account:** @${result.account}
- **Variant A:** ${result.variantA.hookStyle} — Post ${result.variantA.postId} — ${result.variantA.views} views, ${result.variantA.saveRate}% save rate
- **Variant B:** ${result.variantB.hookStyle} — Post ${result.variantB.postId} — ${result.variantB.views} views, ${result.variantB.saveRate}% save rate
- **Verdict:** ${verdictText}
`;

  // Move from active to completed
  content = content.replace(
    /## Active Experiment\n[\s\S]*?(?=\n## Completed)/,
    '## Active Experiment\n_None — next experiment starts with next post._\n\n',
  );

  if (content.includes('## Completed Experiments')) {
    content = content.replace(
      '## Completed Experiments',
      `## Completed Experiments\n${completedEntry}`,
    );
  } else {
    content += `\n## Completed Experiments\n${completedEntry}\n`;
  }

  content = content.replace('_None yet._', '');

  await writeFile(path, content);
  log(`Experiment #${result.experimentId} completed: ${verdictText}`);
}

// ─── results.tsv logging ─────────────────────────────────────

async function logToResultsTsv(result: ExperimentResult): Promise<void> {
  const tsvPath = join(config.paths.memory, 'results.tsv');
  const status = result.winner === 'inconclusive' ? 'inconclusive' : result.winner === 'A' ? 'keep' : 'keep';
  const row = [
    result.experimentId,
    new Date().toISOString().slice(0, 10),
    result.account,
    'hook_style',
    result.variantA.hookStyle,
    result.variantB.hookStyle,
    `${result.variantA.saveRate}%`,
    `${result.variantB.saveRate}%`,
    result.variantA.views,
    result.variantB.views,
    0, // saves_a (not tracked separately yet)
    0, // saves_b
    status,
    `${result.variantA.hookStyle} vs ${result.variantB.hookStyle}, ${result.relativeDiff}% relative diff`,
  ].join('\t');

  await appendFile(tsvPath, row + '\n');
  log(`Logged experiment #${result.experimentId} to results.tsv`);
}

// ─── FORMAT-WINNERS refresh from tracker data ────────────────

async function refreshFormatWinners(tracker: string): Promise<void> {
  const metrics = parseTrackerMetrics(tracker);
  const path = join(config.paths.memory, 'FORMAT-WINNERS.md');
  let content = await readFile(path, 'utf-8').catch(() => '');

  // Aggregate by hook style + format from all posts with data
  const formatStats: Record<string, { views: number; saves: number; count: number; lastDate: string }> = {};

  for (const [, data] of metrics) {
    if (data.views <= 0) continue;
    const key = `${data.hookStyle}`;
    if (!formatStats[key]) formatStats[key] = { views: 0, saves: 0, count: 0, lastDate: '' };
    formatStats[key].views += data.views;
    formatStats[key].count++;
    if (data.date > formatStats[key].lastDate) formatStats[key].lastDate = data.date;
  }

  if (Object.keys(formatStats).length === 0) return;

  // Sort by avg views descending
  const ranked = Object.entries(formatStats)
    .map(([style, s]) => ({
      style,
      avgViews: Math.round(s.views / s.count),
      avgSaveRate: s.saves > 0 && s.views > 0 ? ((s.saves / s.views) * 100).toFixed(2) : '0.00',
      count: s.count,
      lastDate: s.lastDate,
    }))
    .sort((a, b) => b.avgViews - a.avgViews);

  // Rebuild the format rankings section
  const rankingHeader = '## Format Rankings\n\n| Rank | Hook Style | Avg Views | Avg Save Rate | Posts | Last Used |\n|------|-----------|-----------|---------------|-------|-----------|\n';
  const rankingRows = ranked
    .map((r, i) => `| ${i + 1} | ${r.style} | ${r.avgViews.toLocaleString()} | ${r.avgSaveRate}% | ${r.count} | ${r.lastDate} |`)
    .join('\n');

  // Replace or append the rankings section
  if (content.includes('## Format Rankings')) {
    content = content.replace(/## Format Rankings[\s\S]*$/, rankingHeader + rankingRows + '\n');
  } else {
    content += `\n${rankingHeader}${rankingRows}\n`;
  }

  await writeFile(path, content);
  log(`Updated FORMAT-WINNERS.md (${ranked.length} styles ranked)`);
}

export async function optimize(): Promise<void> {
  log('=== OPTIMIZATION PHASE ===');

  const experimentLog = await readFile(join(config.paths.memory, 'EXPERIMENT-LOG.md'), 'utf-8').catch(() => '');
  const tracker = await readFile(join(config.paths.memory, 'POST-TRACKER.md'), 'utf-8').catch(() => '');

  // Evaluate active experiment
  const result = await evaluateExperiment(experimentLog, tracker);

  if (!result) {
    log('No experiment ready to evaluate');
  } else if (result.winner !== 'inconclusive') {
    // We have a winner
    await completeExperiment(result);
    await updateFormatWinners(result);
    await updateLessonsLearned(result);
    await logToResultsTsv(result);
  } else {
    log(`Experiment #${result.experimentId}: inconclusive (${result.relativeDiff}% diff < 20% threshold)`);
    // Keep experiment active for more data, or close it and try new one
    if (result.relativeDiff < 5) {
      // Very close — close it and move on
      await completeExperiment(result);
      await logToResultsTsv(result);
      log('Closing inconclusive experiment — difference too small');
    }
  }

  // Always refresh FORMAT-WINNERS from latest tracker data
  await refreshFormatWinners(tracker);

  // Log rolling dashboard update
  const metrics = parseTrackerMetrics(tracker);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let totalViews = 0;
  let totalSaveRate = 0;
  let count = 0;
  const styleCounts: Record<string, { views: number; count: number }> = {};

  for (const [, data] of metrics) {
    if (data.date >= sevenDaysAgo && data.views > 0) {
      totalViews += data.views;
      totalSaveRate += data.saveRate;
      count++;
      if (!styleCounts[data.hookStyle]) styleCounts[data.hookStyle] = { views: 0, count: 0 };
      styleCounts[data.hookStyle].views += data.views;
      styleCounts[data.hookStyle].count++;
    }
  }

  if (count > 0) {
    const avgViews = Math.round(totalViews / count);
    const avgSaveRate = (totalSaveRate / count).toFixed(2);
    const bestStyle = Object.entries(styleCounts).sort((a, b) => b[1].views / b[1].count - a[1].views / a[1].count)[0]?.[0] || 'pending';

    // Update lessons-learned dashboard
    const lessonsPath = join(config.paths.memory, 'LESSONS-LEARNED.md');
    let lessons = await readFile(lessonsPath, 'utf-8').catch(() => '');
    lessons = lessons.replace(
      /## Rolling Dashboard[\s\S]*?(?=\n## [A-Z])/,
      `## Rolling Dashboard\n- 7-day avg save rate: ${avgSaveRate}%\n- 7-day avg views: ${avgViews.toLocaleString()}\n- Best hook style: ${bestStyle}\n- Best posting day/time: _analyzing_\n\n`,
    );
    await writeFile(lessonsPath, lessons);
    log(`Dashboard: ${avgViews} avg views, ${avgSaveRate}% avg save rate, best style: ${bestStyle}`);
  }

  log('=== OPTIMIZATION COMPLETE ===');
}

// Allow running standalone: npm run optimize
if (process.argv[1]?.endsWith('optimizer.ts')) {
  optimize().catch(console.error);
}
