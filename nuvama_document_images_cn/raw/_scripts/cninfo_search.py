"""Search cninfo.com.cn announcements. usage: cninfo_search.py KEYWORD [column: szse|sse] [seDate]"""
import sys, json, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
kw = sys.argv[1]; col = sys.argv[2] if len(sys.argv) > 2 else "szse"; dt = sys.argv[3] if len(sys.argv) > 3 else "2025-01-01~2026-10-14"
body = urllib.parse.urlencode({"pageNum": 1, "pageSize": 30, "column": col, "tabName": "fulltext", "plate": "", "stock": "", "searchkey": kw,
                               "secid": "", "category": "", "trade": "", "seDate": dt, "sortName": "", "sortType": "", "isHLtitle": "true"}).encode()
req = urllib.request.Request("http://www.cninfo.com.cn/new/hisAnnouncement/query", data=body, headers={
    "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": "http://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search"})
d = json.load(urllib.request.urlopen(req, timeout=60))
for a in d.get("announcements") or []:
    t = a["announcementTitle"].replace("<em>", "").replace("</em>", "")
    print(a["secCode"], a["secName"], t, "http://static.cninfo.com.cn/" + a["adjunctUrl"])
