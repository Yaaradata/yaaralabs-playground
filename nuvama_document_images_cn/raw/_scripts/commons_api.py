"""Tiny Wikimedia Commons API helper with polite retry.
usage: commons_api.py search QUERY... | cat CATEGORY... | info FILE_TITLE...
"""
import sys, json, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
UA = {"User-Agent": "nuvama-dataset-builder/1.0 (internal workshop dataset; contact common.tech)"}
API = "https://commons.wikimedia.org/w/api.php?"

def get(params):
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(API + urllib.parse.urlencode(params), headers=UA), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (i + 1)); continue
            raise
    raise SystemExit("rate limited")

mode, args = sys.argv[1], sys.argv[2:]
for a in args:
    print("==", a)
    if mode == "search":
        d = get({"action": "query", "list": "search", "srnamespace": 6, "srlimit": 50, "format": "json", "srsearch": a})
        for r in d["query"]["search"]: print("  ", r["title"])
    elif mode == "cat":
        d = get({"action": "query", "list": "categorymembers", "cmtitle": a, "cmlimit": 200, "format": "json"})
        for r in d["query"]["categorymembers"]: print("  ", r["title"])
    elif mode == "info":
        d = get({"action": "query", "titles": a, "prop": "imageinfo", "iiprop": "url|size|extmetadata", "format": "json"})
        for p in d["query"]["pages"].values():
            ii = p.get("imageinfo", [{}])[0]
            m = ii.get("extmetadata", {})
            g = lambda k: m.get(k, {}).get("value", "")
            print("   url:", ii.get("url"), ii.get("width"), ii.get("height"))
            print("   licence:", g("LicenseShortName"), "| artist:", g("Artist")[:150])
            print("   desc:", g("ImageDescription")[:300].replace("\n", " "))
    time.sleep(1.5)
