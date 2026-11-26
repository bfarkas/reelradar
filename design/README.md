# ReelRadar design kit

Colour, type and components for the web app (`frontend/`) and the Samsung TV app (`tv-app/`), built from the Play Sweep logo: Cinema Teal `#0D3438`, Reel Orange `#FF6A3D`, Inter.

Full reference with live previews and guidelines: https://claude.ai/artifact/61DccKKVUmAyuxqfB8hTPF

| File | What |
|---|---|
| `tokens.json` | The source: colours (light web / dark web + TV), type scales, spacing, radii, shadows, motion |
| `tokens.css` | CSS custom properties and type classes, generated: `python3 design/build_tokens.py` |
| `components.css` | Component classes (`rr-btn`, `rr-chip`, `rr-card`, `rr-tvposter` …). Load after `tokens.css` |

Use: load `tokens.css` then `components.css`, put `class="rr"` on `<body>`. On the TV add `rr-tv` and `data-theme="dark"` on `<html>`; the CSS avoids flex `gap`, `inset`, `:focus-visible` and `:focus-within` so it runs on Tizen 4 (Chromium 56). Change a value in `tokens.json`, rebuild, and update the published kit to match.

Key rules: text on orange is always teal (never white); focus is a ring, never orange; nothing on the TV below 24px or outside the 96 × 54 px safe area.
