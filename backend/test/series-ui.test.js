'use strict';

// Series next to movies in the web page and the TV app (OS-T-J0NCM): runs the real inline scripts against a small
// fake DOM, so the badge, the "available on X" line and the request button are checked as built, not just the helpers.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function stub() {
  return new Proxy(function () {}, {
    get: function (_, key) { return key === Symbol.toPrimitive ? function () { return ''; } : stub(); },
    set: function () { return true; },
    apply: function () { return stub(); }
  });
}

function fakeElement(tag) {
  var text = '';
  var e = {
    tag: tag, className: '', children: [], style: {}, attrs: {}, parentNode: null,
    appendChild: function (child) { child.parentNode = e; e.children.push(child); return child; },
    insertBefore: function (child, ref) { var at = e.children.indexOf(ref); e.children.splice(at < 0 ? e.children.length : at, 0, child); return child; },
    setAttribute: function (name, value) { e.attrs[name] = value; },
    getAttribute: function (name) { return e.attrs[name] === undefined ? null : e.attrs[name]; },
    getBoundingClientRect: function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }, removeAttribute: function () {}, addEventListener: function () {}, load: function () {}, pause: function () {}, play: function () {}
  };
  Object.defineProperty(e, 'textContent', { get: function () { return text; }, set: function (value) { text = value; e.children = []; } });
  Object.defineProperty(e, 'firstChild', { get: function () { return e.children[0] || null; } });
  return e;
}

// Everything under root (any depth) for which predicate holds.
function find(root, predicate) {
  var found = [];
  (function walk(node) {
    (node.children || []).forEach(function (child) { if (predicate(child)) found.push(child); walk(child); });
  })(root);
  return found;
}
function badges(root, name) {
  return find(root, function (node) { return (' ' + node.className + ' ').indexOf(' ' + name + ' ') !== -1; });
}
function allText(root) {
  return [root.textContent].concat(find(root, function () { return true; }).map(function (node) { return node.textContent; })).join('|');
}

function load(file) {
  var html = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
  var script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  var byId = {};
  var requests = [];
  var document = new Proxy({}, {
    get: function (_, key) {
      if (key === 'createElement') return fakeElement;
      if (key === 'createTextNode') return function (value) { return { textContent: value, children: [] }; };
      if (key === 'getElementById') return function (id) { return byId[id] || (byId[id] = fakeElement('div')); };
      return stub();
    },
    set: function () { return true; }
  });
  var context = {
    document: document, byId: byId, requests: requests,
    window: { localStorage: { getItem: function () { return null; }, setItem: function () {} }, location: { hash: '' }, history: { state: null } },
    XMLHttpRequest: function () { this.open = function (method, url) { requests.push(method + ' ' + url); }; this.send = function () {}; },
    clearTimeout: clearTimeout, setTimeout: setTimeout,
    console: console
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

var NETFLIX = { id: 8, name: 'Netflix' };
var DRAMA = { id: 18, name: 'Drama' };

// Movie 7 and series 7 share an id, as TMDB ids do.
function movie(fields) {
  return Object.assign({ media_type: 'movie', tmdb_id: 7, title: 'Movie Seven', original_title: 'Movie Seven', de_theatrical: null, de_digital: null,
    genres: [DRAMA], keywords: [], providers: [], trailer: { key: 'abc', published_at: '2026-11-01' }, decisions: [] }, fields);
}
function series(fields) {
  return Object.assign({ media_type: 'tv', tmdb_id: 7, title: 'Series Seven', original_title: 'Series Seven', de_theatrical: null, de_digital: null,
    genres: [DRAMA], keywords: [], providers: [NETFLIX], trailer: { key: 'def', published_at: '2026-11-10' }, decisions: [] }, fields);
}

['frontend/index.html', 'tv-app/index.html'].forEach(function (file) {
  var name = file.split('/')[0];

  test(name + ': a movie and a series with the same id are two titles, in every non-calendar view', function () {
    var ctx = load(file);
    var d = ctx.isoDay;
    var titles = [movie({ de_theatrical: d(10) }), series()];
    ['trailers', 'all', 'genres'].forEach(function (view) {
      var sections = ctx.viewSections(view, titles, 'all');
      var shown = [].concat.apply([], sections.map(function (s) { return s.items; })).map(function (item) { return item.title.media_type; });
      assert.deepEqual(shown.sort(), ['movie', 'tv'], view);
    });
    assert.equal(ctx.titleKey(titles[0]), 'movie:7');
    assert.equal(ctx.titleKey(titles[1]), 'tv:7');
    assert.equal(ctx.titleKey({ tmdb_id: 7 }), 'movie:7'); // data from before series existed
  });

  test(name + ': a series is never in the calendar views and never under Cinema; Streaming needs a German service', function () {
    var ctx = load(file);
    var d = ctx.isoDay;
    var onService = series();
    var noService = series({ tmdb_id: 8, providers: [] });
    var film = movie({ de_theatrical: d(10), de_digital: d(-3) });
    var titles = [film, onService, noService];
    ['upcoming', 'recent'].forEach(function (view) {
      var entries = [].concat.apply([], ctx.viewSections(view, titles, 'all').map(function (s) { return s.items; }));
      assert.ok(entries.every(function (entry) { return entry.title.media_type === 'movie'; }), view);
      assert.ok(entries.length > 0, view);
    });
    function ids(kind) {
      return ctx.viewSections('all', titles, kind)[0].items.map(function (item) { return ctx.titleKey(item.title) + (item.title.tmdb_id === 8 ? '-none' : ''); });
    }
    assert.deepEqual(ids('all'), ['movie:7', 'tv:7', 'tv:8-none']);
    assert.deepEqual(ids('cinema'), ['movie:7']);
    assert.deepEqual(ids('streaming'), ['movie:7', 'tv:7']);
  });

  test(name + ': a series says where it streams in Germany and never invents a date', function () {
    var ctx = load(file);
    assert.equal(ctx.availableText(series()), 'Available on Netflix in Germany');
    assert.equal(ctx.availableText(series(), true), 'On Netflix');
    assert.equal(ctx.availableText(series({ providers: [NETFLIX, { id: 337, name: 'Disney+' }] })), 'Available on Netflix, Disney+ in Germany');
    assert.equal(ctx.availableText(series({ providers: [] })), null);
    assert.equal(ctx.availableText(movie({ providers: [NETFLIX] })), null); // a movie shows its German dates instead
    assert.equal(ctx.itemRelease({ title: series({ de_theatrical: null }), kind: null, date: null }), null);
  });
});

// ---- web page ----
test('web: a series poster carries the Series badge in the wall and in the card (list and dialog)', function () {
  var ctx = load('frontend/index.html');
  var seriesItem = { title: series(), kind: null, date: null };
  var movieItem = { title: movie({ de_theatrical: ctx.isoDay(5) }), kind: null, date: null };

  var tile = ctx.tile(seriesItem);
  assert.deepEqual(badges(tile, 'badge').map(function (b) { return b.textContent; }), ['Series']);
  assert.equal(badges(tile, 'series').length, 1);
  assert.match(tile.attrs['aria-label'], /^Series, Series Seven/);
  assert.match(allText(tile), /On Netflix/);
  assert.doesNotMatch(allText(tile), /No German date/);

  var card = ctx.card(seriesItem);
  var wrap = badges(card, 'posterwrap')[0];
  assert.equal(badges(wrap, 'series').length, 1, 'badge sits on the poster');
  assert.match(allText(card), /Available on Netflix in Germany/);

  assert.equal(badges(ctx.tile(movieItem), 'series').length, 0);
  assert.equal(badges(ctx.card(movieItem), 'series').length, 0);
  assert.deepEqual(badges(ctx.tile(movieItem), 'badge').map(function (b) { return b.textContent; }), ['Cinema']);
});

test('web: a series without a German service shows no date or service line', function () {
  var ctx = load('frontend/index.html');
  var item = { title: series({ providers: [] }), kind: null, date: null };
  assert.equal(ctx.releaseLine(item), null);
  var tile = ctx.tile(item);
  assert.equal(badges(tile, 'date')[0].textContent, '');
  assert.equal(badges(tile, 'series').length, 1);
});

test('web: Seerr status and requests are per media type, and the series button says season 1', function () {
  var ctx = load('frontend/index.html');
  ctx.requests.length = 0; // the page loads /api/titles on start
  ctx.seerrStatus = { 'tv:7': 'requested' };
  var movieControl = ctx.seerrControl(movie());
  assert.equal(movieControl.textContent, 'Request via Seerr'); // the series with the same id is requested, the movie is not
  var seriesControl = ctx.seerrControl(series());
  assert.equal(seriesControl.textContent, 'Requested in Seerr');
  ctx.seerrStatus = {};
  var button = ctx.seerrControl(series());
  assert.equal(button.textContent, 'Request season 1 via Seerr');
  button.onclick();
  ctx.seerrControl(movie()).onclick();
  assert.deepEqual(ctx.requests, ['POST /api/request/tv/7', 'POST /api/request/movie/7']);
  ctx.playTrailer(series(), fakeElement('button'));
  assert.equal(ctx.requests[2], 'GET /api/stream/tv/7');
});

test('web: service chip counts include series in the list views and stay equal to what is shown', function () {
  var ctx = load('frontend/index.html');
  ctx.allTitles = [movie({ de_digital: ctx.isoDay(-2), providers: [NETFLIX] }), series(), series({ tmdb_id: 8, providers: [] })];
  var chosen = { genres: [], keywords: [], kind: 'all', service: 0 };
  ['upcoming', 'recent', 'trailers', 'genres', 'all'].forEach(function (view) {
    var counts = ctx.serviceCounts(view, chosen);
    var shown = ctx.allTitles.filter(function (t) { return ctx.matchesFilter(t, { genres: [], keywords: [], service: NETFLIX.id, expected: view === 'upcoming' }); });
    assert.equal(counts[NETFLIX.id], ctx.viewCount(view, ctx.viewSections(view, shown, 'all')), view);
  });
  assert.equal(ctx.serviceCounts('all', chosen)[NETFLIX.id], 2); // the movie and the series, though both have id 7
  assert.equal(ctx.serviceCounts('recent', chosen)[NETFLIX.id], 1); // only the movie has a date
  assert.equal(ctx.viewCount('genres', ctx.viewSections('genres', ctx.allTitles, 'all')), 3); // same id, counted twice, not once
});

// ---- TV app ----
test('tv: a series poster has the Series badge, its own data-id and "On X" caption; movies have none', function () {
  var ctx = load('tv-app/index.html');
  var card = ctx.posterCard({ title: series(), kind: null, date: null });
  assert.deepEqual(badges(card, 'badge').map(function (b) { return b.textContent; }), ['Series']);
  assert.equal(card.attrs['data-id'], 'tv:7');
  assert.equal(badges(card, 'cap')[0].textContent, 'On Netflix');
  var film = ctx.posterCard({ title: movie({ de_theatrical: ctx.isoDay(5) }), kind: 'cinema', date: ctx.isoDay(5) });
  assert.equal(badges(film, 'series').length, 0);
  assert.equal(film.attrs['data-id'], 'movie:7');
});

test('tv: the hero shows the series badge and where it streams; a series without a service leaves the line empty', function () {
  var ctx = load('tv-app/index.html');
  ctx.showHero({ title: series(), kind: null, date: null });
  assert.deepEqual(badges(ctx.byId['hero-date'], 'rr-badge').map(function (b) { return b.textContent; }), ['Series']);
  assert.equal(ctx.byId['hero-date'].textContent, 'Available on Netflix in Germany');
  assert.match(allText(ctx.byId['hero-actions']), /Request season 1 via Seerr/);
  ctx.showHero({ title: series({ providers: [] }), kind: null, date: null });
  assert.equal(ctx.byId['hero-date'].textContent, '');
  ctx.showHero({ title: movie(), kind: null, date: null });
  assert.equal(badges(ctx.byId['hero-date'], 'kbadge').length, 0);
  assert.equal(ctx.byId['hero-date'].textContent, 'No German release date');
  assert.match(allText(ctx.byId['hero-actions']), /Request via Seerr/);
});

test('tv: the wall info dialog carries the badge for a series only', function () {
  var ctx = load('tv-app/index.html');
  ctx.openDialog({ title: series(), kind: null, date: null });
  assert.equal(badges(ctx.byId['dlg-poster'], 'series').length, 1);
  assert.equal(ctx.byId['dlg-date'].textContent, 'Available on Netflix in Germany');
  ctx.openDialog({ title: movie({ de_theatrical: ctx.isoDay(5) }), kind: null, date: null });
  assert.equal(badges(ctx.byId['dlg-poster'], 'series').length, 0);
});

test('tv: requests, Seerr state and playback address the series by media type', function () {
  var ctx = load('tv-app/index.html');
  ctx.requests.length = 0;
  ctx.seerrStatus = { 'tv:7': 'available' };
  var box = fakeElement('div');
  ctx.appendRequest(box, series(), function () {});
  assert.match(allText(box), /In the library/);
  var movieBox = fakeElement('div');
  ctx.appendRequest(movieBox, movie(), function () {});
  assert.match(allText(movieBox), /Request via Seerr/); // same id, different title: not in the library
  ctx.seerrStatus = {};
  var seriesBox = fakeElement('div');
  ctx.appendRequest(seriesBox, series(), function () {});
  seriesBox.children[0].onactivate();
  ctx.play(series());
  assert.deepEqual(ctx.requests.map(function (r) { return r.replace('http://192.168.42.57:8095', ''); }), ['POST /api/request/tv/7', 'GET /api/stream/tv/7']);
});

// ---- "Premieres on X" in the TV app (OS-T-GMHY4): same wording as the web page ----
var DISNEY = { id: 337, name: 'Disney+' };
['frontend/index.html', 'tv-app/index.html'].forEach(function (file) {
  test(file.split('/')[0] + ': an upcoming streaming title with only an expected service says "Premieres on X"', function () {
    var ctx = load(file);
    var d = ctx.isoDay;
    var expected = movie({ de_digital: d(10), providers_expected: [NETFLIX, DISNEY] });
    assert.equal(ctx.premiereText(expected, 'streaming', d(10)), 'Premieres on Netflix, Disney+');
    assert.equal(ctx.whereText(expected, 'streaming', d(10)), 'Premieres on Netflix, Disney+');
    assert.equal(ctx.premiereText(expected, 'streaming', d(0)), 'Premieres on Netflix, Disney+'); // today counts
    // a current service wins
    var current = movie({ de_digital: d(10), providers: [NETFLIX], providers_expected: [DISNEY] });
    assert.equal(ctx.premiereText(current, 'streaming', d(10)), null);
    assert.equal(ctx.whereText(current, 'streaming', d(10)), 'Netflix');
    // a past date keeps the plain text
    var past = movie({ de_digital: d(-3), providers_expected: [NETFLIX] });
    assert.equal(ctx.premiereText(past, 'streaming', d(-3)), null);
    assert.equal(ctx.whereText(past, 'streaming', d(-3)), 'Streaming');
    // no data stays unknown
    assert.equal(ctx.whereText(movie({ de_digital: d(10) }), 'streaming', d(10)), 'Streaming');
    assert.equal(ctx.whereText(movie({ de_digital: d(10), providers_expected: [] }), 'streaming', d(10)), 'Streaming');
    // cinema is unchanged
    assert.equal(ctx.premiereText(expected, 'cinema', d(10)), null);
    assert.equal(ctx.whereText(expected, 'cinema', d(10)), 'Cinema');
  });
});

test('tv: hero, wall dialog and poster badge say "Premieres on X"; a series is unchanged', function () {
  var ctx = load('tv-app/index.html');
  var date = ctx.isoDay(10);
  var item = { title: movie({ de_digital: date, providers_expected: [NETFLIX] }), kind: 'streaming', date: date };
  ctx.showHero(item);
  assert.match(ctx.byId['hero-date'].textContent, /^\w{3}, \d+ \w{3} \d{4} · Premieres on Netflix$/);
  ctx.openDialog(item);
  assert.match(ctx.byId['dlg-date'].textContent, / · Premieres on Netflix$/);
  assert.deepEqual(badges(ctx.posterCard(item), 'badge').map(function (b) { return b.textContent; }), ['Premieres on\nNetflix']); // two lines
  assert.match(badges(ctx.posterCard(item), 'cap')[0].textContent, /^\w{3} \d+ \w{3}$/); // the date only
  var cinema = { title: item.title, kind: 'cinema', date: date };
  assert.deepEqual(badges(ctx.posterCard(cinema), 'badge').map(function (b) { return b.textContent; }), ['Cinema']);
  var tv = { title: series({ providers_expected: [DISNEY] }), kind: null, date: null };
  ctx.showHero(tv);
  assert.equal(ctx.byId['hero-date'].textContent, 'Available on Netflix in Germany');
  assert.deepEqual(badges(ctx.posterCard(tv), 'badge').map(function (b) { return b.textContent; }), ['Series']);
});

// ---- All titles is A to Z (OS-T-0AQ3G) ----
['frontend/index.html', 'tv-app/index.html'].forEach(function (file) {
  test(file.split('/')[0] + ': All titles is A to Z, ignoring case and accents; other views keep their order', function () {
    var ctx = load(file);
    var names = ['zebra', 'Émile', 'Rebecca', 'eden', 'Port of Shadows', 'Die Sünderin'];
    var titles = names.map(function (name, i) { return movie({ tmdb_id: i + 1, title: name, trailer: { key: 'k', published_at: '2026-11-0' + (i + 1) } }); });
    function order(view) { return Array.from(ctx.viewSections(view, titles, 'all')[0].items, function (item) { return item.title.title; }); }
    assert.deepEqual(order('all'), ['Die Sünderin', 'eden', 'Émile', 'Port of Shadows', 'Rebecca', 'zebra']);
    assert.deepEqual(order('trailers'), names.slice().reverse());
    assert.deepEqual(order('genres'), names);
    assert.deepEqual(titles.map(function (t) { return t.title; }), names, 'the catalogue itself is not reordered');
    var twins = [movie({ tmdb_id: 9, title: 'Twin' }), movie({ tmdb_id: 10, title: 'twin' })];
    assert.deepEqual(Array.from(ctx.viewSections('all', twins, 'all')[0].items, function (item) { return item.title.tmdb_id; }), [10, 9]);
  });
});
