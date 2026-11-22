'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('../import');
var media = require('../media');
var kinocheck = require('../kinocheck');

process.env.KINOCHECK_TRIM = '1'; // ident cutting is opt-in in production

function setup() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelradar-media-'));
  var db = new DatabaseSync(':memory:');
  importer.ensureSchema(db);
  db.prepare("INSERT INTO titles (tmdb_id, title, original_title, original_language, trailer_key) VALUES (1, 'Film', 'Film', 'ja', 'privateVid1')").run();
  var insert = db.prepare('INSERT INTO candidates (tmdb_id, key, source, type, published_at, playable, reason) VALUES (1, ?, ?, ?, ?, ?, ?)');
  insert.run('privateVid1', 'tmdb', 'Trailer', '2024-02-01', 1, 'ok');
  insert.run('goodVideo_2', 'tmdb', 'Trailer', '2024-01-01', 1, 'ok');
  insert.run('hiddenVid_3', 'tmdb', 'Trailer', '2024-03-01', 0, 'wrong language');
  return { dir: dir, db: db, env: { MEDIA_DIR: dir } };
}

// Fake yt-dlp: fails for privateVid1, otherwise writes the -o file.
function fakeYtDlp(calls) {
  return function (cmd, args, options, callback) {
    if (cmd !== 'yt-dlp') return callback(new Error('no ffmpeg in this test')); // processing falls back to the original
    var key = args[args.length - 1];
    calls.push(key);
    if (key === 'privateVid1') return callback(new Error('exit 1'), '', 'ERROR: [youtube] privateVid1: Private video');
    fs.writeFileSync(args[args.indexOf('-o') + 1], 'mp4');
    callback(null, '', '');
  };
}

test('falls back to the next playable candidate when a video cannot be downloaded', async function () {
  var s = setup();
  var calls = [];
  var key = await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: fakeYtDlp(calls), logger: { warn: function () {} } });
  assert.equal(key, 'goodVideo_2');
  assert.deepEqual(calls, ['privateVid1', 'goodVideo_2']);
  assert.equal(s.db.prepare('SELECT trailer_key FROM titles').get().trailer_key, 'goodVideo_2');
  var failed = s.db.prepare("SELECT playable, reason FROM candidates WHERE key = 'privateVid1'").get();
  assert.equal(failed.playable, 0);
  assert.match(failed.reason, /Private video/);
  assert.ok(fs.existsSync(path.join(s.dir, 'goodVideo_2.mp4')));

  calls.length = 0;
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: fakeYtDlp(calls) });
  assert.deepEqual(calls, [], 'cached file is not downloaded again');
});

test('a series trailer uses the series candidates, not those of the movie with the same id', async function () {
  var s = setup();
  s.db.prepare("INSERT INTO titles (media_type, tmdb_id, title, original_title, original_language, trailer_key) VALUES ('tv', 1, 'Series', 'Series', 'en', NULL)").run();
  s.db.prepare("INSERT INTO candidates (media_type, tmdb_id, key, source, type, published_at, playable, reason) VALUES ('tv', 1, 'seriesVid_1', 'tmdb', 'Trailer', '2024-05-01', 1, 'ok')").run();
  var calls = [];
  var key = await media.ensureTitleTrailer(s.db, 'tv', 1, { env: s.env, execFile: fakeYtDlp(calls), logger: { warn: function () {} } });
  assert.equal(key, 'seriesVid_1');
  assert.deepEqual(calls, ['seriesVid_1']);
  assert.equal(s.db.prepare("SELECT trailer_key FROM titles WHERE media_type = 'tv'").get().trailer_key, 'seriesVid_1');
  assert.equal(s.db.prepare("SELECT trailer_key FROM titles WHERE media_type = 'movie'").get().trailer_key, 'privateVid1');
  assert.equal(await media.ensureTitleTrailer(s.db, 'tv', 2, { env: s.env, execFile: fakeYtDlp(calls) }), null); // no such series
});

test('rejects keys that are not YouTube video ids', async function () {
  await assert.rejects(media.download('--exec=rm', {}), /invalid video key/);
});

// Synthetic decoded frames. A logo frame is a gentle gradient with the wordmark template stamped in.
function grayFrame(logo, base) {
  var w = kinocheck.GRAY_W, frame = Buffer.alloc(w * kinocheck.GRAY_H), tpl = kinocheck.getTemplate(), L = kinocheck.LOGO, x, y;
  for (y = 0; y < kinocheck.GRAY_H; y += 1) {
    for (x = 0; x < w; x += 1) {
      var v = base + (logo ? x * 0.15 : 0);
      if (logo && x >= L.x0 && x < L.x1 && y >= L.y0 && y < L.y1) v += tpl[(y - L.y0) * (L.x1 - L.x0) + (x - L.x0)] * 1500;
      frame[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return frame;
}

// rgb frame: `red` share of the pixels is dark red, the rest `gray`.
function rgbFrame(red, gray) {
  var n = kinocheck.RGB_W * kinocheck.RGB_H, frame = Buffer.alloc(n * 3), p;
  for (p = 0; p < n; p += 1) {
    var isRed = p < Math.round(red * n);
    frame[p * 3] = isRed ? 130 : gray;
    frame[p * 3 + 1] = isRed ? 20 : gray;
    frame[p * 3 + 2] = isRed ? 25 : gray;
  }
  return frame;
}

// 25 fps frames from t0 to t1 as [{t, data}].
function timeline(t0, t1, make) {
  var frames = [], i;
  for (i = 0; t0 + i / 25 < t1 - 1e-9; i += 1) frames.push({ t: Math.round((t0 + i / 25) * 1000) / 1000, data: make(t0 + i / 25) });
  return frames;
}

// KinoCheck-like start: logo until `cut`, then trailer (a flat frame with a different brightness).
function introFrames(cut) {
  var logo = grayFrame(true, 110), trailer = grayFrame(false, 40);
  return timeline(0, 3.6, function (t) { return t < cut - 1e-9 ? logo : trailer; });
}

// KinoCheck-like end: trailer, still image at `cut`, red wipe over 4 frames, static red card to the end.
function outroFrames(from, to, cut) {
  var trailer = rgbFrame(0, 60), still = rgbFrame(0, 200), card = rgbFrame(0.93, 200), wipe = [rgbFrame(0.3, 200), rgbFrame(0.4, 200), rgbFrame(0.75, 200), rgbFrame(0.9, 200)];
  return timeline(from, to, function (t) {
    if (t < cut - 1e-9) return trailer;
    var i = Math.round((t - cut) * 25);
    return i < 2 ? still : i < 6 ? wipe[i - 2] : card;
  });
}

// Fake yt-dlp + ffprobe + ffmpeg. A "video" is a JSON file {codec, tag, audio, duration, ident}; ffmpeg
// reads the -ss/-to cuts and writes the result the same way. The decoding scans ("showinfo" runs) answer
// with synthetic frames for `ident` = {intro, outro} (cut times; either may be missing = no ident).
// `behavior.ffmpegFails` breaks transcoding, `behavior.scanFails` breaks the scans, `behavior.glitchOnce` garbles the first scan.
function fakeToolchain(behavior) {
  var log = [];
  var run = function (cmd, args, options, callback) {
    log.push(cmd === 'nice' ? args.slice(2).join(' ') : cmd + ' ' + args.join(' '));
    if (cmd === 'yt-dlp') {
      fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ codec: 'h264', tag: 'avc1', audio: 'aac', duration: 100, ident: behavior.ident || {} }));
      return callback(null, '', '');
    }
    if (cmd === 'ffprobe') {
      var v = JSON.parse(fs.readFileSync(args[args.length - 1], 'utf8'));
      return callback(null, JSON.stringify({ streams: [
        { codec_type: 'video', codec_name: v.codec, codec_tag_string: v.tag },
        { codec_type: 'audio', codec_name: v.audio }], format: { duration: String(v.duration) } }), '');
    }
    assert.equal(cmd, 'nice', 'ffmpeg must run under nice');
    assert.equal(args[0], '-n');
    var ffArgs = args.slice(2);
    var input = JSON.parse(fs.readFileSync(ffArgs[ffArgs.indexOf('-i') + 1], 'utf8'));
    var vf = ffArgs.indexOf('-vf') >= 0 ? ffArgs[ffArgs.indexOf('-vf') + 1] : '';
    if (/showinfo/.test(vf)) {
      if (behavior.scanFails) return callback(new Error('ffmpeg exit 1'), '', 'boom');
      var frames = ffArgs.indexOf('-ss') >= 0
        ? outroFrames(Number(ffArgs[ffArgs.indexOf('-ss') + 1]), input.duration, input.ident.outro || 1e9)
        : introFrames(input.ident.intro || 0);
      var lines = frames.map(function (f, i) { return '[Parsed_showinfo_1 @ 0x1] n:   ' + i + ' pts:' + Math.round(f.t * 1000) + ' pts_time:' + f.t.toFixed(3) + ' duration: 40'; });
      if (behavior.glitchOnce && !behavior.glitched) { behavior.glitched = true; lines.pop(); } // one showinfo line lost, as seen on a busy host
      var info = lines.join('\n');
      return callback(null, Buffer.concat(frames.map(function (f) { return f.data; })), info);
    }
    if (behavior.ffmpegFails) return callback(new Error('ffmpeg exit 1'), '', 'boom');
    var ss = ffArgs.indexOf('-ss') >= 0 ? Number(ffArgs[ffArgs.indexOf('-ss') + 1]) : 0;
    var to = ffArgs.indexOf('-to') >= 0 ? Number(ffArgs[ffArgs.indexOf('-to') + 1]) : input.duration;
    fs.writeFileSync(ffArgs[ffArgs.length - 1], JSON.stringify({ codec: 'hevc', tag: ffArgs[ffArgs.indexOf('-tag:v') + 1], audio: 'aac', duration: to - ss, ident: {} }));
    callback(null, '', '');
  };
  return { run: run, log: log };
}

function readVideo(dir, key) {
  return JSON.parse(fs.readFileSync(path.join(dir, key + '.mp4'), 'utf8'));
}

// The 100 s fake file has the logo until 3.04 s and the outro's first frame at 84.92 s; the cuts go halfway to the neighbouring frame.
var INTRO_AND_OUTRO = { intro: 3.04, outro: 84.92 };
var START = 3.02, END = 84.9;

function kinoCheckSetup(source) {
  var s = setup();
  s.db.prepare("UPDATE candidates SET source = ? WHERE key = 'goodVideo_2'").run(source);
  s.db.prepare("UPDATE candidates SET playable = 0 WHERE key = 'privateVid1'").run();
  return s;
}

test('KinoCheck trailer: ident cut at both ends and transcoded to HEVC hvc1', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ ident: INTRO_AND_OUTRO });
  assert.equal(await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: tools.run }), 'goodVideo_2');
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.deepEqual([video.codec, video.tag, video.audio], ['hevc', 'hvc1', 'aac']);
  assert.ok(Math.abs(video.duration - (END - START)) < 1e-6);
  assert.ok(tools.log.some(function (l) { return /-ss 3\.02 -to 84\.9 /.test(l); }));
  assert.ok(tools.log.some(function (l) { return /-movflags \+faststart/.test(l); }));
  assert.deepEqual(fs.readdirSync(s.dir), ['goodVideo_2.mp4'], 'no temp files left');
});

test('a scan whose output came back short is repeated once', async function () {
  var s = kinoCheckSetup('kinocheck');
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: fakeToolchain({ ident: INTRO_AND_OUTRO, glitchOnce: true }).run });
  assert.ok(Math.abs(readVideo(s.dir, 'goodVideo_2').duration - (END - START)) < 1e-6);
});

test('KinoCheck trailer without a recognisable ident is transcoded but not cut', async function () {
  var s = kinoCheckSetup('both');
  var tools = fakeToolchain({});
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: tools.run });
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.equal(video.codec, 'hevc');
  assert.equal(video.duration, 100);
  assert.ok(!tools.log.some(function (l) { return /-ss |-to /.test(l) && /-c:v/.test(l); }));
});

test('only the end that is found is cut', async function () {
  var s = kinoCheckSetup('kinocheck');
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: fakeToolchain({ ident: { outro: 84.92 } }).run });
  assert.ok(Math.abs(readVideo(s.dir, 'goodVideo_2').duration - 84.9) < 1e-6);
  s = kinoCheckSetup('kinocheck');
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: fakeToolchain({ ident: { intro: 3.04 } }).run });
  assert.ok(Math.abs(readVideo(s.dir, 'goodVideo_2').duration - (100 - 3.02)) < 1e-6);
});

test('a failed ident scan still transcodes, uncut', async function () {
  var s = kinoCheckSetup('kinocheck');
  var warnings = [];
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: fakeToolchain({ ident: INTRO_AND_OUTRO, scanFails: true }).run, logger: { warn: function (m) { warnings.push(m); } } });
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.deepEqual([video.codec, video.duration], ['hevc', 100]);
  assert.match(warnings[0], /ident scan .* not cutting/);
});

test('non-KinoCheck trailer is transcoded but never cut or scanned', async function () {
  var s = kinoCheckSetup('tmdb');
  var tools = fakeToolchain({ ident: INTRO_AND_OUTRO });
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: tools.run });
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.equal(video.codec, 'hevc');
  assert.equal(video.duration, 100);
  assert.ok(!tools.log.some(function (l) { return /showinfo/.test(l); }));
});

test('ffmpeg failure keeps the original download', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ ident: INTRO_AND_OUTRO, ffmpegFails: true });
  var warnings = [];
  assert.equal(await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: tools.run, logger: { warn: function (m) { warnings.push(m); } } }), 'goodVideo_2');
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.deepEqual([video.codec, video.duration], ['h264', 100]);
  assert.match(warnings[0], /keeping original/);
  assert.deepEqual(fs.readdirSync(s.dir), ['goodVideo_2.mp4']);
});

test('a transcode that fails validation does not replace the original', async function () {
  var s = kinoCheckSetup('tmdb');
  var tools = fakeToolchain({});
  var broken = function (cmd, args, options, callback) {
    if (cmd === 'nice' && args.indexOf('-vf') < 0) { // ffmpeg "succeeds" but writes a truncated 10 s file
      fs.writeFileSync(args[args.length - 1], JSON.stringify({ codec: 'hevc', tag: 'hvc1', audio: 'aac', duration: 10, ident: {} }));
      return callback(null, '', '');
    }
    tools.run(cmd, args, options, callback);
  };
  await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: broken, logger: { warn: function () {} } });
  assert.equal(readVideo(s.dir, 'goodVideo_2').codec, 'h264');
});

test('reprocessCached upgrades old H.264 files one by one and skips HEVC ones', async function () {
  var s = kinoCheckSetup('kinocheck');
  var h264 = { codec: 'h264', tag: 'avc1', audio: 'aac', duration: 100, ident: INTRO_AND_OUTRO };
  fs.writeFileSync(path.join(s.dir, 'goodVideo_2.mp4'), JSON.stringify(h264));
  fs.writeFileSync(path.join(s.dir, 'otherVid_44.mp4'), JSON.stringify(Object.assign({}, h264, { codec: 'hevc', tag: 'hvc1' })));
  fs.writeFileSync(path.join(s.dir, 'half-way_11.part.mp4'), 'partial');
  var tools = fakeToolchain({});
  var done = await media.reprocessCached(s.db, { env: s.env, execFile: tools.run });
  assert.deepEqual(done, { replaced: 1, kept: 1 });
  assert.ok(Math.abs(readVideo(s.dir, 'goodVideo_2').duration - (END - START)) < 1e-6);
  assert.equal(fs.readFileSync(path.join(s.dir, 'half-way_11.part.mp4'), 'utf8'), 'partial');
});

test('without KINOCHECK_TRIM a KinoCheck trailer is transcoded but never cut', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ ident: INTRO_AND_OUTRO });
  delete process.env.KINOCHECK_TRIM;
  try { await media.ensureTitleTrailer(s.db, 'movie', 1, { env: s.env, execFile: tools.run }); } finally { process.env.KINOCHECK_TRIM = '1'; }
  assert.equal(readVideo(s.dir, 'goodVideo_2').duration, 100);
  assert.ok(!tools.log.some(function (l) { return /showinfo/.test(l); }));
});

// The detector itself, on synthetic frames.
test('synthetic logo frames match the template; a flat frame does not', function () {
  assert.ok(kinocheck.logoScore(grayFrame(true, 110)) > 0.8);
  assert.ok(kinocheck.logoScore(grayFrame(false, 110)) < 0.3);
});

test('intro: cut lands halfway between the last logo frame and the first trailer frame', function () {
  assert.equal(kinocheck.findIntroEnd(introFrames(3.04)), 3.02);
  assert.equal(kinocheck.findIntroEnd(introFrames(3.36)), 3.34);
});

test('intro: no cut unless a resting logo ends in a hard cut at about 3 s', function () {
  assert.equal(kinocheck.findIntroEnd(introFrames(0)), null, 'no logo');
  assert.equal(kinocheck.findIntroEnd(introFrames(1e9)), null, 'logo never ends');
  assert.equal(kinocheck.findIntroEnd(introFrames(2.4)), null, 'cut too early');
  assert.equal(kinocheck.findIntroEnd(introFrames(3.8)), null, 'cut too late');
  var other = grayFrame(false, 110), frames = introFrames(3.04);
  frames.forEach(function (f) { if (f.t < 3.04) f.data = other; });
  assert.equal(kinocheck.findIntroEnd(frames), null, 'a frame before the cut is not the logo');
  frames = introFrames(3.04);
  frames[60].data = grayFrame(true, 160); // logo flickers: not at rest
  assert.equal(kinocheck.findIntroEnd(frames), null);
});

test('outro: cut lands halfway between the last trailer frame and the still that starts the end card', function () {
  assert.ok(Math.abs(kinocheck.findOutroStart(outroFrames(76, 100, 84.92)) - 84.9) < 1e-6);
  assert.ok(Math.abs(kinocheck.findOutroStart(outroFrames(76, 100, 89.96)) - 89.94) < 1e-6, 'a shorter card, 10 s');
});

test('outro: a cut frame that already holds some red, or a trailer fading to black first, still cuts at the outro', function () {
  var card = rgbFrame(0.93, 200), wipe = [rgbFrame(0.34, 200), rgbFrame(0.52, 200), rgbFrame(0.9, 200)];
  var early = timeline(76, 100, function (t) { var i = Math.round((t - 84.92) * 25); return t < 84.92 - 1e-9 ? rgbFrame(0, 60) : i < 3 ? wipe[i] : card; });
  assert.ok(Math.abs(kinocheck.findOutroStart(early) - 84.9) < 1e-6, 'red from the first outro frame');
  var black = timeline(76, 100, function (t) { // cut to black at 84.6 (trailer), outro cut at 84.92
    var i = Math.round((t - 84.92) * 25);
    return t < 84.6 - 1e-9 ? rgbFrame(0, 90) : t < 84.92 - 1e-9 ? rgbFrame(0, 0) : i < 3 ? wipe[i] : card;
  });
  assert.ok(Math.abs(kinocheck.findOutroStart(black) - 84.9) < 1e-6, 'the trailer\'s own cut to black stays');
});

test('outro: no cut without a static red card, a wipe and a hard cut', function () {
  assert.equal(kinocheck.findOutroStart(outroFrames(76, 100, 1e9)), null, 'no card');
  assert.equal(kinocheck.findOutroStart(outroFrames(76, 100, 95)), null, 'card shorter than 8 s');
  var red = rgbFrame(0.93, 200), plain = rgbFrame(0, 60);
  var hard = timeline(76, 100, function (t) { return t < 84.92 ? plain : red; });
  assert.equal(kinocheck.findOutroStart(hard), null, 'cut straight to red, no wipe');
  var fade = timeline(76, 100, function (t) { return t < 84 ? plain : t < 85 ? rgbFrame(Math.min(0.93, (t - 84) * 0.93), 60) : red; });
  assert.equal(kinocheck.findOutroStart(fade), null, 'slow dissolve to red');
  var redScene = timeline(76, 100, function () { return rgbFrame(0.6, 90); });
  assert.equal(kinocheck.findOutroStart(redScene), null, 'a trailer that is red all along');
});
