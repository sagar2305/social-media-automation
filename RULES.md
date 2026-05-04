# Content Pipeline Rules

**Every cycle MUST follow ALL rules below. No exceptions.**

---

## A. Slide Structure & Format

1. Minimum 5 slides per post — flexible body section, no fixed count.
2. Slide order: Slide 1 = Hook, Middle slides = Body, Last slide = CTA.
3. Middle slides carry narrative: problem, pain point, tips, advice, solution, transformation.
4. CTA slide (last slide) GENERATED in the same animation style, color grading, and aesthetic as all previous slides — showing Minutewise app on phone. No pre-made static CTA.
5. All slides: 1080x1440 px (3:4 vertical).
6. Output format: PNG.
7. Images generated WITHOUT text — clean images from Gemini.
8. All text added via `scripts/overlay-text.py`.
9. Font: Helvetica Neue Bold Italic only.
10. Text must NOT cover faces, characters, main subjects, key visual content.
11. Text adapts to composition: split top/bottom preferred, never blocking the main element.

## B. Narrative Arc

12. Slide 1 = always the Hook.
13. Middle slides = always Body.
14. Body slides narrate through: problem, struggle, advice, solutions, tips, progress.
15. Final slide = always CTA.
16. Narrative adapts dynamically to slide count.
17. 5-slide post: Hook, 3 Body, CTA.
18. Longer posts: body expands, strong hook + clear progression + strong CTA ending.
19. CTA slide visually matches the flow style — generated, not static.

## C. Character Consistency

20. One consistent character per post — same appearance, clothing, hair, features throughout ALL slides.
21. Character must be visually recognizable across every single slide.
22. Facial expression must match emotional tone of each slide.
23. Character progresses visually through the narrative scene by scene.
24. Expression must clearly change slide to slide.
25. Emotional progression visible without relying on text.
26. Character prompt must be EXPLICIT and DETAILED — exact hair color, hairstyle, skin tone, clothing items, accessories.
27. Every slide prompt must include the FULL character description — never shorten or abbreviate. Repeat the exact same character string.
28. Character proportions must stay fixed — big eyes in slide 1 = big eyes in slide 9.

## D. Animation Consistency

29. Animation style must be 100% consistent across ALL slides in a post.
30. Same rendering technique, line weight, color treatment, lighting style in every slide.
31. Every slide prompt must include the FULL animation style description — never paraphrase or abbreviate. Repeat exact same style string.
32. No mixing styles within a single post — Pixar 3D = all Pixar 3D, Watercolor = all Watercolor. Including CTA slide.
33. Background environment must stay consistent — same room, same lighting, same color temperature. Only subtle progression allowed.

## E. Emotional Expression System

34. Flow 1 & 2: No emoji overlays — emotion through expression, pose, body language.
35. Flow 3 only: Semi-transparent emoji reaction bubbles in top-right corner.
36. Emoji mapping (Flow 3): Hook = 🤔, Problem = 😰, Tips = 💡, Resolution = 🔥, CTA = 👉.
37. Expression mapping (all flows): Hook = curious, Problem = frustrated, Tips = focused/"aha", Resolution = confident, CTA = warm/inviting.
38. Anime-style exaggeration encouraged: sweat drops, sparkle eyes, clenched fists.

## F. Aesthetic & Background

39. One cohesive aesthetic per post — consistent throughout.
40. Color palette and environment consistent within a post.
41. Background style decided by AI based on topic.
42. Each post uses a distinct animation style.
43. Styles rotate across 18+ options over time.

## G. Triple Flow System

44. Flow 1 (Photorealistic): Cinematic, Arri Alexa/Sony A7 quality, shallow depth of field.
45. Flow 2 (Animated): Different animation style per post (Pixar 3D, Stop Motion, Anime, Watercolor, etc.).
46. Flow 3 (Emoji Overlay): Illustrated characters + emoji reaction bubbles + narrative arc.
47. All flows use gemini-2.5-flash-image.
48. All generated images must be text-free before overlay.

## H. Content & Brand

49. Every post promotes Minutewise — records lectures, transcribes, creates notes/quizzes/flashcards, 100+ languages.
50. Minutewise is the hero product of every post.
51. Study/educational templates ONLY.
52. Content generated via Gemini AI text generation (primary) with CSV templates as fallback. AI prompt includes hook style, trending topics, brand rules, and slide structure. CSV remains source of truth when AI is unavailable.
53. Brand spelling: Minutewise — one word, capital M, lowercase w.
54. 4-pass spell check — zero tolerance for typos.
55. Captions: hook + value line + "Save for exam week" + hashtags.
56. Hashtags: 20 per post — 5 trending (Tier 1) + 7 niche (Tier 2) + 5 ultra-niche (Tier 3) + 3 branded/topic (Tier 4). ALL must be relevant. Always include #MinuteWise. Pick from `data/HASHTAG-BANK.md`.

## I. Posting & Approval

57. Never post without explicit permission — unless automation pre-approved for the cycle.
58. Posts created as TikTok drafts inside TikTok (UPLOAD method).
59. Never auto-publish — unless explicitly enabled for the approved workflow.
60. autoAddMusic: "yes" — TikTok trending sounds on every post.
61. Each account must receive unique content.
62. Never repeat same content across accounts.
63. Each flow run generates exactly 1 post per active account — total post count scales with the number of active accounts.

## J. Account Rotation & Posting Cadence

64. Posts go out one account at a time — no simultaneous posting.
65. Minimum 1-hour gap between posting to different accounts.
66. Minimum 3-hour gap before next post on the same account.
67. Drafts prepared inside TikTok before final publish.

## K. Account System

68. Active TikTok accounts are defined in `config/config.ts` (`tiktokAccounts` array). This is the single source of truth — RULES.md does not enumerate accounts.
69. Adding or removing an account = edit `config.ts` only; no rule changes required.
70. System scales to any number of active accounts as added.
71. Scheduling and rotation adapt automatically to the total active account count.

## L. Two Posting Paths

72. Path 1 (direct): DIRECT_POST — publishes directly to TikTok.
73. Path 2 (draft): UPLOAD — saves to TikTok drafts for manual review & sound adding.
74. Default path is draft. User specifies which path when running the cycle.

## M. Pipeline

75. Workflow: research -> content-generator -> image-generator -> poster -> analytics -> optimizer.
76. A/B testing compares hook styles automatically.
77. Winning hooks kept, losing hooks discarded.
78. Hook framework — Henry: Picture -> Promise -> Prove -> Push.
79. Before every cycle, pipeline MUST read and follow ALL rules from this file.
80. When user is updating rules/config, do NOT generate or post content. Only run when explicitly told "run the flow."
81. No pre-made static CTA images — CTA slide always generated in matching style.
