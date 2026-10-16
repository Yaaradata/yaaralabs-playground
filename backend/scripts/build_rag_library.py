"""Builds the RAG Chatbot document library (app/data/rag_chatbot/library/*.json) from the official PDFs.

Download the PDFs into RAW_DIR first (public SEBI circulars):
  sebi_custodian_guidelines_2026.pdf  https://www.sebi.gov.in/sebi_data/attachdocs/mar-2026/1772622419912.pdf
                                      (page: https://www.sebi.gov.in/legal/circulars/mar-2026/guidelines-for-custodians_100118.html)
  sebi_t0_beta_2024.pdf               https://www.sebi.gov.in/sebi_data/attachdocs/mar-2024/1711019839112.pdf
                                      (page: https://www.sebi.gov.in/legal/circulars/mar-2024/introduction-of-beta-version-of-t-0-rolling-settlement-cycle-on-optional-basis-in-addition-to-the-existing-t-1-settlement-cycle-in-equity-cash-markets_82455.html)
  sebi_t0_enhancement_2024.pdf        https://www.sebi.gov.in/sebi_data/attachdocs/dec-2024/1733829354031.pdf
                                      (page: https://www.sebi.gov.in/legal/circulars/dec-2024/enhancement-in-the-scope-of-optional-t-0-rolling-settlement-cycle-in-addition-to-the-existing-t-1-settlement-cycle-in-equity-cash-markets_89443.html)
  nse_cmpt_66135_2025.pdf             https://nsearchives.nseindia.com/content/circulars/CMPT66135.pdf
                                      (NSE blocks plain downloads: send a browser User-Agent and Referer: https://www.nseindia.com/)

Each JSON holds the document's metadata and its text page by page, extracted the same way an
upload is (rag_text.extract_pdf), so the library and learners' own files go through one pipeline.

usage (from backend/): python scripts/build_rag_library.py RAW_DIR
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.rag_text import extract_pdf  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "rag_chatbot" / "library"

DOCS = [
    {
        "id": "sebi-custodian-guidelines-2026",
        "file": "sebi_custodian_guidelines_2026.pdf",
        "title": "Guidelines for Custodians",
        "short": "Custodian guidelines",
        "issuer": "Securities and Exchange Board of India (SEBI)",
        "reference": "HO/19/(1)2025-AFD-FPICELL/I/5928/2026",
        "date": "2026-03-04",
        "effective": "2026-03-24",
        "sourceUrl": "https://www.sebi.gov.in/legal/circulars/mar-2026/guidelines-for-custodians_100118.html",
        "pdfUrl": "https://www.sebi.gov.in/sebi_data/attachdocs/mar-2026/1772622419912.pdf",
        "licence": "Public regulatory circular, published by SEBI",
        "summary": "What custodians must do: segregation of activities, outsourcing, vaults, governance, risk "
                   "management, IT capacity, orderly wind-down, business continuity and DR, and which reports stop.",
        "recommended": True,
    },
    {
        "id": "sebi-t0-beta-2024",
        "file": "sebi_t0_beta_2024.pdf",
        "title": "Introduction of Beta version of T+0 rolling settlement cycle on optional basis",
        "short": "T+0 beta circular",
        "issuer": "Securities and Exchange Board of India (SEBI)",
        "reference": "SEBI/HO/MRD/MRD-PoD-3/P/CIR/2024/20",
        "date": "2024-03-21",
        "effective": "2024-03-28",
        "sourceUrl": "https://www.sebi.gov.in/legal/circulars/mar-2024/introduction-of-beta-version-of-t-0-rolling-settlement-cycle-on-optional-basis-in-addition-to-the-existing-t-1-settlement-cycle-in-equity-cash-markets_82455.html",
        "pdfUrl": "https://www.sebi.gov.in/sebi_data/attachdocs/mar-2024/1711019839112.pdf",
        "licence": "Public regulatory circular, published by SEBI",
        "summary": "Same-day (T+0) settlement as an optional beta next to T+1: 25 scrips, trading hours, price band, netting.",
        "recommended": True,
    },
    {
        "id": "sebi-t0-enhancement-2024",
        "file": "sebi_t0_enhancement_2024.pdf",
        "title": "Enhancement in the scope of optional T+0 rolling settlement cycle",
        "short": "T+0 enhancement circular",
        "issuer": "Securities and Exchange Board of India (SEBI)",
        "reference": "SEBI/HO/MRD/MRD-PoD-3/P/CIR/2024/172",
        "date": "2024-12-10",
        "effective": "2025-01-31",
        "sourceUrl": "https://www.sebi.gov.in/legal/circulars/dec-2024/enhancement-in-the-scope-of-optional-t-0-rolling-settlement-cycle-in-addition-to-the-existing-t-1-settlement-cycle-in-equity-cash-markets_89443.html",
        "pdfUrl": "https://www.sebi.gov.in/sebi_data/attachdocs/dec-2024/1733829354031.pdf",
        "licence": "Public regulatory circular, published by SEBI",
        "summary": "T+0 widened to the top 500 scrips, all brokers allowed, a T+0 block deal window, and custodians "
                   "to put systems in place so institutional investors can take part (from 1 May 2025).",
        "recommended": True,
    },
    {
        "id": "nse-clearing-t0-custodians-2025",
        "file": "nse_cmpt_66135_2025.pdf",
        "title": "Additional clarification on custodian transactions in T+0 settlement cycle",
        "short": "NSE Clearing T+0 custodian circular",
        "issuer": "NSE Clearing Limited",
        "reference": "NCL/CMPT/66135",
        "date": "2025-01-15",
        "effective": "2025-02-10",
        "sourceUrl": "https://www.nseindia.com/static/products-services/t0-settlement-cycle",
        "pdfUrl": "https://nsearchives.nseindia.com/content/circulars/CMPT66135.pdf",
        "licence": "Public circular, published by NSE Clearing",
        "summary": "How custodians settle T+0 trades: family account CP codes, trade confirmation by 2:45 PM, "
                   "securities pay-in by 3:30 PM, funds pay-in by 4:00 PM. Check it is still current.",
        "recommended": True,
    },
]


def main(raw: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for meta in DOCS:
        data = (raw / meta["file"]).read_bytes()
        pages = extract_pdf(data)
        doc = {k: v for k, v in meta.items() if k != "file"}
        doc.update({
            "fileName": meta["file"],
            "fileSha1": hashlib.sha1(data).hexdigest(),
            "pages": [{"page": i + 1, "text": t} for i, t in enumerate(pages)],
        })
        doc["words"] = sum(len(p["text"].split()) for p in doc["pages"])
        doc["version"] = hashlib.sha1(json.dumps(doc["pages"], ensure_ascii=False).encode()).hexdigest()[:12]
        (OUT / f"{meta['id']}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        shutil.copyfile(raw / meta["file"], OUT / f"{meta['id']}.pdf")  # served to the viewer: sebi.gov.in can't be framed
        print(f"{meta['id']}: {len(pages)} pages, {doc['words']} words, version {doc['version']}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
