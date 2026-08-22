export const CREDDY_EXPRESSION_FILES = {
  neutral: "01-neutral-friendly.png",
  waving: "02-waving-hello.png",
  thinking: "03-thinking.png",
  confused: "04-confused.png",
  idea: "17-aha-idea.png",
  worried: "12-worried.png",
  surprised: "07-surprised.png",
  sleepy: "08-sleepy.png",
  starstruck: "14-rewards-excited.png",
  sad: "11-sad.png",
  wink: "09-confident-wink.png",
  card: "13-card-approval.png",
  "thumbs-up": "10-thumbs-up.png",
  guide: "06-presenting.png",
  rewards: "14-rewards-excited.png",
  celebrate: "05-celebrating.png",
  curious: "15-listening-curious.png",
  skeptical: "16-skeptical.png",
  pointing: "18-pointing-left.png",
  happy: "19-happy-laughing.png",
  urgent: "20-urgent-stop.png",
} as const;

export const CREDDY_PHONE_TEMPLATE_FILES = {
  wallet_vouchers: "creddy-phone-wallet-vouchers-1080x1440.png",
  spend_goals: "creddy-phone-spend-goals-1080x1440.png",
  app_store_dark: "creddy-phone-app-store-dark-1080x1440.png",
  app_store_light: "creddy-phone-app-store-light-1080x1440.png",
} as const;

export const CREDDY_EXPRESSIONS = Object.keys(CREDDY_EXPRESSION_FILES) as Array<keyof typeof CREDDY_EXPRESSION_FILES>;
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
