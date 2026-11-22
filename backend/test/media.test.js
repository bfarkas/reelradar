'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('../import');
var media = require('../media');

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
