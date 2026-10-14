"""Build nuvama_document_images_us/ from raw/: train folders, degraded test set, CSVs, hash check, contact sheet,
and the app copy in frontend/public/datasets/nuvama_documents_us/ (images + manifest.json).

usage: build_dataset.py ROOT [APP_DIR]
  ROOT    = .../nuvama_document_images_us, with raw/ already filled
  APP_DIR = .../frontend/public/datasets/nuvama_documents_us (optional)

Before running: raw/_scripts/render_edgar_html.py raw/corporate_action   (EDGAR HTML -> PDF)
                raw/_scripts/prep_real_cheques.py ROOT                  (crop + redact the check photos)
"""
import csv
import json
import random
import shutil
import sys
from itertools import product
from pathlib import Path

import imagehash
import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(sys.argv[1])
APP = Path(sys.argv[2]) if len(sys.argv) > 2 else None
RAW = ROOT / "raw"
LONG = 1024
DPI = 150
QUALITY = 88

FORM = "Publicly published blank form; no licence stated; used for internal, non-commercial training"
IRS = "US federal government work (IRS), public domain"
EDGAR = "SEC EDGAR filing (Form 8-K, Exhibit 99.1); public filing, no licence stated; used for internal, non-commercial training"
FATURA = "CC BY 4.0 (FATURA dataset, Limam et al., Zenodo 10.5281/zenodo.10371464)"
FATURA_URL = "https://zenodo.org/records/10371464 (FATURA2.zip: invoices_dataset_final/colored_images/{})"
STATE = "Publicly published US state-government sample; no licence stated; used for internal, non-commercial training"

# key: (pdf, page, url, licence, note)
KYC = {
    "fidelity": ("kyc/fidelity_mutual_fund_app.pdf", 3, "https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/mutual-fund-account-application.pdf", FORM,
                 "Fidelity Investments: Mutual Fund Account Application (account setup / owner details)"),
    "vanguard": ("kyc/vanguard_v826.pdf", 3, "https://personal1.vanguard.com/forms/v826.pdf", FORM,
                 "Vanguard: Brokerage Account application, Form FARF (citizenship, residence, employment)"),
    "etrade": ("kyc/etrade_brokerage_kit.pdf", 2, "https://content.etrade.com/etrade/mssb/pdf/Brokerage_account_kit.pdf", FORM,
               "E*TRADE from Morgan Stanley: Complete Investment Account Application (account type / owner information)"),
    "troweprice": ("kyc/troweprice_regnew.pdf", 1, "https://www.troweprice.com/content/dam/iinvestor/Forms/regnew.pdf", FORM,
                   "T. Rowe Price: Mutual Fund New Account form (owner information)"),
    "apex": ("kyc/apex_new_account.pdf", 1, "https://www.etoro.com/wp-content/uploads/2022/10/apex-new-account-application-and-agreement.pdf", FORM,
             "Apex Clearing: New Account Application & Agreement (account information)"),
    "bny": ("kyc/bny_carf_application.pdf", 7, "https://www.bny.com/content/dam/im/documents/imwebdocs/account-form/annual/im-carf-and-application.pdf", FORM,
            "BNY Mellon Funds: Account Application (account registration information)"),
    "bayfirst": ("kyc/bayfirst_cip.pdf", 1, "https://bayfirstfinancial.com/getmedia/01007e1e-c5c7-495b-83b7-9703449c3abd/Customer-Identification-Program-(CIP)-Form.pdf", FORM,
                 "BayFirst (bank): Customer Identification Program (CIP) form, new account information"),
    "w9": ("kyc/irs_w9.pdf", 1, "https://www.irs.gov/pub/irs-pdf/fw9.pdf", IRS,
           "IRS Form W-9 (Rev. March 2024): Request for Taxpayer Identification Number and Certification"),
}
EDGAR_BASE = "https://www.sec.gov/Archives/edgar/data/"
CA = {
    "kdp": ("corporate_action/keurig_dr_pepper_dividend.pdf", EDGAR_BASE + "1418135/000141813526000058/exhibit991keurigdrpepperde.htm",
            "Keurig Dr Pepper: quarterly cash dividend declared (Sep 2026)"),
    "fastenal": ("corporate_action/fastenal_stock_split.pdf", EDGAR_BASE + "815556/000081555625000085/ex_991042325stocksplitpres.htm",
                 "Fastenal: two-for-one stock split, record date (Apr 2025)"),
    "honeywell": ("corporate_action/honeywell_spinoff.pdf", EDGAR_BASE + "773840/000077384025000090/exhibit991-pressrelease101.htm",
                  "Honeywell: record date for spin-off of Solstice Advanced Materials (Oct 2025)"),
    "itron": ("corporate_action/itron_acquisition.pdf", EDGAR_BASE + "780571/000117184325006299/exh_991.htm",
              "Itron: definitive agreement to acquire Urbint (Oct 2025)"),
    "stitchfix": ("corporate_action/stitchfix_buyback.pdf", EDGAR_BASE + "1576942/000162828026022847/exhibit991-412026.htm",
                  "Stitch Fix: share repurchase program resumed (Apr 2026)"),
    "netflix": ("corporate_action/netflix_stock_split.pdf", EDGAR_BASE + "1065280/000106528025000407/ex991_q425stocksplit.htm",
                "Netflix: ten-for-one stock split, record date (Oct 2025)"),
    "lennar": ("corporate_action/lennar_spinoff.pdf", EDGAR_BASE + "920760/000119312525009205/d913968dex991.htm",
               "Lennar: Millrose spin-off record date and election period (Jan 2025)"),
    "borgwarner": ("corporate_action/borgwarner_dividend.pdf", EDGAR_BASE + "908255/000090825526000003/a02052026dividendrelease.htm",
                   "BorgWarner: quarterly cash dividend declared (Feb 2026)"),
}
COMMONS = "https://commons.wikimedia.org/wiki/File:"
# key: (raw file, url, licence, note)
INV = {
    "T18": ("invoice/fatura/Template18_Instance199.jpg", FATURA_URL.format("Template18_Instance199.jpg"), FATURA,
            "FATURA Template18_Instance199: generated invoice, USD amounts, fake US addresses (original 595x841 upscaled)"),
    "mits": ("invoice/originals/mits_altair_1975.jpg", COMMONS + "MITS_First_Commercial_Sale_of_Altair_to_Roger_Melen_-_Cromemco.jpg",
             "CC BY-SA 3.0, Cromemco (Wikimedia Commons)", "Real invoice: MITS Inc., Albuquerque NM, Altair 8800 sale, 1974/75 (typed form, USD)"),
    "njdot": ("invoice/njdot_twopartmatch.pdf", "https://nj.gov/transportation/business/vendorhelp/pdf/twopartmatch.pdf", STATE,
              "New Jersey DOT: sample vendor invoice layout (page 2), annotated with the required fields"),
    "watkins": ("invoice/originals/watkins_cottrell.jpg", COMMONS + "Watkins-Cottrell_Company.jpg", "Public domain (Wikimedia Commons)",
                "Real invoice: Watkins-Cottrell Co., wholesale hardware, Richmond VA, 1906 (typed, USD)"),
    "T39": ("invoice/fatura/Template39_Instance10.jpg", FATURA_URL.format("Template39_Instance10.jpg"), FATURA,
            "FATURA Template39_Instance10: generated commercial invoice, USD amounts, fake US addresses (original 595x841 upscaled)"),
    "oregon": ("invoice/oregon_opdc_invoice_req.pdf", "https://www.oregon.gov/opdc/provider/SiteAssets/Pages/invoice-submission/Invoice%20Requirements%20Notice%202022.07.pdf", STATE,
               "Oregon Office of Public Defense Services: invoice example (page 2, cropped to the example invoice)"),
    "ashton": ("invoice/originals/ashton_valve_1888.jpg", COMMONS + "1888_invoice.jpg", "Public domain (Wikimedia Commons)",
               "Real invoice: The Ashton Valve Co., Boston MA, 1888, billed to a railroad (USD); receipt signature blurred"),
    "T43": ("invoice/fatura/Template43_Instance166.jpg", FATURA_URL.format("Template43_Instance166.jpg"), FATURA,
            "FATURA Template43_Instance166: generated tax invoice, USD amounts, fake US addresses (original 595x841 upscaled)"),
}
# Real check photos from Wikimedia Commons, cropped and redacted by prep_real_cheques.py.
CHQ = {
    "bank_of_reubens_1920s": (COMMONS + "Bank_of_Reubens_Check,_circa_1920s_-_Reubens,_Idaho_(51077339463).jpg",
                              "CC BY 2.0, Steve Shook (Flickr, via Wikimedia Commons)", "Real check: Bank of Reubens, Idaho, blank leaf, c. 1920s"),
    "wells_fargo_2006": (COMMONS + "Wells_Fargo_counterfeit_cashier%27s_check_2006.jpg",
                         "CC BY-SA 3.0, Kalmia (Wikimedia Commons); names, loan no., account no. and signature blurred",
                         "Real check: Wells Fargo Bank cashier's check, 2006 (a counterfeit used in a scam)"),
    "columbus_savings_1881": (COMMONS + "1881_Columbus_Savings_Bank_check_-_DPLA_-_4dd0c4680df1fad28d77c5aa02775ea7.jpg",
                              "Public domain (Wikimedia Commons / DPLA); drawer's signature blurred", "Real check: The Columbus Savings Bank Co., Ohio, 1881"),
    "commercial_state_bank_1915": (COMMONS + "Commercial_State_Bank_Check,_December_16,_1915_-_Oakesdale,_Washington_(51077344523).jpg",
                                   "CC BY 2.0, Steve Shook (Flickr, via Wikimedia Commons); payee and signature blurred",
                                   "Real check: Commercial State Bank, Oakesdale WA, 1915"),
    "battles_chase_1911": (COMMONS + "Banking_House_of_R.S._Battles_Draft_on_Chase_National_Bank_1911.jpg",
                           "Public domain (Wikimedia Commons); cashier's signature blurred",
                           "Real check: Banking House of R.S. Battles, Girard PA, draft on Chase National Bank, 1911"),
    "citibank_2013": (COMMONS + "Check_used_in_Internet_scam_with_victims_name_removed.JPG",
                      "CC0, Tomwsulcer (Wikimedia Commons); payee and remitter removed by the uploader",
                      "Real check: Citibank N.A. official check / US dollar draft, 2013 (used in an internet scam)"),
    "us_treasury_1865": (COMMONS + "Canceled_Check_for_President_Abraham_Lincoln%27s_Salary,_Pay_Due_Mr._Lincoln_from_April_5_to_and_Including_April_14,_1865_(front).jpg",
                         "Public domain (US Treasury, via Wikimedia Commons)",
                         "Real check: Treasury of the United States warrant, 1865 (President Lincoln's salary, public figure)"),
    "riggs_burmese_embassy_1953": (COMMONS + "$10,000_Check_%22No._481%22_to_%22American_National_Red_Cross%22_on_%2218th_June_1953%22_%22BURMESE_EMBASSY%22_%22NON-CONSULAR_ACCOUNT%22_%222228_Massachusetts_Avenue_N._W._Washington,_D._C.%22_from-_Burma%27s_Gift_to_U.S._Flood_Areas_-_NARA_-_5729922_(cropped).jpg",
                                   "Public domain (NARA, via Wikimedia Commons); signatures blurred",
                                   "Real check photo: The Riggs National Bank, Washington DC, 1953 (Burmese Embassy to the American Red Cross), held in hands"),
}

TRAIN = {
    "KYC": ["fidelity", "vanguard", "etrade", "troweprice", "apex"],
    "corporate_action": ["kdp", "fastenal", "honeywell", "itron", "stitchfix"],
    "invoice": ["T18", "mits", "njdot", "watkins", "T39"],
    "cheque": ["bank_of_reubens_1920s", "wells_fargo_2006", "columbus_savings_1881", "commercial_state_bank_1915", "battles_chase_1911"],
}
# (label, key, condition key, condition text)
TEST = [
    ("KYC", "bny", "clean", "clean: new document, upright"),
    ("KYC", "bayfirst", "phone_kyc", "phone-photo look: perspective skew 12 deg, rotation -3 deg, shadow gradient, on a dark desk"),
    ("KYC", "w9", "crop_bottom", "partial crop: bottom 25% cut off"),
    ("corporate_action", "netflix", "clean", "clean: new document, upright"),
    ("corporate_action", "lennar", "blur", "Gaussian blur, radius 3"),
    ("corporate_action", "borgwarner", "lowlight", "low light / low contrast: brightness x0.45, contrast x0.5"),
    ("invoice", "oregon", "clean", "clean: new document, upright"),
    ("invoice", "T43", "jpeg", "heavy JPEG compression: quality 6"),
    ("invoice", "ashton", "motion", "motion blur: 15 px horizontal"),
    ("cheque", "citibank_2013", "clean", "clean: new document, upright"),
    ("cheque", "us_treasury_1865", "phone_chq", "phone-photo look: perspective skew 9 deg, rotation 4 deg, shadow gradient, on a dark desk"),
    ("cheque", "riggs_burmese_embassy_1953", "crop_right", "partial crop: right 22% cut off"),
]
APP_LABEL = {"KYC": "KYC", "corporate_action": "Corporate action", "invoice": "Invoice", "cheque": "Cheque"}
COVERS = {
    "KYC": "Blank US brokerage, fund and bank account-opening (KYC / CIP) forms",
    "corporate_action": "SEC 8-K press releases: dividends, stock splits, spin-offs, buybacks, acquisitions",
    "invoice": "US business invoices in different layouts (USD), modern and historic",
    "cheque": "Real US check photos and scans, each from a different bank",
}
# Ashton Valve 1888: the 'Received payment' signature (original pixels)
ASHTON_REDACT = [(2250, 2270, 3060, 2414)]


def render(pdf, page, clip=None):
    doc = pymupdf.open(RAW / pdf)
    p = doc[page - 1]
    pix = p.get_pixmap(dpi=DPI, clip=pymupdf.Rect(*clip) if clip else None)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def fit(im):
    im = im.convert("RGB")
    s = LONG / max(im.size)
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)


def redact(im, box):
    region = im.crop(box)
    w, h = region.size
    small = region.resize((max(1, w // 24), max(1, h // 24)), Image.BILINEAR)
    im.paste(small.resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(6)), box[:2])


def source_image(label, key):
    """(image, source_url, licence, note)"""
    if label == "KYC":
        f, page, url, lic, note = KYC[key]
        return render(f, page), url, lic, f"{note}; page {page}"
    if label == "corporate_action":
        f, url, note = CA[key]
        return render(f, 1), url, EDGAR, f"{note}; page 1 of the printed exhibit (no signature block)"
    if label == "invoice":
        f, url, lic, note = INV[key]
        if key == "njdot":
            return render(f, 2), url, lic, note
        if key == "oregon":
            return render(f, 2, clip=(40, 435, 572, 735)), url, lic, note
        im = Image.open(RAW / f).convert("RGB")
        if key == "ashton":
            for box in ASHTON_REDACT:
                redact(im, box)
        return im, url, lic, note
    url, lic, note = CHQ[key]
    return Image.open(RAW / "cheque" / f"{key}.png"), url, lic, note


# ── degradations (same as the India set) ──
def perspective_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(m, float), np.array(src, float).reshape(8)).tolist()


def phone_photo(im, skew, rot, seed):
    random.Random(seed)
    w, h = im.size
    pad = int(max(w, h) * 0.12)
    desk = Image.new("RGB", (w + 2 * pad, h + 2 * pad), (58, 48, 40))
    noise = Image.effect_noise(desk.size, 18).convert("RGB")
    desk = Image.blend(desk, noise, 0.08)
    d = skew / 45.0
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(pad + w * d * 0.5, pad + h * d * 0.15), (pad + w - w * d * 0.35, pad + h * d * 0.05),
           (pad + w, pad + h), (pad, pad + h - h * d * 0.05)]
    warped = im.transform(desk.size, Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC, fillcolor=None)
    mask = Image.new("L", im.size, 255).transform(desk.size, Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    desk.paste(warped, (0, 0), mask)
    desk = desk.rotate(rot, resample=Image.BICUBIC, expand=False, fillcolor=(58, 48, 40))
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
    folders = ["KYC", "corporate_action", "invoice", "cheque", "test"]
    for d in folders:
        (ROOT / d).mkdir(exist_ok=True)
        for old in (ROOT / d).glob("*.jpg"):
            old.unlink()
    sources = []
    prefix = {"KYC": "kyc", "corporate_action": "ca", "invoice": "inv", "cheque": "chq"}
    for label, keys in TRAIN.items():
        for n, key in enumerate(keys, 1):
            im, url, lic, note = source_image(label, key)
            path = save(im, ROOT / label / f"{prefix[label]}_{n:02d}.jpg")
            sources.append({"file": f"{label}/{path.name}", "label": label, "source_url": url, "licence": lic, "notes": note})

    order = list(range(len(TEST)))
    random.Random(2027).shuffle(order)
    key_rows = []
    for t_no, idx in enumerate(order, 1):
        label, key, cond, cond_text = TEST[idx]
        im, url, lic, note = source_image(label, key)
        im, q = degrade(fit(im), cond)
        save(im, ROOT / "test" / f"test_{t_no:02d}.jpg", quality=q or QUALITY)
        name = f"test_{t_no:02d}.jpg"
        sources.append({"file": f"test/{name}", "label": label, "source_url": url, "licence": lic, "notes": f"{note}; test: {cond_text}"})
        key_rows.append({"file": name, "true_label": label, "source": note.split(";")[0], "condition": cond_text})

    with (ROOT / "SOURCES.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "label", "source_url", "licence", "notes"])
        w.writeheader()
        w.writerows(sources)
    with (ROOT / "test_key.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "true_label", "source", "condition"])
        w.writeheader()
        w.writerows(key_rows)

    # ── checks ──
    files = [f for d in folders for f in sorted((ROOT / d).glob("*.jpg"))]
    print("counts", {d: len(list((ROOT / d).glob("*.jpg"))) for d in folders})
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
    ImageDraw.Draw(sheet).text((10, 10), "nuvama_document_images_us: 20 training images (5 per class) + 12 test images", font=bold, fill=(20, 20, 20))
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % cols) * tw, 40 + (k // cols) * th))
    sheet.save(ROOT / "contact_sheet.png")
    print("contact sheet", sheet.size, len(tiles), "images")

    # ── app copy + manifest ──
    if APP:
        for d in folders:
            (APP / d).mkdir(parents=True, exist_ok=True)
            for old in (APP / d).glob("*.jpg"):
                old.unlink()
            for f in sorted((ROOT / d).glob("*.jpg")):
                shutil.copy2(f, APP / d / f.name)
        manifest = {
            "name": "Nuvama client documents · United States",
            "description": "US documents a custody client sends in: 4 labels, 5 images each, plus 12 unseen test images "
                           "(some blurred, cropped or photographed at an angle).",
            "labels": [{"label": APP_LABEL[d], "covers": COVERS[d],
                        "files": [f"{d}/{f.name}" for f in sorted((ROOT / d).glob("*.jpg"))]}
                       for d in ["KYC", "corporate_action", "invoice", "cheque"]],
            "test": [{"file": f"test/{r['file']}", "expected": APP_LABEL[r["true_label"]]} for r in key_rows],
        }
        (APP / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("app copy written to", APP)


if __name__ == "__main__":
    main()
