# Nuvama document images

A small image dataset for a **document-type classifier** (MobileNet transfer learning in the
YaaraLabs Playground Image Recognition project). Built for the Nuvama Asset Services AI workshop:
the model learns to recognise what kind of document a client has sent.

| Folder | Images | What it is |
|---|---|---|
| `KYC/` | 5 | Blank KYC / demat account-opening forms (individual and non-individual), each from a different firm |
| `corporate_action/` | 5 | Stock-exchange corporate-action notices: dividend, bonus, buyback, stock split; 5 different companies |
| `invoice/` | 5 | Business invoices, each from a different layout template |
| `cheque/` | 5 | 2 synthetic **SPECIMEN** cheques (fictional banks) + 3 real cheque photos (Wikimedia Commons) |
| `test/` | 12 | 3 per class, from documents not used in training; 1 clean + 2 degraded each; shuffled |
| `test/deep test/` | 20 | 5 per class, from documents used nowhere else; handwriting + 4 or more defects each (see below) |

Also here:
- `test_key.csv`: `file, true_label, source, condition` for every test image
- `SOURCES.csv`: `file, label, source_url, licence, notes` for all 32 images
- `contact_sheet.png`: every image as a labelled thumbnail
- `nuvama_document_images.zip`: the five image folders, ready to upload
- `raw/`: original downloads and the build scripts (`raw/_scripts/`); not in the zip

All images are JPG, RGB, longest side 1024 px, under 2 MB.

## How to use it in the Playground

1. Create an **Image Recognition** project.
2. Make four labels: `KYC`, `corporate_action`, `invoice`, `cheque`, and upload the 5 images from each folder.
3. Train, then test with the images in `test/`. They are named `test_01` to `test_12` so the class is not
   given away; `test_key.csv` has the answers and says how each image was degraded.

## Where the images came from

### KYC (publicly published blank forms)
First page of each form that is the actual form: cover pages, indexes, checklists and instruction pages
were skipped. All forms are blank: no names, PANs, Aadhaar numbers, signatures or personal addresses.

| File | Source | Page |
|---|---|---|
| kyc_01 | Sharekhan: CKYC application form, legal entity (NSDL non-individual kit) | 9 |
| kyc_02 | Motilal Oswal: KYC application form, individual | 8 |
| kyc_03 | JKB Financial Services: Part I KYC, demat & trading account opening | 2 |
| kyc_04 | Union Bank of India: SARAL account opening form | 1 |
| kyc_05 | HSBC Mutual Fund: CKYC application form, individual | 1 |
| test | Yes Securities (NRI individual), CDSL Annexure 2.2 (non-individual), SVC Co-operative Bank (CKYC) | 3, 12, 1 |

### Corporate action (public stock-exchange filings)
Page 1 of each notice, **cropped above the sign-off**, so no signature or signatory name appears. Where
page 1 has no sign-off (eClerx, Vesuvius), the page is kept whole; its footer shows only the company's
office address.

| File | Company | Action |
|---|---|---|
| ca_01 | Repco Home Finance | interim dividend record date |
| ca_02 | Ashok Leyland | 1:1 bonus record date |
| ca_03 | eClerx Services | buyback record date |
| ca_04 | Info Edge (India) | stock split record date |
| ca_05 | Remus Pharmaceuticals | 1:1 bonus record date |
| test | Eris Lifesciences (dividend), Vesuvius India (split), SIS Ltd (buyback) | |

8 different companies across training and test. No rights-issue notice was used.

### Invoice: FATURA dataset (CC BY 4.0)
Limam, M. et al., *FATURA: A Multi-Layout Invoice Image Dataset for Document Analysis and Understanding*,
Zenodo, https://zenodo.org/records/10371464 (doi:10.5281/zenodo.10371464), licence CC BY 4.0.
FATURA has 50 layout templates; one image was taken from each of 8 different templates (training:
templates 1, 7, 13, 16, 28; test: 10, 40, 46), so no two images share a layout. Only those 8 images
were fetched from the 690 MB archive. The invoice contents (companies, names, addresses) are FATURA's own
generated fake data. Originals are 595 x 841 px and were upscaled to 1024 px on the long side.

### Cheque: 2 synthetic + 3 real photos (training), 1 synthetic + 2 real (test)
So the model does not learn "red SPECIMEN stamp = cheque", the cheque class mixes both kinds.

**Real cheque photos** (Wikimedia Commons; cropped and redacted by `raw/_scripts/prep_real_cheques.py`, which
pixelates payee names, account numbers, personal seals and signatures):

| File | Cheque | Licence |
|---|---|---|
| `cheque/chq_03.jpg` | Assam Gramin Vikash Bank, blank leaf (India) | CC BY-SA 4.0, Chiring chandan |
| `cheque/chq_04.jpg` | UCO Bank, filled in by hand (India) | CC BY-SA 3.0, Tshrinivasan |
| `cheque/chq_05.jpg` | WestLB crossed cheque, 2004 (Germany) | Public domain |
| `test/test_09.jpg` | First Commercial Bank, 2014 (Taiwan) | CC BY-SA 4.0, Solomon203 |
| `test/test_08.jpg` | Deutsche Bank, handwritten, 1909 | No known copyright restrictions (Flickr Commons) |

Source links are in `SOURCES.csv`. CC BY-SA images must keep this credit and the same licence if shared.

**Synthetic SPECIMEN cheques** (`chq_01`, `chq_02`, `test_05`): made with `raw/_scripts/make_cheques.py`: CTS-2010-like layout (payee line, amount in words and
figures, date boxes, account boxes, MICR band, blank signature area), the word **SPECIMEN** across
each, and "VALID FOR 3 MONTHS ONLY". Each uses a different **fictional** bank (Kestrel Valley,
Indigo Harbour, Saffron Ridge, Lotus Meadow, Peacock Hill, Monsoon Trust, Tamarind Grove, Marigold
Coast), its own colours, a simple drawn mark (not a real logo), and varied placement so they are not
near-copies of each other. Payees, account numbers, IFSC codes (all start with `QX`, which no real bank
uses) and MICR numbers are invented. These synthetic ones use no real bank names or logos and nothing from the
IDRBT dataset. No signatures.

## How the test images were made
For each class: one clean image from a new document, and two degraded copies of other new documents.
Degradations differ by class, and each is recorded in `test_key.csv`:

| Class | Clean | Degraded 1 | Degraded 2 |
|---|---|---|---|
| KYC | Yes Securities | phone-photo look: perspective skew 12 deg, rotation -3 deg, shadow gradient, dark desk | partial crop: bottom 25% cut off |
| corporate_action | Eris | Gaussian blur, radius 3 | low light / low contrast (brightness x0.45, contrast x0.5) |
| invoice | Template 10 | heavy JPEG compression, quality 6 | motion blur, 15 px horizontal |
| cheque | First Commercial Bank (real scan) | Tamarind Grove SPECIMEN: phone-photo look, skew 9 deg, rotation 4 deg, shadow, dark desk | Deutsche Bank 1909 (real photo): partial crop, right 22% cut off |

The 12 were shuffled with a fixed seed, so `test_01`...`test_12` do not follow class order.

## Deep test (`test/deep test/`)
A harder test set for uploading by hand: 5 images per class, in class folders (`KYC/`, `corporate_action/`,
`invoice/`, `cheque/`), each with handwriting and at least four defects at once. `deep_test_key.csv` lists the
true label, source, licence and the exact defects of every image; `contact_sheet.png` shows them all.

| Class | Documents (none used in training or `test/`) | Handwriting / markings |
|---|---|---|
| KYC | Aditya Birla Sun Life MF KYC form p1 and p2, CDSL Annexure 2.1 p1 and p2, HSBC MF CKYC form p2 | form filled in by hand next to its own labels (name, PAN, DOB, mobile, email, address, city, PIN), ticked boxes, signature scrawl |
| Corporate action | Aaron Industries, Bajaj Consumer Care, Bharat Rasayan, Dhampur Bio Organics, Tega Industries notices (cropped above the sign-off) | margin notes, record date circled, highlighter, tick |
| Invoice | FATURA templates 19, 22, 25, 31, 34 | PAID / RECEIVED stamps, handwritten approval and notes, total circled, amount struck through and corrected |
| Cheque | new fictional banks (Banyan Bay, Cardamom Ridge, Pearl Lagoon, Teakwood Harbour, Jasmine Delta) | handwritten date and signature, "A/c payee" |

Defects mixed across the set: phone photo (perspective skew, rotation, shadow, dark desk), coffee stain, fold
crease, punch holes, thumb over the edge, photocopy (grey, speckle, fading toner), yellowed paper, low light,
blur, motion blur, rotation, partial crop, sensor noise, heavy JPEG compression (quality 20-30).

All handwritten personal details are invented (example.com emails, sample PAN numbers, 90000 mobile numbers).
Rebuild with `python raw/_scripts/make_deep_test.py .` (needs `pymupdf`, `pillow`, `imagehash`, `numpy`).

## Checks run
- Counts: 5 / 5 / 5 / 5 / 12. All JPG, RGB, 1024 px long side, under 2 MB.
- Perceptual hash (pHash and dHash) between every test and every training image: no near-duplicates;
  the closest pair is pHash distance 14 (test_10 vs invoice/inv_05, two different FATURA templates).
- Within training, ca_01 (Repco) and ca_05 (Remus) are at pHash distance 12: two different companies'
  letters with a similar letter layout, not duplicates.
- Every image was viewed (see `contact_sheet.png`).

## Licences, in short
- FATURA invoices: CC BY 4.0 (credit above).
- Cheques: chq_01, chq_02 and test_05 are synthetic, made for this dataset. chq_03, chq_04, chq_05, test_08 and
  test_09 are real photos from Wikimedia Commons (CC BY-SA 4.0 / CC BY-SA 3.0 / public domain; see the table above).
- KYC forms and exchange notices: publicly published documents with **no licence stated**. They are
  used here for internal, non-commercial training only; check with the publishers before any other use.

## Rebuilding
From this folder, with Python and `pymupdf`, `pillow`, `imagehash`, `numpy`:
```
python raw/_scripts/make_cheques.py raw/cheque
python raw/_scripts/prep_real_cheques.py .   # needs the Commons originals in raw/cheque_real/originals/
python raw/_scripts/build_dataset.py .
```
`raw/_scripts/fatura_fetch.py` downloads single FATURA images without the whole archive. The build
uses Windows fonts (Arial, Georgia, Consolas, Segoe) for the cheques and the contact sheet.
