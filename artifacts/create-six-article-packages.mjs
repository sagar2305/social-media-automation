import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const createdAt = '2026-08-25T11:30:00.000Z';
const disclosure = "Advertiser disclosure: Creddy may earn a commission when you apply for a card through links on this site. This does not affect our recommendations, which are based on the published value of each card's benefits.";
const iosUrl = 'https://apps.apple.com/app/id6768603911?ct=web_discovery';
const androidUrl = 'https://play.google.com/store/apps/details?id=com.thebrewapps.creddy';

const topics = [
  {
    analysisId: 'ranking-36c7c0b604db3d0d10312554', canonicalId: '36c7c0b604db3d0d10312554',
    title: 'How Marriott Bonvoy Brilliant Elite Benefits Work', slug: 'marriott-bonvoy-brilliant-elite-benefits', category: 'benefits',
    audience: 'US Marriott travelers evaluating premium card benefits', subject: 'Marriott Bonvoy Brilliant elite benefits',
    dek: 'A practical guide to separating automatic Platinum status, annual elite-night credits, authorized-user limits, and the value you may actually use.',
    sourceUrl: 'https://onemileatatime.com/guides/marriott-bonvoy-brilliant-card-platinum-elite-status',
    claims: [
      { field: 'automatic_status', value: 'Basic cardmembers are reported to receive Marriott Bonvoy Platinum Elite status while holding the card', sourceRecordIds: ['799b0c141a66cf91981f46a3'], confidence: 79 },
      { field: 'elite_night_credits', value: 25, sourceRecordIds: ['799b0c141a66cf91981f46a3'], confidence: 79 },
      { field: 'authorized_users', value: 'Automatic Platinum Elite status is reported as unavailable to authorized users', sourceRecordIds: ['799b0c141a66cf91981f46a3'], confidence: 77 },
    ],
    claimSummary: 'The accepted source reports automatic Platinum Elite status for the basic cardmember, 25 annual elite-night credits, and no automatic status for authorized users.',
    decision: 'whether the benefits you will naturally use justify keeping or applying for a premium hotel card',
    verify: 'current issuer terms, Marriott account-linking instructions, posting timelines, eligible-cardmember rules, and the benefits available at properties you expect to visit',
    heroScene: 'premium hotel travel planning desk with a brass room key, blank status card, calendar, luggage tag, and twenty-five small night markers',
    detailScene: 'two separate groups representing automatic status and annual elite-night progress using a room key, calendar, and twenty-five tactile markers',
    trackerScene: 'hotel-benefit review desk with blank ledger cards, annual-fee envelope, stay calendar, and benefit-use tokens',
  },
  {
    analysisId: 'ranking-5befbe27eb8a94b98257e984', canonicalId: '5befbe27eb8a94b98257e984',
    title: 'How to Use JetBlue TrueBlue for Real Travel', slug: 'jetblue-trueblue-practical-guide', category: 'points_and_miles',
    audience: 'US travelers earning or redeeming JetBlue TrueBlue points', subject: 'JetBlue TrueBlue',
    dek: 'A trip-first framework for earning points, comparing award bookings, understanding Mosaic benefits, and checking the rules that affect flexibility.',
    sourceUrl: 'https://frequentmiler.com/jetblue-trueblue-guide',
    claims: [
      { field: 'program_scope', value: 'The guide covers TrueBlue earning, redemption, Mosaic benefits, subscriptions, partnerships, and credit cards', sourceRecordIds: ['de28720b68ef9174b3756e2f'], confidence: 79 },
      { field: 'award_flexibility', value: 'The guide reports free changes and cancellations for most JetBlue points bookings except Blue Basic', sourceRecordIds: ['de28720b68ef9174b3756e2f'], confidence: 77 },
      { field: '2026_updates', value: 'The guide says it incorporates 2026 Mosaic changes and updated airline partnerships', sourceRecordIds: ['de28720b68ef9174b3756e2f'], confidence: 78 },
    ],
    claimSummary: 'The accepted source covers earning, redemptions, Mosaic, subscriptions, partnerships, and cards; it also reports flexibility for most points bookings other than Blue Basic and notes 2026 updates.',
    decision: 'which TrueBlue feature helps a trip you are genuinely likely to book',
    verify: 'live award pricing, fare-specific change and cancellation rules, current Mosaic terms, partner availability, and the total taxes and fees shown at checkout',
    heroScene: 'coastal travel planning desk with an abstract route map, blue and warm-gold points tokens, blank boarding folder, and flexible date calendar',
    detailScene: 'cash-versus-points comparison with two balanced token groups, flexible date tabs, and a blank fare-condition card',
    trackerScene: 'monthly airline rewards review with balance tokens, blank status meter, partner route cards, and next-trip calendar',
  },
  {
    analysisId: 'ranking-8407893c1526145efb688c01', canonicalId: '8407893c1526145efb688c01',
    title: 'A Practical Guide to American Airlines AAdvantage', slug: 'american-airlines-aadvantage-practical-guide', category: 'points_and_miles',
    audience: 'US travelers using American Airlines AAdvantage', subject: 'American Airlines AAdvantage',
    dek: 'Learn to separate redeemable miles, Loyalty Points, elite-status progress, partner awards, and card activity before choosing your next move.',
    sourceUrl: 'https://frequentmiler.com/american-airlines-aadvantage-complete-guide',
    claims: [
      { field: 'program_scope', value: 'The 2026 guide covers earning and redeeming miles, Loyalty Points, elite status, partners, and AA credit cards', sourceRecordIds: ['71fef8fbbc7682e41b41ce88'], confidence: 79 },
      { field: 'partner_awards', value: 'The guide reports that AAdvantage retains a fixed partner award chart', sourceRecordIds: ['71fef8fbbc7682e41b41ce88'], confidence: 77 },
      { field: 'status_earning', value: 'The guide reports multiple non-flight paths to earning miles and Loyalty Points', sourceRecordIds: ['71fef8fbbc7682e41b41ce88'], confidence: 77 },
    ],
    claimSummary: 'The accepted source covers miles, Loyalty Points, elite status, partners, and cards; it reports a fixed partner-award chart and multiple non-flight earning paths.',
    decision: 'whether to redeem miles, pursue status, use a partner award, or preserve flexibility',
    verify: 'live award space and pricing, current partner-award rules, Loyalty Point eligibility, elite thresholds, card terms, and any booking fees',
    heroScene: 'airline mileage planning desk with abstract domestic and international routes, two distinct token ledgers for miles and status, and a travel calendar',
    detailScene: 'partner-award planning composition with distance dividers, route cards, points tokens, and an availability marker',
    trackerScene: 'status and redemption review with separate blank ledgers, shopping and flight symbols, calendar, and next-trip marker',
  },
  {
    analysisId: 'ranking-9ec326bba59e1af1d155e0bf', canonicalId: '9ec326bba59e1af1d155e0bf',
    title: 'A Practical Test for Amex Gold Travel Benefits', slug: 'amex-gold-travel-benefits-value-test', category: 'benefits',
    audience: 'US consumers evaluating Amex Gold travel and dining benefits', subject: 'Amex Gold travel and dining benefits',
    dek: 'Use one realistic trip to test airfare earning, dining value, hotel benefits, and the gap between advertised credits and value you can naturally use.',
    sourceUrl: 'https://thepointsguy.com/credit-cards/refreshed-amex-gold-card-perks',
    claims: [
      { field: 'airfare_earning', value: 'The article reports 3 Membership Rewards points per dollar on airfare booked directly with airlines or through eligible Amex channels.', sourceRecordIds: ['3a5cf647f3757e473a33372d'], confidence: 74 },
      { field: 'hotel_collection_benefit', value: 'The article reports a $100 eligible on-property credit on qualifying prepaid two-night Hotel Collection stays booked through eligible Amex channels.', sourceRecordIds: ['3a5cf647f3757e473a33372d'], confidence: 74 },
    ],
    claimSummary: 'The accepted sponsored source reports 3 Membership Rewards points per dollar on eligible airfare and a $100 eligible on-property credit on qualifying prepaid two-night Hotel Collection stays.',
    decision: 'how much of the published benefit package fits spending and trips you would make without changing your behavior',
    verify: 'current issuer terms, eligible booking channels, merchant coding, stay requirements, excluded charges, enrollment requirements, and the annual fee',
    heroScene: 'realistic dining and travel planning table with restaurant receipt holder, flight itinerary folder, two-night hotel calendar, and restrained gold points tokens',
    detailScene: 'trip-value comparison with airfare tokens, two hotel-night markers, dining envelope, and a blank out-of-pocket ledger',
    trackerScene: 'annual benefit-use review with blank monthly cards, restaurant and hotel markers, fee envelope, and naturally used versus unused token groups',
  },
  {
    analysisId: 'ranking-d34933142b4275e97022e8c1', canonicalId: 'd34933142b4275e97022e8c1',
    title: 'Check Hotel Fees Before Transferring Amex Points', slug: 'check-hotel-fees-before-amex-transfer', category: 'points_and_miles',
    audience: 'US Membership Rewards users considering Leaders Club transfers', subject: 'Amex points transfers to Leaders Club',
    dek: 'A verification-first method for estimating property taxes and fees, comparing the cash rate, and deciding whether a transfer supports the stay you want.',
    sourceUrl: 'https://thepointsguy.com/loyalty-programs/taxes-and-fees-leading-hotels-of-the-world',
    claims: [
      { field: 'transfer_ratio', value: '4 Membership Rewards points to 1 Leaders Club point', sourceRecordIds: ['c5aecba28de6ccebfdfdd8bb'], confidence: 76 },
      { field: 'award_fees', value: 'Leaders Club award stays may require property-specific taxes and fees', sourceRecordIds: ['c5aecba28de6ccebfdfdd8bb'], confidence: 77 },
      { field: 'estimation_method', value: 'The guide recommends checking taxes and fees on the standard or best-available refundable cash rate before transferring points', sourceRecordIds: ['c5aecba28de6ccebfdfdd8bb'], confidence: 76 },
    ],
    claimSummary: 'The accepted source reports a 4-to-1 Membership Rewards transfer ratio, property-specific taxes and fees on some award stays, and a cash-rate method for estimating those charges.',
    decision: 'whether the points transfer still makes sense after adding property-specific cash charges and comparing alternatives',
    verify: 'live award availability, the current transfer ratio, property-specific taxes and fees, refundable cash-rate details, cancellation rules, and whether transfers are reversible',
    heroScene: 'luxury hotel booking desk with four small source tokens leading to one destination token, a room key, cash-fee envelope, and refundable-rate calendar',
    detailScene: 'four-to-one transfer funnel represented by tactile tokens beside a hotel key and a separate cash-fee tray',
    trackerScene: 'pre-transfer checklist with blank award availability card, refundable-rate folder, taxes envelope, cancellation marker, and final decision token',
  },
  {
    analysisId: 'ranking-ec11a5add69f05fa28f4354b', canonicalId: 'ec11a5add69f05fa28f4354b',
    title: 'How to Approach Atmos Rewards in 2026', slug: 'atmos-rewards-2026-practical-guide', category: 'points_and_miles',
    audience: 'US Alaska and Hawaiian Airlines loyalty-program travelers', subject: 'Atmos Rewards',
    dek: 'A practical framework for the combined Alaska–Hawaiian program, including earning choices, partners, status progress, cards, and features still rolling out.',
    sourceUrl: 'https://frequentmiler.com/alaska-air-mileage-plan-complete-guide',
    claims: [
      { field: 'program_identity', value: 'Atmos Rewards is the combined loyalty program for Alaska Airlines and Hawaiian Airlines', sourceRecordIds: ['9f5d8b8f60e529496be7a60b'], confidence: 79 },
      { field: 'guide_scope', value: 'The guide covers updated benefits, earning methods, award partners, cards, and elite-status thresholds', sourceRecordIds: ['9f5d8b8f60e529496be7a60b'], confidence: 78 },
      { field: 'rollout_status', value: 'The guide says some new features will continue to roll out during 2026', sourceRecordIds: ['9f5d8b8f60e529496be7a60b'], confidence: 78 },
    ],
    claimSummary: 'The accepted source describes Atmos Rewards as the combined Alaska–Hawaiian program, covers earning, partners, cards, benefits, and status, and says some features will continue rolling out in 2026.',
    decision: 'which current program feature supports an actual trip while the combined program continues to evolve',
    verify: 'current official program terms, live partner availability, status thresholds, earning eligibility, card benefits, and whether a feature has fully launched for your account',
    heroScene: 'Pacific travel planning desk with two route-map layers joining into one network, ocean-blue and warm-gold tokens, partner cards, and 2026 calendar tabs without text',
    detailScene: 'combined-program decision map with two route strands joining, separate redeemable and status tokens, partner markers, and a rollout calendar',
    trackerScene: '2026 program review desk with blank feature cards sorted into available, verify, and later groups, plus a next-trip marker',
  },
];

function paragraph(topic, purpose) {
  const common = {
    trip: `Start with a trip you can describe in concrete terms: the travelers, likely dates, route or property, acceptable cash budget, and the flexibility you need. Then decide which part of ${topic.subject} can help. ${topic.claimSummary} Those facts are useful inputs, but they are not a personal recommendation. A broad program guide can make every feature look equally important even though most readers need only a small part of the system. Write down the outcome you want before looking at a points balance, status meter, or card benefit. Price the trip using live information and preserve a screenshot or note of the date checked. This creates a baseline that is grounded in a real booking rather than an abstract desire to maximize everything.`,
    separate: `Published program rules and personal value answer different questions. The accepted evidence describes what the source reports; your decision depends on how those rules interact with your account and travel. Separate redeemable value, qualification progress, recurring benefits, one-time offers, and cash costs into different lines. Do not combine them into one optimistic total. A benefit should count only when you expect to use it naturally, under conditions you can meet, for a purchase or trip you would otherwise make. Treat uncertain availability as uncertain, and do not assign full value to a feature that requires changed behavior. This separation makes it easier to see whether ${topic.decision}.`,
    value: `Use a conservative value test. First calculate the cash you would otherwise pay for the same trip or benefit. Then subtract unavoidable taxes, fees, annual costs, positioning travel, or extra purchases. Next account for flexibility: cancellation rules, transfer finality, expiration, availability, and the possibility that your plans change. Finally, compare the result with the best realistic alternative, including doing nothing. Avoid using a best-case redemption or a perfect benefit year as the default assumption. A smaller value you can repeat is more decision-useful than a large theoretical number. If the conclusion changes when one assumption moves slightly, mark the decision as sensitive and verify again immediately before acting.`,
    verify: `Before acting, verify ${topic.verify}. This article uses a single accepted secondary source, so program-specific details should be checked against current official terms. Record what you verified, the date, and where it appeared. If a rule affects a transfer, application, cancellation, or large purchase, save the relevant official page before proceeding. Also check your own account because targeted eligibility and rollout timing may differ. When a source and an official page conflict, stop and resolve the difference rather than choosing the more attractive version. A short verification habit protects more value than chasing an extra fraction of a point while relying on an outdated rule.`,
    review: `After the trip or statement closes, compare expected value with what actually happened. Note what posted correctly, which benefit required extra effort, what remained unused, and whether support or booking friction changed the result. Keep this review short and factual. The purpose is not to defend an earlier choice; it is to improve the next one. Revisit ${topic.subject} only when a meaningful input changes: a real trip appears, official terms change, a renewal date approaches, or a balance becomes large enough to use. This cadence reduces promotion-driven decisions and keeps the rewards plan connected to ordinary finances and travel priorities.`,
  };
  return common[purpose];
}

function createDraft(topic) {
  const claimFields = topic.claims.map((claim) => claim.field);
  const heroId = `${topic.slug}-hero`;
  const decisionId = `${topic.slug}-decision`;
  const trackerId = `${topic.slug}-tracker`;
  return {
    version: 1, distributionMode: 'article_only', copyVersion: 'creddy-copy-v3',
    id: `copy-${topic.analysisId}`, analysisId: topic.analysisId, canonicalId: topic.canonicalId, createdAt,
    audience: topic.audience, slot: 'understand', hook: topic.title,
    textScenes: [], narrationScript: '', instagramCaption: '', tiktokCaption: '', hashtags: [],
    cta: { label: 'Organize your rewards in Creddy', deepLink: 'creddy://home' },
    brief: `Evergreen, verification-aware article about ${topic.subject}; no social post or slideshow output.`,
    sourceUrls: [topic.sourceUrl], factualClaims: topic.claims,
    article: {
      version: 'creddy-article-v1', designVersion: 'creddy-guides-v1', id: `article-${topic.analysisId}`,
      slug: topic.slug, category: topic.category, title: topic.title, dek: topic.dek,
      excerpt: `Use a trip-first, verification-aware framework to understand ${topic.subject}, compare realistic value, and avoid acting on a headline alone.`,
      seoTitle: `${topic.title} — Creddy`,
      seoDescription: 'Learn how to evaluate rewards and card benefits with a real-trip value test, current-rule verification, practical comparisons, and a review checklist.',
      authorName: 'Creddy Editorial', createdAt, updatedAt: createdAt, readingMinutes: 7,
      heroVisualId: heroId, sourceUrls: [topic.sourceUrl], referralDisclosure: disclosure,
      blocks: [
        { id: 'hero-visual', type: 'visual', visualId: heroId, caption: `A trip-first planning view of ${topic.subject}.` },
        { id: 'key-takeaways', type: 'key_takeaways', title: `What matters before using ${topic.subject}`, items: [topic.claimSummary, 'Separate published program rules from the value you can realistically use.', 'Verify current official terms and live booking details immediately before acting.'], claimFields },
        { id: 'start-with-real-trip', type: 'heading', level: 2, text: 'Start with one real trip' },
        { id: 'start-with-real-trip-body', type: 'paragraph', text: paragraph(topic, 'trip'), claimFields },
        { id: 'trip-first-tip', type: 'callout', tone: 'tip', title: 'Use one realistic test case', body: 'Compare the complete cash and rewards outcomes for the same dates, travelers, and conditions before changing spending or moving points.', claimFields: [] },
        { id: 'decision-visual', type: 'visual', visualId: decisionId, caption: `A practical decision view for ${topic.subject}.` },
        { id: 'separate-rules-value', type: 'heading', level: 2, text: 'Separate rules from personal value' },
        { id: 'separate-rules-value-body', type: 'paragraph', text: paragraph(topic, 'separate'), claimFields },
        { id: 'use-conservative-test', type: 'heading', level: 2, text: 'Use a conservative value test' },
        { id: 'use-conservative-test-body', type: 'paragraph', text: paragraph(topic, 'value'), claimFields: [] },
        { id: 'decision-table', type: 'comparison_table', caption: 'Four decisions to make with current evidence instead of assumptions.', columns: ['Decision', 'Question', 'Check now'], rows: [
          ['Use the benefit', 'Would I make this purchase or trip anyway?', 'Eligibility, timing, and total cash cost'],
          ['Redeem or transfer', 'Is the exact booking available at an acceptable total price?', 'Live space, fees, cancellation, and transfer rules'],
          ['Pursue status', 'Will the resulting benefits improve trips already planned?', 'Current progress, threshold, deadline, and expected use'],
          ['Wait', 'Does keeping flexibility create a stronger option?', 'Alternative bookings, future plans, and opportunity cost'],
        ], claimFields: [] },
        { id: 'verify-before-action', type: 'heading', level: 2, text: 'Verify the rule that can change the decision' },
        { id: 'verify-before-action-body', type: 'paragraph', text: paragraph(topic, 'verify'), claimFields },
        { id: 'verification-warning', type: 'callout', tone: 'warning', title: 'Single-source evidence needs a final check', body: 'Confirm every material program-specific detail in current official terms and in your own account before transferring points, applying, cancelling, or redirecting major spending.', claimFields },
        { id: 'tracker-visual', type: 'visual', visualId: trackerId, caption: `A compact verification and follow-up system for ${topic.subject}.` },
        { id: 'review-real-result', type: 'heading', level: 2, text: 'Review the result, not the promise' },
        { id: 'review-real-result-body', type: 'paragraph', text: paragraph(topic, 'review'), claimFields: [] },
        { id: 'faq', type: 'faq', items: [
          { question: `What does the accepted source establish about ${topic.subject}?`, answer: `${topic.claimSummary} Verify the current official terms because the pipeline currently has one accepted secondary source.`, claimFields },
          { question: 'Should I value every listed benefit at face value?', answer: 'No. Count only value you expect to use naturally after unavoidable cash costs, restrictions, and the value of alternatives.', claimFields: [] },
          { question: 'When should I verify the rules?', answer: 'Verify immediately before a transfer, application, cancellation, large purchase, or booking because terms, availability, and account eligibility can change.', claimFields: [] },
          { question: 'What should I track afterward?', answer: 'Record what posted, what you used, the cash you paid, any friction, and whether the outcome matched the reason you acted.', claimFields: [] },
        ] },
        { id: 'subscribe', type: 'subscribe', title: 'Get practical Creddy guides', body: 'Receive clear credit-card, points, and benefits guidance built around decisions you can actually use.', consentLabel: 'I agree to receive Creddy editorial emails and can unsubscribe at any time.' },
        { id: 'download', type: 'download', title: 'Keep your rewards plan visible', body: 'Use Creddy to organize benefits, balances, verification dates, and the next decision connected to your travel.', iosUrl, androidUrl },
      ],
    },
  };
}

function createVisualPlan(topic) {
  const draft = createDraft(topic);
  const ids = [`${topic.slug}-hero`, `${topic.slug}-decision`, `${topic.slug}-tracker`];
  const scenes = [topic.heroScene, topic.detailScene, topic.trackerScene];
  const blockIds = ['hero-visual', 'decision-visual', 'tracker-visual'];
  const usages = ['hero', 'comparison', 'inline'];
  return {
    version: 1, distributionMode: 'article_only', id: `visual-copy-${topic.analysisId}`,
    contentDraftId: draft.id, analysisId: topic.analysisId, canonicalId: topic.canonicalId, createdAt,
    format: 'article', theme: 'editorial', characterPack: 'credit-card-rewards/creddy',
    cover: { headline: topic.title, subheadline: topic.dek.slice(0, 120) }, scenes: [],
    visualBrief: 'Natural premium editorial photography with warm cream surfaces, restrained gold and coral accents, real material texture, believable imperfections, and no social scenes.',
    safetyOverlays: [], sourceUrls: draft.sourceUrls, factualClaims: draft.factualClaims,
    articleVisuals: {
      version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1',
      assets: ids.map((id, index) => ({
        id, usage: usages[index], articleBlockId: blockIds[index], assetType: 'editorial_illustration',
        aspectRatio: index === 0 ? '16:9' : '4:3', generationMode: 'generate',
        prompt: `Highly realistic premium editorial photograph of ${scenes[index]}, arranged on a warm cream surface with restrained gold, charcoal, coral, and topic-appropriate muted accents, natural window light, tactile paper and metal textures, believable human imperfections, clean hierarchy, and generous margins.`,
        negativePrompt: 'No text, no logos, no watermarks, no airline or hotel branding, no bank-card artwork, no product interface, no people, no duplicate objects, no distorted geometry, and no glossy synthetic advertising look.',
        altText: index === 0 ? `Travel-planning materials representing ${topic.subject}` : index === 1 ? `Tactile comparison materials for a ${topic.subject} decision` : `Blank tracking materials for reviewing ${topic.subject}`,
        caption: index === 0 ? `A practical overview of ${topic.subject}.` : index === 1 ? `Compare the decision using current evidence and a real trip.` : `Track verification, expected value, and the result together.`,
        claimFields: index === 0 ? draft.factualClaims.map((claim) => claim.field) : [],
      })),
    },
  };
}

await mkdir('artifacts/article-batch', { recursive: true });
for (const topic of topics) {
  await writeFile(join('artifacts/article-batch', `${topic.slug}-draft.json`), `${JSON.stringify(createDraft(topic), null, 2)}\n`);
  await writeFile(join('artifacts/article-batch', `${topic.slug}-visual.json`), `${JSON.stringify(createVisualPlan(topic), null, 2)}\n`);
}
console.log(JSON.stringify(topics.map(({ title, slug, analysisId }) => ({ title, slug, analysisId })), null, 2));
