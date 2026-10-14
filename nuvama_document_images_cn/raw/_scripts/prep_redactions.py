"""Crop and redact the real invoice and cheque images (Wikimedia Commons originals, tax-bureau specimens).

usage: prep_redactions.py ROOT   (ROOT = .../nuvama_document_images_cn)
Reads raw/invoice/*, raw/invoice/chinatax_specimen/*, raw/cheque/originals/*; writes raw/invoice/prepped/*.png and
raw/cheque/prepped/*.png.

Redaction = pixelate + blur, so taxpayer IDs, personal phone numbers, people's names, driver numbers, car plates,
signatures and personal seals cannot be read. Boxes are (x0, y0, x1, y1) as FRACTIONS of the original image size,
applied before cropping. Crops are also fractions of the original.
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1])
RAW = ROOT / "raw"

# key: (source file under raw/, crop or None, [redaction boxes])
INVOICES = {
    "guangdong_e_fapiao": ("invoice/guangdong_e_fapiao_standard.jpg", None, [
        (0.175, 0.795, 0.405, 0.845),   # seller taxpayer ID
        (0.770, 0.835, 0.950, 0.900),   # taxpayer ID inside the seller's invoice seal
    ]),
    "shanghai_vat": ("invoice/shanghai_vat_standard.jpg", None, [
        (0.240, 0.770, 0.495, 0.818),   # seller taxpayer ID
        (0.380, 0.815, 0.495, 0.852),   # mobile phone number
        (0.710, 0.785, 0.885, 0.875),   # taxpayer ID inside the seller's invoice seal
        (0.598, 0.870, 0.650, 0.925),   # issuer's name (开票人)
    ]),
    "shanghai_quota": ("invoice/shanghai_quota_invoice.jpg", None, [
        (0.445, 0.360, 0.805, 0.420),   # unified social credit code (taxpayer ID)
        (0.680, 0.705, 0.925, 0.770),   # taxpayer ID inside the seller's invoice seal
    ]),
    "sichuan_machine_printed": ("invoice/sichuan_common_printed_invoice.jpg", None, [
        (0.230, 0.785, 0.870, 0.862),   # taxpayer ID inside the seller's invoice seal
        (0.300, 0.880, 0.790, 0.950),   # code at the bottom of the seal
    ]),
    "chinatax_digital_vat_special": ("invoice/chinatax_specimen/chinatax_digital_vat_special_invoice_specimen.jpg", None, []),  # blank specimen
    "beijing_court_fee": ("invoice/beijing_chaoyang_court_invoice.jpg", None, []),  # payer names already greyed out by the uploader
    "shenzhen_taxi": ("invoice/shenzhen_taxi_invoices.jpg", None, [
        (0.185, 0.500, 0.320, 0.565),   # receipt 1: car plate and driver certificate number
        (0.480, 0.572, 0.600, 0.636),   # receipt 2: car plate and driver certificate number
        (0.190, 0.800, 0.300, 0.850),   # receipt 1: taxpayer ID inside the seal
        (0.468, 0.890, 0.588, 0.932),   # receipt 2: taxpayer ID inside the seal
        (0.745, 0.835, 0.860, 0.872),   # receipt 3: taxpayer ID inside the seal
    ]),
    "chinatax_motor_vehicle": ("invoice/chinatax_specimen/chinatax_motor_vehicle_sales_invoice_specimen.png", None, []),  # blank specimen
}

CHEQUES = {
    # Shanghai Commercial & Savings Bank, early 1950s, mostly blank leaf (photo in Shanghai Bank Museum)
    "scsb_shanghai_1950s": ("cheque/originals/shanghai_commercial_savings_bank.jpg", (0.150, 0.100, 0.760, 0.875), [
        (0.320, 0.350, 0.395, 0.500),   # faint stamped payee name
    ]),
    # Bank of East Asia, Shanghai branch, Republican era (English-style cheque, photo in Shanghai Bank Museum)
    "bea_shanghai_branch": ("cheque/originals/bea_shanghai_branch_with_seals.jpg", (0.280, 0.318, 0.770, 0.485), [
        (0.535, 0.405, 0.690, 0.470),   # drawer signature and handwritten name
    ]),
    # Chung King Bank, Chengdu, 1935, cancelled cheque (left item of a Baldwin's auction scan)
    "chung_king_bank_1935": ("cheque/originals/chung_king_bank_1935_composite.jpg", (0.008, 0.293, 0.405, 0.992), [
        (0.020, 0.760, 0.135, 0.985),   # drawer signature and personal seal
        (0.255, 0.660, 0.375, 0.810),   # handwritten signature across the cheque
    ]),
    # Hong Kong cheque sample drawn for Wikipedia (fictional bank, payee and signature)
    "hk_wiki_bank_sample": ("cheque/originals/hk_cheque_sample.png", None, []),
    # Ta Yo Bank, 1923, the "5000-yuan cheque" (newspaper reproduction); front side only
    "ta_yo_bank_1923": ("cheque/originals/cheque_5000_yuan_1923.tif", (0.505, 0.035, 1.000, 1.000), [
        (0.540, 0.680, 0.650, 0.840),   # drawer signature
    ]),
    # Bank of East Asia, Shanghai, 1949 (right-hand cheque of a museum display of three)
    "bea_shanghai_1949": ("cheque/originals/bea_shanghai_subbranch.jpg", (0.645, 0.075, 0.905, 0.890), [
        (0.650, 0.570, 0.735, 0.830),   # drawer signature
        (0.760, 0.360, 0.850, 0.650),   # handwritten payee / amount line
    ]),
}


def redact(im, box):
    w, h = im.size
    b = (int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h))
    region = im.crop(b)
    rw, rh = region.size
    k = max(8, min(rw, rh) // 4)
    small = region.resize((max(1, rw // k), max(1, rh // k)), Image.BILINEAR)
    im.paste(small.resize((rw, rh), Image.NEAREST).filter(ImageFilter.GaussianBlur(max(3, k // 3))), b[:2])


def load(path):
    im = Image.open(RAW / path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, "white")
        im = Image.alpha_composite(bg, im)
    return im.convert("RGB")


def run(table, outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    for key, (src, crop, boxes) in table.items():
        im = load(src)
        for box in boxes:
            redact(im, box)
        if crop:
            w, h = im.size
            im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        if max(im.size) > 3000:  # keep raw/prepped small; final build resizes to 1024 anyway
            s = 3000 / max(im.size)
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        im.save(outdir / f"{key}.png")
        print(key, im.size, f"{len(boxes)} redactions")


if __name__ == "__main__":
    run(INVOICES, RAW / "invoice" / "prepped")
    run(CHEQUES, RAW / "cheque" / "prepped")
