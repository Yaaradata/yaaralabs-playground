"""Build nuvama_document_images_cn/ from raw/: train folders, degraded test set, CSVs, manifest, hash check, contact sheet.

usage: build_dataset_cn.py ROOT [APP_DIR]
  ROOT    = .../nuvama_document_images_cn, with raw/ filled and prep_redactions.py + make_cheques_cn.py already run
  APP_DIR = optional .../frontend/public/datasets/nuvama_documents_cn; gets a copy of the images + manifest.json
"""
import csv
import json
import random
import shutil
import sys
from itertools import product
from pathlib import Path
from urllib.parse import quote

import imagehash
import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1])
APP = Path(sys.argv[2]) if len(sys.argv) > 2 else None
RAW = ROOT / "raw"
LONG = 1024
DPI = 150
QUALITY = 88

FORM = "Publicly published blank form; no licence stated; used for internal, non-commercial training"
FILING = "Public stock-exchange filing (CNINFO, the CSRC-designated disclosure site); no licence stated; used for internal, non-commercial training"
STA = ("Official blank specimen published by the State Taxation Administration of China (Announcement 2024 No. 11, "
       "attachment 数电发票样式.doc); government document, no licence stated; used for internal, non-commercial training")
SYNTH = "Synthetic, generated for this dataset (fictional bank, payee and numbers); no third-party content"
STA_URL = "https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html (attachment 数电发票样式.doc)"


def commons(title):
    return "https://commons.wikimedia.org/wiki/File:" + quote(title.replace(" ", "_"))


LABELS = ["KYC", "Corporate action", "Invoice", "Cheque"]
FOLDER = {"KYC": "KYC", "Corporate action": "corporate_action", "Invoice": "invoice", "Cheque": "cheque"}
PREFIX = {"KYC": "kyc", "Corporate action": "ca", "Invoice": "inv", "Cheque": "chq"}
COVERS = {
    "KYC": "Blank Chinese account-opening and client-information forms (securities, fund, futures, bank, Hong Kong broker)",
    "Corporate action": "Shanghai and Shenzhen listed-company announcements: cash dividends, bonus shares from capital reserve, buybacks",
    "Invoice": "Chinese fapiao: VAT, e-invoice, quota, machine-printed, taxi and official specimens",
    "Cheque": "Chinese and Hong Kong cheques: museum and archive photos plus two marked specimens",
}

# key: (pdf under raw/, page, source url, note)
KYC = {
    "csdc_natural_person": ("kyc/cfsc_businessSpecific06.pdf", 7, "https://www.cfsc.com.cn/www/doc/businessSpecific06.pdf",
                            "CSDC (China Securities Depository and Clearing): 自然人证券账户注册申请表, individual securities account application (annex to a CSDC notice, republished by China Fortune Securities 华鑫证券)"),
    "cmf": ("kyc/cmf_china_merchants_fund_individual_2024.pdf", 1, "https://www.cmfchina.com/upload/20240726/202407261721956023555.pdf",
            "China Merchants Fund 招商基金: 开放式基金账户业务申请表(个人版), individual fund account application"),
    "cifm": ("kyc/cifm_jpmorgan_fund_2026.pdf", 1, "https://www.cifm.com/service/xzzx/202009/P020260422396716368475.pdf",
             "J.P. Morgan Asset Management (China) 摩根基金 (formerly 上投摩根): 账户开户申请表(个人客户), individual account opening form"),
    "hsbc_rural": ("kyc/hsbc_rural_bank_corporate_account_opening_2023.pdf", 1,
                   "https://www.hsbc.com.cn/content/dam/hsbc/cn/docs/rural-bank/help/document-download/" + quote("汇丰村镇银行工商金融客户开户申请表 21Aug2023.pdf"),
                   "HSBC Rural Bank (China) 汇丰村镇银行: 工商金融客户开户申请表, commercial banking account opening form (entity)"),
    "galaxy_hk": ("kyc/chinastock_hk.pdf", 1, "https://en.chinastock.com.hk/uploads/20241203021205_246980.pdf",
                  "China Galaxy International (Hong Kong) 中国银河国际: 账户申请表, account application form for individual and joint accounts"),
    "csdc_entity": ("kyc/csdc_aoa_form_clearstream.pdf", 1, "https://www.clearstream.com/caas/v1/media/1315512/data/65e4813e1b4d2216b06516c6ae236977/csdc-aoa-form.pdf",
                    "CSDC: 证券账户开立申请表(适用于机构), securities account opening application for entities (bilingual copy published by Clearstream)"),
    "hkex": ("kyc/hkex_ind_open_form_set.pdf", 1,
             "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Settlement-and-Depository/Overview/Investor-Account-Service/Admission-Criteria-and-Application-Procedures/Ind_open_form_set.pdf",
             "HKEX / Hong Kong Securities Clearing: 個人投資者開戶表格, individual investor account opening form"),
    "sywg_futures": ("kyc/sywg_futures_contract_2025.pdf", 47, "https://m.sywgqh.com.cn/upload/file/202510/16/lnCiIfO52YbIJI8Z.pdf",
                     "Shenwan Hongyuan Futures 申银万国期货: 个人客户交易编码申请表, individual client account application (annex 1 of the brokerage contract)"),
}
CA = {
    "changjiang": ("corporate_action/changjiang_securities_dividend.pdf", "http://static.cninfo.com.cn/finalpage/2026-10-14/1225604165.PDF",
                   "Changjiang Securities 长江证券 (SZSE 000783): 2026 interim cash dividend implementation (权益分派实施公告)"),
    "joincare": ("corporate_action/joincare_dividend.pdf", "http://static.cninfo.com.cn/finalpage/2026-10-14/1225603349.PDF",
                 "Joincare Pharmaceutical 健康元 (SSE 600380): 2026 interim cash dividend implementation (权益分派实施公告)"),
    "zhongjing": ("corporate_action/zhongjing_food_bonus.pdf", "http://static.cninfo.com.cn/finalpage/2026-09-04/1225548933.PDF",
                  "Zhongjing Food 仲景食品 (SZSE 300908): bonus shares from capital reserve (资本公积金转增股本实施公告)"),
    "dongyangguang": ("corporate_action/dongyangguang_buyback.pdf", "http://static.cninfo.com.cn/finalpage/2026-10-10/1225600203.PDF",
                      "HEC Technology 东阳光 (SSE 600673): share buyback report (回购报告书)"),
    "ruida": ("corporate_action/ruida_futures_dividend_bonus.pdf", "http://static.cninfo.com.cn/finalpage/2026-09-16/1225566247.PDF",
              "Ruida Futures 瑞达期货 (SZSE 002961): interim dividend plus bonus shares (分红派息、转增股本实施公告)"),
    "semcorp": ("corporate_action/semcorp_dividend.pdf", "http://static.cninfo.com.cn/finalpage/2026-10-14/1225604047.PDF",
                "Yunnan Energy New Material 恩捷股份 (SZSE 002812): 2026 interim cash dividend implementation (权益分派实施公告)"),
    "hetai": ("corporate_action/hetai_bonus.pdf", "http://static.cninfo.com.cn/finalpage/2026-09-17/1225567702.PDF",
              "Hangzhou Hetai Machinery 和泰机电 (SZSE 001225): bonus shares from capital reserve (资本公积金转增股本实施公告)"),
    "jingjiawei": ("corporate_action/jingjiawei_buyback.pdf", "http://static.cninfo.com.cn/finalpage/2026-10-08/1225597611.PDF",
                   "Changsha Jingjia Microelectronics 景嘉微 (SZSE 300474): share buyback report (回购股份报告书)"),
}
# key: (prepped png, source url, licence, note)
INV = {
    "guangdong_e_fapiao": ("Standard Fapiao.jpg", "CC BY-SA 4.0, Supraios (Wikimedia Commons); taxpayer IDs blurred",
                           "Guangdong VAT electronic ordinary invoice 广东增值税电子普通发票 (2016)"),
    "shanghai_vat": ("Shanghai VAT Standard Invoice.jpg", "Public domain (Wikimedia Commons, 上海市税务局 form); taxpayer IDs, phone number and issuer name blurred",
                     "Shanghai VAT ordinary invoice 上海增值税普通发票 (2020)"),
    "shanghai_quota": ("Quota Invoice from Shanghai.jpg", "Public domain (Wikimedia Commons, 上海市税务局 form); taxpayer IDs blurred",
                       "Shanghai quota invoice 定额发票, Shanghai Public Transportation Card Co."),
    "sichuan_machine_printed": ("Common Printed Invoice from Sichuan.jpg", "Public domain (Wikimedia Commons, 四川省税务局 form); taxpayer IDs in the seal blurred",
                                "Sichuan machine-printed general invoice 四川通用机打发票, Chengdu Ito-Yokado (2020)"),
    "chinatax_digital_vat_special": (None, STA, "State Taxation Administration: blank specimen of the fully digitalised e-invoice, VAT special invoice 电子发票(增值税专用发票)"),
    "beijing_court_fee": ("An invoice by Beijing Chaoyang District People's Court, China.jpg", "Public domain (Wikimedia Commons); payer names greyed out by the uploader",
                          "Beijing Chaoyang District People's Court litigation-fee receipt 诉讼收费专用票据 (2018)"),
    "shenzhen_taxi": ("深圳市出租汽車專用發票發票聯 20160202.jpg", "CC BY-SA 4.0, Solomon203 (Wikimedia Commons); car plates, driver numbers and taxpayer IDs blurred",
                      "Shenzhen taxi invoices 深圳市出租汽车专用发票, three receipts (2016)"),
    "chinatax_motor_vehicle": (None, STA, "State Taxation Administration: blank specimen of the e-invoice for motor-vehicle sales 电子发票(机动车销售统一发票)"),
}
CHQ = {
    "scsb_shanghai_1950s": ("民国时期上商储支票.jpg", "CC BY-SA 4.0, Lhzss8 (Wikimedia Commons); faint payee stamp blurred",
                            "Real cheque photo: Shanghai Commercial & Savings Bank 上海商业储蓄银行, RMB cheque, early 1950s, mostly blank (Shanghai Bank Museum)"),
    "bea_shanghai_branch": ("东亚银行上海分行支票及印章.jpg", "CC BY-SA 4.0, Lhzss8 (Wikimedia Commons); signature and handwritten name blurred",
                            "Real cheque photo: Bank of East Asia 东亚银行, Shanghai branch, Republican era (Shanghai Bank Museum)"),
    "chung_king_bank_1935": ("Chung King Bank - Cancelled Cheque $100 (1935) (Chengtu). - Tien Yuan Chin Shop Certificate of Deposit 5-Yuan (1927) He De Company (Canton), Incense Export Tax Receipt (1929).jpg",
                             "Public domain (Wikimedia Commons, scan by Baldwin's Hong Kong Coin Auction); signatures and personal seal blurred",
                             "Real cheque scan: Chung King Bank 重庆银行, Chengdu, cancelled cheque, 1935 (cropped from a scan of three items)"),
    "hk_wiki_bank_sample": ("HK Cheque Sample.png", "CC BY-SA 3.0, Phantomkid@Wikipedia.ZH (Wikimedia Commons)",
                            "Hong Kong cheque sample 支票樣本, fictional Wiki Bank, drawn for Chinese Wikipedia (fictional payee and signature)"),
    "cn_specimen_transfer": (None, SYNTH, "Synthetic SPECIMEN 转账支票 (transfer cheque), fictional Qinglan Commercial Bank"),
    "ta_yo_bank_1923": ("The 5000-Yuan cheque.tif", "Public domain (Wikimedia Commons; 1923 newspaper reproduction); signature blurred",
                        "Real cheque (newspaper print): Ta Yo Bank 大有银行, the 1923 '5000-yuan cheque', front side"),
    "cn_specimen_cash": (None, SYNTH, "Synthetic SPECIMEN 现金支票 (cash cheque), fictional Yunshan Rural Commercial Bank"),
    "bea_shanghai_1949": ("东亚银行上海支行支票.jpg", "CC BY-SA 4.0, Lhzss8 (Wikimedia Commons); signature and handwritten amount line blurred",
                          "Real cheque photo: Bank of East Asia 东亚银行, Shanghai, 1949 (right-hand cheque of a museum display)"),
}

TRAIN = {
    "KYC": ["csdc_natural_person", "cmf", "cifm", "hsbc_rural", "galaxy_hk"],
    "Corporate action": ["changjiang", "joincare", "zhongjing", "dongyangguang", "ruida"],
    "Invoice": ["guangdong_e_fapiao", "shanghai_vat", "shanghai_quota", "sichuan_machine_printed", "chinatax_digital_vat_special"],
    "Cheque": ["scsb_shanghai_1950s", "bea_shanghai_branch", "chung_king_bank_1935", "hk_wiki_bank_sample", "cn_specimen_transfer"],
}
# (label, key, condition key, condition text)
TEST = [
    ("KYC", "csdc_entity", "clean", "clean: new document, upright"),
    ("KYC", "hkex", "phone_kyc", "phone-photo look: perspective skew 12 deg, rotation -3 deg, shadow gradient, on a dark desk"),
    ("KYC", "sywg_futures", "crop_bottom", "partial crop: bottom 25% cut off"),
    ("Corporate action", "semcorp", "clean", "clean: new document, upright"),
    ("Corporate action", "hetai", "blur", "Gaussian blur, radius 3"),
    ("Corporate action", "jingjiawei", "lowlight", "low light / low contrast: brightness x0.45, contrast x0.5"),
    ("Invoice", "beijing_court_fee", "clean", "clean: new document, upright"),
    ("Invoice", "shenzhen_taxi", "jpeg", "heavy JPEG compression: quality 6"),
    ("Invoice", "chinatax_motor_vehicle", "motion", "motion blur: 15 px horizontal"),
    ("Cheque", "ta_yo_bank_1923", "clean", "clean: new document, upright"),
    ("Cheque", "cn_specimen_cash", "phone_chq", "phone-photo look: perspective skew 9 deg, rotation 4 deg, shadow gradient, on a dark desk"),
    ("Cheque", "bea_shanghai_1949", "crop_right", "partial crop: right 22% cut off"),
]
SIGN_OFF = ["特此公告"]


def render(pdf, page, crop_signoff=False):
    doc = pymupdf.open(RAW / pdf)
    p = doc[page - 1]
    clip = p.rect
    note = ""
    if crop_signoff:
        ys = [r.y0 for phrase in SIGN_OFF for r in p.search_for(phrase) if r.y0 > p.rect.height * 0.35]
        if ys:
            clip = pymupdf.Rect(0, 0, p.rect.width, min(ys) - 4)
            note = "cropped above the sign-off"
        else:
            note = "page 1 has no sign-off block (no names or signatures on it)"
    pix = p.get_pixmap(dpi=DPI, clip=clip)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples), note


def fit(im):
    im = im.convert("RGB")
    s = LONG / max(im.size)
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)


def source_image(label, key):
    """(image, source_url, licence, note)"""
    if label == "KYC":
        f, page, url, note = KYC[key]
        im, _ = render(f, page)
        return im, url, FORM, f"{note}; page {page}"
    if label == "Corporate action":
        f, url, note = CA[key]
        im, crop = render(f, 1, crop_signoff=True)
        return im, url, FILING, f"{note}; page 1, {crop}"
    if label == "Invoice":
        title, lic, note = INV[key]
        url = commons(title) if title else STA_URL
        return Image.open(RAW / "invoice" / "prepped" / f"{key}.png"), url, lic, note
    title, lic, note = CHQ[key]
    if title is None:
        return Image.open(RAW / "cheque" / "synthetic" / f"{key}.png"), "generated by raw/_scripts/make_cheques_cn.py", lic, note
    return Image.open(RAW / "cheque" / "prepped" / f"{key}.png"), commons(title), lic, note


# ── degradations (same recipes as the India set) ──
def perspective_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(m, float), np.array(src, float).reshape(8)).tolist()


def phone_photo(im, skew, rot, seed):
    rng = random.Random(seed)
    w, h = im.size
    pad = int(max(w, h) * 0.12)
    desk = Image.new("RGB", (w + 2 * pad, h + 2 * pad), (58, 48, 40))
    noise = Image.effect_noise(desk.size, 18).convert("RGB")
    desk = Image.blend(desk, noise, 0.08)
    d = skew / 45.0
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(pad + w * d * 0.5, pad + h * d * 0.15), (pad + w - w * d * 0.35, pad + h * d * 0.05),
           (pad + w, pad + h), (pad, pad + h - h * d * 0.05)]
    warped = im.transform(desk.size, Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    mask = Image.new("L", im.size, 255).transform(desk.size, Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    desk.paste(warped, (0, 0), mask)
    desk = desk.rotate(rot + rng.uniform(-0.01, 0.01), resample=Image.BICUBIC, expand=False, fillcolor=(58, 48, 40))
    gx = np.linspace(1.0, 0.55, desk.width)[None, :]
    gy = np.linspace(0.95, 1.0, desk.height)[:, None]
    arr = np.asarray(desk).astype(float) * (gx * gy)[..., None]
    return Image.fromarray(arr.clip(0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.8))


def motion_blur(im, length=15):
    arr = np.asarray(im).astype(float)
    out = np.zeros_like(arr)
    for k in range(length):
        out += np.roll(arr, k - length // 2, axis=1)
    return Image.fromarray((out / length).clip(0, 255).astype("uint8"))


def degrade(im, cond):
    if cond == "clean":
        return im, None
    if cond == "blur":
        return im.filter(ImageFilter.GaussianBlur(3)), None
    if cond == "lowlight":
        return ImageEnhance.Contrast(ImageEnhance.Brightness(im).enhance(0.45)).enhance(0.5), None
    if cond == "jpeg":
        return im, 6
    if cond == "motion":
        return motion_blur(im, 15), None
    if cond == "crop_bottom":
        return im.crop((0, 0, im.width, int(im.height * 0.75))), None
    if cond == "crop_right":
        return im.crop((0, 0, int(im.width * 0.78), im.height)), None
    if cond == "phone_kyc":
        return phone_photo(im, 12, -3, 1), None
    if cond == "phone_chq":
        return phone_photo(im, 9, 4, 2), None
    raise ValueError(cond)


def save(im, path, quality=QUALITY):
    fit(im).save(path, "JPEG", quality=quality, optimize=True)
    return path


def main():
    for lab in LABELS + ["test"]:
        d = ROOT / FOLDER.get(lab, lab)
        d.mkdir(exist_ok=True)
        for old in d.glob("*.jpg"):
            old.unlink()
    sources, manifest_labels = [], []
    for label in LABELS:
        files = []
        for n, key in enumerate(TRAIN[label], 1):
            im, url, lic, note = source_image(label, key)
            path = save(im, ROOT / FOLDER[label] / f"{PREFIX[label]}_{n:02d}.jpg")
            rel = f"{FOLDER[label]}/{path.name}"
            files.append(rel)
            sources.append({"file": rel, "label": label, "source_url": url, "licence": lic, "notes": note})
        manifest_labels.append({"label": label, "covers": COVERS[label], "files": files})

    order = list(range(len(TEST)))
    random.Random(2026).shuffle(order)
    key_rows, manifest_test = [], []
    for t_no, idx in enumerate(order, 1):
        label, key, cond, cond_text = TEST[idx]
        im, url, lic, note = source_image(label, key)
        im, q = degrade(fit(im), cond)
        name = f"test_{t_no:02d}.jpg"
        save(im, ROOT / "test" / name, quality=q or QUALITY)
        sources.append({"file": f"test/{name}", "label": label, "source_url": url, "licence": lic, "notes": f"{note}; test: {cond_text}"})
        key_rows.append({"file": name, "true_label": label, "source": note.split(";")[0], "condition": cond_text})
        manifest_test.append({"file": f"test/{name}", "expected": label})

    with (ROOT / "SOURCES.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "label", "source_url", "licence", "notes"])
        w.writeheader()
        w.writerows(sources)
    with (ROOT / "test_key.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "true_label", "source", "condition"])
        w.writeheader()
        w.writerows(key_rows)
    manifest = {
        "name": "Nuvama client documents · China",
        "description": "Chinese documents a custody client sends in: 4 labels, 5 images each, plus 12 unseen test images "
                       "(some blurred, cropped or photographed at an angle).",
        "labels": manifest_labels,
        "test": manifest_test,
    }

    # ── checks ──
    files = [f for d in ["KYC", "corporate_action", "invoice", "cheque", "test"] for f in sorted((ROOT / d).glob("*.jpg"))]
    counts = {d: len(list((ROOT / d).glob("*.jpg"))) for d in ["KYC", "corporate_action", "invoice", "cheque", "test"]}
    print("counts", counts)
    bad = []
    for f in files:
        im = Image.open(f)
        if im.format != "JPEG" or im.mode != "RGB" or max(im.size) != LONG or f.stat().st_size >= 2 * 1024 * 1024:
            bad.append((f.name, im.format, im.mode, im.size, f.stat().st_size))
    print("format problems", bad or "none")
    hashes = {f: (imagehash.phash(Image.open(f)), imagehash.dhash(Image.open(f))) for f in files}
    train = [f for f in files if f.parent.name != "test"]
    test = [f for f in files if f.parent.name == "test"]
    close = []
    for a, b in product(test, train):
        dp, dd = hashes[a][0] - hashes[b][0], hashes[a][1] - hashes[b][1]
        if dp <= 12 or dd <= 10:
            close.append((a.name, f"{b.parent.name}/{b.name}", dp, dd))
    for i, a in enumerate(train):
        for b in train[i + 1:]:
            dp, dd = hashes[a][0] - hashes[b][0], hashes[a][1] - hashes[b][1]
            if dp <= 12 or dd <= 10:
                close.append((f"{a.parent.name}/{a.name}", f"{b.parent.name}/{b.name}", dp, dd))
    nearest = min((hashes[a][0] - hashes[b][0], a.name, f"{b.parent.name}/{b.name}") for a, b in product(test, train))
    print("near-duplicates (phash<=12 or dhash<=10)", close or "none")
    print("closest test/train pair by phash", nearest)
    print("total size of the 32 images: %.2f MB" % (sum(f.stat().st_size for f in files) / 1e6))

    # ── contact sheet ──
    tw, th, cols = 240, 300, 8
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 14)
    bold = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 14)
    truth = {r["file"]: r["true_label"] for r in key_rows}
    tiles = []
    for f in files:
        im = Image.open(f)
        im.thumbnail((tw - 10, th - 44))
        tile = Image.new("RGB", (tw, th), "white")
        tile.paste(im, ((tw - im.width) // 2, 38 + (th - 44 - im.height) // 2))
        d = ImageDraw.Draw(tile)
        d.text((6, 4), f"{f.parent.name}/{f.name}", font=bold, fill=(20, 20, 20))
        if f.parent.name == "test":
            d.text((6, 20), f"true: {truth[f.name]}", font=font, fill=(160, 20, 60))
        d.rectangle([0, 0, tw - 1, th - 1], outline=(200, 200, 200))
        tiles.append(tile)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th + 40), (245, 245, 245))
    ImageDraw.Draw(sheet).text((10, 10), "nuvama_document_images_cn: 20 training images (5 per label) + 12 test images", font=bold, fill=(20, 20, 20))
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % cols) * tw, 40 + (k // cols) * th))
    sheet.save(ROOT / "contact_sheet.png")
    print("contact sheet", sheet.size, len(tiles), "images")

    # ── app copy ──
    if APP:
        APP.mkdir(parents=True, exist_ok=True)
        for d in ["KYC", "corporate_action", "invoice", "cheque", "test"]:
            dst = APP / d
            if dst.exists():
                shutil.rmtree(dst)
            dst.mkdir()
            for f in sorted((ROOT / d).glob("*.jpg")):
                shutil.copy2(f, dst / f.name)
        (APP / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("app copy ->", APP)


if __name__ == "__main__":
    main()
