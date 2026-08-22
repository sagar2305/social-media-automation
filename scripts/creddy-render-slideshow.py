#!/usr/bin/env python3
"""Render an accepted Creddy 3:4 visual plan with locked reusable assets."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "creddy"
EXPRESSIONS = ASSETS / "slideshow-expressions-1080x1440"
PHONE_SCREENS = ASSETS / "slideshow-templates" / "phone-screens"
HEADLINE_FONT = ASSETS / "slideshow-templates" / "fonts" / "tungsten-condensed-bold.ttf"
CARD_FONT = ASSETS / "slideshow-templates" / "fonts" / "DIN-Condensed-Bold.ttf"
WIDTH, HEIGHT = 1080, 1440
CREAM = "#F5EBDD"
GOLD = "#C99625"
BLACK = "#090806"

EXPRESSION_FILES = {
    "neutral": "01-neutral-friendly.png",
    "waving": "02-waving-hello.png",
    "thinking": "03-thinking.png",
    "confused": "04-confused.png",
    "idea": "17-aha-idea.png",
    "worried": "12-worried.png",
    "surprised": "07-surprised.png",
    "sleepy": "08-sleepy.png",
    "starstruck": "14-rewards-excited.png",
    "sad": "11-sad.png",
    "wink": "09-confident-wink.png",
    "card": "13-card-approval.png",
    "thumbs-up": "10-thumbs-up.png",
    "guide": "06-presenting.png",
    "rewards": "14-rewards-excited.png",
    "celebrate": "05-celebrating.png",
    "curious": "15-listening-curious.png",
    "skeptical": "16-skeptical.png",
    "pointing": "18-pointing-left.png",
    "happy": "19-happy-laughing.png",
    "urgent": "20-urgent-stop.png",
    # Older accepted Agent 5 plans remain readable. These aliases map to the
    # locked 3:4 asset library without generating replacement artwork.
    "explaining": "06-presenting.png",
    "concerned": "12-worried.png",
    "celebrating": "05-celebrating.png",
    "excited": "14-rewards-excited.png",
}

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


def headline_layout(draw: ImageDraw.ImageDraw, text: str) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    for size in range(132, 71, -2):
        font = face(HEADLINE_FONT, size)
        lines = wrap_words(draw, text, font, 470)
        line_height = max(draw.textbbox((0, 0), line, font=font)[3] for line in lines)
        total_height = len(lines) * line_height + max(0, len(lines) - 1) * 12
        if len(lines) <= 5 and total_height <= 575:
            return font, lines, line_height
    raise ValueError(f"Headline cannot fit safely: {text}")


def draw_rail(draw: ImageDraw.ImageDraw) -> None:
    draw.line((18, 69, 563, 69), fill=GOLD, width=2)
    cx, cy = 565, 69
    draw.polygon(
        [(cx, cy - 22), (cx + 6, cy - 6), (cx + 22, cy), (cx + 6, cy + 6),
         (cx, cy + 22), (cx - 6, cy + 6), (cx - 22, cy), (cx - 6, cy - 6)],
        fill=GOLD,
    )


def apply_background_style(image: Image.Image, style: str) -> Image.Image:
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
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, 650, 830), fill=f"{color}D9")
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def draw_headline(draw: ImageDraw.ImageDraw, text: str) -> dict:
    font, lines, line_height = headline_layout(draw, text)
    x, y = 52, 104
    gap = 12
    boxes = []
    for index, line in enumerate(lines):
        color = GOLD if index == len(lines) - 1 else CREAM
        draw.text((x + 4, y + 5), line, font=font, fill="#000000A0")
        draw.text((x, y), line, font=font, fill=color)
        box = draw.textbbox((x, y), line, font=font)
        boxes.append(box)
        y += line_height + gap
    return {"lines": lines, "fontSize": font.size, "boxes": boxes, "lineGap": gap}


def wrap_card(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> list[str]:
    return wrap_words(draw, text, font, 340)


def draw_support_card(draw: ImageDraw.ImageDraw, text: str) -> dict:
    x, y, width, height = 55, 850, 395, 175
    draw.rounded_rectangle((x, y, x + width, y + height), radius=4, fill=CREAM)
    draw.rectangle((x + width - 5, y + height - 54, x + width, y + height), fill=GOLD)
    font = face(CARD_FONT, 38)
    lines = wrap_card(draw, text, font)
    while len(lines) > 3 and font.size > 28:
        font = face(CARD_FONT, font.size - 2)
        lines = wrap_card(draw, text, font)
    if len(lines) > 3:
        raise ValueError(f"Supporting copy cannot fit safely: {text}")
    line_height = max(draw.textbbox((0, 0), line, font=font)[3] for line in lines)
    ty = y + 25
    boxes = []
    for index, line in enumerate(lines):
        color = GOLD if index == len(lines) - 1 else BLACK
        draw.text((x + 28, ty), line, font=font, fill=color)
        box = draw.textbbox((x + 28, ty), line, font=font)
        boxes.append(box)
        ty += line_height + 8
    return {"lines": lines, "fontSize": font.size, "boxes": boxes, "lineGap": 8}


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
    if index == 0:
        return plan["cover"]["subheadline"]
    if index == len(plan["scenes"]) - 1:
        return "Open Creddy. Keep the research organized."
    overlays = plan.get("safetyOverlays") or []
    overlay = overlays[0].strip() if overlays else ""
    return overlay if 0 < len(overlay) <= 70 else "Verify current details before deciding."


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
        background_style = str(scene.get("background", {}).get("style") or "spotlight")
        if background_style not in BACKGROUND_STYLES:
            raise ValueError(f"Unknown approved background style: {background_style}")
        if scene.get("expression") not in EXPRESSION_FILES:
            raise ValueError(f"No approved 3:4 template for expression: {scene.get('expression')}")
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
- Slides 1–5 use script-matched poses from the approved 20-expression Creddy library.
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
        template = phone_path if is_phone_proof else EXPRESSIONS / EXPRESSION_FILES[scene["expression"]]
        image = Image.open(template).convert("RGB")
        if image.size != (WIDTH, HEIGHT):
            raise ValueError(f"Template must be {WIDTH}x{HEIGHT}: {template}")
        background_style = str(scene.get("background", {}).get("style") or "spotlight")
        image = apply_background_style(image, background_style)
        draw = ImageDraw.Draw(image)
        draw_rail(draw)
        headline = draw_headline(draw, scene["text"])
        # The approved product templates already contain Creddy and the real
        # phone screen. A support card placed over that artwork can hide the
        # mascot, so Slide 6 is intentionally overlay-free apart from its
        # headline. The CTA remains in the copy/caption and deep link.
        support_copy = "" if is_phone_proof else support_text(plan, number - 1)
        card = None if is_phone_proof else draw_support_card(draw, support_copy)
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
            "headlineLayout": headline,
            "supportCopy": support_copy,
            "supportLayout": card,
        })

    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    write_report(args.output, plan, manifest)
    print(json.dumps({"visualPlanId": plan["id"], "slidesRendered": len(manifest["slides"]), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
