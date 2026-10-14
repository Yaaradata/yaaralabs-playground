"""Print SEC EDGAR exhibit HTML files to US-Letter PDFs (headless Edge via Playwright), like printing the filing.

usage: render_edgar_html.py DIR   (every *.htm in DIR becomes a .pdf next to it)

The EDGAR SGML wrapper (<DOCUMENT><TYPE>EX-99.1 ... <TEXT>) is stripped first so it does not print as text.
Logos referenced by the exhibit were downloaded next to it as <stem>__<image name> (see README).
Remote resources are blocked; any image that fails to load is hidden.
"""
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

DIR = Path(sys.argv[1]).resolve()

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge")
    page = browser.new_page()
    page.route("http*://**", lambda route: route.abort())
    for htm in sorted(DIR.glob("*.htm")):
        text = htm.read_text(encoding="latin-1")
        m = re.search(r"<html", text, re.I) or re.search(r"<TEXT>", text)
        text = text[m.start():] if m else text
        text = re.sub(r"</?(TEXT|DOCUMENT)>", "", text)
        tmp = htm.with_name(htm.stem + ".clean.html")
        tmp.write_text(text, encoding="latin-1")
        page.goto(tmp.as_uri())
        page.wait_for_load_state("load")
        page.evaluate("document.querySelectorAll('img').forEach(i => { if (!i.complete || i.naturalWidth === 0) i.style.display = 'none'; })")
        page.pdf(path=str(htm.with_suffix(".pdf")), format="Letter",
                 margin={"top": "0.6in", "bottom": "0.6in", "left": "0.75in", "right": "0.75in"},
                 print_background=True)
        tmp.unlink()
        print("pdf", htm.with_suffix(".pdf").name)
    browser.close()
