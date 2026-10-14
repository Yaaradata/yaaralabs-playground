"""Make 2 synthetic SPECIMEN mainland-China cheques (转账支票 / 现金支票) for the cheque class.

usage: make_cheques_cn.py OUTDIR

The layout follows the general shape of a PBOC-format cheque (stub on the left, perforation, main body with
出票日期 / 付款行名称 / 收款人 / 出票人账号 / 人民币(大写) / amount grid / 用途 / 出票人签章 / MICR line).
Bank names, marks, payees, account numbers and serials are FICTIONAL; no real bank name or logo is used.
Every cheque carries a large "样本 SPECIMEN" stamp. No signatures.
Needs Windows fonts: msyh.ttc / msyhbd.ttc (Microsoft YaHei), simsun.ttc, consola.ttf.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1])
F = "C:/Windows/Fonts/"


def font(name, size, index=0):
    return ImageFont.truetype(F + name, size, index=index)


CHEQUES = [
    {   # training: transfer cheque
        "file": "cn_specimen_transfer.png",
        "bank": "青岚商业银行", "bank_en": "QINGLAN COMMERCIAL BANK (FICTIONAL)", "kind": "转账支票",
        "ink": (22, 96, 92), "bg": (226, 242, 236), "wave": (170, 214, 200), "seed": 7,
        "serial": ("30205610", "00418273"), "date": "贰零贰陆 年 零玖 月 壹拾伍 日",
        "payee": "示例贸易有限公司", "payer_bank": "青岚商业银行示例支行", "account": "QX00 0000 0000 0418",
        "words": "叁万伍仟元整", "digits": "¥3500000", "use": "货款",
        "micr": "|00418273|  000000000:  30205610|",
    },
    {   # test: cash cheque
        "file": "cn_specimen_cash.png",
        "bank": "云杉农村商业银行", "bank_en": "YUNSHAN RURAL COMMERCIAL BANK (FICTIONAL)", "kind": "现金支票",
        "ink": (150, 62, 30), "bg": (250, 236, 222), "wave": (236, 196, 166), "seed": 11,
        "serial": ("30106620", "00027791"), "date": "贰零贰陆 年 壹拾 月 零捌 日",
        "payee": "示例科技有限公司", "payer_bank": "云杉农村商业银行示例分理处", "account": "QX00 0000 0000 2779",
        "words": "捌仟陆佰元整", "digits": "¥860000", "use": "备用金",
        "micr": "|00027791|  000000000:  30106620|",
    },
]

W, H = 2400, 960
STUB = 560  # stub width


def guilloche(d, x0, y0, x1, y1, color, seed):
    rng = random.Random(seed)
    for k in range(26):
        amp = rng.uniform(10, 34)
        per = rng.uniform(140, 320)
        ph = rng.uniform(0, math.tau)
        base = y0 + (y1 - y0) * (k + 0.5) / 26
        pts = [(x, base + amp * math.sin(x / per * math.tau + ph)) for x in range(x0, x1, 6)]
        d.line(pts, fill=color, width=2)


def bank_mark(d, cx, cy, r, ink, char):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ink, width=6)
    d.ellipse([cx - r + 14, cy - r + 14, cx + r - 14, cy + r - 14], outline=ink, width=2)
    f = font("msyhbd.ttc", int(r * 1.0))
    d.text((cx, cy), char, font=f, fill=ink, anchor="mm")


def make(c):
    im = Image.new("RGB", (W, H), c["bg"])
    d = ImageDraw.Draw(im)
    ink = c["ink"]
    guilloche(d, STUB + 30, 40, W - 30, H - 120, c["wave"], c["seed"])
    guilloche(d, 20, 40, STUB - 30, H - 120, c["wave"], c["seed"] + 1)
    d.rectangle([4, 4, W - 5, H - 5], outline=ink, width=4)

    song = lambda s: font("simsun.ttc", s)
    hei = lambda s: font("msyhbd.ttc", s)
    yahei = lambda s: font("msyh.ttc", s)
    fill_f = font("simsun.ttc", 40)
    fill_c = (30, 30, 40)

    # ── stub ──
    d.text((STUB // 2, 70), c["bank"], font=hei(34), fill=ink, anchor="mm")
    d.text((STUB // 2, 118), f"{c['kind']}存根", font=hei(38), fill=ink, anchor="mm")
    d.text((STUB // 2, 168), f"{c['serial'][0]}  {c['serial'][1]}", font=font("consola.ttf", 30), fill=(190, 30, 30), anchor="mm")
    y = 220
    for label in ["附加信息", "", "", "出票日期：", "收款人：", "金  额：", "用  途：", "单位主管        会计"]:
        if label:
            d.text((40, y), label, font=song(30), fill=ink)
        d.line([(40, y + 44), (STUB - 40, y + 44)], fill=ink, width=2)
        y += 72
    d.text((185, 436), "2026年09月15日" if "transfer" in c["file"] else "2026年10月08日", font=song(30), fill=fill_c)
    d.text((170, 506), c["payee"], font=song(30), fill=fill_c)
    d.text((170, 576), c["digits"].replace("¥", "¥ ")[:-2] + "." + c["digits"][-2:], font=song(32), fill=fill_c)
    d.text((170, 650), c["use"], font=song(30), fill=fill_c)

    # perforation
    for yy in range(10, H - 10, 22):
        d.ellipse([STUB - 4, yy, STUB + 4, yy + 8], fill=(255, 255, 255), outline=ink)

    # ── main body ──
    x0 = STUB + 40
    bank_mark(d, x0 + 80, 100, 58, ink, c["bank"][0])
    d.text((x0 + 170, 70), c["bank"], font=hei(52), fill=ink)
    d.text((x0 + 172, 136), c["bank_en"], font=yahei(22), fill=ink)
    d.text((x0 + 900, 76), c["kind"], font=hei(76), fill=ink)
    d.text((W - 60, 70), c["serial"][0], font=font("consola.ttf", 36), fill=(190, 30, 30), anchor="ra")
    d.text((W - 60, 118), c["serial"][1], font=font("consola.ttf", 44), fill=(190, 30, 30), anchor="ra")

    # vertical note at the left edge of the body
    for i, ch in enumerate("本支票付款期限十天"):
        d.text((x0 - 2, 260 + i * 46), ch, font=song(32), fill=ink)

    bx0, bx1 = x0 + 50, W - 40
    rows = [200, 270, 340, 440, 520, 600, 680, 760]
    for r in rows:
        d.line([(bx0, r), (bx1, r)], fill=ink, width=2)
    d.line([(bx0, rows[0]), (bx0, rows[-1])], fill=ink, width=2)
    d.line([(bx1, rows[0]), (bx1, rows[-1])], fill=ink, width=2)
    mid = bx0 + 980
    d.line([(mid, rows[0]), (mid, rows[2])], fill=ink, width=2)

    d.text((bx0 + 14, rows[0] + 16), "出票日期（大写）", font=song(32), fill=ink)
    d.text((bx0 + 300, rows[0] + 14), c["date"], font=fill_f, fill=fill_c)
    d.text((mid + 14, rows[0] + 16), "付款行名称：", font=song(32), fill=ink)
    d.text((mid + 220, rows[0] + 14), c["payer_bank"], font=song(36), fill=fill_c)
    d.text((bx0 + 14, rows[1] + 16), "收款人：", font=song(32), fill=ink)
    d.text((bx0 + 160, rows[1] + 14), c["payee"], font=fill_f, fill=fill_c)
    d.text((mid + 14, rows[1] + 16), "出票人账号：", font=song(32), fill=ink)
    d.text((mid + 220, rows[1] + 12), c["account"], font=font("consola.ttf", 40), fill=fill_c)

    # amount row with digit grid
    d.text((bx0 + 14, rows[2] + 18), "人民币", font=song(32), fill=ink)
    d.text((bx0 + 14, rows[2] + 56), "（大写）", font=song(28), fill=ink)
    d.text((bx0 + 170, rows[2] + 28), c["words"], font=font("simsun.ttc", 46), fill=fill_c)
    gx0 = bx1 - 11 * 62
    heads = "亿千百十万千百十元角分"
    d.line([(gx0, rows[2]), (gx0, rows[3])], fill=ink, width=2)
    d.line([(gx0, rows[2] + 38), (bx1, rows[2] + 38)], fill=ink, width=1)
    digits = c["digits"].rjust(11)
    for i in range(11):
        cx = gx0 + i * 62
        if i:
            d.line([(cx, rows[2]), (cx, rows[3])], fill=ink, width=1)
        d.text((cx + 31, rows[2] + 20), heads[i], font=song(26), fill=ink, anchor="mm")
        if digits[i] != " ":
            d.text((cx + 31, rows[2] + 70), digits[i], font=font("simsun.ttc", 44), fill=fill_c, anchor="mm")

    d.text((bx0 + 14, rows[3] + 22), "用途", font=song(32), fill=ink)
    d.text((bx0 + 120, rows[3] + 18), c["use"], font=fill_f, fill=fill_c)
    d.line([(mid, rows[3]), (mid, rows[-1])], fill=ink, width=2)
    d.text((mid + 14, rows[3] + 22), "密码", font=song(32), fill=ink)
    d.text((bx0 + 14, rows[4] + 22), "上列款项请从", font=song(32), fill=ink)
    d.text((bx0 + 14, rows[5] + 22), "我账户内支付", font=song(32), fill=ink)
    d.text((bx0 + 14, rows[6] + 22), "出票人签章", font=song(32), fill=ink)
    d.text((mid + 14, rows[4] + 22), "行号", font=song(32), fill=ink)
    d.text((mid + 300, rows[6] + 22), "复核", font=song(32), fill=ink)
    d.text((mid + 620, rows[6] + 22), "记账", font=song(32), fill=ink)

    # MICR band
    d.rectangle([STUB + 20, H - 120, W - 20, H - 20], fill=(250, 250, 248))
    d.text((STUB + 120, H - 100), c["micr"], font=font("consola.ttf", 52), fill=(20, 20, 20))

    # SPECIMEN stamp
    stamp = Image.new("RGBA", (1500, 360), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stamp)
    sd.rounded_rectangle([10, 10, 1490, 350], radius=40, outline=(200, 20, 30, 170), width=14)
    sd.text((750, 185), "样本  SPECIMEN", font=font("msyhbd.ttc", 170), fill=(200, 20, 30, 150), anchor="mm")
    stamp = stamp.rotate(14, expand=True, resample=Image.BICUBIC)
    im.paste(stamp, (STUB + 220, 170), stamp)
    return im


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for c in CHEQUES:
        make(c).save(OUT / c["file"])
        print(OUT / c["file"])
