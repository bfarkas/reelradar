import sys,urllib.parse,json,datetime
# Decode the page beacons (GET /log?{json}) from a python http.server log: python3 logs.py server.log [all]  (all = keep the user agent)
for l in open(sys.argv[1]):
    if '"GET /log?' not in l: continue
    q=urllib.parse.unquote(l.split('/log?')[1].split(' HTTP')[0]); d=json.loads(q)
    t=datetime.datetime.fromtimestamp(d.pop('at')/1000).strftime('%H:%M:%S')
    d.pop('ua',None) if len(sys.argv)<3 else None
    print(t, json.dumps(d)[:300])
