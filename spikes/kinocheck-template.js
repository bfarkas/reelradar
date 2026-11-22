'use strict';

// Rebuilds TEMPLATE_B64 in backend/kinocheck.js: the average high-passed KinoCheck wordmark.
// usage: node spikes/kinocheck-template.js clip.mp4 ...   (KinoCheck trailers whose ident is the
// 2018+ one; each file's frame at 2.5 s is used). Prints the base64 string.

var execFileSync = require('child_process').execFileSync;
var kc = require('../backend/kinocheck');

var L = kc.LOGO, ref = null, acc = null;
process.argv.slice(2).forEach(function (file) {
  var gray = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.5', '-i', file, '-frames:v', '1', '-an', '-vf',
    'scale=' + kc.GRAY_W + ':' + kc.GRAY_H + ':flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  var hp = kc.highPass(gray), best = kc.cropAt(hp, 0, 0), bestDot = -2;
  if (!ref) { ref = best; acc = new Float32Array(best.length); } // the first file sets the position
  for (var dy = -L.shiftY; dy <= L.shiftY; dy += 1) {
    for (var dx = -L.shiftX; dx <= L.shiftX; dx += 1) {
      var crop = kc.cropAt(hp, dx, dy), dot = 0;
      for (var i = 0; i < crop.length; i += 1) dot += crop[i] * ref[i];
      if (dot > bestDot) { best = crop; bestDot = dot; }
    }
  }
  for (var j = 0; j < acc.length; j += 1) acc[j] += best[j]; // each file aligned to the first
});
var max = 0, out = Buffer.alloc(acc.length), k;
for (k = 0; k < acc.length; k += 1) max = Math.max(max, Math.abs(acc[k]));
for (k = 0; k < acc.length; k += 1) out.writeInt8(Math.round(acc[k] / max * 127), k);
console.log(out.toString('base64'));
