/**
 * Defaults for every CMS-driven page. These mirror the current
 * hard-coded content on the creator-facing routes so that the pages
 * render byte-identically when no admin has saved content yet (or when
 * a row is missing / malformed). Editing this file effectively bumps
 * the "factory reset" content used as a fallback.
 */

import type {
  BriefContent,
  TiktokSetupContent,
  WelcomeContent,
  AuthFormContent,
  CmsContent,
} from "./cms-schemas";

export const briefDefault: BriefContent = {
  hero: {
    eyebrow: "BrewApps Slideshow Internship",
    heading: "BrewApps Slideshow Internship",
    subheading:
      "Thanks for your interest in taking on this project! We are looking forward to the opportunity to collaborate and see the amazing content that you create!",
  },
  briefVideo: {
    heading: "Internship Brief Video",
    description:
      "Watch this comprehensive video to understand the internship program, expectations, and get started with your journey.",
    loomEmbedId: "3f160c01f93c45dbb9f464bf0b8f45d3",
    learnHeading: "What you'll learn in this video:",
    bullets: [
      "Complete overview of the internship program and expectations",
      "Step-by-step guide to getting started with TikTok account setup",
      "Understanding the compensation structure and performance metrics",
      "How to use our internal tools for content creation",
      "Tips for success and best practices from our team",
    ],
  },
  aboutUs: {
    heading: "About Us",
    intro:
      "BrewApps is a mobile app development studio that owns and builds multiple apps focused on smart, intuitive, and AI-powered tools that simplify everyday life. Some of our apps include:",
    apps: [
      { name: "Minutewise", description: "– AI meeting and lecture summaries" },
      { name: "Roast AI", description: "– Smart texting and conversation assistant" },
      { name: "EZTape", description: "– Call recording and voice-note management" },
    ],
    closing:
      "These are just a few of the apps we've built, and we continue to expand our portfolio with new, innovative solutions.",
    appCards: [
      {
        name: "Minutewise",
        href: "https://apps.apple.com/app/id6739527717",
        icon: "/app-icons/minutewise.png",
      },
      {
        name: "Call Recorder",
        href: "https://apps.apple.com/in/app/call-recording-app-for-iphone/id1512476140",
        icon: "/app-icons/call-recorder.png",
      },
      {
        name: "Roast AI",
        href: "https://apps.apple.com/in/app/roast-ai-texting-assistant/id6737178219",
        icon: "/app-icons/roast-ai.png",
      },
    ],
  },
  internShowcase: {
    heading: "Impactful Work by Our Interns",
    subtitle: "Showcasing intern work seen by millions",
    tiles: [
      {
        handle: "@miniutewise_thomas",
        youtubeId: "a4u006u3nXc",
        tiktokUrl: "https://www.tiktok.com/@miniutewise_thomas/photo/7531069420211309844",
      },
      {
        handle: "@studybae_ai",
        youtubeId: "SVbQiLROuUg",
        tiktokUrl: "https://www.tiktok.com/@studybae_ai/photo/7515481851264322834",
      },
      {
        handle: "@studybae_ai",
        youtubeId: "7z5pKhNG25w",
        tiktokUrl: "https://www.tiktok.com/@studybae_ai/photo/7516944029779512583",
      },
      {
        handle: "@studybae_ai",
        youtubeId: "kJ6FVXGbk20",
        tiktokUrl: "https://www.tiktok.com/@studybae_ai/photo/7512187048825048327",
      },
    ],
  },
  internshipDetails: {
    heading: "Slideshow Internship Details",
    summary:
      "As part of this internship, you'll use our internal tool to create slideshows (sequences of images) and post them on TikTok daily.",
    panels: [
      {
        heading: "Duration & Commitment",
        bullets: [
          "Initially 1 month (extendable based on performance)",
          "30-40 minutes daily commitment",
          "Flexible schedule — create content daily or in bulk",
        ],
      },
      {
        heading: "Compensation Structure",
        bullets: [
          "Performance-based: ₹20 CPM (₹20 per 1,000 views)",
          "100,000 views = ₹2,000 | 500,000 views = ₹10,000",
          "1,000,000 views = ₹20,000",
          "Monthly earnings capped at ₹40,000",
          "Top performers get fixed stipend + performance bonuses",
        ],
      },
    ],
  },
  whatYoullDo: {
    heading: "What You'll Do",
    columns: [
      {
        heading: "Daily Tasks",
        bullets: [
          "Use internal tools to recreate slideshows",
          "Post 3 slideshows daily on TikTok",
          "Create TikTok account using VPN (for users in India)",
          "Maintain consistent posting schedule",
          "Collaborate with other interns in group",
        ],
      },
      {
        heading: "Learning Opportunities",
        bullets: [
          "AI tools for content creation",
          "Social media marketing strategies",
          "TikTok account setup and optimization",
          "Content creation workflows",
          "Performance tracking and optimization",
        ],
      },
    ],
  },
  internsWeLove: {
    heading: "Interns That We Love to Work With",
    columns: [
      {
        heading: "Technical Requirements",
        bullets: [
          "Learning mindset for AI tools exploration",
          "Basic understanding of social media platforms",
          "Ability to follow step-by-step instructions",
          "Comfortable with VPN setup for TikTok access",
        ],
      },
      {
        heading: "Personal Qualities",
        bullets: [
          "Creative and tech-savvy mindset",
          "Ability to dedicate 30-40 minutes daily",
          "Consistent posting without much management",
          "Collaborative team player attitude",
        ],
      },
    ],
  },
  faq: {
    heading: "Frequently Asked Questions?",
    subtitle: "Common questions about our internship program, answered by our team.",
    items: [
      {
        q: "What is the start date for the internship?",
        a: "You can start right away! Once you sign up on the dashboard, you can make an offer letter request based on your chosen start date.",
      },
      {
        q: "I'm not available at the moment; I want to join the internship a month later.",
        a: "Please come back and apply a week before your intended start date. You can then choose the date to start on the dashboard when you request the offer letter.",
      },
      {
        q: "What is the duration of the internship? I'm looking for something more than one month.",
        a: "It starts as one month, but if you're performing well and are consistent, we have no issues extending it. These roles are always available for multiple apps, so you can continue as long as you're performing.",
      },
      {
        q: "What is the salary structure?",
        a: "The compensation is on a CPM (Cost Per Mille) basis — ₹20 per thousand views. You can find detailed information about the compensation structure in the brief above. It's performance-based, meaning your earnings depend on the views your content generates.",
      },
      {
        q: "Is this an in-office or remote position?",
        a: "This is a remote position, and you can work completely at your own time. You can batch create content and post it at your own pace.",
      },
      {
        q: "Will I be receiving an offer letter?",
        a: "Yes, once you sign up on the dashboard, you can request the offer letter.",
      },
      {
        q: "Will I receive an experience letter?",
        a: "Yes, you will receive an experience letter. It can be requested through the dashboard at the end of the internship. Please note that the experience letter will be issued only after completing the required 90 posts.",
      },
    ],
  },
  helpBlock: {
    heading: "I have more questions. Where can I get help?",
    body: "For now, you can reach out to us directly for any questions or support. Once you complete all the required steps and officially onboarded, you will be added to our Slack workspace for ongoing updates and assistance.",
    contactNote: "If you need further help in the meantime, you can reach us anytime:",
    email: "team@thebrewapps.com",
    whatsappUrl: "https://chat.whatsapp.com/Lmw8MXKNPKu0G731bpeNn3?mode=hqrc",
    whatsappLabel: "Join WhatsApp Community",
  },
  journey: {
    heading: "Your Journey to Success",
    subtitle:
      "Follow these simple steps to join the Minutewise team and start your internship journey.",
    steps: [
      { title: "Read the Brief", desc: "📖 Review this page to understand the internship program and requirements." },
      { title: "Setup TikTok", desc: "📱 Create your TikTok account with VPN and follow our setup guide." },
      { title: "Sign Up", desc: "🎯 Register for the creator dashboard with your details." },
      { title: "Join Slack", desc: "💬 Connect with the team in our internal creator Slack workspace." },
      { title: "Request Offer", desc: "📋 Submit your offer letter request through the dashboard." },
      { title: "Setup Tools", desc: "⚙ Familiarize yourself with the slideshow builder tool." },
    ],
    finalStep: {
      title: "Start Creating Content!",
      desc: "🚀 Warm up your TikTok account and start posting amazing slideshows daily!",
    },
    footer: "Estimated time: 30-45 minutes to complete all setup steps",
  },
  ctaHero: {
    eyebrow: "Start earning in 30 minutes",
    heading: "Ready to Get Started?",
    body: "Begin with setting up your TikTok account and join the Minutewise team! 🌟",
    pills: [
      { icon: "check", label: "Remote — work anywhere" },
      { icon: "wallet", label: "₹20 per 1,000 views" },
      { icon: "rocket", label: "Step-by-step guide" },
    ],
    primaryLabel: "Get Started",
    primaryHref: "/creator/setup/tiktok",
    secondaryText: "Already have an account?",
    secondaryLinkLabel: "Sign in",
    secondaryHref: "/creator/login",
    footnote: "Step-by-step TikTok setup guide included",
  },
  gotQuestions: {
    heading: "Got Questions?",
    subtitle:
      "If you run into any issues or need help getting set up, our team is one message away.",
    email: "team@thebrewapps.com",
    whatsappUrl: "https://chat.whatsapp.com/Lmw8MXKNPKu0G731bpeNn3?mode=hqrc",
    whatsappLabel: "Join the community",
    footnote: "We're always here to help!",
  },
  footer: {
    text: "Questions? Contact us at",
    email: "team@thebrewapps.com",
  },
};

export const tiktokSetupDefault: TiktokSetupContent = {
  header: {
    brandTitle: "BrewApps LLC",
    productLine: "Minutewise · TikTok Account Setup",
    backLinkLabel: "Back to Brief",
  },
  hero: {
    eyebrow: "Setup TikTok Account",
    heading: "Set Up Your TikTok Account",
    description:
      "Follow these detailed instructions to create and optimize your TikTok account for the Minutewise slideshow internship.",
  },
  progressCard: {
    heading: "Setup Progress",
    helperBanner:
      "Complete one step at a time. Once you mark the current step as complete, the next step will appear automatically.",
  },
  steps: [
    {
      icon: "globe",
      title: "VPN Setup: Access TikTok from India",
      badge: "🇮🇳 Important for India Users",
      description:
        "Since TikTok is banned in India, you'll need to install and connect to a VPN to access the app.",
      callouts: [
        {
          kind: "warning",
          title: "Important",
          body: "Do not open TikTok without VPN or they will ban your account.",
        },
      ],
      videos: [],
      downloads: [
        {
          label: "Android · Play Store",
          url: "https://play.google.com/store/apps/details?id=com.free.vpn.usa.proxy.planet",
          platform: "android",
        },
        {
          label: "iOS · App Store",
          url: "https://apps.apple.com/in/app/usa-vpn-private-fast/id6475051414",
          platform: "ios",
        },
      ],
      sections: [],
      instructions: [
        "Download USA VPN from the app store or play store",
        "Connect to any free available server in the USA (New York, Los Angeles, etc.)",
        "Keep VPN connected throughout the TikTok setup process",
      ],
    },
    {
      icon: "mail",
      title: "Create a New Email Account",
      badge: "",
      description:
        "Create a new Gmail or Outlook account specifically for your TikTok registration.",
      callouts: [
        {
          kind: "note",
          title: "Important: Use Password, Not Passkey",
          body: "When creating your email account, make sure to use a traditional password instead of a passkey. You will need to share these login credentials with our team for account management purposes, and passkeys cannot be easily shared.",
        },
        {
          kind: "note",
          title: 'Facing "Too Many Attempts" Error?',
          body: "Create a new Gmail ID and use it to sign up or log in to TikTok via Google. This will help bypass the login restrictions and give you smooth access to your TikTok account.",
        },
      ],
      videos: [],
      downloads: [],
      sections: [
        {
          heading: "How to Sign Up for a New Outlook Email",
          platform: "",
          videos: [
            {
              label: "Watch Email Setup Video",
              url: "https://www.loom.com/share/3f160c01f93c45dbb9f464bf0b8f45d3",
            },
          ],
          downloads: [],
        },
      ],
      instructions: [
        "Create a new Gmail or Outlook account",
        "Keep the email credentials safe — you'll need them for signup",
      ],
    },
    {
      icon: "smartphone",
      title: "Download TikTok App",
      badge: "",
      description: "Download TikTok using the appropriate method for your device.",
      callouts: [],
      videos: [],
      downloads: [],
      sections: [
        {
          heading: "How to Change Your iPhone Location & Install TikTok Using a VPN (Step-by-Step)",
          platform: "ios",
          videos: [
            {
              label: "Watch iOS Setup Video",
              url: "https://www.loom.com/share/d8edd22b65f4494b8f843f5fa40cf61a?sid=be5d3ab4-f274-40b2-ac31-c8f971dcb82f",
            },
            { label: "Watch Video", url: "https://www.youtube.com/shorts/9BF0hYWBKJs" },
          ],
          downloads: [],
        },
        {
          heading: "How to Set Up VPN and Install TikTok on Android",
          platform: "android",
          videos: [{ label: "Watch Video", url: "https://www.youtube.com/shorts/LhEUf1gCJoo" }],
          downloads: [
            {
              label: "TikTok APK",
              url: "https://tiktok.en.uptodown.com/android/download/1073755017",
              platform: "apk",
            },
          ],
        },
      ],
      instructions: [
        "Don't connect to VPN yet. Turn off VPN",
        "Android: Download from https://tiktok.en.uptodown.com/android/download/1073755017",
        "iOS: Change your Apple ID country in Settings, download TikTok, then revert country back to India",
        "For iOS users having trouble, watch the above setup video",
      ],
    },
    {
      icon: "user-plus",
      title: "Create Your TikTok Account",
      badge: "",
      description:
        "Set up your TikTok account with the correct information for Minutewise.",
      callouts: [
        {
          kind: "note",
          title: "Important: Use Password, Not Passkey",
          body: "When setting up your TikTok account, use a traditional password instead of passkey authentication. Our team will need access to these credentials for content management and account coordination.",
        },
      ],
      videos: [],
      downloads: [],
      sections: [
        {
          heading: "How to Sign Up for TikTok",
          platform: "",
          videos: [
            {
              label: "Watch TikTok Sign Up Video",
              url: "https://www.loom.com/share/501dc17558e142d68958af4e981adadd",
            },
          ],
          downloads: [],
        },
      ],
      instructions: [
        "Connect to VPN. Always connect to VPN before opening TikTok",
        "Open TikTok app (with VPN still connected)",
        'Option 1 — Email Signup: Tap "Sign-up" and select "Use phone or email"',
        "Enter your birthday (make sure it's 18+)",
        "Switch to email and use your new Gmail/Outlook address",
        'Option 2 — Google Signup: Tap "Continue with Google" and select your new Gmail account',
        "Do NOT enter your phone number anywhere",
        'Username suggestions: "Smart Note Taker", "Online Meeting Tips", "Take Good Notes" — simple, native-sounding names that match the app\'s functionality',
      ],
    },
    {
      icon: "settings",
      title: "Profile Setup & Privacy Settings",
      badge: "",
      description: "Configure your profile and privacy settings for optimal performance.",
      callouts: [],
      videos: [],
      downloads: [],
      sections: [],
      instructions: [
        'Profile Picture: Search for terms related to the app you\'re working on (e.g., "AI meeting notes", "texting assistant", "call recorder", etc.) and choose a clean, non-branded image.',
        'Bio: Use a short bio that fits the app\'s niche — for example: "Check out our AI meeting notes app on the App Store", "Try our AI texting assistant on the App Store", or "Explore our call recorder app on the App Store".',
      ],
    },
    {
      icon: "arrow-right-circle",
      title: "What Next? Complete Your Application",
      badge: "",
      description:
        "You've completed the TikTok setup! Now it's time to officially join the program.",
      callouts: [],
      videos: [],
      downloads: [],
      sections: [
        {
          heading: "How to Sign Up on the Creators Corner Portal",
          platform: "",
          videos: [
            {
              label: "Watch Video",
              url: "https://www.loom.com/share/0e1cb079ed354dfeae0a944c30166fc2",
            },
          ],
          downloads: [],
        },
      ],
      instructions: [
        "Sign up for the Creator Portal to request your offer letter",
        "Join our dedicated Slack channel for updates and support",
        "Access video creation guidelines and templates",
        "Start submitting your content and tracking your earnings",
      ],
    },
  ],
  finalFooter: {
    heading: "What's Next?",
    completeApp: {
      heading: "Complete Your Application",
      body: "Now that your TikTok account is set up, you're ready to sign up for the portal. Please sign up there to request your offer letter, join our dedicated Slack channel, and get started with the internship.",
      signUpLabel: "Sign Up",
      signUpHref: "/creator/signup",
    },
    needHelp: {
      heading: "Need Help?",
      body: "For immediate assistance, you can also reach us via email at",
      email: "team@thebrewapps.com",
      emailLabel: "Email Us",
      whatsappUrl: "https://chat.whatsapp.com/Lmw8MXKNPKu0G731bpeNn3?mode=hqrc",
      whatsappLabel: "Join WhatsApp",
    },
  },
};

export const welcomeDefault: WelcomeContent = {
  hero: {
    title: "MinuteWise",
    subtitle: "Choose how you're signing in.",
  },
  creatorCard: {
    title: "I'm a Creator",
    body: "Track your earnings, see payment status, and review the posts attributed to you.",
    eyebrow: "Creator portal →",
    href: "/creator/brief",
  },
  staffCard: {
    title: "I'm on the Team",
    body: "Run campaigns, manage creators, approve payouts, and operate the automation.",
    eyebrow: "Staff dashboard →",
    href: "/login",
  },
  footnote:
    "Not sure? Pick \"Creator\" if you've been invited to be paid for posts.",
};

export const authFormDefault: AuthFormContent = {
  backLink: "Back to portal chooser",
  hero: {
    heading: "Join the Minutewise Team",
    subheading: "Apply for the Minutewise internship program",
    badge: "Minutewise Internship",
  },
  tabs: {
    signIn: "Sign In",
    signUp: "Sign Up",
  },
  signIn: {
    emailLabel: "Personal Email Address",
    emailPlaceholder: "Enter your personal email",
    passwordLabel: "Password",
    passwordPlaceholder: "Enter your password",
    submitIdle: "Sign In",
    submitLoading: "Signing in…",
  },
  signUp: {
    fullNameLabel: "Full Name",
    fullNamePlaceholder: "Enter your full name",
    emailLabel: "Personal Email Address",
    emailPlaceholder: "Enter your personal email",
    phoneLabel: "Phone Number",
    phonePlaceholder: "Enter your phone number",
    whatsappLabel: "WhatsApp Number",
    whatsappPlaceholder: "Enter your WhatsApp number",
    applyingForLabel: "Applying For",
    applyingForTeamLabel: "Minutewise Team",
    applyingForBody: "You're applying for the Minutewise internship program",
    applyingForFootnote: "This was automatically selected from your referral link",
    platformsHeading: "Social Media Platform Credentials",
    platformsHint: "Provide login details for each platform we'll post to",
    tiktokHint: "The TikTok account you created following our setup guide",
    dashboardPasswordLabel: "Dashboard Password",
    dashboardPasswordPlaceholder: "Create a password for the dashboard",
    submitIdle: "Create Account",
    submitLoading: "Creating account…",
    successHeading: "Check your email",
    successBodyPrefix: "We sent a confirmation link to",
    successBodySuffix: "Click it to activate your account.",
  },
};

export const cmsDefaults: CmsContent = {
  brief: briefDefault,
  "tiktok-setup": tiktokSetupDefault,
  welcome: welcomeDefault,
  "auth-form": authFormDefault,
};
