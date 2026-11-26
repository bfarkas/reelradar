"""tokens.json -> tokens.css. Run: python3 design/build_tokens.py"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
t = json.load(open(os.path.join(HERE, "tokens.json")))
first = t["color"]["themes"][0]["id"]

def val(v, theme):
    v = v if isinstance(v, str) else v.get(theme, v.get(first))
    return re.sub(r"^\{(.+)\}$", r"var(--\1)", v)

def block(sel, theme, families, only_changed=False):
    out = []
    for fam in families:
        for tok in t[fam]["tokens"]:
            v = tok["value"]
            if only_changed and (isinstance(v, str) or theme not in v):
                continue
            out.append(f"  --{tok['name']}: {val(v, theme)};")
    return f"{sel} {{\n" + "\n".join(out) + "\n}\n"

themed = ["color", "shadow"]
plain = [k for k in t if isinstance(t[k], dict) and "tokens" in t[k] and k not in themed]
css = ["/* ReelRadar tokens, generated from tokens.json by build_tokens.py. Do not edit. */\n"]
css.append(block(f':root, [data-theme="{first}"]', first, themed))
for th in t["color"]["themes"][1:]:
    body = block("", th["id"], themed, only_changed=True).replace("}\n", "  color-scheme: dark;\n}\n")
    css.append(f'[data-theme="{th["id"]}"]' + body)
    # Web follows the system setting unless a theme is forced; the TV sets data-theme="dark".
    css.append('@media (prefers-color-scheme: dark) {\n:root:not([data-theme="light"])' + body + "}\n")
fam = t["type"]["families"]
css.append(":root {\n" + "\n".join(f"  --font-{k}: {v};" for k, v in fam.items()) + "\n"
           + "\n".join(f"  --{tok['name']}: {tok['value']};" for f in plain for tok in t[f]["tokens"]) + "\n}\n")
for g in t["type"]["groups"]:
    for s in g["styles"]:
        ls = f" letter-spacing: {s['letterSpacing']};" if "letterSpacing" in s else ""
        up = " text-transform: uppercase;" if s["name"].endswith("label") else ""
        css.append(f".{s['name']} {{ font: {s['fontWeight']} {s['fontSize']}/{s['lineHeight']} var(--font-{g['family']});{ls}{up} }}\n")
open(os.path.join(HERE, "tokens.css"), "w").write("\n".join(css))
