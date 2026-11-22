'use strict';

// Runs the real inline script of frontend/index.html against a stub DOM, then calls its filter/count functions.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8');
var script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function stub() {
  var target = function () {};
  return new Proxy(target, {
    get: function (_, key) { return key === Symbol.toPrimitive ? function () { return ''; } : stub(); },
    set: function () { return true; },
    apply: function () { return stub(); }
  });
}

function load() {
  var context = {
    document: stub(),
    window: { localStorage: { getItem: function () { return null; }, setItem: function () {} } },
    XMLHttpRequest: function () { this.open = function () {}; this.send = function () {}; },
    console: console
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

var NETFLIX = { id: 8, name: 'Netflix' };
var DISNEY = { id: 337, name: 'Disney+' };
var APPLE = { id: 350, name: 'Apple TV+' };
var ACTION = { id: 28, name: 'Action' };

function title(id, fields) {
  return Object.assign({ tmdb_id: id, title: 'T' + id, de_theatrical: null, de_digital: null, genres: [], keywords: [], providers: [] }, fields);
}

// Today is the context's own isoDay(0); dates are offsets from it. Providers come from TMDB "now", so upcoming titles have none.
function catalogue(ctx) {
  var d = ctx.isoDay;
  return [
    title(1, { de_digital: d(-20), providers: [NETFLIX], genres: [ACTION] }),                       // already streaming
    title(2, { de_digital: d(-5), providers: [NETFLIX, DISNEY] }),                                  // already streaming
    title(3, { de_theatrical: d(-40), de_digital: d(10), providers: [NETFLIX] }),                   // cinema past, streaming upcoming
    title(4, { de_theatrical: d(15), providers: [] }),                                              // upcoming cinema, no service
    title(5, { de_theatrical: d(-60), de_digital: d(-3), providers: [APPLE] }),
    title(6, { de_theatrical: d(30), de_digital: d(40), providers: [DISNEY], genres: [ACTION] })    // two upcoming releases
  ];
}

function shownCount(ctx, view, chosen) {
  var shown = ctx.allTitles.filter(function (t) { return ctx.matchesFilter(t, chosen); });
  return ctx.viewCount(view, ctx.viewSections(view, shown, chosen.kind));
}

test('every service chip count equals what that view lists with the service picked', function () {
  var ctx = load();
  ctx.allTitles = catalogue(ctx);
  ['upcoming', 'recent', 'trailers', 'genres', 'all'].forEach(function (view) {
    ['all', 'cinema', 'streaming'].forEach(function (kind) {
      var chosen = { genres: [], keywords: [], kind: kind, service: 0 };
      var counts = ctx.serviceCounts(view, chosen);
      [NETFLIX, DISNEY, APPLE].forEach(function (service) {
        chosen.service = service.id;
        assert.equal(counts[service.id], shownCount(ctx, view, chosen), view + '/' + kind + '/' + service.name);
      });
    });
  });
});

test('upcoming counts only releases still ahead, recent only those behind', function () {
  var ctx = load();
  ctx.allTitles = catalogue(ctx);
  var up = ctx.serviceCounts('upcoming', { genres: [], keywords: [], kind: 'all' });
  var recent = ctx.serviceCounts('recent', { genres: [], keywords: [], kind: 'all' });
  assert.equal(up[NETFLIX.id], 1);   // title 3's digital date only
  assert.equal(up[DISNEY.id], 2);    // title 6, cinema and streaming
  assert.equal(up[APPLE.id], 0);
  assert.equal(recent[NETFLIX.id], 3); // titles 1, 2 and 3's past cinema date
  assert.equal(recent[APPLE.id], 2);
});

test('counts follow the genre filter, and a service ignores titles it is not on', function () {
  var ctx = load();
  ctx.allTitles = catalogue(ctx);
  var counts = ctx.serviceCounts('all', { genres: [ACTION.id], keywords: [], kind: 'all' });
  assert.equal(counts[NETFLIX.id], 1);
  assert.equal(counts[DISNEY.id], 1);
  assert.equal(counts[APPLE.id], 0);
});

test('genre shelves count a title once however many genres it has', function () {
  var ctx = load();
  ctx.allTitles = [title(1, { de_digital: ctx.isoDay(-1), providers: [NETFLIX], genres: [ACTION, { id: 35, name: 'Comedy' }] })];
  assert.equal(ctx.serviceCounts('genres', { genres: [], keywords: [], kind: 'all' })[NETFLIX.id], 1);
});

test('an empty calendar for a service explains why; other empties stay generic', function () {
  var ctx = load();
  ctx.allTitles = catalogue(ctx);
  var message = ctx.emptyMessage('upcoming', { genres: [], keywords: [], kind: 'all', service: APPLE.id });
  assert.match(message, /Apple TV\+ has no upcoming releases in Germany/);
  assert.match(message, /1 title is on Apple TV\+ now/);
  assert.equal(ctx.emptyMessage('upcoming', { genres: [ACTION.id], keywords: [], kind: 'all', service: NETFLIX.id }),
    'No titles in this view match the filter.');
  ctx.allTitles = [];
  assert.equal(ctx.emptyMessage('upcoming', { genres: [], keywords: [], kind: 'all', service: 0 }), 'No titles imported yet.');
});
