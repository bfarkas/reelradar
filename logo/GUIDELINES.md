# ReelRadar logo: usage guide

**Idea:** a play button sliced by radar arcs. You scan trailers to find the next thing to watch.

## The parts

| File (in `masters/`) | Use it for |
|---|---|
| `reelradar-horizontal-accent.svg` | Default logo on light backgrounds: Deep Orange symbol, Cinema Teal wordmark |
| `reelradar-horizontal-on-dark.svg` | Default on dark backgrounds (the app UI, README dark mode) |
| `reelradar-horizontal.svg` | One-colour Cinema Teal version (print, docs, embossing) |
| `reelradar-stacked*.svg` | Square-ish spaces: splash screens, social cards |
| `reelradar-symbol*.svg` | Symbol alone, once people already know the name |
| `reelradar-symbol-small*.svg` | **Symbol below 32 px only.** It has one wider arc, so the gap doesn't close up |
| `reelradar-wordmark.svg` | Wordmark alone (rare: a footer, or anywhere the symbol is already shown) |

Ready-made exports are in `exports/`: black, white and Deep Orange one-colour symbols, teal one-colour lockups, full-colour lockups in `exports/full-colour/`, PNGs, `favicon.ico`, PNG favicons, the app icon, maskable and Apple touch icons, `site.webmanifest`, and `head-snippet.html` with the `<head>` tags.

## Colour

| Name | HEX | RGB | Use |
|---|---|---|---|
| Reel Orange | `#FF6A3D` | 255 106 61 | The symbol on Cinema Teal or other dark backgrounds; one accent per screen |
| Deep Orange | `#E8521F` | 232 82 31 | The symbol on white or light backgrounds; the favicon |
| Cinema Teal | `#0D3438` | 13 52 56 | Wordmark on light, dark backgrounds, app-icon tile |
| Screen White | `#FFFFFF` | 255 255 255 | Wordmark on dark, light backgrounds |

Teal and orange is the classic Hollywood colour grade: warm skin tones against cool shadows.

- Reel Orange on Cinema Teal has a contrast of 4.7:1. Deep Orange on white is 3.7:1, which is fine for the symbol and large text but **not for body text**. Cinema Teal on white is ~13:1, so it can be used for any text.
- Don't put Reel Orange on white (2.8:1); switch to Deep Orange.
- CMYK/Pantone are approximations, so proof them before printing: Reel Orange ≈ C0 M70 Y80 K0 / Pantone 1655 C; Deep Orange ≈ C0 M78 Y95 K3 / Pantone 1665 C; Cinema Teal ≈ C90 M45 Y50 K65 / Pantone 5463 C.
- Avoid gradients and shadows. The mark is flat.

## Clear space and size

- **Clear space:** keep a margin of at least **x** on every side, where **x = ¼ of the symbol's height**. The gap between the symbol and the wordmark is fixed in the master files, so don't change it.
- **Minimum size:** full symbol 32 px (8 mm); small cut 16 px; horizontal lockup 120 px wide (30 mm).
- In the horizontal lockup the wordmark's cap height is about ⅓ of the symbol's height. Don't rescale the two parts separately.

## Typography

The wordmark is **Inter ExtraBold** (SIL Open Font License, free to use in a logo), converted to outlines with −2% tracking. Inter in regular to semibold weights is a natural UI typeface next to it.

## Don't

- Don't rotate or mirror the symbol. It has to point right, because pointing right is what makes it read as "play".
- Don't add a third arc, fill the gaps, or use the two-arc symbol below 32 px.
- Don't recolour the pieces separately or put orange on mid-tone or busy images, or use Reel Orange on white.
- Don't retype the wordmark in a live font, or stretch, outline or add effects to it.

## Rebuilding

`build.py` creates every master from exact geometry: rounded triangle, arcs centred at (4, 128), gaps r 124–140 and 162–178 (small cut: 134–156).
`python build.py /path/to/Inter-ExtraBold.ttf` (needs `fonttools`).

## Open items

- Trademark search: I didn't run one. Check trademark databases and run a reverse image search before wider use. Play-plus-arc marks exist in media and audio apps.
- The Pantone/CMYK values are estimates; get a print proof.
