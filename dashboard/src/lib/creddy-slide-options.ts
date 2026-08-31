export const CREDDY_EXPRESSIONS = [
  "001-neutral-friendly", "002-happy-waving", "003-happy-smile", "004-joyful-open-smile",
  "005-laughing", "006-delighted", "007-excited", "008-amazed", "009-surprised", "010-shocked",
  "011-curious", "012-confused", "013-puzzled", "014-skeptical", "015-suspicious", "016-doubtful",
  "017-uncertain", "018-worried", "019-anxious", "020-nervous", "021-fearful", "022-terrified",
  "023-sad", "024-very-sad", "025-disappointed", "026-discouraged", "027-lonely", "028-heartbroken",
  "029-about-to-cry", "030-teary-eyed", "031-frustrated", "032-annoyed", "033-irritated", "034-angry",
  "035-furious", "036-grumpy", "037-disgusted", "038-unimpressed", "039-bored", "040-sleepy",
  "041-exhausted", "042-calm", "043-peaceful", "044-relaxed", "045-relieved", "046-grateful",
  "047-proud", "048-confident", "049-confident-wink", "050-playful-wink", "051-mischievous",
  "052-cheeky", "053-embarrassed", "054-shy", "055-bashful-happy", "056-apologetic", "057-guilty",
  "058-ashamed", "059-pleading", "060-hopeful", "061-inspired", "062-determined", "063-focused",
  "064-serious", "065-concerned", "066-cautious", "067-alert", "068-urgent", "069-startled",
  "070-overwhelmed", "071-stressed", "072-panicked", "073-confused-side-eye", "074-thinking-left",
  "075-thinking-right", "076-looking-up-hopeful", "077-looking-down-sad", "078-dreamy",
  "079-starstruck", "080-lovestruck", "081-eager", "082-rewards-excited", "083-sleepy-yawn",
  "084-big-yawn", "085-sighing", "086-relieved-smile", "087-proud-smile", "088-gentle-smile",
  "089-warm-smile", "090-big-grin", "091-toothy-grin", "092-silly-tongue", "093-surprised-smile",
  "094-awkward-smile", "095-nervous-smile", "096-concerned-frown", "097-tiny-frown", "098-pout",
  "099-kissy-face", "100-celebratory-face",
] as const;

export const CREDDY_EXPRESSION_FILES = Object.fromEntries(
  CREDDY_EXPRESSIONS.map((name) => [name, `${name}.png`]),
) as Record<(typeof CREDDY_EXPRESSIONS)[number], string>;

export const CREDDY_LEGACY_EXPRESSION_ALIASES: Record<string, CreddyExpression> = {
  neutral: "001-neutral-friendly", waving: "002-happy-waving", thinking: "074-thinking-left",
  confused: "012-confused", idea: "061-inspired", worried: "018-worried", surprised: "009-surprised",
  sleepy: "040-sleepy", starstruck: "079-starstruck", sad: "023-sad", wink: "049-confident-wink",
  card: "063-focused", "thumbs-up": "100-celebratory-face", guide: "003-happy-smile",
  rewards: "082-rewards-excited", celebrate: "100-celebratory-face", curious: "011-curious",
  skeptical: "014-skeptical", pointing: "008-amazed", happy: "089-warm-smile", urgent: "068-urgent",
  excited: "007-excited", concerned: "065-concerned", celebrating: "100-celebratory-face",
  explaining: "003-happy-smile",
};

export const CREDDY_PHONE_TEMPLATE_FILES = {
  wallet_vouchers: "creddy-phone-wallet-vouchers-1080x1440.png",
  spend_goals: "creddy-phone-spend-goals-1080x1440.png",
  app_store_dark: "creddy-phone-app-store-dark-1080x1440.png",
  app_store_light: "creddy-phone-app-store-light-1080x1440.png",
} as const;

export const CREDDY_BACKGROUND_STYLES = ["spotlight", "deep_navy", "forest", "burgundy"] as const;
export const CREDDY_PHONE_TEMPLATES = Object.keys(CREDDY_PHONE_TEMPLATE_FILES) as Array<keyof typeof CREDDY_PHONE_TEMPLATE_FILES>;

export type CreddyExpression = (typeof CREDDY_EXPRESSIONS)[number];
export type CreddyBackgroundStyle = (typeof CREDDY_BACKGROUND_STYLES)[number];
export type CreddyPhoneTemplate = (typeof CREDDY_PHONE_TEMPLATES)[number];

export type CreddySlideEditorScene = {
  text: string;
  supportText: string;
  expression: CreddyExpression;
  backgroundStyle: CreddyBackgroundStyle;
};

export type CreddySlideEditor = {
  scenes: CreddySlideEditorScene[];
  phoneTemplateId: CreddyPhoneTemplate;
  editable: boolean;
  blockedReason?: string;
};
