"""把 README 的拼图合成出来（tools/readme-shots.mjs 调用）。
python3 tools/readme-compose.py islands <输出> <图1> ... <图9>
python3 tools/readme-compose.py phone <输出> <图1> <图2> <图3>
"""
import sys
from PIL import Image, ImageDraw

BG = (10, 23, 21)
kind, out, *files = sys.argv[1:]

if kind == 'islands':
    w, h, gap = 640, 427, 10
    sheet = Image.new('RGB', (3 * w + 4 * gap, 3 * h + 4 * gap), BG)
    for i, f in enumerate(files):
        im = Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS)
        sheet.paste(im, (gap + (i % 3) * (w + gap), gap + (i // 3) * (h + gap)))
    sheet.save(out, quality=84)

if kind == 'phone':
    ims = [Image.open(f).convert('RGB') for f in files]
    pw, ph = ims[0].size
    gap, pad, r = 120, 120, 64
    sheet = Image.new('RGB', (len(ims) * pw + (len(ims) - 1) * gap + 2 * pad, ph + 2 * pad), BG)
    mask = Image.new('L', (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), r, fill=255)
    for i, im in enumerate(ims):
        sheet.paste(im, (pad + i * (pw + gap), pad), mask)
    sheet = sheet.resize((1600, round(sheet.size[1] * 1600 / sheet.size[0])), Image.LANCZOS)
    sheet.save(out, quality=86)
