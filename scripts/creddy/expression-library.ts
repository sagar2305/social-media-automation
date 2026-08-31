/** Approved 3:4 Creddy v4 emotion-and-gesture assets. */
export const CREDDY_V4_EXPRESSION_NAMES = [
  '001-neutral-friendly', '002-happy-waving', '003-happy-smile', '004-joyful-open-smile',
  '005-laughing', '006-delighted', '007-excited', '008-amazed', '009-surprised', '010-shocked',
  '011-curious', '012-confused', '013-puzzled', '014-skeptical', '015-suspicious', '016-doubtful',
  '017-uncertain', '018-worried', '019-anxious', '020-nervous', '021-fearful', '022-terrified',
  '023-sad', '024-very-sad', '025-disappointed', '026-discouraged', '027-lonely', '028-heartbroken',
  '029-about-to-cry', '030-teary-eyed', '031-frustrated', '032-annoyed', '033-irritated', '034-angry',
  '035-furious', '036-grumpy', '037-disgusted', '038-unimpressed', '039-bored', '040-sleepy',
  '041-exhausted', '042-calm', '043-peaceful', '044-relaxed', '045-relieved', '046-grateful',
  '047-proud', '048-confident', '049-confident-wink', '050-playful-wink', '051-mischievous',
  '052-cheeky', '053-embarrassed', '054-shy', '055-bashful-happy', '056-apologetic', '057-guilty',
  '058-ashamed', '059-pleading', '060-hopeful', '061-inspired', '062-determined', '063-focused',
  '064-serious', '065-concerned', '066-cautious', '067-alert', '068-urgent', '069-startled',
  '070-overwhelmed', '071-stressed', '072-panicked', '073-confused-side-eye', '074-thinking-left',
  '075-thinking-right', '076-looking-up-hopeful', '077-looking-down-sad', '078-dreamy',
  '079-starstruck', '080-lovestruck', '081-eager', '082-rewards-excited', '083-sleepy-yawn',
  '084-big-yawn', '085-sighing', '086-relieved-smile', '087-proud-smile', '088-gentle-smile',
  '089-warm-smile', '090-big-grin', '091-toothy-grin', '092-silly-tongue', '093-surprised-smile',
  '094-awkward-smile', '095-nervous-smile', '096-concerned-frown', '097-tiny-frown', '098-pout',
  '099-kissy-face', '100-celebratory-face',
] as const;

export type CreddyV4Expression = (typeof CREDDY_V4_EXPRESSION_NAMES)[number];

export const CREDDY_V4_EXPRESSION_FILES = Object.fromEntries(
  CREDDY_V4_EXPRESSION_NAMES.map((name) => [name, `${name}.png`]),
) as Record<CreddyV4Expression, string>;

/** Old plans stay readable while new Agent 5 plans use precise v4 emotion IDs. */
export const CREDDY_LEGACY_EXPRESSION_ALIASES = {
  neutral: '001-neutral-friendly', waving: '002-happy-waving', thinking: '074-thinking-left',
  confused: '012-confused', idea: '061-inspired', worried: '018-worried', surprised: '009-surprised',
  sleepy: '040-sleepy', starstruck: '079-starstruck', sad: '023-sad', wink: '049-confident-wink',
  card: '063-focused', 'thumbs-up': '100-celebratory-face', guide: '003-happy-smile',
  rewards: '082-rewards-excited', celebrate: '100-celebratory-face', curious: '011-curious',
  skeptical: '014-skeptical', pointing: '008-amazed', happy: '089-warm-smile', urgent: '068-urgent',
  excited: '007-excited', concerned: '065-concerned', celebrating: '100-celebratory-face',
  explaining: '003-happy-smile',
} as const satisfies Record<string, CreddyV4Expression>;

export type CreddyLegacyExpression = keyof typeof CREDDY_LEGACY_EXPRESSION_ALIASES;

/** Exact pre-v4 filenames are accepted only when validating already-rendered manifests. */
export const CREDDY_LEGACY_TEMPLATE_FILES: Partial<Record<CreddyLegacyExpression, string>> = {
  neutral: '01-neutral-friendly.png', waving: '02-waving-hello.png', thinking: '03-thinking.png',
  confused: '04-confused.png', celebrate: '05-celebrating.png', guide: '06-presenting.png',
  surprised: '07-surprised.png', sleepy: '08-sleepy.png', wink: '09-confident-wink.png',
  'thumbs-up': '10-thumbs-up.png', sad: '11-sad.png', worried: '12-worried.png',
  card: '13-card-approval.png', rewards: '14-rewards-excited.png', curious: '15-listening-curious.png',
  starstruck: '14-rewards-excited.png', skeptical: '16-skeptical.png', idea: '17-aha-idea.png',
  pointing: '18-pointing-left.png', happy: '19-happy-laughing.png', urgent: '20-urgent-stop.png',
};

export const CREDDY_APPROVED_EXPRESSIONS = new Set<string>([
  ...CREDDY_V4_EXPRESSION_NAMES,
  ...Object.keys(CREDDY_LEGACY_EXPRESSION_ALIASES),
]);

export function creddyExpressionFile(expression: string): string | undefined {
  const canonical = (CREDDY_LEGACY_EXPRESSION_ALIASES as Record<string, CreddyV4Expression>)[expression]
    ?? (CREDDY_APPROVED_EXPRESSIONS.has(expression) ? expression as CreddyV4Expression : undefined);
  return canonical ? CREDDY_V4_EXPRESSION_FILES[canonical] : undefined;
}
