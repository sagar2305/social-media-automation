#!/usr/bin/env python3
"""Render an accepted Creddy 3:4 visual plan with locked reusable assets."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "creddy"
EXPRESSIONS = ASSETS / "slideshow-emotion-gestures-v4-1080x1440"
PHONE_SCREENS = ASSETS / "slideshow-templates" / "phone-screens"
HEADLINE_FONT = ASSETS / "slideshow-templates" / "fonts" / "tungsten-condensed-bold.ttf"
CARD_FONT = ASSETS / "slideshow-templates" / "fonts" / "DIN-Condensed-Bold.ttf"
WIDTH, HEIGHT = 1080, 1440
CREAM = "#F5EBDD"
GOLD = "#C99625"
BLACK = "#090806"

EXPRESSION_FILES = {
    item["name"]: item["file"]
    for item in json.loads((EXPRESSIONS / "manifest.json").read_text())["expressions"]
}
LEGACY_EXPRESSION_ALIASES = {
    "neutral": "001-neutral-friendly", "waving": "002-happy-waving", "thinking": "074-thinking-left",
    "confused": "012-confused", "idea": "061-inspired", "worried": "018-worried",
    "surprised": "009-surprised", "sleepy": "040-sleepy", "starstruck": "079-starstruck",
    "sad": "023-sad", "wink": "049-confident-wink", "card": "063-focused",
    "thumbs-up": "100-celebratory-face", "guide": "003-happy-smile", "rewards": "082-rewards-excited",
    "celebrate": "100-celebratory-face", "curious": "011-curious", "skeptical": "014-skeptical",
    "pointing": "008-amazed", "happy": "089-warm-smile", "urgent": "068-urgent",
    "explaining": "003-happy-smile", "concerned": "065-concerned",
    "celebrating": "100-celebratory-face", "excited": "007-excited",
}
EXPRESSION_FILES.update({alias: EXPRESSION_FILES[target] for alias, target in LEGACY_EXPRESSION_ALIASES.items()})

PHONE_TEMPLATES = {
    "wallet_vouchers": "creddy-phone-wallet-vouchers-1080x1440.png",
    "spend_goals": "creddy-phone-spend-goals-1080x1440.png",
    "app_store_dark": "creddy-phone-app-store-dark-1080x1440.png",
    "app_store_light": "creddy-phone-app-store-light-1080x1440.png",
}

BACKGROUND_STYLES = {
    "spotlight": None,
    "deep_navy": "#0A1730",
    "forest": "#0B241B",
    "burgundy": "#321017",
}

ROLE_TREATMENTS = {
    "hook": {"max_lines": 4, "max_size": 154, "min_size": 96, "max_width": 520, "y": 132},
    "standard": {"max_lines": 5, "max_size": 126, "min_size": 84, "max_width": 485, "y": 138},
    "caution": {"max_lines": 5, "max_size": 122, "min_size": 84, "max_width": 500, "y": 158},
    "cta": {"max_lines": 5, "max_size": 126, "min_size": 86, "max_width": 440, "y": 142},
}


def phone_template(plan: dict) -> tuple[str, Path]:
    requested = str(plan.get("phoneTemplateId") or "").strip()
    if requested:
        if requested not in PHONE_TEMPLATES:
            raise ValueError(f"Unknown approved phone template: {requested}")
        return requested, PHONE_SCREENS / PHONE_TEMPLATES[requested]
    text = " ".join(scene.get("text", "") for scene in plan["scenes"]).lower()
    if re.search(r"voucher|loyalty|status|hotel|airline", text):
        template_id = "wallet_vouchers"
    elif re.search(r"spend|welcome bonus|progress|minimum spend", text):
        template_id = "spend_goals"
    else:
        checksum = sum(ord(char) for char in plan["id"])
        template_id = "app_store_dark" if checksum % 2 else "app_store_light"
    return template_id, PHONE_SCREENS / PHONE_TEMPLATES[template_id]


def face(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def wrap_words(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = re.sub(r"\s+", " ", text.strip()).split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and text_width(draw, candidate, font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def treatment_for_role(role: str) -> str:
    if role == "hook":
        return "hook"
    if role == "caution":
        return "caution"
    if role == "cta":
        return "cta"
    return "standard"


def headline_layout(
    draw: ImageDraw.ImageDraw,
    text: str,
    treatment: str,
    emphasis: list[str],
) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    rules = ROLE_TREATMENTS[treatment]
    for size in range(rules["max_size"], rules["min_size"] - 1, -2):
        font = face(HEADLINE_FONT, size)
        lines = wrap_words(draw, text, font, rules["max_width"])
        line_height = max(draw.textbbox((0, 0), line, font=font)[3] for line in lines)
        gap = max(12, round(size * 0.09))
        total_height = len(lines) * line_height + max(0, len(lines) - 1) * gap
        orphan = re.sub(r"[^a-z0-9$%]", "", lines[-1].lower()) if len(lines) > 1 and len(lines[-1].split()) == 1 else ""
        emphasized = {
            re.sub(r"[^a-z0-9$%]", "", token.lower())
            for value in emphasis
            for token in value.split()
        }
        if len(lines) <= rules["max_lines"] and total_height <= 590 and (not orphan or orphan in emphasized):
            return font, lines, line_height
    raise ValueError(
        f"{treatment} copy cannot meet the minimum type and line-count gate; "
        f"return it to Agent 4 for shortening: {text}"
    )


def draw_rail(draw: ImageDraw.ImageDraw, treatment: str) -> None:
    end = 610 if treatment == "hook" else 555
    draw.line((18, 69, end, 69), fill=GOLD, width=3 if treatment == "hook" else 2)
    cx, cy = end + 2, 69
    draw.polygon(
        [(cx, cy - 22), (cx + 6, cy - 6), (cx + 22, cy), (cx + 6, cy + 6),
         (cx, cy + 22), (cx - 6, cy + 6), (cx - 22, cy), (cx - 6, cy - 6)],
        fill=GOLD,
    )


def apply_background_style(image: Image.Image, style: str, treatment: str) -> Image.Image:
    """Apply a branded tint only to the copy-safe background region.

    Creddy's approved expression assets are flattened RGB artwork. Tinting the
    whole image would recolor the mascot, so the editor changes the left-side
    background panel while preserving the character, podium, and app proof.
    """
    color = BACKGROUND_STYLES.get(style)
    if style not in BACKGROUND_STYLES:
        raise ValueError(f"Unknown approved background style: {style}")
    if color is None:
        return image
    tint = Image.new("RGBA", image.size, color)
    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    # The blurred copy panel preserves Creddy's premium lighting and removes
    # the pasted-on rectangular edge of the original tint treatment.
    panel_width = 660 if treatment == "hook" else 615
    panel_height = 840 if treatment in {"hook", "caution"} else 790
    mask_draw.rounded_rectangle(
        (-100, -100, panel_width, panel_height),
        radius=120,
        fill=218 if treatment == "caution" else 202,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(72))
    tint.putalpha(mask)
    return Image.alpha_composite(image.convert("RGBA"), tint).convert("RGB")


def emphasis_ranges(text: str, phrases: list[str]) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for phrase in phrases:
        match = re.search(re.escape(phrase.strip()), text, flags=re.IGNORECASE)
        if match is None:
            raise ValueError(f"Emphasis phrase is absent from exact scene copy: {phrase}")
        ranges.append(match.span())
    return ranges


def draw_headline(
    draw: ImageDraw.ImageDraw,
    text: str,
    emphasis: list[str],
    treatment: str,
) -> dict:
    font, lines, line_height = headline_layout(draw, text, treatment, emphasis)
    rules = ROLE_TREATMENTS[treatment]
    x, y = 52, rules["y"]
    gap = max(12, round(font.size * 0.09))
    ranges = emphasis_ranges(text, emphasis)
    boxes = []
    highlighted_tokens: list[str] = []
    search_from = 0
    for line in lines:
        line_start = text.lower().find(line.lower(), search_from)
        if line_start < 0:
            raise ValueError("Wrapped headline no longer maps to exact scene copy")
        cursor = x
        token_offset = 0
        for token in line.split(" "):
            relative = line.find(token, token_offset)
            start = line_start + relative
            end = start + len(token)
            highlighted = any(start < right and end > left for left, right in ranges)
            color = GOLD if highlighted else CREAM
            if highlighted:
                highlighted_tokens.append(token)
            draw.text((cursor + 4, y + 5), token, font=font, fill="#000000A0")
            draw.text((cursor, y), token, font=font, fill=color)
            cursor += text_width(draw, token, font) + text_width(draw, " ", font)
            token_offset = relative + len(token)
        box = draw.textbbox((x, y), line, font=font)
        boxes.append(box)
        search_from = line_start + len(line)
        y += line_height + gap
    return {
        "lines": lines,
        "fontSize": font.size,
        "boxes": boxes,
        "lineGap": gap,
        "treatment": treatment,
        "emphasis": emphasis,
        "highlightedTokens": highlighted_tokens,
    }


def wrap_card(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> list[str]:
    return wrap_words(draw, text, font, 340)


def draw_support_card(draw: ImageDraw.ImageDraw, text: str, treatment: str) -> dict:
    x, y, width, height = 55, 838, 405, 104
    fill = "#F1D9D7" if treatment == "caution" else CREAM
    draw.rounded_rectangle((x, y, x + width, y + height), radius=30, fill=fill)
    draw.rounded_rectangle((x, y, x + 9, y + height), radius=5, fill=GOLD)
    font = face(CARD_FONT, 34)
    lines = wrap_card(draw, text, font)
    while len(lines) > 2 and font.size > 28:
        font = face(CARD_FONT, font.size - 2)
        lines = wrap_card(draw, text, font)
    if len(lines) > 2:
        raise ValueError(f"Supporting copy cannot fit safely: {text}")
    line_height = max(draw.textbbox((0, 0), line, font=font)[3] for line in lines)
    total = len(lines) * line_height + max(0, len(lines) - 1) * 5
    ty = y + max(16, (height - total) // 2)
    boxes = []
    for line in lines:
        draw.text((x + 28, ty), line, font=font, fill=BLACK)
        box = draw.textbbox((x + 28, ty), line, font=font)
        boxes.append(box)
        ty += line_height + 5
    return {"lines": lines, "fontSize": font.size, "boxes": boxes, "lineGap": 5, "treatment": treatment}


def validate_no_overlap(first: dict, second: dict, label: str) -> None:
    """Fail rendering when two composed text regions intersect."""
    for left in first.get("boxes", []):
        for right in second.get("boxes", []):
            intersects = not (
                left[2] <= right[0] or right[2] <= left[0] or
                left[3] <= right[1] or right[3] <= left[1]
            )
            if intersects:
                raise ValueError(f"Unsafe overlapping layout: {label}")


def support_text(plan: dict, index: int) -> str:
    explicit = str(plan["scenes"][index].get("supportText") or "").strip()
    if explicit:
        return explicit
    role = plan["scenes"][index].get("role")
    if role == "hook":
        candidate = str(plan["cover"].get("subheadline") or "").strip()
    elif role == "caution":
        overlays = plan.get("safetyOverlays") or []
        candidate = overlays[0].strip() if overlays else ""
    else:
        return ""
    if not 0 < len(candidate) <= 70:
        return ""
    headline_words = set(re.findall(r"[a-z0-9]+", plan["scenes"][index]["text"].lower()))
    support_words = set(re.findall(r"[a-z0-9]+", candidate.lower()))
    if support_words and len(headline_words & support_words) / len(support_words) >= 0.7:
        return ""
    return candidate


def validate_plan(plan: dict) -> None:
    if plan.get("format") != "3:4":
        raise ValueError("This renderer accepts only locked 3:4 slideshow plans")
    if plan.get("characterPack") != "credit-card-rewards/creddy":
        raise ValueError("Unexpected character pack")
    if len(plan.get("scenes", [])) != 6:
        raise ValueError("A Creddy slideshow post requires exactly 6 scenes")
    for index, scene in enumerate(plan["scenes"]):
        if scene.get("sceneIndex") != index or not scene.get("text", "").strip():
            raise ValueError("Scene order or text is invalid")
        if scene.get("background", {}).get("mode") != "template":
            raise ValueError("Locked slideshow rendering accepts reusable templates only")
        role = scene.get("role")
        if role not in {"hook", "fact", "context", "caution", "cta"}:
            raise ValueError(f"Unknown slideshow scene role: {role}")
        default_style = "burgundy" if role == "caution" else "spotlight"
        background_style = str(scene.get("background", {}).get("style") or default_style)
        if background_style not in BACKGROUND_STYLES:
            raise ValueError(f"Unknown approved background style: {background_style}")
        emphasis = scene.get("emphasis") or []
        if not isinstance(emphasis, list) or len(emphasis) > 2 or any(not str(value).strip() for value in emphasis):
            raise ValueError("Each slide may use at most two meaningful emphasis phrases")
        emphasis_ranges(scene["text"], [str(value) for value in emphasis])
        if scene.get("expression") not in EXPRESSION_FILES:
            raise ValueError(f"No approved 3:4 template for expression: {scene.get('expression')}")
    if plan["scenes"][0].get("role") != "hook" or plan["scenes"][-1].get("role") != "cta":
        raise ValueError("Slide 1 must be the hook treatment and slide 6 the CTA treatment")
    expressions = [scene["expression"] for scene in plan["scenes"]]
    if len(set(expressions)) < 5:
        raise ValueError("A six-slide Creddy post requires at least five distinct expressions")
    if any(current == expressions[index - 1] for index, current in enumerate(expressions) if index):
        raise ValueError("Adjacent slideshow scenes cannot repeat the same expression")


def write_report(output: Path, plan: dict, manifest: dict) -> None:
    slide_rows = "\n".join(
        f"| {slide['number']} | {slide['sourceText']} | {slide['expression']} | `{slide['file']}` |"
        for slide in manifest["slides"]
    )
    source_rows = "\n".join(f"- {url}" for url in plan.get("sourceUrls", [])) or "- No source URL recorded"
    report = f"""# Agent 06 — Slideshow rendering

## Result

- Status: completed
- Visual plan: `{plan['id']}`
- Slides rendered: {len(manifest['slides'])}
- Final dimensions: {WIDTH} × {HEIGHT} px (3:4)
- Generation: deterministic reusable-template composition
- Image-generation credits used: 0
- Headline font: Tungsten Condensed Bold
- Supporting-card font: DIN Condensed Bold
- Portal upload: not started (Agent 07 responsibility)
- Publishing: not started

## Rendered slides

| Slide | Exact copy | Creddy expression | File |
|---:|---|---|---|
{slide_rows}

## Sources preserved from Agent 05

{source_rows}

## Verification

- Every PNG was reopened after rendering and verified at exactly {WIDTH} × {HEIGHT}.
- Slides 1–5 use script-matched poses from the approved 100-expression Creddy library.
- Slide 6 uses one approved real-app phone-screen template as product proof/CTA.
- Slide 6 never receives a support-card overlay, so Creddy and the phone screen remain unobstructed.
- Text was rendered with the supplied local font files, not image-generated lettering.
- Positive line spacing and separate headline, mascot, and supporting-card regions were enforced.
- No slide counters were added.
"""
    (output / "06-slideshow-rendering.md").write_text(report)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("plan", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    validate_plan(plan)
    if not HEADLINE_FONT.is_file() or not CARD_FONT.is_file():
        raise FileNotFoundError("Locked Creddy font files are missing")

    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "visualPlanId": plan["id"],
        "canvas": {"width": WIDTH, "height": HEIGHT, "aspectRatio": "3:4"},
        "fonts": {
            "headline": {"name": "Tungsten Condensed Bold", "file": str(HEADLINE_FONT.relative_to(ROOT))},
            "support": {"name": "DIN Condensed Bold", "file": str(CARD_FONT.relative_to(ROOT))},
        },
        "generationMode": "deterministic-template-composition",
        "imageGenerationCreditsUsed": 0,
        "slides": [],
    }

    phone_id, phone_path = phone_template(plan)
    for number, scene in enumerate(plan["scenes"], start=1):
        is_phone_proof = number == len(plan["scenes"])
        treatment = treatment_for_role(scene["role"])
        template = phone_path if is_phone_proof else EXPRESSIONS / EXPRESSION_FILES[scene["expression"]]
        image = Image.open(template).convert("RGB")
        if image.size != (WIDTH, HEIGHT):
            raise ValueError(f"Template must be {WIDTH}x{HEIGHT}: {template}")
        default_style = "burgundy" if treatment == "caution" else "spotlight"
        background_style = str(scene.get("background", {}).get("style") or default_style)
        image = apply_background_style(image, background_style, treatment)
        draw = ImageDraw.Draw(image)
        draw_rail(draw, treatment)
        headline = draw_headline(draw, scene["text"], scene.get("emphasis") or [], treatment)
        # The approved product templates already contain Creddy and the real
        # phone screen. A support card placed over that artwork can hide the
        # mascot, so Slide 6 is intentionally overlay-free apart from its
        # headline. The CTA remains in the copy/caption and deep link.
        support_copy = "" if is_phone_proof else support_text(plan, number - 1)
        card = None if not support_copy or is_phone_proof else draw_support_card(draw, support_copy, treatment)
        if card is not None:
            validate_no_overlap(headline, card, "headline and support card")
        output = args.output / f"slide-{number:02d}.png"
        image.save(output, format="PNG", optimize=True)
        with Image.open(output) as proof:
            if proof.size != (WIDTH, HEIGHT):
                raise RuntimeError(f"Rendered slide has wrong dimensions: {output}")
        manifest["slides"].append({
            "number": number,
            "file": output.name,
            "sourceText": scene["text"],
            "expression": scene["expression"],
            "template": str(template.relative_to(ROOT)),
            "templateFamily": "phone-screen" if is_phone_proof else "expression",
            "phoneTemplateId": phone_id if is_phone_proof else None,
            "backgroundStyle": background_style,
            "roleTreatment": treatment,
            "headlineLayout": headline,
            "supportCopy": support_copy,
            "supportLayout": card,
        })

    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    write_report(args.output, plan, manifest)
    print(json.dumps({"visualPlanId": plan["id"], "slidesRendered": len(manifest["slides"]), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
