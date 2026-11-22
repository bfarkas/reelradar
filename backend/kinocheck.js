'use strict';

// Finds KinoCheck's own ident in a cached trailer, from small decoded frames (see media.js).
// Measured on all 122 cached KinoCheck trailers (2017-2026), about 40 of them checked frame by frame:
//  - Intro: a ~3.05 s logo animation (chevron + KINOCHECK wordmark on a coloured, blurred backdrop;
//    the backdrop differs per file). It ends in a hard cut to the trailer at 3.0-3.1 s. The small
//    KinoCheck watermark that stays bottom-right through the trailer is not part of the ident.
//  - Outro: a still of one trailer scene (hard cut), a red wipe over it within ~0.25 s, then a static dark
//    red card with that scene tinted, to the end of the file (15.1 s in all but one file, 10.1 s in one).
// A cut is made only when the signature matches: an end that does not match stays uncut. Pure
// functions on frames, no I/O. shortcut: the 2017 intro variant (ghosted wordmark) is not matched,
// so those files keep their intro; add its signature if that matters.

var GRAY_W = 160, GRAY_H = 90;           // intro frames: gray, scaled to this regardless of aspect ratio
var RGB_W = 32, RGB_H = 18;              // outro frames: rgb24
var LOGO = { x0: 44, x1: 150, y0: 30, y1: 52, blur: 3, shiftX: 3, shiftY: 2 }; // wordmark area, 160x90 grid
var LOGO_MIN_SCORE = 0.6;                // correlation: logos 0.79-0.96, any other frame at most 0.28
var INTRO_ID_AT = 2.0;                   // the logo is at rest from here to the cut
var INTRO_CUT_MIN = 2.8, INTRO_CUT_MAX = 3.4;
var INTRO_CUT_DIFF = 12;                 // mean abs gray difference that counts as a hard cut (seen 35-174)
var INTRO_STATIC_DIFF = 10;              // frames of the resting logo differ by less than this (backdrops drift: seen up to 7.7)
var OUTRO_CARD_MIN = 8;                  // seconds of static red card to the end
var OUTRO_WINDOW = 0.6;                  // hard cut lies this close before the card
var OUTRO_CUT_DIFF = 12;                 // sceneDiff at the hard cut (seen 17-160), below it inside the still and wipe (seen <= 5)

// 106x22 high-passed wordmark crop (average of 25 files), int8; rebuild with spikes/kinocheck-template.js
var TEMPLATE_B64 = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA///+/f7/AAMDAQD///7+/v///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz6+fn5+fj5+fj39/X09Pb4+Pb19ff4+Pn7/f37+ff29vj7///8+PXy8fHz',
  '9vn8/gAAAP/9+/n39/f5+vv9/v7+//8A//7+/v38+vn49vb3+fr8/v79+/n39/f4+vv8/v7////+/v7+/v738e7u7u3s7Ozr6unl',
  '5OTo7Ovm5eXo6urt8vf49fDt7ezs8PP38+zl39zc4Obs8vj8/v37+ff08vDx8/b19/n8/P39AP/8/P369/X09PLx9Pf5+/v7+ff0',
  '8vDx8/X19vn7/fz6+/v8+/v88eji4uLe3Nzd3dzb19XV2+De1dPV2NrZ3Obu7+3m4+Lh3+Ll5+Pb1N3n5dzU3OXu9fj5+Pb08vP4',
  '9fP18vP2+fv7+wD++vv79vPx8fPx8PX4+fn5+Pf08vL49fL08vP1+Pr49fj5+fn5/OveH0E/EcnKzhM6Ozf60SdBPfPC8DEyK+bX',
  '4+Xi5TZAPfLT1dbV/SEpKSklGPDY4urw9Pb0CjdGQEZAFfHy+TMB+foB/vj5ECLt7y1IRURLTxX39/f1BTNGQEVFG/Lx9S4G8/H2',
  '9xE9+/zk1TpqZRyztuVTZGg81MtJbGb2r/dWVU8gzdTX1d5aaGLww8XTGjpESEdHRz80CNbd5+71JUEUBgYKHUgn8PpN/vP4Av/3',
  '+Boz4+tAGAQDDA/57/T3HEQaCAkKGUMz8fNGBOrs8wxOFfT53ss2aGAOnLMqZGha67rBSG5n653qU1BIQ/3Ex8XPWGpg47G8E0pN',
  'R0ZGRkRESUH8z93pHj8G8eno6PUMKen4Uvrs8QH+9fYZNdvgP/3i4u3v6+rtGEcM8+no6PMLKe/vSADg4QJLH/Tx9tnBKVhM94zr',
  'SltVAbqytzxiWtqL2UQ/NDc327Wyu0hdUdCf10ZORDcG6+8UPUFJN8/Q9kUG5Ojr6+vt7vLh7Ury39/u8ensESzS1Db01tbj5ePk',
  '9EsQ5efq6+vt7/Lj5EL72ulBI/Lv8/fWvSNOP+itKElTE8W+t7k7X1XUhNNAOSoqPim1oaw9VUnFmAdMSTTmurm5vf09REP1wBck',
  '6Onx9ff29/bn4+lI8d7c6Ojl6hAr0tY5+t7e6+rn5yA66ufw9fb29/fp4t49+OYsIu/v8/f61rwiSjf2+jBCIMLDx8C+PV5U0oPS',
  'QTogHjZGAJWeMk1CvpsmSEgHr7vKybq4JkQ+Grwt9ers+P3//v787ejtTfzp5/Pw6PEVLNPYPQbq6vjz6OxFDurs9vz+/v797+fg',
  'OwQmHOfq8vf7/tW8IkkzFhkrLsSxyM3Gwz5eVNOD0kU/Fc8xQzzGkihGPLmdMUZI3rXM3tzLtwRFOyjBNt/t7vsAAQAA//Dr71RJ',
  'QD5KRj1BVSzT2EFOQkJQSADxU/bs7fn/AAAAAPLp40JFJdni6/P6/wDVvCJJMhYaKzjNscfNxcI+X1TTg9NKRxqHA0JCHqQfPzi4',
  'nDJGStu50eTi0bwCRzsnwTfd7u/7AAEAAP/x7PBNBfTz//vy9Rss1Ng8DfT0Afvq8ljw7e76AAEBAADy6uNCUynW4uvz+v8A1rwi',
  'Sjf2Di5COMPCxr++PV9U0oPUTk4liaUzRTECHDk2u5YsR0n6sMTV1MS/FEU+H7o94+3u+v8A///+8OvvS/Pg3+vo3+IKLdTZO/3i',
  '4e/q5+xT+ezt+P4AAAD/8enjPv0yHuXr8/j8/9a8I04+5LQvRFMnwLq0tjleVNKD1FFWL5aZ2Ug3JSg2NsGSF0lIMcC0wcC/2DhF',
  'QQW6LAXr6/X5+/r7+uzo7Un04uHu6+HkCy7V2Dr84eHu7OnpORzq6/T5+/v7++3m4j/53zoj7fD1+PzXvidVSfKB9UlUVwuxqrA3',
  'X1fWhtdWXTulqLANQS4tODvJmedOS0Ai0sbK2ylASTrjxfpK7ujt8PDx8/Tr5u9P/e3t+/jt7hM02tw8/uTk8fDt7ANX8efs8PDw',
  '8/Tr5ONC/dzhTSTw8fX53MYxY1sHkqc0XF5g56y1P2di45TkYGlKt7u/xy5APkVI2am4N1JIQ0ArLEBCR0UhxtPgOjL06+zt7fMF',
  'A+nyUgDx8v788fIXOd7gPv/l5PDx7+7uMzr06+vs7PEBAuvpSATi3vNXIPP0+OLQPnNuHqut3V1pblXSwEtzb/Sm9m12WcjMz87e',
  'RlJXWeu8v+M/TUtISEhIRz8x3tLe5/RHNQgBAAUKHEPq9FQC8/T+/fT0Gj3j5UYW/PwGCPTw7/NBPAf//QEIGUjx7k4K6eXr/lsf',
  '9/jo2ipdWyXBwsUUUlRPIMY0W1n/uO9XXVDX297d0ANFR0r6zdDR5ig5Ozo5NzQi4Nfh6fDy9S5KLyAmREb97PJBBPb2//329ww4',
  '6Og0Oy4uNTkQ8/Lx8ypQNCInRk8G6/A8Du/s8PEHVAb47uPx//7w1dbW2fX17+zR6/v738rY+//84Ojr6uDY8/P25t3g4NjS6wYS',
  'EQTp0trm7vT29fLv+RMgGgXx7fDzCvz4+f/++fn+Bu7tAA4MCxEVA/X19PLv9xIiHgjy7e/yCP718vT19QYI+PPt6Ofn5ufn5+Tg',
  '39rY2Nzj5N7d3uXn5+ry9fTt5uPj4+js7u7o4NjQzc3S2uLr8vn8/Pn28/Dt7O3w8/L09vn7+/v///v7+/f08vDx7u3x9Pf4+Pj2',
  '8/Dt7Ozv8vHz9vj7+/j4+fn4+Pn39vT09PP19fX08fDt6+vt8fPv7+/y9PT1+fz8+PTz8/P0+Pn59vHs6OXl6O3y9/v/AQD9+/j2',
  '9PLz9ff4+vz9/f39AP/+/v77+fj29vTz9ff5+/z8+vj28/Hy9ff3+fv9/v39/Pz8/Pz8+fz9/v79/v7+/v39/Pv8/P39/f39/v7+',
  '/v4A///+/v7+/v////78+/n4+Pn7/f4AAAAAAP/+/f39/f3+/wAAAAD//wAAAP8A///+/v39/P39/v//AP/+/fz8/f3+/v8AAP//',
  'AP///////w=='
].join('');

var template = null;
function getTemplate() {
  if (template) return template;
  var raw = Buffer.from(TEMPLATE_B64, 'base64'), t = new Float32Array(raw.length), sum = 0, sq = 0, i;
  for (i = 0; i < raw.length; i += 1) { t[i] = raw.readInt8(i); sum += t[i]; }
  for (i = 0; i < t.length; i += 1) { t[i] -= sum / t.length; sq += t[i] * t[i]; }
  sq = Math.sqrt(sq) || 1;
  for (i = 0; i < t.length; i += 1) t[i] /= sq;
  template = t;
  return t;
}

// Frame minus its box blur over the wordmark area plus the search margin: backdrop gradients drop
// out, letter edges stay.
function highPass(gray) {
  var x0 = LOGO.x0 - LOGO.shiftX, x1 = LOGO.x1 + LOGO.shiftX, y0 = LOGO.y0 - LOGO.shiftY, y1 = LOGO.y1 + LOGO.shiftY;
  var w = x1 - x0, out = new Float32Array(w * (y1 - y0)), r = LOGO.blur, x, y, dx, dy;
  for (y = y0; y < y1; y += 1) {
    for (x = x0; x < x1; x += 1) {
      var sum = 0;
      for (dy = -r; dy <= r; dy += 1) {
        for (dx = -r; dx <= r; dx += 1) {
          sum += gray[Math.min(GRAY_H - 1, Math.max(0, y + dy)) * GRAY_W + Math.min(GRAY_W - 1, Math.max(0, x + dx))];
        }
      }
      out[(y - y0) * w + (x - x0)] = gray[y * GRAY_W + x] - sum / ((2 * r + 1) * (2 * r + 1));
    }
  }
  return { data: out, w: w };
}

// The wordmark crop of a frame, mean 0 and unit length, at a pixel shift from the nominal position.
function cropAt(hp, dx, dy) {
  var w = LOGO.x1 - LOGO.x0, h = LOGO.y1 - LOGO.y0, out = new Float32Array(w * h), sum = 0, sq = 0, x, y, i;
  for (y = 0; y < h; y += 1) {
    for (x = 0; x < w; x += 1) {
      var v = hp.data[(y + LOGO.shiftY + dy) * hp.w + x + LOGO.shiftX + dx];
      out[y * w + x] = v;
      sum += v;
    }
  }
  for (i = 0; i < out.length; i += 1) { out[i] -= sum / out.length; sq += out[i] * out[i]; }
  sq = Math.sqrt(sq) || 1;
  for (i = 0; i < out.length; i += 1) out[i] /= sq;
  return out;
}

// Best correlation of the frame's wordmark area with the template over a few pixels of shift (the
// 16:9 and 2:1 files place the logo up to 2 px apart on the 160x90 grid).
function logoScore(gray, tpl) {
  tpl = tpl || getTemplate();
  var hp = highPass(gray), best = -1, dx, dy, i;
  for (dy = -LOGO.shiftY; dy <= LOGO.shiftY; dy += 1) {
    for (dx = -LOGO.shiftX; dx <= LOGO.shiftX; dx += 1) {
      var crop = cropAt(hp, dx, dy), dot = 0;
      for (i = 0; i < crop.length; i += 1) dot += crop[i] * tpl[i];
      if (dot > best) best = dot;
    }
  }
  return best;
}

function meanDiff(a, b) {
  var sum = 0, i;
  for (i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// frames: [{t, data}] gray GRAY_WxGRAY_H, ascending, from the start of the file.
// Returns the time (s) the trailer begins, or null. The time lies halfway between the last ident
// frame and the first trailer frame, so a cut there keeps every trailer frame.
function findIntroEnd(frames, tpl) {
  var i = 1, ref = -1, j;
  while (i < frames.length && frames[i].t < INTRO_ID_AT) i += 1;
  while (i < frames.length && meanDiff(frames[i - 1].data, frames[i].data) < INTRO_CUT_DIFF) i += 1; // first hard cut after the logo came to rest
  if (i >= frames.length || frames[i].t < INTRO_CUT_MIN || frames[i].t > INTRO_CUT_MAX) return null;
  for (j = 0; j < i; j += 1) if (frames[j].t >= INTRO_ID_AT - 0.1) { ref = j; break; }
  if (ref < 0 || i - ref < 3) return null;
  for (j = ref + 1; j < i; j += 1) if (meanDiff(frames[j - 1].data, frames[j].data) >= INTRO_STATIC_DIFF) return null; // logo not at rest
  if (logoScore(frames[ref].data, tpl) < LOGO_MIN_SCORE || logoScore(frames[i - 1].data, tpl) < LOGO_MIN_SCORE) return null;
  return (frames[i - 1].t + frames[i].t) / 2;
}

function isRed(rgb, p) { return rgb[p] > 50 && rgb[p] > 2 * rgb[p + 1] && rgb[p] > 2 * rgb[p + 2]; }

function redShare(rgb) {
  var red = 0, p;
  for (p = 0; p < rgb.length; p += 3) if (isRed(rgb, p)) red += 1;
  return red / (rgb.length / 3);
}

// Mean abs difference between two rgb frames over the pixels that are not red in `b`: tiny while the
// red wipe sweeps over a still (seen <= 5), large at a cut to another picture (seen >= 17).
function sceneDiff(a, b) {
  var sum = 0, n = 0, p;
  for (p = 0; p < b.length; p += 3) {
    if (!isRed(b, p)) { sum += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]); n += 3; }
  }
  return n ? sum / n : 0;
}

// frames: [{t, data}] rgb24 RGB_WxRGB_H, ascending, covering the end of the file.
// Returns the time (s) the outro begins, or null; halfway between the last trailer frame and the
// outro's first frame.
function findOutroStart(frames) {
  var n = frames.length, red = [], diff = [], k, j, cut = -1, wipe = 0;
  if (n < 10) return null;
  for (k = 0; k < n; k += 1) {
    red.push(redShare(frames[k].data));
    diff.push(k ? meanDiff(frames[k - 1].data, frames[k].data) : 0);
  }
  k = n - 1;
  while (k > 0 && red[k] >= 0.5 && diff[k] < 2) k -= 1; // k: last frame of the wipe; the static red card follows
  if (frames[n - 1].t - frames[k].t < OUTRO_CARD_MIN) return null;
  // The outro starts at the last jump to another picture before the wipe: the still and the wipe
  // over it are one scene, so walking back from the wipe stops at the cut (any black frames the
  // trailer ends on stay). No jump within the window means no match.
  for (j = k; j > 0 && frames[k].t - frames[j].t <= OUTRO_WINDOW; j -= 1) {
    if (red[j] < 0.6 && sceneDiff(frames[j - 1].data, frames[j].data) >= OUTRO_CUT_DIFF) { cut = j; break; } // mostly red: too few pixels to compare
  }
  if (cut < 0) return null;
  for (j = cut; j <= k; j += 1) if (red[j] > 0.15 && red[j] < 0.85) wipe += 1;
  return wipe >= 2 ? (frames[cut - 1].t + frames[cut].t) / 2 : null;
}

module.exports = {
  GRAY_W: GRAY_W, GRAY_H: GRAY_H, RGB_W: RGB_W, RGB_H: RGB_H,
  getTemplate: getTemplate, LOGO: LOGO, highPass: highPass, cropAt: cropAt, logoScore: logoScore,
  findIntroEnd: findIntroEnd, findOutroStart: findOutroStart
};
