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
    window: { localStorage: { getItem: function () { return null; }, setItem: function () {} }, location: { hash: '' }, history: { state: null } },
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

// ---- expected providers: "premieres on X" in the release calendar (OS-T-3HXMY) ----
var HBO = { id: 1899, name: 'HBO Max' };

function withExpected(ctx) {
  var d = ctx.isoDay;
  return catalogue(ctx).concat([
    title(7, { de_digital: d(5), providers_expected: [NETFLIX] }),                                   // streaming only, premieres on Netflix
    title(8, { de_theatrical: d(3), de_digital: d(20), providers_expected: [NETFLIX], genres: [ACTION] }), // cinema, then Netflix
    title(9, { de_digital: d(9), providers_expected: [DISNEY] }),
    title(10, { de_digital: d(12), providers_expected: [HBO] }),                                      // a service nothing streams on yet
    title(11, { de_digital: d(-4), providers_expected: [NETFLIX] })                                  // date passed: not listed as upcoming
  ]);
}

test('the calendar counts and lists expected providers; the chip number equals the cards shown', function () {
  var ctx = load();
  ctx.allTitles = withExpected(ctx);
  ['all', 'cinema', 'streaming'].forEach(function (kind) {
    [0, ACTION.id].forEach(function (genre) {
      var chosen = { genres: genre ? [genre] : [], keywords: [], kind: kind, service: 0 };
      var counts = ctx.serviceCounts('upcoming', chosen);
      [NETFLIX, DISNEY, APPLE, HBO].forEach(function (service) {
        var picked = Object.assign({}, chosen, { service: service.id });
        var shown = ctx.allTitles.filter(function (t) { return ctx.matchesFilter(t, ctx.scoped('upcoming', picked)); });
        assert.equal(counts[service.id], ctx.viewCount('upcoming', ctx.viewSections('upcoming', shown, kind)), kind + '/' + genre + '/' + service.name);
      });
    });
  });
  var counts = ctx.serviceCounts('upcoming', { genres: [], keywords: [], kind: 'all' });
  assert.equal(counts[NETFLIX.id], 1 + 1 + 2); // title 3's digital date, title 7, title 8 (its cinema entry stays listed, as for any title on the service)
  assert.equal(counts[DISNEY.id], 2 + 1);      // title 6 (cinema and streaming), title 9
  assert.equal(counts[HBO.id], 1);
});

test('recent, all titles and the other views ignore expected providers', function () {
  var ctx = load();
  ctx.allTitles = withExpected(ctx);
  var chosen = { genres: [], keywords: [], kind: 'all' };
  ['recent', 'trailers', 'genres', 'all'].forEach(function (view) {
    var counts = ctx.serviceCounts(view, chosen);
    assert.equal(counts[HBO.id], undefined, view + ': no chip for a service that only has an expected premiere');
    var picked = { genres: [], keywords: [], kind: 'all', service: NETFLIX.id };
    var shown = ctx.allTitles.filter(function (t) { return ctx.matchesFilter(t, ctx.scoped(view, picked)); });
    assert.ok(shown.every(function (t) { return t.providers.length; }), view);
    assert.equal(counts[NETFLIX.id], ctx.viewCount(view, ctx.viewSections(view, shown, 'all')), view);
  });
  assert.equal(ctx.serviceTags('recent').some(function (t) { return t.id === HBO.id; }), false);
  assert.equal(ctx.serviceTags('upcoming').some(function (t) { return t.id === HBO.id; }), true);
});

test('a streaming entry before its date is marked "Premieres on X"; cinema, streaming now and past dates are not', function () {
  var ctx = load();
  var d = ctx.isoDay;
  var soon = title(7, { de_digital: d(5), providers_expected: [NETFLIX] });
  assert.equal(ctx.premiereText(soon, 'streaming', d(5)), 'Premieres on Netflix');
  assert.equal(ctx.whereText(soon, 'streaming', d(5)), 'Premieres on Netflix');
  assert.equal(ctx.badgeText(soon, 'streaming', d(5)), 'Premieres on Netflix');
  assert.equal(ctx.whereText(soon, 'cinema', d(5)), 'Cinema');
  assert.equal(ctx.whereText(soon, 'streaming', d(-1)), 'Streaming');                        // premiere passed: TMDB has not caught up, claim nothing
  assert.equal(ctx.whereText(title(8, { providers: [DISNEY], providers_expected: [NETFLIX] }), 'streaming', d(5)), 'Disney+'); // streams somewhere now
  assert.equal(ctx.whereText(title(9, { de_digital: d(5) }), 'streaming', d(5)), 'Streaming'); // unknown stays unknown
});

test('a service with an expected premiere is not reported as empty; others keep the explanation', function () {
  var ctx = load();
  ctx.allTitles = withExpected(ctx);
  assert.equal(ctx.emptyMessage('upcoming', { genres: [ACTION.id], keywords: [], kind: 'cinema', service: HBO.id }),
    'No titles in this view match the filter.');
  assert.match(ctx.emptyMessage('upcoming', { genres: [], keywords: [], kind: 'all', service: APPLE.id }), /Apple TV\+ has no upcoming releases/);
});
