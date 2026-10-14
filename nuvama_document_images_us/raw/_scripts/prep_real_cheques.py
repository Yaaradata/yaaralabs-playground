"""Prepare the real US check photos (Wikimedia Commons) in raw/cheque/: crop and redact personal details.

usage: prep_real_cheques.py ROOT   (ROOT = .../nuvama_document_images_us; originals in raw/cheque/originals/)

Redaction = pixelate + blur, so names of private individuals, account / loan numbers and signatures
cannot be read. Boxes are (x0, y0, x1, y1) in the original image's pixels.
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(sys.argv[1])
SRC = ROOT / "raw" / "cheque" / "originals"
OUT = ROOT / "raw" / "cheque"

# key: (original file, crop box or None, boxes to redact)
CHEQUES = {
    "bank_of_reubens_1920s": ("bank_of_reubens_1920s.jpg", None, []),  # blank leaf: nothing personal on it
    "wells_fargo_2006": ("wells_fargo_2006.jpg", None, [
        (190, 290, 1000, 400),     # loan number, 'For' number and remitter names
        (1560, 780, 2230, 960),    # signature
        (1140, 995, 1760, 1075),   # account number in the MICR line
    ]),
    "columbus_savings_1881": ("columbus_savings_1881.jpg", None, [
        (1110, 590, 1860, 770),    # drawer's signature
    ]),
    "commercial_state_bank_1915": ("commercial_state_bank_1915.jpg", None, [
        (1200, 660, 2800, 870),    # payee name
        (1840, 950, 3430, 1230),   # drawer's signature
    ]),
    "battles_chase_1911": ("battles_chase_1911.jpg", None, [
        (590, 285, 840, 392),      # cashier's signature
    ]),
    "citibank_2013": ("scam_check.jpg", None, []),  # payee, remitter and FC number already removed by the uploader
    "us_treasury_1865": ("us_treasury_lincoln_1865.jpg", None, []),  # 1865 Treasury warrant to President Lincoln (public figure)
    "riggs_burmese_embassy_1953": ("burmese_embassy_1953.jpg", None, [
        (325, 258, 475, 298),      # signature
        (445, 292, 540, 328),      # second signature
    ]),
}


def redact(im, box):
    region = im.crop(box)
    w, h = region.size
    small = region.resize((max(1, w // 24), max(1, h // 24)), Image.BILINEAR)
    im.paste(small.resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(6)), box[:2])


def main():
    for key, (name, crop, boxes) in CHEQUES.items():
        im = Image.open(SRC / name).convert("RGB")
        for box in boxes:
            redact(im, box)
        if crop:
            im = im.crop(crop)
        im.save(OUT / f"{key}.png")
        print(key, im.size, f"{len(boxes)} redactions")


if __name__ == "__main__":
    main()
