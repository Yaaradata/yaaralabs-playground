"""Read the FATURA2.zip listing with HTTP range requests and extract chosen members only.

usage: fatura_fetch.py list               -> prints image members grouped by template
       fatura_fetch.py get OUT name1 ...  -> extracts those members into OUT
"""
import io
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

URL = "https://zenodo.org/api/records/10371464/files/FATURA2.zip/content"


class HttpRangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            self.url = r.geturl()
            self.size = int(r.headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        n = len(b)
        if self.pos >= self.size or n == 0:
            return 0
        end = min(self.pos + n, self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def open_zip():
    raw = HttpRangeFile(URL)
    return zipfile.ZipFile(io.BufferedReader(raw, buffer_size=1 << 20))


if __name__ == "__main__":
    z = open_zip()
    if sys.argv[1] == "list":
        groups = defaultdict(list)
        for info in z.infolist():
            if info.filename.lower().endswith((".jpg", ".jpeg", ".png")):
                m = re.search(r"(Template\d+)", info.filename, re.I)
                groups[m.group(1) if m else "?"].append((info.filename, info.file_size))
        print(len(groups), "templates;", sum(len(v) for v in groups.values()), "images")
        for k in sorted(groups, key=lambda s: int(re.sub(r"\D", "", s) or 0)):
            print(k, len(groups[k]), groups[k][0])
    else:
        out = Path(sys.argv[2])
        out.mkdir(parents=True, exist_ok=True)
        for name in sys.argv[3:]:
            data = z.read(name)
            (out / Path(name).name).write_bytes(data)
            print("got", name, len(data))
