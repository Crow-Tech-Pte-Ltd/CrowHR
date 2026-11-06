#!/usr/bin/env python3
"""Draws the PLACEHOLDER Crow HR app icon (1024 px, no alpha) in Crow Tech tokens.

NOT FINAL: the icon needs Daniel's approval before any release. It is a plain neo-brutalist
card ("HR" in Azeret Mono on near-white, 2px-style ink border, hard offset shadow) on kuning-200.
Usage: scripts/ios-make-placeholder-icon.py FONT_TTF OUT_PNG   (needs Pillow)
"""
import sys

from PIL import Image, ImageDraw, ImageFont

KUNING_200 = (0xFE, 0xD5, 0x6C)
INK = (0x0A, 0x0A, 0x0A)
SURFACE_50 = (0xFF, 0xFF, 0xFF)

font_path, out = sys.argv[1], sys.argv[2]
size = 1024
img = Image.new("RGB", (size, size), KUNING_200)
d = ImageDraw.Draw(img)
# Hard offset shadow, then the card with a heavy ink border (no blur, no gradient).
card = (232, 262, 772, 762)
shadow = 36
d.rectangle((card[0] + shadow, card[1] + shadow, card[2] + shadow, card[3] + shadow), fill=INK)
d.rectangle(card, fill=SURFACE_50, outline=INK, width=28)
font = ImageFont.truetype(font_path, 260)
text = "HR"
box = d.textbbox((0, 0), text, font=font)
w, h = box[2] - box[0], box[3] - box[1]
cx, cy = (card[0] + card[2]) / 2, (card[1] + card[3]) / 2
d.text((cx - w / 2 - box[0], cy - h / 2 - box[1]), text, font=font, fill=INK)
img.save(out, "PNG")
