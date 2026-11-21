'use strict';

// Downloads every title's trailer into the cache so the TV app starts playback at once.
// Run after an import: docker compose exec -T backend node prefetch.js
var DatabaseSync = require('node:sqlite').DatabaseSync;
var media = require('./media');

var db = new DatabaseSync(process.env.DB_PATH || '/data/reelradar.db');
media.prefetchAll(db).then(function (result) {
  console.log('prefetch: ' + result.ready + ' of ' + result.titles + ' titles have a cached trailer');
}).catch(function (error) {
  console.error('prefetch failed: ' + error.message);
  process.exitCode = 1;
});
