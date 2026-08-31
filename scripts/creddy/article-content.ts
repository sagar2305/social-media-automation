import { isAbsolute } from 'node:path';

import type {
  CreddyArticleBlock,
  CreddyArticleDraft,
  CreddyArticleVisualPlan,
  CreddyClaim,
} from './pipeline-types.js';

export const CREDDY_ARTICLE_DISCLOSURE =
  'Advertiser disclosure: Creddy may earn a commission when you apply for a card through links on this site. This does not affect our recommendations, which are based on the published value of each card\'s benefits.';

export const CREDDY_ARTICLE_THEME = {
  background: '#FBFAF7',
  text: '#1E1A16',
  muted: '#7E7976',
  gold: '#D2992E',
  coral: '#FF605D',
  cream: '#FBF2DD',
  headingFont: 'Fraunces, Georgia, serif',
  bodyFont: 'Geist, ui-sans-serif, system-ui, sans-serif',
  radius: '18px',
} as const;

export const CREDDY_ARTICLE_IMAGE_BLOCK = {
  version: 'creddy-abstract-editorial-v1',
  aspectRatio: '16:9',
  desktopImageWidthPx: 900,
  frame: 'cream-gallery-mat',
  ornaments: ['coin-cluster', 'travel-route', 'card-outline', 'starburst'],
  hideOrnamentsBelowPx: 1100,
} as const;

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function textForBlock(block: CreddyArticleBlock): string[] {
  switch (block.type) {
    case 'paragraph': return [block.text];
    case 'heading': return [block.text];
    case 'key_takeaways': return [block.title, ...block.items];
    case 'callout': return [block.title, block.body];
    case 'comparison_table': return [block.caption, ...block.columns, ...block.rows.flat()];
    case 'visual': return [block.caption];
    case 'referral_card': return [block.title, block.body, block.ctaLabel];
    case 'faq': return block.items.flatMap((item) => [item.question, item.answer]);
    case 'subscribe': return [block.title, block.body, block.consentLabel];
    case 'download': return [block.title, block.body];
  }
}

function claimFieldsForBlock(block: CreddyArticleBlock): string[] {
  switch (block.type) {
    case 'paragraph':
    case 'key_takeaways':
    case 'callout':
    case 'comparison_table':
    case 'referral_card': return block.claimFields;
    case 'faq': return block.items.flatMap((item) => item.claimFields);
    default: return [];
  }
}

export function articleWordCount(article: CreddyArticleDraft): number {
  return words(article.blocks.flatMap(textForBlock).join(' '));
}

function assertHttpUrl(value: string, label: string): void {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use http or https`);
}

function assertClaimFields(fields: string[], accepted: Set<string>, label: string): void {
  if (!Array.isArray(fields) || fields.some((field) => !accepted.has(field))) {
    throw new Error(`${label} references a claim that Agent 03 did not approve`);
  }
}

export function validateCreddyArticle(
  article: CreddyArticleDraft,
  claims: CreddyClaim[],
  draftSourceUrls: string[],
): CreddyArticleDraft {
  if (article.version !== 'creddy-article-v1' || article.designVersion !== 'creddy-guides-v1') {
    throw new Error('Article must use the current Creddy article and design versions');
  }
  if (!article.id.startsWith('article-') || !/^[a-z0-9][a-z0-9-]{2,119}$/.test(article.slug)) {
    throw new Error('Article requires a stable article- ID and safe lowercase slug');
  }
  if (article.title.length < 20 || article.title.length > 80) throw new Error('Article title must contain 20–80 characters');
  if (!article.dek.trim() || article.dek.length > 240) throw new Error('Article dek must contain 1–240 characters');
  if (!article.excerpt.trim() || article.excerpt.length > 320) throw new Error('Article excerpt must contain 1–320 characters');
  if (!article.seoTitle.trim() || article.seoTitle.length > 65) throw new Error('SEO title must contain 1–65 characters');
  if (article.seoDescription.length < 100 || article.seoDescription.length > 170) {
    throw new Error('SEO description must contain 100–170 characters');
  }
  if (article.authorName !== 'Creddy Editorial') throw new Error('Article author must use Creddy Editorial');
  if (!Number.isInteger(article.readingMinutes) || article.readingMinutes < 3 || article.readingMinutes > 20) {
    throw new Error('Article reading time must be 3–20 minutes');
  }
  if (!article.heroVisualId.trim()) throw new Error('Article requires a hero visual ID');
  if (!Array.isArray(article.blocks) || article.blocks.length < 8 || article.blocks.length > 80) {
    throw new Error('Article requires 8–80 structured blocks');
  }
  const blockIds = new Set(article.blocks.map((block) => block.id));
  if (blockIds.size !== article.blocks.length || [...blockIds].some((id) => !/^[a-z0-9][a-z0-9-]{1,79}$/.test(id))) {
    throw new Error('Article block IDs must be unique safe slugs');
  }
  if (articleWordCount(article) < 650 || articleWordCount(article) > 3_500) {
    throw new Error('Article body must contain 650–3500 words');
  }
  if (article.blocks.filter((block) => block.type === 'heading' && block.level === 2).length < 2) {
    throw new Error('Article requires at least two H2 sections');
  }
  for (const required of ['key_takeaways', 'subscribe', 'download'] as const) {
    if (article.blocks.filter((block) => block.type === required).length !== 1) {
      throw new Error(`Article requires exactly one ${required} block`);
    }
  }
  if (!article.blocks.some((block) => block.type === 'visual' && block.visualId === article.heroVisualId)) {
    throw new Error('Article hero visual must be represented by a visual block');
  }
  const accepted = new Set(claims.map((claim) => claim.field));
  for (const block of article.blocks) {
    assertClaimFields(claimFieldsForBlock(block), accepted, `Article block ${block.id}`);
    if (block.type === 'comparison_table') {
      if (block.columns.length < 2 || block.columns.length > 6 || block.rows.length === 0 ||
          block.rows.some((row) => row.length !== block.columns.length)) {
        throw new Error(`Comparison table ${block.id} has inconsistent columns`);
      }
    }
    if (block.type === 'referral_card' && !/^[a-z0-9][a-z0-9-]{2,99}$/.test(block.referralId)) {
      throw new Error(`Referral card ${block.id} requires an approved registry ID`);
    }
    if (block.type === 'subscribe' && !/consent|agree|email/i.test(block.consentLabel)) {
      throw new Error('Subscribe block requires clear email consent language');
    }
    if (block.type === 'download') {
      assertHttpUrl(block.iosUrl, 'App Store URL');
      assertHttpUrl(block.androidUrl, 'Play Store URL');
    }
  }
  if (article.referralDisclosure !== CREDDY_ARTICLE_DISCLOSURE) {
    throw new Error('Article must preserve the approved advertiser disclosure exactly');
  }
  if (!Array.isArray(article.sourceUrls) || article.sourceUrls.length === 0) throw new Error('Article requires sources');
  article.sourceUrls.forEach((url) => assertHttpUrl(url, 'Article source URL'));
  if (JSON.stringify(article.sourceUrls) !== JSON.stringify(draftSourceUrls)) {
    throw new Error('Article must preserve the Agent 04 source list exactly');
  }
  return article;
}

const FORBIDDEN_GENERATED_VISUAL_LANGUAGE = [
  /\b(?:logo|wordmark)\b/i,
  /\b(?:credit|debit) card design\b/i,
  /\bapp screenshot\b/i,
  /\b(?:headline|caption|label|typography|written text) inside (?:the )?image\b/i,
  /\b(?:celebrity|public figure)\b/i,
];

export function validateCreddyArticleVisuals(
  plan: CreddyArticleVisualPlan,
  article: CreddyArticleDraft,
  claims: CreddyClaim[],
): CreddyArticleVisualPlan {
  if (plan.version !== 'creddy-article-visuals-v1' || plan.designVersion !== article.designVersion) {
    throw new Error('Article visuals must use the current Creddy design version');
  }
  if (!Array.isArray(plan.assets) || plan.assets.length < 3 || plan.assets.length > 8) {
    throw new Error('Article requires 3–8 planned visuals');
  }
  if (plan.imageBlockStyle && String(plan.imageBlockStyle) !== CREDDY_ARTICLE_IMAGE_BLOCK.version) {
    throw new Error('Article visual plan requests an unsupported image block style');
  }
  if (plan.imageBlockStyle === CREDDY_ARTICLE_IMAGE_BLOCK.version &&
      plan.assets.some((asset) => asset.aspectRatio !== CREDDY_ARTICLE_IMAGE_BLOCK.aspectRatio)) {
    throw new Error('The approved Creddy article image block requires every planned asset to use 16:9');
  }
  const ids = new Set(plan.assets.map((asset) => asset.id));
  if (ids.size !== plan.assets.length || !ids.has(article.heroVisualId)) {
    throw new Error('Article visual IDs must be unique and include the hero visual');
  }
  const blockIds = new Set(article.blocks.map((block) => block.id));
  const accepted = new Set(claims.map((claim) => claim.field));
  const pendingGeneratedStyles = new Set<string>();
  for (const asset of plan.assets) {
    if (!blockIds.has(asset.articleBlockId)) throw new Error(`Visual ${asset.id} references an unknown article block`);
    assertClaimFields(asset.claimFields, accepted, `Visual ${asset.id}`);
    if (!asset.altText.trim() || asset.altText.length > 180 || /^image (?:of|showing)\b/i.test(asset.altText)) {
      throw new Error(`Visual ${asset.id} requires concise descriptive alt text`);
    }
    if (!asset.caption.trim() || asset.caption.length > 220) throw new Error(`Visual ${asset.id} requires a caption`);
    if (asset.generationMode === 'generate') {
      if (!asset.assetPath) {
        const seriesStyle = asset.seriesStyle?.replace(/\s+/g, ' ').trim();
        if (!seriesStyle || seriesStyle.length < 60 || seriesStyle.length > 500) {
          throw new Error(`Generated visual ${asset.id} requires a 60–500 character shared seriesStyle`);
        }
        pendingGeneratedStyles.add(seriesStyle);
      }
      if (!asset.prompt || asset.prompt.length < 60 || asset.prompt.length > 1_200) {
        throw new Error(`Generated visual ${asset.id} requires a detailed 60–1200 character prompt`);
      }
      const prompt = asset.prompt;
      if (FORBIDDEN_GENERATED_VISUAL_LANGUAGE.some((pattern) => pattern.test(prompt))) {
        throw new Error(`Generated visual ${asset.id} requests prohibited logos, fake product UI, or baked-in text`);
      }
      if (!asset.negativePrompt || !/text/i.test(asset.negativePrompt) || !/logo/i.test(asset.negativePrompt)) {
        throw new Error(`Generated visual ${asset.id} must explicitly exclude text and logos`);
      }
    }
    if (asset.assetType === 'creddy_product_capture' && asset.generationMode !== 'supply') {
      throw new Error('Creddy product captures must use supplied approved screenshots');
    }
    if (asset.assetPath && !isAbsolute(asset.assetPath)) throw new Error(`Visual ${asset.id} assetPath must be absolute`);
    if (asset.generationMode !== 'generate' && !asset.provenance?.trim()) {
      throw new Error(`Supplied or composed visual ${asset.id} requires provenance`);
    }
  }
  if (pendingGeneratedStyles.size > 1) {
    throw new Error('Every pending generated image in an article must use the same seriesStyle');
  }
  if (plan.assets.filter((asset) => asset.usage === 'hero' && asset.id === article.heroVisualId).length !== 1) {
    throw new Error('Article requires exactly one matching hero asset');
  }
  return plan;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

const APP_STORE_ICON = '<svg class="app-store-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.79 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25Z"/></svg>';
const PLAY_STORE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path class="play-blue" d="M4.8 3.4 14 12l-9.2 8.6a2 2 0 0 1-.3-1V4.4c0-.4.1-.7.3-1Z"/><path class="play-green" d="m5.7 2.8 11.1 6.3-2.8 2.7-9.2-8.6c.3-.4.6-.5.9-.4Z"/><path class="play-yellow" d="m14 12 2.8 2.7-11.1 6.4c-.4.2-.7 0-.9-.4L14 12Z"/><path class="play-red" d="m16.8 9.1 2.1 1.2c.8.5.8 1.4 0 1.9l-2.1 1.2-2.8-2.7 2.8-1.6Z"/></svg>';
const ARTICLE_DOWNLOAD_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>';

export type CreddyArticlePreviewVisual = { src: string; altText: string };

function renderBlock(
  block: CreddyArticleBlock,
  visualAssets: Record<string, CreddyArticlePreviewVisual>,
): string {
  switch (block.type) {
    case 'paragraph': return `<p>${escapeHtml(block.text)}</p>`;
    case 'heading': return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    case 'key_takeaways': return `<aside class="takeaways"><strong>${escapeHtml(block.title)}</strong><ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></aside>`;
    case 'callout': return `<aside class="callout ${block.tone}"><strong>${escapeHtml(block.title)}</strong><p>${escapeHtml(block.body)}</p></aside>`;
    case 'comparison_table': return `<figure class="table"><figcaption>${escapeHtml(block.caption)}</figcaption><div class="table-scroll"><table><thead><tr>${block.columns.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></figure>`;
    case 'visual': {
      const asset = visualAssets[block.visualId];
      const media = asset
        ? `<img src="${escapeHtml(asset.src)}" alt="${escapeHtml(asset.altText)}" loading="eager">`
        : `<div class="visual-placeholder">Visual · ${escapeHtml(block.visualId)}</div>`;
      return `<figure class="visual" data-visual-id="${escapeHtml(block.visualId)}"><div class="visual-ornaments" aria-hidden="true"><span class="ornament-coins"></span><span class="ornament-route"></span><span class="ornament-card"></span><span class="ornament-star"></span></div><div class="visual-frame">${media}</div><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
    }
    case 'referral_card': return `<aside class="referral"><div><span>Recommended option</span><strong>${escapeHtml(block.title)}</strong><p>${escapeHtml(block.body)}</p></div><a href="#referral-${escapeHtml(block.referralId)}">${escapeHtml(block.ctaLabel)}</a></aside>`;
    case 'faq': return `<section class="faq"><h2>Frequently asked questions</h2>${block.items.map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</section>`;
    case 'subscribe': return `<section class="subscribe"><div><span>Creddy Blog</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.body)}</p></div><form><input aria-label="Email address" disabled placeholder="you@example.com" type="email"><button disabled>Subscribe</button><small>${escapeHtml(block.consentLabel)}</small></form></section>`;
    case 'download': return `<section class="download"><div><span>Creddy</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.body)}</p></div><div class="store-buttons"><a class="store-badge" href="${escapeHtml(block.iosUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Download Creddy on the App Store">${APP_STORE_ICON}<span><small>Download on the</small><strong>App Store</strong></span></a><a class="store-badge" href="${escapeHtml(block.androidUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Get Creddy on Google Play">${PLAY_STORE_ICON}<span><small>Get it on</small><strong>Google Play</strong></span></a><button class="article-download" type="button" data-download-article>${ARTICLE_DOWNLOAD_ICON}<span>Download this article</span></button></div></section>`;
  }
}

export function renderCreddyArticlePreview(
  article: CreddyArticleDraft,
  visualAssets: Record<string, CreddyArticlePreviewVisual> = {},
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.seoTitle)}</title><style>
  :root{--bg:${CREDDY_ARTICLE_THEME.background};--text:${CREDDY_ARTICLE_THEME.text};--muted:${CREDDY_ARTICLE_THEME.muted};--gold:${CREDDY_ARTICLE_THEME.gold};--coral:${CREDDY_ARTICLE_THEME.coral};--cream:${CREDDY_ARTICLE_THEME.cream}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:${CREDDY_ARTICLE_THEME.bodyFont};line-height:1.7;overflow-wrap:anywhere}header,main,footer{width:min(100%,1440px);margin-inline:auto;padding-inline:clamp(24px,4vw,64px)}header{padding-top:24px}main{padding-top:24px}footer{padding-block:24px}nav{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:12px 0;border-bottom:1px solid #e7e0d4}.brand{font-family:${CREDDY_ARTICLE_THEME.headingFont};font-size:24px}.crumb,.eyebrow,small{color:var(--muted);font-size:13px}.hero{max-width:1040px;padding:72px 0 32px}.hero h1,h2,h3{font-family:${CREDDY_ARTICLE_THEME.headingFont};line-height:1.08}.hero h1{font-size:clamp(44px,6vw,76px);letter-spacing:-.04em;margin:12px 0 20px}.hero .dek{font-size:22px;color:var(--muted);max-width:880px}.article{width:100%;max-width:1120px;margin-inline:auto}.article>p,.article>h2,.article>h3,.faq{max-width:820px;margin-inline:auto}.article>p{font-size:19px;margin-block:24px}.article h2{font-size:38px;margin-block:64px 20px}.article h3{font-size:27px;margin-block:40px 16px}.takeaways,.callout,.referral,.subscribe,.download,.table,.visual{border-radius:${CREDDY_ARTICLE_THEME.radius};margin-block:36px;padding:32px}.takeaways,.callout{max-width:960px;margin-inline:auto}.takeaways{background:var(--cream)}.takeaways strong,.referral strong{font-family:${CREDDY_ARTICLE_THEME.headingFont};font-size:24px}.callout{border:1px solid #ded5c6;background:#fff}.callout.warning{border-color:var(--coral)}.table,.visual{width:100%;background:#fff;border:1px solid #e7e0d4}.table-scroll{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;min-width:620px}th,td{text-align:left;border-bottom:1px solid #e7e0d4;padding:12px}.visual div{aspect-ratio:16/9;background:linear-gradient(135deg,var(--cream),#efe0ba);display:grid;place-items:center;border-radius:14px;color:#8b6723}.visual img{display:block;width:100%;height:auto;max-height:720px;border-radius:14px;object-fit:cover}.visual figcaption,figcaption{color:var(--muted);font-size:13px;margin-top:10px}.referral{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:32px;align-items:center;background:#1e1a16;color:#fff}.referral>div{min-width:0}.referral span,.subscribe>div>span,.download>div>span{color:var(--gold);text-transform:uppercase;letter-spacing:.12em;font-size:12px}.referral span,.referral strong{display:block}.referral strong{margin-top:10px;line-height:1.18}.referral a,button{background:var(--gold);color:#1e1a16;text-decoration:none;padding:12px 18px;border:0;border-radius:14px;font-weight:700}.referral a{text-align:center}.disclosure{font-size:13px;color:var(--muted);border-block:1px solid #e7e0d4;padding:16px 0}.faq details{border-top:1px solid #e7e0d4;padding:18px 0}.faq summary{font-weight:700;cursor:pointer}.subscribe,.download{width:100%;margin-block:64px;background:var(--cream);display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,1fr);gap:32px}.subscribe h2,.download h2{font-size:34px;margin:8px 0}.subscribe form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-content:center}.subscribe input{min-width:0;border:1px solid #cfc4b1;background:#fff;border-radius:14px;padding:14px}.subscribe small{grid-column:1/-1}.store-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-content:center}.store-badge{min-height:62px;background:#171512;color:#fff;text-decoration:none;padding:10px 14px;border:1px solid #3b3832;border-radius:14px;display:flex;align-items:center;gap:10px}.store-badge svg{width:30px;height:30px;flex:none}.store-badge .app-store-icon{fill:#fff;stroke:none}.store-badge:nth-child(2) svg{fill:currentColor;stroke:none}.store-badge .play-blue{fill:#48a9f8}.store-badge .play-green{fill:#33d17a}.store-badge .play-yellow{fill:#ffd43b}.store-badge .play-red{fill:#ff5c5c}.store-badge span{display:grid;color:#fff;text-transform:none;letter-spacing:0}.store-badge small{color:#d9d6d0;font-size:10px;line-height:1}.store-badge strong{font-size:18px;line-height:1.2}.article-download{grid-column:1/-1;background:transparent;border:1px solid #bda769;display:flex;justify-content:center;align-items:center;gap:9px;cursor:pointer}.article-download svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.article-download span{color:inherit;text-transform:none;letter-spacing:0;font-size:14px}.store-badge:hover,.article-download:hover{transform:translateY(-1px)}.sources{max-width:1120px;font-size:14px;color:var(--muted);margin:48px auto}.sources a{color:var(--text)}footer{border-top:1px solid #e7e0d4;color:var(--muted);margin-top:72px}@media(max-width:900px){.subscribe,.download{grid-template-columns:1fr}.referral{grid-template-columns:minmax(0,1fr) 190px}}@media(max-width:700px){header,main,footer{padding-inline:16px}header{padding-top:10px}main{padding-top:16px}nav{align-items:flex-start;font-size:12px;gap:12px}.brand{font-size:22px}.crumb{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hero{padding:40px 0 24px}.hero h1{font-size:clamp(36px,11vw,48px);letter-spacing:-.035em}.hero .dek{font-size:19px;line-height:1.55}.article>p{font-size:17px;line-height:1.75}.article h2{font-size:30px;margin-block:48px 18px}.article h3{font-size:24px}.takeaways,.callout,.referral,.subscribe,.download,.table,.visual{border-radius:18px;margin-block:28px;padding:18px}.visual{padding:10px}.visual img,.visual div{border-radius:12px}.visual figcaption{padding-inline:4px}.referral{grid-template-columns:1fr;gap:20px}.referral a{width:100%}.subscribe,.download{grid-template-columns:1fr;gap:20px;margin-block:44px}.subscribe h2,.download h2{font-size:28px}.subscribe form,.store-buttons{grid-template-columns:1fr}.subscribe button{width:100%}.store-badge{width:100%}.article-download{grid-column:1}.sources{margin-block:40px}footer{margin-top:48px}}
  @media(min-width:701px){header,main,footer{width:100%;max-width:none;padding-inline:clamp(24px,3vw,56px)}.hero,.article,.article>p,.article>h2,.article>h3,.faq,.takeaways,.callout,.sources{width:100%;max-width:none}.subscribe,.download{max-width:none}}
  .visual{position:relative;overflow:hidden;background:radial-gradient(circle at 8% 12%,rgba(210,153,46,.18) 0 7px,transparent 8px),radial-gradient(circle at 92% 88%,rgba(255,96,93,.14) 0 9px,transparent 10px),linear-gradient(135deg,#fffaf0,#f4ead6);border-color:#ddc99f}.visual:before,.visual:after{content:"";position:absolute;border:1px solid rgba(210,153,46,.28);border-radius:50%;pointer-events:none}.visual:before{width:120px;height:120px;right:-54px;top:-58px}.visual:after{width:78px;height:78px;left:-34px;bottom:-38px}.visual .visual-topline{max-width:1080px;margin:0 auto 14px;display:flex;aspect-ratio:auto;background:transparent;border-radius:0;justify-content:space-between;align-items:center;gap:16px;color:#8b6723;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.visual-topline span:last-child{color:var(--muted);font-weight:500}.visual .visual-frame{position:relative;z-index:1;display:block;aspect-ratio:auto;max-width:1080px;margin-inline:auto;padding:12px;background:rgba(255,255,255,.86);border:1px solid rgba(210,153,46,.34);border-radius:18px;box-shadow:0 18px 45px rgba(75,53,18,.12)}.visual-frame img{display:block;max-width:100%;max-height:540px;width:auto;height:auto;margin-inline:auto;border-radius:12px;object-fit:contain}.visual .visual-placeholder{height:min(54vw,540px);aspect-ratio:auto;background:linear-gradient(135deg,var(--cream),#efe0ba);display:grid;place-items:center;border-radius:12px;color:#8b6723}.visual figcaption{position:relative;z-index:1;max-width:1080px;margin:14px auto 0;color:#675f54;font-size:14px}.visual-frame div{aspect-ratio:auto}@media(max-width:700px){.visual .visual-topline{margin-bottom:10px;font-size:9px;letter-spacing:.1em}.visual-topline span:last-child{display:none}.visual .visual-frame{padding:6px;border-radius:14px}.visual-frame img{width:100%;max-height:none;border-radius:10px}.visual .visual-placeholder{height:56vw}.visual figcaption{font-size:12px;margin-top:10px}}
  .visual{padding:clamp(18px,3vw,38px);background:linear-gradient(145deg,#fffdf8 0%,#f7f0e3 100%);border:1px solid #e4d5ba;box-shadow:inset 0 3px 0 rgba(210,153,46,.72)}.visual:before,.visual:after{width:72px;height:72px;border:0;border-radius:18px;background:linear-gradient(135deg,rgba(210,153,46,.18),rgba(255,96,93,.08));transform:rotate(24deg)}.visual:before{right:-30px;top:-34px}.visual:after{left:-34px;bottom:-38px}.visual .visual-frame{position:relative;z-index:1;display:block;aspect-ratio:16/9;width:min(100%,900px);max-width:900px;margin-inline:auto;padding:9px;background:#fff;border:1px solid #d8c29a;border-radius:18px;box-shadow:0 16px 38px rgba(55,38,14,.13)}.visual-frame img{display:block;width:100%;height:100%;max-width:none;max-height:none;margin:0;border-radius:11px;object-fit:cover}.visual .visual-placeholder{width:100%;height:100%;aspect-ratio:auto;background:linear-gradient(135deg,var(--cream),#efe0ba);display:grid;place-items:center;border-radius:11px;color:#8b6723}.visual figcaption{position:relative;z-index:1;width:min(100%,900px);max-width:900px;margin:13px auto 0;color:#675f54;font-size:14px}.visual-frame div{aspect-ratio:auto}@media(max-width:700px){.visual{padding:10px}.visual .visual-frame{width:100%;padding:5px;border-radius:13px}.visual-frame img{border-radius:9px}.visual figcaption{font-size:12px;margin-top:9px;padding-inline:3px}}
  .visual .visual-ornaments{position:absolute;inset:0;z-index:2;display:block;aspect-ratio:auto;background:transparent;border-radius:0;color:inherit;pointer-events:none}.visual-ornaments span{position:absolute;z-index:1;display:grid;place-items:center;width:46px;height:46px;border:1px solid rgba(210,153,46,.36);border-radius:15px;background:rgba(255,255,255,.78);box-shadow:0 10px 24px rgba(76,53,17,.1);color:#b77c17;font-family:${CREDDY_ARTICLE_THEME.headingFont};font-size:23px;line-height:1;backdrop-filter:blur(5px);pointer-events:none}.ornament-dollar{left:4.5%;top:26%}.ornament-points{left:7%;bottom:22%;color:var(--coral)!important}.ornament-growth{right:4.5%;top:27%}.ornament-spark{right:7%;bottom:21%;color:var(--coral)!important}@media(max-width:1100px){.visual .visual-ornaments{display:none}}
  .visual:before,.visual:after{border:1px dashed rgba(210,153,46,.24);border-radius:50%;background:transparent;transform:none}.visual:before{width:120px;height:120px;right:-62px;top:-66px}.visual:after{width:88px;height:88px;left:-48px;bottom:-50px;border-color:rgba(255,96,93,.2)}.visual .visual-ornaments:before,.visual .visual-ornaments:after{content:"";position:absolute;top:31%;bottom:31%;width:1px;background:repeating-linear-gradient(to bottom,rgba(210,153,46,.3) 0 4px,transparent 4px 10px)}.visual .visual-ornaments:before{left:calc(50% - 510px)}.visual .visual-ornaments:after{right:calc(50% - 510px)}.visual-ornaments span{width:32px;height:32px;border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;font-size:24px;opacity:.58}.ornament-dollar{left:calc(50% - 526px);top:27%}.ornament-points{left:calc(50% - 526px);bottom:27%;color:var(--coral)!important}.ornament-growth{right:calc(50% - 526px);top:27%}.ornament-spark{right:calc(50% - 526px);bottom:27%;color:var(--coral)!important}@media(max-width:1100px){.visual .visual-ornaments{display:none}}
  .visual .visual-ornaments:before,.visual .visual-ornaments:after{display:none}.visual-ornaments span{font-size:0;opacity:1;border:0;background:none;box-shadow:none;backdrop-filter:none}.ornament-coins{left:calc(50% - 545px);top:31%;width:86px!important;height:76px!important;background:radial-gradient(circle at 28% 70%,rgba(255,96,93,.16) 0 17px,transparent 18px),radial-gradient(circle at 68% 66%,rgba(210,153,46,.24) 0 20px,transparent 21px),radial-gradient(circle at 50% 25%,rgba(210,153,46,.14) 0 21px,transparent 22px)!important}.ornament-route{left:calc(50% - 535px);bottom:24%;width:78px!important;height:84px!important;border-left:2px dashed rgba(255,96,93,.24)!important;border-bottom:2px dashed rgba(255,96,93,.24)!important;border-radius:0 0 0 58px!important;transform:rotate(-12deg)}.ornament-route:before,.ornament-route:after{content:"";position:absolute;width:9px;height:9px;border-radius:50%;background:rgba(255,96,93,.38)}.ornament-route:before{left:-5px;top:-2px}.ornament-route:after{right:-5px;bottom:-5px}.ornament-card{right:calc(50% - 540px);top:32%;width:88px!important;height:56px!important;border:1.5px solid rgba(210,153,46,.3)!important;border-radius:14px!important;background:linear-gradient(145deg,rgba(255,255,255,.7),rgba(210,153,46,.07))!important;transform:rotate(7deg)}.ornament-card:before{content:"";position:absolute;left:14px;top:15px;width:19px;height:14px;border:1px solid rgba(210,153,46,.34);border-radius:4px;background:linear-gradient(90deg,transparent 45%,rgba(210,153,46,.25) 46% 54%,transparent 55%)}.ornament-card:after{content:"";position:absolute;left:14px;right:14px;bottom:12px;height:1px;background:rgba(210,153,46,.22)}.ornament-star{right:calc(50% - 522px);bottom:26%;width:54px!important;height:54px!important;background:linear-gradient(135deg,rgba(210,153,46,.24),rgba(255,96,93,.17))!important;clip-path:polygon(50% 0,61% 37%,100% 50%,61% 63%,50% 100%,39% 63%,0 50%,39% 37%)}@media(max-width:1100px){.visual .visual-ornaments{display:none}}
  figure{margin-inline:0}
  </style></head><body><header><nav><div class="brand">Creddy</div><div>Cards · Benefits · Best · Hotels · Blog</div></nav></header><main><div class="crumb">Blog / ${escapeHtml(article.title)}</div><section class="hero"><div class="eyebrow">${escapeHtml(article.category.replaceAll('_', ' '))} · ${article.readingMinutes} min read</div><h1>${escapeHtml(article.title)}</h1><p class="dek">${escapeHtml(article.dek)}</p></section><p class="disclosure">${escapeHtml(article.referralDisclosure)}</p><article class="article">${article.blocks.map((block) => renderBlock(block, visualAssets)).join('')}</article><section class="sources"><strong>Sources and verification</strong><ul>${article.sourceUrls.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join('')}</ul><p>Last updated ${escapeHtml(article.updatedAt.slice(0, 10))} by ${escapeHtml(article.authorName)}.</p></section></main><footer>Creddy · Every card benefit, explained.</footer><script>(()=>{const filename=${JSON.stringify(`${article.slug}.html`)};document.querySelectorAll('[data-download-article]').forEach((button)=>button.addEventListener('click',()=>{const blob=new Blob(['<!doctype html>\n'+document.documentElement.outerHTML],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}))})()</script></body></html>`;
}
