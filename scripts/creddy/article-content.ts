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
  const ids = new Set(plan.assets.map((asset) => asset.id));
  if (ids.size !== plan.assets.length || !ids.has(article.heroVisualId)) {
    throw new Error('Article visual IDs must be unique and include the hero visual');
  }
  const blockIds = new Set(article.blocks.map((block) => block.id));
  const accepted = new Set(claims.map((claim) => claim.field));
  for (const asset of plan.assets) {
    if (!blockIds.has(asset.articleBlockId)) throw new Error(`Visual ${asset.id} references an unknown article block`);
    assertClaimFields(asset.claimFields, accepted, `Visual ${asset.id}`);
    if (!asset.altText.trim() || asset.altText.length > 180 || /^image (?:of|showing)\b/i.test(asset.altText)) {
      throw new Error(`Visual ${asset.id} requires concise descriptive alt text`);
    }
    if (!asset.caption.trim() || asset.caption.length > 220) throw new Error(`Visual ${asset.id} requires a caption`);
    if (asset.generationMode === 'generate') {
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
        : `<div>Visual · ${escapeHtml(block.visualId)}</div>`;
      return `<figure class="visual" data-visual-id="${escapeHtml(block.visualId)}">${media}<figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
    }
    case 'referral_card': return `<aside class="referral"><div><span>Recommended option</span><strong>${escapeHtml(block.title)}</strong><p>${escapeHtml(block.body)}</p></div><a href="#referral-${escapeHtml(block.referralId)}">${escapeHtml(block.ctaLabel)}</a></aside>`;
    case 'faq': return `<section class="faq"><h2>Frequently asked questions</h2>${block.items.map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</section>`;
    case 'subscribe': return `<section class="subscribe"><div><span>Creddy Guides</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.body)}</p></div><form><input aria-label="Email address" disabled placeholder="you@example.com" type="email"><button disabled>Subscribe</button><small>${escapeHtml(block.consentLabel)}</small></form></section>`;
    case 'download': return `<section class="download"><div><span>Creddy</span><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.body)}</p></div><div class="store-buttons"><a class="store-badge" href="${escapeHtml(block.iosUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Download Creddy on the App Store">${APP_STORE_ICON}<span><small>Download on the</small><strong>App Store</strong></span></a><a class="store-badge" href="${escapeHtml(block.androidUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Get Creddy on Google Play">${PLAY_STORE_ICON}<span><small>Get it on</small><strong>Google Play</strong></span></a><button class="article-download" type="button" data-download-article>${ARTICLE_DOWNLOAD_ICON}<span>Download this article</span></button></div></section>`;
  }
}

export function renderCreddyArticlePreview(
  article: CreddyArticleDraft,
  visualAssets: Record<string, CreddyArticlePreviewVisual> = {},
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.seoTitle)}</title><style>
  :root{--bg:${CREDDY_ARTICLE_THEME.background};--text:${CREDDY_ARTICLE_THEME.text};--muted:${CREDDY_ARTICLE_THEME.muted};--gold:${CREDDY_ARTICLE_THEME.gold};--coral:${CREDDY_ARTICLE_THEME.coral};--cream:${CREDDY_ARTICLE_THEME.cream}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:${CREDDY_ARTICLE_THEME.bodyFont};line-height:1.7}header,main,footer{max-width:1120px;margin:auto;padding:24px}nav{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #e7e0d4}.brand{font-family:${CREDDY_ARTICLE_THEME.headingFont};font-size:24px}.crumb,.eyebrow,small{color:var(--muted);font-size:13px}.hero{max-width:880px;padding:72px 0 32px}.hero h1,h2,h3{font-family:${CREDDY_ARTICLE_THEME.headingFont};line-height:1.08}.hero h1{font-size:clamp(44px,8vw,76px);letter-spacing:-.04em;margin:12px 0 20px}.hero .dek{font-size:22px;color:var(--muted);max-width:760px}.article{max-width:760px;margin:auto}.article>p{font-size:19px;margin:24px 0}.article h2{font-size:38px;margin:64px 0 20px}.article h3{font-size:27px;margin:40px 0 16px}.takeaways,.callout,.referral,.subscribe,.download,.table,.visual{border-radius:${CREDDY_ARTICLE_THEME.radius};margin:36px 0;padding:28px}.takeaways{background:var(--cream)}.takeaways strong,.referral strong{font-family:${CREDDY_ARTICLE_THEME.headingFont};font-size:24px}.callout{border:1px solid #ded5c6;background:#fff}.callout.warning{border-color:var(--coral)}.table,.visual{background:#fff;border:1px solid #e7e0d4}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #e7e0d4;padding:12px}.visual div{aspect-ratio:16/9;background:linear-gradient(135deg,var(--cream),#efe0ba);display:grid;place-items:center;border-radius:14px;color:#8b6723}.visual img{display:block;width:100%;height:auto;border-radius:14px;object-fit:cover}.visual figcaption,figcaption{color:var(--muted);font-size:13px;margin-top:10px}.referral{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:28px;align-items:center;background:#1e1a16;color:#fff}.referral>div{min-width:0}.referral span,.subscribe>div>span,.download>div>span{color:var(--gold);text-transform:uppercase;letter-spacing:.12em;font-size:12px}.referral span,.referral strong{display:block}.referral strong{margin-top:10px;line-height:1.18}.referral a,button{background:var(--gold);color:#1e1a16;text-decoration:none;padding:12px 18px;border:0;border-radius:14px;font-weight:700}.referral a{text-align:center}.disclosure{font-size:13px;color:var(--muted);border-block:1px solid #e7e0d4;padding:16px 0}.faq details{border-top:1px solid #e7e0d4;padding:18px 0}.faq summary{font-weight:700;cursor:pointer}.subscribe,.download{max-width:980px;margin:72px auto;background:var(--cream);display:grid;grid-template-columns:1fr 1fr;gap:28px}.subscribe h2,.download h2{font-size:34px;margin:8px 0}.subscribe form{display:grid;grid-template-columns:1fr auto;gap:10px;align-content:center}.subscribe input{border:1px solid #cfc4b1;background:#fff;border-radius:14px;padding:14px}.subscribe small{grid-column:1/-1}.store-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-content:center}.store-badge{min-height:62px;background:#171512;color:#fff;text-decoration:none;padding:10px 14px;border:1px solid #3b3832;border-radius:14px;display:flex;align-items:center;gap:10px}.store-badge svg{width:30px;height:30px;flex:none}.store-badge .app-store-icon{fill:#fff;stroke:none}.store-badge:nth-child(2) svg{fill:currentColor;stroke:none}.store-badge .play-blue{fill:#48a9f8}.store-badge .play-green{fill:#33d17a}.store-badge .play-yellow{fill:#ffd43b}.store-badge .play-red{fill:#ff5c5c}.store-badge span{display:grid;color:#fff;text-transform:none;letter-spacing:0}.store-badge small{color:#d9d6d0;font-size:10px;line-height:1}.store-badge strong{font-size:18px;line-height:1.2}.article-download{grid-column:1/-1;background:transparent;border:1px solid #bda769;display:flex;justify-content:center;align-items:center;gap:9px;cursor:pointer}.article-download svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.article-download span{color:inherit;text-transform:none;letter-spacing:0;font-size:14px}.store-badge:hover,.article-download:hover{transform:translateY(-1px)}.sources{font-size:14px;color:var(--muted);margin:48px 0}.sources a{color:var(--text)}footer{border-top:1px solid #e7e0d4;color:var(--muted);margin-top:72px}@media(max-width:700px){header,main,footer{padding:18px}.hero{padding-top:44px}.article h2{font-size:32px}.referral,.subscribe,.download{grid-template-columns:1fr}.subscribe form,.store-buttons{grid-template-columns:1fr}.subscribe button{width:100%}}
  </style></head><body><header><nav><div class="brand">Creddy</div><div>Cards · Benefits · Best · Hotels · Guides</div></nav></header><main><div class="crumb">Guides / ${escapeHtml(article.title)}</div><section class="hero"><div class="eyebrow">${escapeHtml(article.category.replaceAll('_', ' '))} · ${article.readingMinutes} min read</div><h1>${escapeHtml(article.title)}</h1><p class="dek">${escapeHtml(article.dek)}</p></section><p class="disclosure">${escapeHtml(article.referralDisclosure)}</p><article class="article">${article.blocks.map((block) => renderBlock(block, visualAssets)).join('')}</article><section class="sources"><strong>Sources and verification</strong><ul>${article.sourceUrls.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join('')}</ul><p>Last updated ${escapeHtml(article.updatedAt.slice(0, 10))} by ${escapeHtml(article.authorName)}.</p></section></main><footer>Creddy · Every card benefit, explained.</footer><script>(()=>{const filename=${JSON.stringify(`${article.slug}.html`)};document.querySelectorAll('[data-download-article]').forEach((button)=>button.addEventListener('click',()=>{const blob=new Blob(['<!doctype html>\n'+document.documentElement.outerHTML],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}))})()</script></body></html>`;
}
