"""
Text Overlay Script — TikTok Style (Italic)
Overlays text on images with TikTok-native italic text styling.
Uses Helvetica Neue Bold Italic — consistent across ALL slides.

Enforces 3:4 aspect ratio (1080x1440) — resizes/crops input images.
Auto-scales font to fit all text within top 60-70% safe zone.

Usage: python3 scripts/overlay-text.py <image_path> <text_json> <output_path> [emoji]
"""

import sys
import os
import json
from PIL import Image, ImageDraw, ImageFont


# ─── Canvas ──────────────────────────────────────────────────
TARGET_WIDTH = 1080
TARGET_HEIGHT = 1440  # 3:4 aspect ratio

# ─── Font config ─────────────────────────────────────────────
FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_INDEX_BOLD_ITALIC = 3
FONT_INDEX_ITALIC = 2

# Base font sizes (for 1080x1440 canvas)
FONT_SIZE_TITLE = 80           # Hook/title text (first line)
FONT_SIZE_BODY = 56            # Body/content text
FONT_SIZE_SMALL = 46           # Detail text (long lines)

LINE_SPACING = 18
TEXT_COLOR = (255, 255, 255)    # White
STROKE_COLOR = (0, 0, 0)       # Black outline
STROKE_WIDTH = 5
SHADOW_OFFSET = (4, 4)
SHADOW_COLOR = (0, 0, 0, 180)  # Semi-transparent black
MAX_TEXT_WIDTH_RATIO = 0.85
TEXT_TOP_RATIO = 0.06           # Start at 6% from top
TEXT_BOTTOM_LIMIT = 0.65        # Stay within top 65% (TikTok safe zone)
GAP_BETWEEN_BLOCKS = 24        # Extra gap between text blocks


def get_font(size: int, bold_italic: bool = True) -> ImageFont.FreeTypeFont:
    """Load Helvetica Neue Bold Italic at specified size."""
    idx = FONT_INDEX_BOLD_ITALIC if bold_italic else FONT_INDEX_ITALIC
    try:
        return ImageFont.truetype(FONT_PATH, size, index=idx)
    except Exception:
        try:
            return ImageFont.truetype(FONT_PATH, size, index=0)
        except Exception:
            return ImageFont.load_default()


def wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list:
    """Word-wrap text to fit within max_width pixels."""
    words = text.split()
    lines = []
    current_line = []

    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = font.getbbox(test_line)
        if bbox[2] - bbox[0] <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]

    if current_line:
        lines.append(' '.join(current_line))

    return lines


def measure_text_block(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> int:
    """Measure total height of a wrapped text block."""
    lines = wrap_text(text, font, max_width)
    total = 0
    for line in lines:
        bbox = font.getbbox(line)
        total += (bbox[3] - bbox[1]) + LINE_SPACING
    return total


def measure_all_blocks(text_lines: list, title_size: int, body_size: int, small_size: int, max_width: int) -> int:
    """Measure total height of all text blocks at given font sizes."""
    total = 0
    for i, text in enumerate(text_lines):
        if not text.strip():
            continue
        if i == 0 and len(text_lines) > 1:
            font = get_font(title_size, bold_italic=True)
        elif len(text) > 80:
            font = get_font(small_size, bold_italic=True)
        else:
            font = get_font(body_size, bold_italic=True)
        total += measure_text_block(text, font, max_width) + GAP_BETWEEN_BLOCKS
    return total


def draw_tiktok_text(draw, text, position, font, max_width):
    """Draw text with TikTok-style: white italic + black stroke + shadow."""
    lines = wrap_text(text, font, max_width)
    x, y = position
    total_height = 0

    for line in lines:
        bbox = font.getbbox(line)
        line_width = bbox[2] - bbox[0]
        line_height = bbox[3] - bbox[1]

        # Center horizontally
        line_x = x + (max_width - line_width) // 2

        # Shadow
        draw.text(
            (line_x + SHADOW_OFFSET[0], y + SHADOW_OFFSET[1]),
            line, font=font, fill=SHADOW_COLOR,
        )

        # White text with black stroke
        draw.text(
            (line_x, y), line, font=font,
            fill=TEXT_COLOR,
            stroke_width=STROKE_WIDTH,
            stroke_fill=STROKE_COLOR,
        )

        y += line_height + LINE_SPACING
        total_height += line_height + LINE_SPACING

    return total_height


def draw_emoji_bubble(draw, emoji_char, width, height):
    """Draw a semi-transparent emoji reaction bubble in top-right corner."""
    bubble_size = int(min(width, height) * 0.10)
    margin = int(width * 0.04)

    bubble_x = width - bubble_size - margin
    bubble_y = margin

    circle_bbox = [bubble_x, bubble_y, bubble_x + bubble_size, bubble_y + bubble_size]
    draw.ellipse(circle_bbox, fill=(255, 255, 255, 180))

    emoji_font_size = int(bubble_size * 0.6)
    try:
        emoji_font = ImageFont.truetype(
            "/System/Library/Fonts/Apple Color Emoji.ttc",
            emoji_font_size,
            index=0,
        )
    except Exception:
        try:
            emoji_font = get_font(emoji_font_size, bold_italic=True)
        except Exception:
            return

    bbox = emoji_font.getbbox(emoji_char)
    emoji_w = bbox[2] - bbox[0]
    emoji_h = bbox[3] - bbox[1]
    emoji_x = bubble_x + (bubble_size - emoji_w) // 2
    emoji_y = bubble_y + (bubble_size - emoji_h) // 2

    draw.text((emoji_x, emoji_y), emoji_char, font=emoji_font, fill=(0, 0, 0, 255))


def resize_to_3_4(img: Image.Image) -> Image.Image:
    """Resize and crop image to exact 1080x1440 (3:4) canvas."""
    target_ratio = TARGET_WIDTH / TARGET_HEIGHT  # 0.75
    img_ratio = img.width / img.height

    if img_ratio > target_ratio:
        # Image is wider — scale by height, crop width
        new_height = TARGET_HEIGHT
        new_width = int(img.width * (TARGET_HEIGHT / img.height))
    else:
        # Image is taller — scale by width, crop height
        new_width = TARGET_WIDTH
        new_height = int(img.height * (TARGET_WIDTH / img.width))

    img = img.resize((new_width, new_height), Image.LANCZOS)

    # Center crop to target
    left = (new_width - TARGET_WIDTH) // 2
    top = (new_height - TARGET_HEIGHT) // 2
    img = img.crop((left, top, left + TARGET_WIDTH, top + TARGET_HEIGHT))

    return img


def overlay_text_on_image(image_path, text_lines, output_path, emoji_char=None):
    """Overlay italic text on image with TikTok styling. Enforces 3:4 ratio."""
    img = Image.open(image_path).convert("RGBA")

    # Enforce 3:4 aspect ratio
    img = resize_to_3_4(img)
    width, height = img.size  # Always 1080x1440

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Draw emoji reaction bubble if provided (Flow 3)
    if emoji_char:
        draw_emoji_bubble(draw, emoji_char, width, height)

    max_text_width = int(width * MAX_TEXT_WIDTH_RATIO)
    text_x = int(width * (1 - MAX_TEXT_WIDTH_RATIO) / 2)
    available_height = int(height * (TEXT_BOTTOM_LIMIT - TEXT_TOP_RATIO))

    # Auto-scale: shrink fonts if text doesn't fit in safe zone
    title_size = FONT_SIZE_TITLE
    body_size = FONT_SIZE_BODY
    small_size = FONT_SIZE_SMALL
    scale = 1.0

    for attempt in range(8):
        total_h = measure_all_blocks(text_lines, title_size, body_size, small_size, max_text_width)
        if total_h <= available_height:
            break
        scale -= 0.08
        title_size = int(FONT_SIZE_TITLE * scale)
        body_size = int(FONT_SIZE_BODY * scale)
        small_size = int(FONT_SIZE_SMALL * scale)

    current_y = int(height * TEXT_TOP_RATIO)
    max_y = int(height * TEXT_BOTTOM_LIMIT)

    for i, text in enumerate(text_lines):
        if not text.strip():
            continue
        if current_y >= max_y:
            break

        # First line = big bold title, rest = body
        if i == 0 and len(text_lines) > 1:
            font = get_font(title_size, bold_italic=True)
        elif len(text) > 80:
            font = get_font(small_size, bold_italic=True)
        else:
            font = get_font(body_size, bold_italic=True)

        used_height = draw_tiktok_text(draw, text, (text_x, current_y), font, max_text_width)
        current_y += used_height + GAP_BETWEEN_BLOCKS

    result = Image.alpha_composite(img, overlay)
    result = result.convert("RGB")
    result.save(output_path, "PNG", quality=95)


def main():
    if len(sys.argv) < 4:
        print("Usage: python3 overlay-text.py <image_path> <text_json> <output_path> [emoji]")
        sys.exit(1)

    image_path = sys.argv[1]
    text_json = sys.argv[2]
    output_path = sys.argv[3]
    emoji_char = sys.argv[4] if len(sys.argv) > 4 else None

    if not os.path.exists(image_path):
        print(f"Error: Image not found: {image_path}")
        sys.exit(1)

    text_lines = json.loads(text_json)
    overlay_text_on_image(image_path, text_lines, output_path, emoji_char)
    print(f"OK: {output_path}")


if __name__ == "__main__":
    main()
