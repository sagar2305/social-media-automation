/**
 * Typed schemas for the Signup Control admin CMS.
 *
 * Every creator-facing onboarding page is keyed by a slug. The schema for
 * each slug defines the shape of the JSONB blob stored in
 * public.cms_pages.content. Defaults that match the current hard-coded
 * page content live in `./cms-defaults.ts` — the reader in `./cms.ts`
 * falls back to those defaults when a row is missing or fails validation,
 * so the creator pages keep rendering even if the CMS is empty or broken.
 */

import { z } from "zod";

/* ─── Rich primitives (typography, headings, custom blocks) ──────
 * Every new field below is optional so rows saved against the
 * original schemas keep parsing without migration.
 */

export const typographyTokens = z.object({
  /** Semantic heading level — affects screen-reader output AND default size. */
  level: z.enum(["h1", "h2", "h3", "h4"]).optional(),
  /** CSS font-size — accepts any valid value e.g. "2rem", "32px", "1.5em". */
  size: z.string().optional(),
  /** Tailwind-ish weight as numeric string (300-800). Maps to font-weight. */
  weight: z.enum(["300", "400", "500", "600", "700", "800"]).optional(),
  /** Any CSS color: #rrggbb, named, or rgb(). */
  color: z.string().optional(),
  /** CSS font-family — accepts any installed/web font (e.g. "Georgia, serif"). */
  fontFamily: z.string().optional(),
  /** italic / normal. */
  fontStyle: z.enum(["normal", "italic"]).optional(),
  /** Horizontal alignment of the text block. */
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  /** Casing transform. */
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  /** Line height — accepts any CSS value e.g. "1.5", "32px". */
  lineHeight: z.string().optional(),
  /** Letter spacing — accepts any CSS value e.g. "0.05em", "1px". */
  letterSpacing: z.string().optional(),
});
export type TypographyTokens = z.infer<typeof typographyTokens>;

/**
 * Per-text styling map. Keys are dot-joined paths to text fields
 * (e.g. "hero.heading", "faq.items.0.q"). Values are the same
 * typography tokens used by section-level `headingTypography`. Lets
 * admins style ANY individual text element on the page without us
 * having to touch the schema for each field.
 */
export const stylesMap = z.record(z.string(), typographyTokens);
export type StylesMap = z.infer<typeof stylesMap>;

/**
 * Heading value — can be either a plain string (back-compat with
 * the original schemas) or a typed object that carries typography
 * tokens. Use `readHeading()` in the View to normalize both.
 */
export const heading = z.union([
  z.string(),
  z.object({
    text: z.string(),
    typography: typographyTokens.optional(),
  }),
]);
export type Heading = z.infer<typeof heading>;

/** Custom block an admin can add to the end of any page. */
export const customSection = z.object({
  heading: heading,
  /** Markdown supported: **bold**, *italic*, [link](url), - bullets, # H2 etc. */
  body: z.string(),
  /** Optional image URL (anything resolvable by next/image). */
  imageUrl: z.string().optional(),
  /** When true, the View skips this block. */
  hidden: z.boolean().optional(),
});
export type CustomSection = z.infer<typeof customSection>;

/* ─── Brief — /creator/brief ─────────────────────────────────── */

const appListItem = z.object({
  name: z.string(),
  description: z.string(),
});

const appCard = z.object({
  name: z.string(),
  href: z.string(),
  icon: z.string(), // public path or absolute URL
});

const internTile = z.object({
  handle: z.string(),
  youtubeId: z.string(),
  tiktokUrl: z.string(),
});

const panel = z.object({
  heading: z.string(),
  bullets: z.array(z.string()),
});

const faqItem = z.object({
  q: z.string(),
  a: z.string(),
});

const journeyStep = z.object({
  title: z.string(),
  desc: z.string(),
});

/** Every standard section can be hidden + each one's heading can be styled. */
const sectionMeta = {
  hidden: z.boolean().optional(),
  headingTypography: typographyTokens.optional(),
};

export const briefSchema = z.object({
  hero: z.object({
    eyebrow: z.string(),
    heading: z.string(),
    subheading: z.string(),
    ...sectionMeta,
  }),
  briefVideo: z.object({
    heading: z.string(),
    description: z.string(),
    loomEmbedId: z.string(),
    learnHeading: z.string(),
    bullets: z.array(z.string()),
    ...sectionMeta,
  }),
  aboutUs: z.object({
    heading: z.string(),
    intro: z.string(),
    apps: z.array(appListItem),
    closing: z.string(),
    appCards: z.array(appCard),
    ...sectionMeta,
  }),
  internShowcase: z.object({
    heading: z.string(),
    subtitle: z.string(),
    tiles: z.array(internTile),
    ...sectionMeta,
  }),
  internshipDetails: z.object({
    heading: z.string(),
    summary: z.string(),
    panels: z.array(panel),
    ...sectionMeta,
  }),
  whatYoullDo: z.object({
    heading: z.string(),
    columns: z.array(panel),
    ...sectionMeta,
  }),
  internsWeLove: z.object({
    heading: z.string(),
    columns: z.array(panel),
    ...sectionMeta,
  }),
  faq: z.object({
    heading: z.string(),
    subtitle: z.string(),
    items: z.array(faqItem),
    ...sectionMeta,
  }),
  helpBlock: z.object({
    heading: z.string(),
    body: z.string(),
    contactNote: z.string(),
    email: z.string(),
    whatsappUrl: z.string(),
    whatsappLabel: z.string(),
    ...sectionMeta,
  }),
  journey: z.object({
    heading: z.string(),
    subtitle: z.string(),
    steps: z.array(journeyStep),
    finalStep: journeyStep,
    footer: z.string(),
    ...sectionMeta,
  }),
  ctaHero: z.object({
    eyebrow: z.string(),
    heading: z.string(),
    body: z.string(),
    pills: z.array(z.object({
      icon: z.enum(["check", "wallet", "rocket", "sparkles", "clock"]),
      label: z.string(),
    })),
    primaryLabel: z.string(),
    primaryHref: z.string(),
    secondaryText: z.string(),
    secondaryLinkLabel: z.string(),
    secondaryHref: z.string(),
    footnote: z.string(),
    ...sectionMeta,
  }),
  gotQuestions: z.object({
    heading: z.string(),
    subtitle: z.string(),
    email: z.string(),
    whatsappUrl: z.string(),
    whatsappLabel: z.string(),
    footnote: z.string(),
    ...sectionMeta,
  }),
  footer: z.object({
    text: z.string(),
    email: z.string(),
    ...sectionMeta,
  }),
  /** Custom admin-defined blocks rendered at the bottom of the page. */
  customSections: z.array(customSection).optional(),
  /** Per-text styling map — keyed by dot-joined path (e.g. "hero.heading"). */
  styles: stylesMap.optional(),
});

/* ─── TikTok Setup — /creator/setup/tiktok ───────────────────── */

const videoLink = z.object({
  label: z.string(),
  url: z.string(),
});

const downloadLink = z.object({
  label: z.string(),
  url: z.string(),
  platform: z.enum(["android", "ios", "apk"]),
});

const section = z.object({
  heading: z.string(),
  platform: z.enum(["ios", "android", ""]).default(""),
  videos: z.array(videoLink).default([]),
  downloads: z.array(downloadLink).default([]),
});

const callout = z.object({
  kind: z.enum(["warning", "note"]),
  title: z.string(),
  body: z.string(),
});

export const tiktokStepIcon = z.enum([
  "globe",
  "mail",
  "smartphone",
  "user-plus",
  "settings",
  "arrow-right-circle",
]);
export type TiktokStepIcon = z.infer<typeof tiktokStepIcon>;

const tiktokStep = z.object({
  icon: tiktokStepIcon,
  title: z.string(),
  badge: z.string().default(""),
  description: z.string(),
  callouts: z.array(callout).default([]),
  videos: z.array(videoLink).default([]),
  downloads: z.array(downloadLink).default([]),
  sections: z.array(section).default([]),
  instructions: z.array(z.string()),
});

export const tiktokSetupSchema = z.object({
  header: z.object({
    brandTitle: z.string(),
    productLine: z.string(),
    backLinkLabel: z.string(),
    ...sectionMeta,
  }),
  hero: z.object({
    eyebrow: z.string(),
    heading: z.string(),
    description: z.string(),
    ...sectionMeta,
  }),
  progressCard: z.object({
    heading: z.string(),
    helperBanner: z.string(),
    ...sectionMeta,
  }),
  steps: z.array(tiktokStep),
  finalFooter: z.object({
    heading: z.string(),
    completeApp: z.object({
      heading: z.string(),
      body: z.string(),
      signUpLabel: z.string(),
      signUpHref: z.string(),
    }),
    needHelp: z.object({
      heading: z.string(),
      body: z.string(),
      email: z.string(),
      emailLabel: z.string(),
      whatsappUrl: z.string(),
      whatsappLabel: z.string(),
    }),
    ...sectionMeta,
  }),
  customSections: z.array(customSection).optional(),
  /** Per-text styling map — keyed by dot-joined path (e.g. "hero.heading"). */
  styles: stylesMap.optional(),
});

/* ─── Welcome — /welcome ─────────────────────────────────────── */

export const welcomeSchema = z.object({
  hero: z.object({
    title: z.string(),
    subtitle: z.string(),
    ...sectionMeta,
  }),
  creatorCard: z.object({
    title: z.string(),
    body: z.string(),
    eyebrow: z.string(),
    href: z.string(),
    ...sectionMeta,
  }),
  staffCard: z.object({
    title: z.string(),
    body: z.string(),
    eyebrow: z.string(),
    href: z.string(),
    ...sectionMeta,
  }),
  footnote: z.string(),
  customSections: z.array(customSection).optional(),
  /** Per-text styling map — keyed by dot-joined path (e.g. "hero.heading"). */
  styles: stylesMap.optional(),
});

/* ─── Auth Form — /creator/login & /creator/signup ───────────── */

export const authFormSchema = z.object({
  backLink: z.string(),
  hero: z.object({
    heading: z.string(),
    subheading: z.string(),
    badge: z.string(),
    ...sectionMeta,
  }),
  tabs: z.object({
    signIn: z.string(),
    signUp: z.string(),
  }),
  signIn: z.object({
    emailLabel: z.string(),
    emailPlaceholder: z.string(),
    passwordLabel: z.string(),
    passwordPlaceholder: z.string(),
    submitIdle: z.string(),
    submitLoading: z.string(),
  }),
  signUp: z.object({
    fullNameLabel: z.string(),
    fullNamePlaceholder: z.string(),
    emailLabel: z.string(),
    emailPlaceholder: z.string(),
    phoneLabel: z.string(),
    phonePlaceholder: z.string(),
    whatsappLabel: z.string(),
    whatsappPlaceholder: z.string(),
    applyingForLabel: z.string(),
    applyingForTeamLabel: z.string(),
    applyingForBody: z.string(),
    applyingForFootnote: z.string(),
    platformsHeading: z.string(),
    platformsHint: z.string(),
    tiktokHint: z.string(),
    dashboardPasswordLabel: z.string(),
    dashboardPasswordPlaceholder: z.string(),
    submitIdle: z.string(),
    submitLoading: z.string(),
    successHeading: z.string(),
    successBodyPrefix: z.string(),
    successBodySuffix: z.string(),
  }),
  customSections: z.array(customSection).optional(),
  /** Per-text styling map — keyed by dot-joined path (e.g. "hero.heading"). */
  styles: stylesMap.optional(),
});

/* ─── Brand theme — /signup-control/<campaign>/campaign-theme ── */

/** Available preset themes. The "custom" entry pairs with an
 *  optional `customColor` hex value so admins can pick any color,
 *  not just the curated palette. New presets need a corresponding
 *  `.theme-<name>` class in `globals.css` AND a default entry in
 *  `campaignThemeDefaults` over in cms-defaults.ts. */
export const THEME_PRESETS = ["emerald", "rose", "blue", "amber", "custom"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

/** Per-campaign brand-color picker. The `customColor` hex is only
 *  consumed when `theme === "custom"` — the 4 presets ignore it. */
export const campaignThemeSchema = z.object({
  theme: z.enum(THEME_PRESETS),
  /** #rrggbb hex when theme === "custom". Validated, but optional. */
  customColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color (e.g. #2563eb)")
    .optional(),
});
export type CampaignThemeContent = z.infer<typeof campaignThemeSchema>;

/* ─── Slug registry ──────────────────────────────────────────── */

export const CMS_SLUGS = ["brief", "tiktok-setup", "welcome", "auth-form", "campaign-theme"] as const;
export type CmsSlug = (typeof CMS_SLUGS)[number];

/* ─── Campaign registry ──────────────────────────────────────── */

/**
 * Every creator URL is now keyed by campaign in addition to slug:
 *   /creator/<campaign>/brief, /creator/<campaign>/setup/tiktok, …
 * Admins edit each campaign independently from /signup-control/<campaign>.
 */
export const CAMPAIGNS = ["minutewise", "roastai", "call-recorder"] as const;
export type Campaign = (typeof CAMPAIGNS)[number];

/**
 * Sentinel used in cms_pages.campaign for slugs that are NOT
 * campaign-scoped. Today only `welcome` is shared (it's the chooser
 * shown before any campaign is picked).
 */
export const SHARED_CAMPAIGN = "_shared" as const;

/** Whether a slug stores per-campaign content or a single shared blob. */
export const slugScope: Record<CmsSlug, "campaign" | "shared"> = {
  brief: "campaign",
  "tiktok-setup": "campaign",
  "auth-form": "campaign",
  welcome: "shared",
  "campaign-theme": "campaign",
};

/**
 * Display metadata for the campaign chooser cards (admin + public).
 * The `appIcon` paths point at files committed in
 * `dashboard/public/app-icons/`.
 */
export const campaignMeta: Record<Campaign, {
  label: string;
  description: string;
  appIcon: string;
}> = {
  minutewise: {
    label: "Minutewise",
    description: "AI meeting & lecture summaries",
    appIcon: "/app-icons/minutewise.png",
  },
  roastai: {
    label: "Roast AI",
    description: "Smart texting & conversation assistant",
    appIcon: "/app-icons/roast-ai.png",
  },
  "call-recorder": {
    label: "Call Recorder",
    description: "Call recording & voice-note management",
    appIcon: "/app-icons/call-recorder.png",
  },
};

/**
 * Resolve a campaign string to the actual key used in cms_pages.
 * Shared slugs always read from SHARED_CAMPAIGN regardless of which
 * campaign the caller passed in.
 *
 * Accepts any string so DB-driven campaigns (added via /campaigns/new)
 * work end-to-end. The static `Campaign` literal union and
 * `isCampaign()` narrowing guard remain available for places that
 * specifically want the known-and-typed set (e.g. cms-defaults keys).
 */
export function resolveCampaignKey(slug: CmsSlug, campaign: string): string {
  return slugScope[slug] === "shared" ? SHARED_CAMPAIGN : campaign;
}

/** Narrowing guard — `isCampaign(s)` lets TS treat `s` as `Campaign`. */
export function isCampaign(value: string): value is Campaign {
  return (CAMPAIGNS as readonly string[]).includes(value);
}

export const cmsSchemaBySlug = {
  brief: briefSchema,
  "tiktok-setup": tiktokSetupSchema,
  welcome: welcomeSchema,
  "auth-form": authFormSchema,
  "campaign-theme": campaignThemeSchema,
} as const;

export type BriefContent = z.infer<typeof briefSchema>;
export type TiktokSetupContent = z.infer<typeof tiktokSetupSchema>;
export type WelcomeContent = z.infer<typeof welcomeSchema>;
export type AuthFormContent = z.infer<typeof authFormSchema>;

export type CmsContent = {
  brief: BriefContent;
  "tiktok-setup": TiktokSetupContent;
  welcome: WelcomeContent;
  "auth-form": AuthFormContent;
  "campaign-theme": CampaignThemeContent;
};

export type CmsContentFor<S extends CmsSlug> = CmsContent[S];

/**
 * Human-readable labels used by the admin tile picker and editor headers.
 * Keeping this here (next to the slugs) so the admin UI doesn't drift if
 * we add a new page.
 */
export const cmsPageMeta: Record<CmsSlug, { title: string; description: string; livePath: string }> = {
  brief: {
    title: "Internship Brief",
    description: "The long-scroll brief shown at /creator/brief.",
    livePath: "/creator/brief",
  },
  "tiktok-setup": {
    title: "TikTok Setup Guide",
    description: "The 6-step interactive guide at /creator/setup/tiktok.",
    livePath: "/creator/setup/tiktok",
  },
  welcome: {
    title: "Welcome / Portal Chooser",
    description: "The first screen at /welcome — Creator vs Staff.",
    livePath: "/welcome",
  },
  "auth-form": {
    title: "Login & Signup Form",
    description: "Copy shown on /creator/login and /creator/signup.",
    livePath: "/creator/signup",
  },
  "campaign-theme": {
    title: "Brand Theme",
    description: "Pick the brand color for this campaign's creator-facing pages.",
    livePath: "/creator",
  },
};
