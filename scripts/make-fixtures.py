"""Synthetic fixtures for local desktop verification. Never reads user files."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen.canvas import Canvas
root = Path(__file__).resolve().parent.parent / 'qa' / 'fixtures'
root.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 56)
small = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 18)
for name, bg, ink, title, shape in [
    ('品牌视觉参考.png', '#e8e0cd', '#466957', 'EARTH\n& FORM', 'circle'),
    ('配色方案.jpg', '#294c42', '#ece5d0', 'The quiet\ncollection.', 'arch'),
    ('版式探索.webp', '#d7c1aa', '#693f32', 'Notes on\neveryday.', 'lines'),
]:
    image = Image.new('RGB', (900, 640), bg)
    d = ImageDraw.Draw(image)
    if shape == 'circle':
        d.ellipse((450, 90, 920, 560), fill='#b7c2a0')
        d.ellipse((630, 190, 855, 415), fill=bg)
    elif shape == 'arch':
        d.rounded_rectangle((500, 80, 805, 670), 152, fill='#72917a')
        d.rounded_rectangle((550, 170, 755, 690), 102, fill=bg)
    else:
        for x in range(480, 850, 25):
            d.arc((x-200, 80, x+100, 630), 270, 450, fill='#a57e65', width=4)
    d.multiline_text((65, 205), title, font=font, fill=ink, spacing=8)
    d.text((66, 75), 'STUDIO ARCHIVE  /  2026', font=small, fill=ink)
    d.text((66, 560), 'DESIGN STUDY     No. 01', font=small, fill=ink)
    image.save(root / name)
(root / '项目需求说明.md').write_text('# 品牌升级项目\n\n目标：建立统一的视觉语言与资料索引。\n\n- 整理灵感\n- 确认初稿\n- 记录客户反馈\n\n<script>这段文字不会执行</script>\n', encoding='utf-8')
(root / '会议记录.txt').write_text('设计评审会议\n\n确认方案后，需要整理图片和输出规范。\n', encoding='utf-8')
(root / '预算表.xlsx').write_bytes(b'Synthetic office placeholder - preview should degrade gracefully.')
(root / '损坏图片.png').write_bytes(b'This is deliberately not an image.')
(root / '子文件夹').mkdir(exist_ok=True)
(root / '子文件夹' / '交付清单.txt').write_text('品牌手册\n视觉规范\n项目复盘', encoding='utf-8')
c = Canvas(str(root / '项目提案.pdf'), pagesize=(595,842))
c.setFillColorRGB(.94,.95,.91);c.rect(0,0,595,842,fill=1,stroke=0)
c.setFillColorRGB(.17,.4,.33);c.setFont('Helvetica',12);c.drawString(55,760,'STUDIO  /  PROJECT BRIEF')
c.setFont('Helvetica',38);c.drawString(55,600,'A place for');c.drawString(55,550,'every idea.')
c.setLineWidth(1);c.line(55,490,540,490);c.setFont('Helvetica',12)
c.drawString(55,455,'A synthetic PDF for Shiqian preview verification.')
c.drawString(55,100,'01     /     LOCAL ARCHIVE');c.showPage();c.save()
print(root)
