"""Varied, synthetic image dimensions for gallery and pagination verification."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent / "qa" / "gallery-fixtures"
root.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 42)
small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
sizes = [(720, 960), (960, 640), (800, 800), (640, 1000), (1000, 560), (720, 900)]
colors = [("#e5ddca", "#536b54"), ("#2b5149", "#dfdfc4"), ("#d4b9a1", "#714d41"), ("#c1cbd1", "#364d5e"), ("#e9c5ba", "#885b55"), ("#c7c9b8", "#485f53")]
for i in range(126):
    w, h = sizes[i % len(sizes)]
    bg, ink = colors[i % len(colors)]
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.text((40, 35), f"SHIQIAN / STUDY {i + 1:03}", fill=ink, font=small)
    if i % 3 == 0:
        d.ellipse((w * .16, h * .22, w * .85, h * .74), fill=ink)
        d.ellipse((w * .42, h * .3, w * .86, h * .65), fill=bg)
    elif i % 3 == 1:
        for n in range(6):
            d.arc((w * .25 - n * 20, h * .18, w * .9 + n * 10, h * .75), 60, 300, fill=ink, width=4)
    else:
        d.rounded_rectangle((w * .23, h * .22, w * .77, h * .75), radius=w * .26, fill=ink)
        d.rectangle((w * .23, h * .52, w * .77, h * .75), fill=bg)
    d.text((40, h - 100), ["Quiet forms", "Collected ideas", "A little space"][i % 3], fill=ink, font=font)
    im.save(root / f"画幅-{i + 1:03}.png")
(root / "损坏画幅.png").write_bytes(b"Intentional invalid image fixture")
(root / "参考文档.md").write_text("# Gallery fixture\nA document remains identifiable in image view.\n", encoding="utf-8")
print(f"Created 128 synthetic gallery files in {root}")
