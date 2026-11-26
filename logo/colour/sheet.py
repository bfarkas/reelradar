"""Colour sheet: python sheet.py out.png "Title" palettes.json  (run from kit/)"""
import re, sys, json, html, cairosvg
def d_of(f): return re.search(r' d="([^"]+)"', open(f).read()).group(1)
sym=d_of("masters/reelradar-symbol.svg"); parts=["M"+p for p in sym.split("M")[1:]]
lock=open("masters/reelradar-horizontal.svg").read()
wtr,wd=re.search(r'<g transform="([^"]+)"><path fill="[^"]+" d="([^"]+)"',lock).groups()
def lum(h):
    c=[int(h[i:i+2],16)/255 for i in (1,3,5)]; c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def cr(a,b): A,B=sorted([lum(a),lum(b)]); return (B+0.05)/(A+0.05)
out_png,title,P=sys.argv[1],sys.argv[2],json.load(open(sys.argv[3]))
F='font-family="Helvetica Neue,Helvetica,Arial"'
CW,CH,cols=760,300,2; rows=(len(P)+1)//2; W=120+CW*cols+40; H=130+rows*(CH+40)
o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="#F5F4F0"/>',
   f'<text x="60" y="70" {F} font-size="34" font-weight="700" fill="#111">{html.escape(title)}</text>',
   f'<text x="60" y="104" {F} font-size="17" fill="#666">App icon · on dark · on light (with the darker symbol shade used on light backgrounds).</text>']
def symbol(acc,x,y,s):
    body=f'<path fill="{acc[0]}" d="{sym}"/>' if len(acc)==1 else "".join(f'<path fill="{c}" d="{p}"/>' for c,p in zip(acc,parts))
    return f'<g transform="translate({x} {y}) scale({s})">{body}</g>'
def lockup(acc,word,x,y,s): return f'<g transform="translate({x} {y}) scale({s})">{symbol(acc,0,0,1)}<g transform="{wtr}"><path fill="{word}" d="{wd}"/></g></g>'
for i,p in enumerate(P):
    acc,ground,light,lsym,wl=p["accent"],p["ground"],p["light"],p["light_symbol"],p["word_on_light"]
    cx=60+(i%cols)*(CW+40); cy=130+(i//cols)*(CH+40)
    o.append(f'<g transform="translate({cx} {cy})"><rect width="{CW}" height="{CH}" rx="18" fill="#fff" stroke="#e4e2dc"/>')
    o.append(f'<rect x="28" y="28" width="150" height="150" rx="34" fill="{ground}"/>'+symbol(acc,28+150*0.13,28+150*0.13-4,150*0.74/256))
    o.append(f'<rect x="200" y="28" width="532" height="70" rx="10" fill="{ground}"/>'+lockup(acc,p.get("word_on_dark","#FFFFFF"),222,33,60/256))
    o.append(f'<rect x="200" y="108" width="532" height="70" rx="10" fill="{light}" stroke="#e4e2dc"/>'+lockup(lsym,wl,222,113,60/256))
    o.append(f'<text x="28" y="222" {F} font-size="22" font-weight="700" fill="#111">{html.escape(p["name"])}</text>')
    o.append(f'<text x="28" y="250" {F} font-size="15" fill="#555">{html.escape(p["note"])}</text>')
    sw=acc+[ground]+([lsym[0]] if lsym[0] not in acc else [])
    o.append("".join(f'<rect x="{28+j*96}" y="262" width="88" height="22" rx="4" fill="{c}" stroke="#ddd"/><text x="{28+j*96+44}" y="277" text-anchor="middle" font-family="Menlo,monospace" font-size="10" fill="{"#fff" if lum(c)<0.4 else "#111"}">{c}</text>' for j,c in enumerate(sw)))
    o.append(f'<text x="{CW-28}" y="277" text-anchor="end" {F} font-size="13" fill="#777">{cr(acc[0],ground):.1f}:1 on ground · {cr(lsym[0],light):.1f}:1 on light</text></g>')
o.append("</svg>")
svg="\n".join(o); open(out_png.replace(".png",".svg"),"w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(),write_to=out_png,output_width=1600); print("wrote",out_png)
