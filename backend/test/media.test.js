'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('../import');
var media = require('../media');

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
  var key = await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: fakeYtDlp(calls), logger: { warn: function () {} } });
  assert.equal(key, 'goodVideo_2');
  assert.deepEqual(calls, ['privateVid1', 'goodVideo_2']);
  assert.equal(s.db.prepare('SELECT trailer_key FROM titles').get().trailer_key, 'goodVideo_2');
  var failed = s.db.prepare("SELECT playable, reason FROM candidates WHERE key = 'privateVid1'").get();
  assert.equal(failed.playable, 0);
  assert.match(failed.reason, /Private video/);
  assert.ok(fs.existsSync(path.join(s.dir, 'goodVideo_2.mp4')));

  calls.length = 0;
  await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: fakeYtDlp(calls) });
  assert.deepEqual(calls, [], 'cached file is not downloaded again');
});

test('rejects keys that are not YouTube video ids', async function () {
  await assert.rejects(media.download('--exec=rm', {}), /invalid video key/);
});

// Fake yt-dlp + ffprobe + ffmpeg. A "video" is a JSON file {codec, tag, audio, duration, blacks}; ffmpeg
// reads the -ss/-to cuts and writes the result the same way. `behavior.ffmpegFails` breaks transcoding.
function fakeToolchain(behavior) {
  var log = [];
  var run = function (cmd, args, options, callback) {
    log.push(cmd === 'nice' ? args.slice(2).join(' ') : cmd + ' ' + args.join(' '));
    if (cmd === 'yt-dlp') {
      fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ codec: 'h264', tag: 'avc1', audio: 'aac', duration: 100, blacks: behavior.blacks || '' }));
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
    if (ffArgs.indexOf('-vf') >= 0) return callback(null, '', input.blacks); // blackdetect writes to stderr
    if (behavior.ffmpegFails) return callback(new Error('ffmpeg exit 1'), '', 'boom');
    var ss = ffArgs.indexOf('-ss') >= 0 ? Number(ffArgs[ffArgs.indexOf('-ss') + 1]) : 0;
    var to = ffArgs.indexOf('-to') >= 0 ? Number(ffArgs[ffArgs.indexOf('-to') + 1]) : input.duration;
    fs.writeFileSync(ffArgs[ffArgs.length - 1], JSON.stringify({ codec: 'hevc', tag: ffArgs[ffArgs.indexOf('-tag:v') + 1], audio: 'aac', duration: to - ss, blacks: '' }));
    callback(null, '', '');
  };
  return { run: run, log: log };
}

function readVideo(dir, key) {
  return JSON.parse(fs.readFileSync(path.join(dir, key + '.mp4'), 'utf8'));
}

var INTRO_AND_OUTRO = '[blackdetect] black_start:5 black_end:5.5 black_duration:0.5\n[blackdetect] black_start:94 black_end:94.4 black_duration:0.4\n';

function kinoCheckSetup(source) {
  var s = setup();
  s.db.prepare("UPDATE candidates SET source = ? WHERE key = 'goodVideo_2'").run(source);
  s.db.prepare("UPDATE candidates SET playable = 0 WHERE key = 'privateVid1'").run();
  return s;
}

test('KinoCheck trailer: ident cut at both ends and transcoded to HEVC hvc1', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ blacks: INTRO_AND_OUTRO });
  assert.equal(await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: tools.run }), 'goodVideo_2');
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.deepEqual([video.codec, video.tag, video.audio], ['hevc', 'hvc1', 'aac']);
  assert.equal(video.duration, 94 - 5.5);
  assert.ok(tools.log.some(function (l) { return /-movflags \+faststart/.test(l); }));
  assert.deepEqual(fs.readdirSync(s.dir), ['goodVideo_2.mp4'], 'no temp files left');
});

test('KinoCheck trailer without a recognisable ident is transcoded but not cut', async function () {
  var s = kinoCheckSetup('both');
  var tools = fakeToolchain({ blacks: '[blackdetect] black_start:50 black_end:51 black_duration:1\n' });
  await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: tools.run });
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.equal(video.codec, 'hevc');
  assert.equal(video.duration, 100);
  assert.ok(!tools.log.some(function (l) { return /-ss |-to /.test(l); }));
});

test('only one end is cut when only that ident is found', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ blacks: '[blackdetect] black_start:94 black_end:94.4 black_duration:0.4\n' });
  await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: tools.run });
  assert.equal(readVideo(s.dir, 'goodVideo_2').duration, 94);
});

test('non-KinoCheck trailer is transcoded but never cut or scanned', async function () {
  var s = kinoCheckSetup('tmdb');
  var tools = fakeToolchain({ blacks: INTRO_AND_OUTRO });
  await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: tools.run });
  var video = readVideo(s.dir, 'goodVideo_2');
  assert.equal(video.codec, 'hevc');
  assert.equal(video.duration, 100);
  assert.ok(!tools.log.some(function (l) { return /blackdetect/.test(l); }));
});

test('ffmpeg failure keeps the original download', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ blacks: INTRO_AND_OUTRO, ffmpegFails: true });
  var warnings = [];
  assert.equal(await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: tools.run, logger: { warn: function (m) { warnings.push(m); } } }), 'goodVideo_2');
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
      fs.writeFileSync(args[args.length - 1], JSON.stringify({ codec: 'hevc', tag: 'hvc1', audio: 'aac', duration: 10, blacks: '' }));
      return callback(null, '', '');
    }
    tools.run(cmd, args, options, callback);
  };
  await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: broken, logger: { warn: function () {} } });
  assert.equal(readVideo(s.dir, 'goodVideo_2').codec, 'h264');
});

test('reprocessCached upgrades old H.264 files one by one and skips HEVC ones', async function () {
  var s = kinoCheckSetup('kinocheck');
  var h264 = { codec: 'h264', tag: 'avc1', audio: 'aac', duration: 100, blacks: INTRO_AND_OUTRO };
  fs.writeFileSync(path.join(s.dir, 'goodVideo_2.mp4'), JSON.stringify(h264));
  fs.writeFileSync(path.join(s.dir, 'otherVid_44.mp4'), JSON.stringify(Object.assign({}, h264, { codec: 'hevc', tag: 'hvc1' })));
  fs.writeFileSync(path.join(s.dir, 'half-way_11.part.mp4'), 'partial');
  var tools = fakeToolchain({});
  var done = await media.reprocessCached(s.db, { env: s.env, execFile: tools.run });
  assert.deepEqual(done, { replaced: 1, kept: 1 });
  assert.equal(readVideo(s.dir, 'goodVideo_2').duration, 94 - 5.5);
  assert.equal(fs.readFileSync(path.join(s.dir, 'half-way_11.part.mp4'), 'utf8'), 'partial');
});

test('without KINOCHECK_TRIM a KinoCheck trailer is transcoded but never cut', async function () {
  var s = kinoCheckSetup('kinocheck');
  var tools = fakeToolchain({ blacks: INTRO_AND_OUTRO });
  delete process.env.KINOCHECK_TRIM;
  try { await media.ensureTitleTrailer(s.db, 1, { env: s.env, execFile: tools.run }); } finally { process.env.KINOCHECK_TRIM = '1'; }
  assert.equal(readVideo(s.dir, 'goodVideo_2').duration, 100);
  assert.ok(!tools.log.some(function (l) { return /blackdetect/.test(l); }));
});
