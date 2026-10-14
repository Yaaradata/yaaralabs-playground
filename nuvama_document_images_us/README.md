# Nuvama document images · United States

The US version of `nuvama_document_images/` (India). It is a small image dataset for the **document-type classifier**
in the YaaraLabs Playground Image Recognition project, built for the Nuvama Asset Services workshop. The model
learns what kind of document a US client has sent.

| Folder | Images | What it is |
|---|---|---|
| `KYC/` | 5 | Blank US brokerage / fund account-opening forms, each from a different firm |
| `corporate_action/` | 5 | SEC 8-K Exhibit 99.1 press releases: dividend, stock split, spin-off, acquisition, buyback; 5 different companies |
| `invoice/` | 5 | US invoices (USD), each with a different layout: 2 FATURA, 1 NJ state sample, 2 real (1975, 1906) |
| `cheque/` | 5 | Real US check photos/scans (Wikimedia Commons), each from a different bank, personal details blurred |
| `test/` | 12 | 3 per class from documents used nowhere in training; 1 clean + 2 degraded each; shuffled |

Also here:
- `test_key.csv`: `file, true_label, source, condition` for every test image
- `SOURCES.csv`: `file, label, source_url, licence, notes` for all 32 images
- `contact_sheet.png`: every image as a labelled thumbnail
- `raw/`: original downloads and the build scripts (`raw/_scripts/`)

All images are JPG, RGB, longest side 1024 px, under 2 MB (largest 254 KB; 3.7 MB for all 32). PDFs are rendered at 150 dpi.

The app copy is in `frontend/public/datasets/nuvama_documents_us/` (same images plus `manifest.json`, labels
`KYC`, `Corporate action`, `Invoice`, `Cheque`).

## Sources

### KYC: blank forms published by US firms
The page that is the form (cover and instruction pages skipped). All blank.

| File | Source | Page |
|---|---|---|
| kyc_01 | Fidelity Investments: Mutual Fund Account Application | 3 |
| kyc_02 | Vanguard: Brokerage Account application (Form FARF) | 3 |
| kyc_03 | E*TRADE from Morgan Stanley: Complete Investment Account Application | 2 |
| kyc_04 | T. Rowe Price: Mutual Fund New Account | 1 |
| kyc_05 | Apex Clearing: New Account Application & Agreement | 1 |
| test | BNY Mellon Funds Account Application (p7), BayFirst bank CIP form (p1), IRS Form W-9 (p1) | |

### Corporate action: SEC EDGAR 8-K Exhibit 99.1
The exhibit HTML was printed to US Letter with headless Edge (`render_edgar_html.py`, EDGAR wrapper stripped,
logos from the same filing folder) and page 1 was used. Press releases have no signature block. They name the
companies' own media and IR contacts, which is published business contact information.

| File | Company | Action |
|---|---|---|
| ca_01 | Keurig Dr Pepper | quarterly dividend |
| ca_02 | Fastenal | 2-for-1 stock split |
| ca_03 | Honeywell | Solstice spin-off record date |
| ca_04 | Itron | acquisition of Urbint |
| ca_05 | Stitch Fix | share repurchase |
| test | Netflix (10-for-1 split), Lennar (Millrose spin-off), BorgWarner (dividend) | |

### Invoice
| File | Source | Licence |
|---|---|---|
| inv_01 | FATURA Template 18 (generated, USD, fake US addresses) | CC BY 4.0 |
| inv_02 | MITS Inc. invoice for an Altair 8800, 1974/75 (Wikimedia Commons, uploaded by Cromemco) | CC BY-SA 3.0 |
| inv_03 | New Jersey DOT sample vendor invoice (annotated required fields) | state publication, no licence stated |
| inv_04 | Watkins-Cottrell Co., Richmond VA, 1906 (Wikimedia Commons) | public domain |
| inv_05 | FATURA Template 39 | CC BY 4.0 |
| test | Oregon OPDS invoice example (state publication); Ashton Valve Co. 1888 (public domain); FATURA Template 43 (CC BY 4.0) | |

FATURA: Limam, M. et al., *FATURA: A Multi-Layout Invoice Image Dataset*, Zenodo, doi:10.5281/zenodo.10371464.
Templates 18, 39 and 43 were not used in the India set (which used 1, 7, 10, 13, 16, 28, 40, 46, and 19, 22, 25,
31, 34 in its deep test). FATURA picks the currency per instance; these three instances are in dollars and have no GSTIN.

### Cheque: real US checks from Wikimedia Commons
`prep_real_cheques.py` pixelates the names of private individuals, account and loan numbers and signatures.

| File | Check | Licence |
|---|---|---|
| chq_01 | Bank of Reubens, Idaho, blank leaf, c. 1920s | CC BY 2.0, Steve Shook (Flickr) |
| chq_02 | Wells Fargo Bank cashier's check, 2006 (a counterfeit used in a scam) | CC BY-SA 3.0, Kalmia |
| chq_03 | The Columbus Savings Bank Co., Ohio, 1881 | public domain (DPLA) |
| chq_04 | Commercial State Bank, Oakesdale WA, 1915 | CC BY 2.0, Steve Shook (Flickr) |
| chq_05 | Banking House of R.S. Battles, draft on Chase National Bank, 1911 | public domain |
| test | Citibank N.A. official check 2013 (CC0, Tomwsulcer), US Treasury warrant 1865 to President Lincoln (public domain), Riggs National Bank 1953, Burmese Embassy to the Red Cross (public domain, NARA) | |

CC BY-SA images must keep this credit and the same licence if they are shared.

## Test set
| Class | Clean | Degraded 1 | Degraded 2 |
|---|---|---|---|
| KYC | BNY Mellon | BayFirst: phone-photo look (skew 12 deg, rotation -3 deg, shadow, dark desk) | W-9: bottom 25% cut off |
| corporate_action | Netflix | Lennar: Gaussian blur, radius 3 | BorgWarner: low light (brightness x0.45, contrast x0.5) |
| invoice | Oregon example | FATURA T43: JPEG quality 6 | Ashton Valve 1888: motion blur 15 px |
| cheque | Citibank 2013 | US Treasury 1865: phone-photo look (skew 9 deg, rotation 4 deg) | Riggs 1953: right 22% cut off |

Shuffled with a fixed seed, so `test_01` to `test_12` are not in class order.

## Checks run
- Counts: 5 / 5 / 5 / 5 / 12. All JPG, RGB, 1024 px long side, under 2 MB.
- Perceptual hash between every test and training image: the closest pair is test_02 (Lennar, blurred) and
  ca_02 (Fastenal), pHash distance 10. They are different companies' press releases with similar text-only layouts, not duplicates.
- Every image was viewed.

## Licences, in short
- Public domain: IRS W-9, US Treasury 1865 and Riggs 1953 checks, Columbus Savings, R.S. Battles, Watkins-Cottrell, Ashton Valve.
- CC0: Citibank check. CC BY 2.0: Bank of Reubens, Commercial State Bank. CC BY-SA 3.0: Wells Fargo check, MITS invoice.
  CC BY 4.0: FATURA invoices.
- Firms' blank forms, SEC exhibits and the NJ/Oregon state samples are publicly published but **state no licence**.
  They are used here for internal, non-commercial training only.

## Rebuilding
From this folder, with Python and `pymupdf`, `pillow`, `imagehash`, `numpy`, `playwright` (Edge installed):
```
python raw/_scripts/render_edgar_html.py raw/corporate_action
python raw/_scripts/prep_real_cheques.py .
python raw/_scripts/build_dataset.py . ../frontend/public/datasets/nuvama_documents_us
```
`raw/_scripts/fatura_fetch.py` downloads single FATURA images without the whole archive.
