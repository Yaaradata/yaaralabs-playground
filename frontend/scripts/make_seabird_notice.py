"""Makes the Ex 10 training notice: public/datasets/copilot/Seabird_dividend_notice_TRAINING.pdf.

A fictional company's record-date notice with four traps for Document AI: two BSE codes (543210 in the address,
543201 in the table), no ISIN, no fixed payment date, and an Annexure A that is mentioned but not attached.

Needs reportlab:  python -m pip install reportlab
Run from frontend/:  python scripts/make_seabird_notice.py public/datasets/copilot/Seabird_dividend_notice_TRAINING.pdf
"""

import os
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Any TTF font works: DejaVu (Linux), then Arial (Windows), then Arial (macOS).
FONTS = [
    ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    ('C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'),
    ('/Library/Fonts/Arial.ttf', '/Library/Fonts/Arial Bold.ttf'),
]
regular, bold_font = next(((r, b) for r, b in FONTS if os.path.exists(r) and os.path.exists(b)), (None, None))
if not regular:
    sys.exit('No TTF font found: edit FONTS in this script.')
pdfmetrics.registerFont(TTFont('S', regular))
pdfmetrics.registerFont(TTFont('SB', bold_font))
out = sys.argv[1]
base = ParagraphStyle('b', fontName='S', fontSize=10, leading=14)
bold = ParagraphStyle('bb', parent=base, fontName='SB')
head = ParagraphStyle('h', parent=base, fontName='SB', fontSize=15, leading=19)
small = ParagraphStyle('s', parent=base, fontSize=8, leading=11, textColor=colors.grey)


def wm(c, d):
    c.saveState(); c.setFont('SB', 9); c.setFillColor(colors.HexColor('#B00020'))
    c.drawString(2*cm, A4[1]-1.2*cm, 'TRAINING SAMPLE – FICTIONAL COMPANY. NOT A REAL EXCHANGE FILING.')
    c.setFont('SB', 60); c.setFillColor(colors.Color(0.85, 0.85, 0.85, alpha=0.35))
    c.translate(A4[0]/2, A4[1]/2); c.rotate(35); c.drawCentredString(0, 0, 'TRAINING SAMPLE'); c.restoreState()


doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm,
                        title='Seabird Industries – Intimation of record date (training sample)')
s = [Paragraph('SEABIRD INDUSTRIES LIMITED', head),
     Paragraph('Registered office: 7 Harbour Road, Fort, Mumbai 400001 · Fictional company for training', small), Spacer(1, 14),
     Paragraph('Date: 12 October 2026', base), Spacer(1, 8),
     Paragraph('To: National Stock Exchange of India Ltd (NSE Symbol: SEABIRD)<br/>BSE Limited (Scrip Code: 543210)', base), Spacer(1, 10),
     Paragraph('Sub: Intimation of Record Date for Final Dividend for FY 2025-26', bold), Spacer(1, 8),
     Paragraph('Dear Sir / Madam,', base), Spacer(1, 6),
     Paragraph('Pursuant to Regulation 42 of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015, '
               'we wish to inform you that the Board of Directors, at its meeting held on 12 October 2026, has '
               'recommended a final dividend of Rs 4.50 per equity share of face value Rs 2 each (225%) for the financial year 2025-26.', base), Spacer(1, 6),
     Paragraph('The Company has fixed Friday, 6 November 2026 as the Record Date for determining the members '
               'entitled to receive the final dividend. The dividend, if approved by the shareholders at the '
               'Annual General Meeting to be held on 20 November 2026, will be paid within 30 days of the AGM.', base), Spacer(1, 10)]
t = Table([['Particulars', 'Details'], ['Security', 'Equity shares, face value Rs 2'], ['BSE Scrip Code', '543201'],
           ['Type of corporate action', 'Final dividend (if declared)'], ['Dividend per share', 'Rs 4.50'],
           ['Record date', '06-11-2026'], ['AGM date', '20-11-2026'], ['Payment date', 'Will be intimated separately']],
          colWidths=[6*cm, 10*cm])
t.setStyle(TableStyle([('FONT', (0, 0), (-1, -1), 'S', 9.5), ('FONT', (0, 0), (-1, 0), 'SB', 9.5),
                       ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E4EBF3')),
                       ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#9AA8B8')), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
s += [t, Spacer(1, 10), Paragraph('The certified copy of the Board resolution is enclosed as Annexure A.', base), Spacer(1, 6),
      Paragraph('Kindly take the above on record.', base), Spacer(1, 14), Paragraph('For Seabird Industries Limited', base), Spacer(1, 22),
      Paragraph('K. Menon<br/>Company Secretary and Compliance Officer', base), Spacer(1, 16), Paragraph('Encl.: As above', small)]
doc.build(s, onFirstPage=wm)
