# Nuvama document images · China

The China version of `nuvama_document_images/` (India): a small image dataset for a **document-type classifier**
in the YaaraLabs Playground Image Recognition project, built for the Nuvama Asset Services workshop. Same four labels,
same processing, same test-set recipe; the documents are Chinese (mainland, plus two Hong Kong KYC forms and one
Hong Kong cheque sample).

| Folder | Images | What it is |
|---|---|---|
| `KYC/` | 5 | Blank account-opening / client-information forms: CSDC, China Merchants Fund, J.P. Morgan AM (China), HSBC Rural Bank (China), China Galaxy International (HK) |
| `corporate_action/` | 5 | SSE / SZSE company announcements (CNINFO): cash dividend x2, bonus shares from capital reserve, buyback, dividend + bonus; 5 companies |
| `invoice/` | 5 | Fapiao, each a different layout: Guangdong VAT e-invoice, Shanghai VAT invoice, Shanghai quota invoice, Sichuan machine-printed invoice, State Taxation Administration digital VAT special-invoice specimen |
| `cheque/` | 5 | 3 real cheque photos/scans (Shanghai 1950s, Shanghai Republican era, Chengdu 1935), 1 Hong Kong cheque sample (Wikipedia drawing), 1 synthetic **SPECIMEN** 转账支票 |
| `test/` | 12 | 3 per label from documents not used in training; 1 clean + 2 degraded each; shuffled (`test_01`...`test_12`) |

Also here: `SOURCES.csv` (file, label, source_url, licence, notes), `test_key.csv` (file, true_label, source, condition),
`contact_sheet.png`, and `raw/` (original downloads, redacted intermediates, scripts in `raw/_scripts/`).
All images are JPG, RGB, longest side 1024 px, quality 88, under 2 MB (32 images, 3.4 MB in total). Label values in the CSVs
are the app labels: `KYC`, `Corporate action`, `Invoice`, `Cheque`.

App copy: `frontend/public/datasets/nuvama_documents_cn/` (same images + `manifest.json`, same format as the India manifest, no deepTest).

## Sources, in short
- **KYC**: publicly published blank forms (no licence stated). Training: CSDC 自然人证券账户注册申请表 (annex to a CSDC notice republished by
  China Fortune Securities), China Merchants Fund individual account form, J.P. Morgan AM (China) individual account form, HSBC Rural Bank
  commercial account opening form, China Galaxy International (HK) account application. Test: CSDC securities account opening form for
  entities (bilingual, Clearstream copy; clean), HKEX individual investor account form (phone photo), Shenwan Hongyuan Futures individual
  client application (bottom cut off). Only the page that is the form; all blank.
- **Corporate action**: page 1 of announcements on CNINFO (static.cninfo.com.cn). Page 1 of these notices has no sign-off, names or signatures.
  Training: Changjiang Securities, Joincare, Zhongjing Food, HEC Technology (东阳光), Ruida Futures. Test: Yunnan Energy New Material (恩捷),
  Hetai Machinery, Jingjia Microelectronics. 8 different companies.
- **Invoice**: Wikimedia Commons (CC BY-SA 4.0 or public domain) and the State Taxation Administration's official blank specimens
  (Announcement 2024 No. 11, `数电发票样式.doc`). Taxpayer IDs (incl. those inside invoice seals), a mobile number, the issuer's name,
  taxi plates and driver numbers are pixelated by `prep_redactions.py`. Company names are kept.
- **Cheque**: Wikimedia Commons (CC BY-SA 4.0 / 3.0 / public domain). Signatures, personal seals and handwritten names are pixelated.
  Modern mainland cheques are not available under an open licence, so two **synthetic SPECIMEN** cheques (a 转账支票 for training,
  a 现金支票 for test) were drawn by `make_cheques_cn.py`: PBOC-style layout, fictional banks (青岚商业银行, 云杉农村商业银行), fictional
  payees and `QX` account numbers, a large "样本 SPECIMEN" stamp, no signatures. 6 of the 8 cheques are real.

CC BY-SA images must keep their credit (see `SOURCES.csv`) and the same licence if shared. Forms and filings with no stated licence are
used for internal, non-commercial training only.

## Test set
| Label | Clean | Degraded 1 | Degraded 2 |
|---|---|---|---|
| KYC | CSDC entity form | HKEX form: phone photo (skew 12 deg, rotation -3 deg, shadow, dark desk) | Shenwan futures form: bottom 25% cut off |
| Corporate action | 恩捷股份 dividend | 和泰机电 bonus: Gaussian blur r=3 | 景嘉微 buyback: low light / low contrast |
| Invoice | Beijing court fee receipt | Shenzhen taxi invoices: JPEG quality 6 | STA motor-vehicle invoice specimen: 15 px motion blur |
| Cheque | Ta Yo Bank 1923 | SPECIMEN 现金支票: phone photo (skew 9 deg, rotation 4 deg) | Bank of East Asia Shanghai 1949: right 22% cut off |

Shuffled with seed 2026. pHash/dHash check: no test image is a near-copy of a training image (closest pair pHash 12: two different
companies' announcements, which share the standard CSRC layout).

## Rebuilding
With Python, `pymupdf`, `pillow`, `imagehash`, `numpy` (and Windows fonts msyh/simsun/consola/arial), from this folder:
```
python raw/_scripts/prep_redactions.py .
python raw/_scripts/make_cheques_cn.py raw/cheque/synthetic
python raw/_scripts/build_dataset_cn.py . ../frontend/public/datasets/nuvama_documents_cn
```
`raw/_scripts/commons_api.py` and `cninfo_search.py` are the search helpers used to find the sources.
