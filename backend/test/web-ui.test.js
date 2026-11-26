'use strict';

// The web page's screens: the real inline script against the small test DOM.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var element = require('./helpers/dom').element;

var html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8');
var script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function load(options) {
  options = options || {};
  var byId = {}, requests = [], handlers = {}, storage = options.storage || {};
  function node(id) {
    if (!byId[id]) {
      byId[id] = element('div');
      byId[id].attrs.id = id;
      byId[id].hidden = id === 'filter' || id === 'detail' || id === 'player' || id === 'filter-clear';
      byId[id].value = '';
    }
    return byId[id];
  }
  // history as the browser keeps it: entries of {state, hash}; back() and a link click fire popstate.
  var entries = [{ state: null, hash: options.hash || '' }], at = 0;
  var win = {
    localStorage: { getItem: function (k) { return storage[k] === undefined ? null : storage[k]; }, setItem: function (k, v) { storage[k] = v; } },
    location: { get hash() { return entries[at].hash; } },
    history: {
      get state() { return entries[at].state; },
      get length() { return at + 1; },
      pushState: function (state) { entries.splice(at + 1, entries.length, { state: state, hash: entries[at].hash }); at += 1; },
      back: function () { win.history.go(-1); },
      go: function (n) { at = Math.max(0, at + n); if (win.onpopstate) win.onpopstate({ state: entries[at].state }); }
    },
    follow: function (hash) { entries.splice(at + 1, entries.length, { state: null, hash: hash }); at += 1; win.onpopstate({ state: null }); }
  };
  var context = {
    byId: byId, requests: requests, handlers: handlers, storage: storage,
    document: {
      body: element('body'), activeElement: null,
      createElement: element,
      createTextNode: function (value) { var t = element('#text'); t.textContent = value; return t; },
      getElementById: node,
      addEventListener: function (type, fn) { handlers[type] = fn; }
    },
    window: win,
    XMLHttpRequest: function () {
      var request = this;
      request.open = function (method, url) { request.name = method + ' ' + url; };
      request.send = function () { requests.push(request); };
    },
    console: console
  };
  if (options.phone) win.matchMedia = function () { return { matches: true }; };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

function reply(ctx, url, body, status) {
  var request = ctx.requests.filter(function (r) { return !r.done && r.name.slice(-url.length) === url; })[0];
  assert.ok(request, 'no pending request ' + url);
  request.done = true;
  request.status = status || 200;
  request.responseText = JSON.stringify(body);
  request.onload();
}

var DRAMA = { id: 18, name: 'Drama' }, ACTION = { id: 28, name: 'Action' };
function movie(id, fields) {
  return Object.assign({ media_type: 'movie', tmdb_id: id, title: 'Movie ' + id, original_title: 'Movie ' + id, de_theatrical: null, de_digital: null,
    genres: [DRAMA], keywords: [], providers: [], trailer: { key: 'k' + id, published_at: '2026-11-01' }, decisions: [] }, fields);
}
function screen(titles, options) {
  var ctx = load(options);
  reply(ctx, '/api/titles', titles);
  return ctx;
}

// ---- phone width (OS-T-XE0MB) ----
test('web: one Filter button counts kind, service, genres and keywords, each a removable chip', function () {
  var saved = { v: 1, genres: [DRAMA.id], keywords: [], kind: 'streaming', service: 8 };
  var titles = [movie(1, { providers: [{ id: 8, name: 'Netflix' }], de_digital: '2099-01-01' })];
  var ctx = screen(titles, { storage: { 'reelradar.filter': JSON.stringify(saved) } });
  function chips() { return Array.from(ctx.byId['active-tags'].children); }
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Filter (3)');
  assert.deepEqual(chips().map(function (c) { return c.textContent; }), ['Streaming', 'Netflix', 'Drama']);
  assert.equal(chips()[1].attrs['aria-label'], 'Remove filter Netflix');
  assert.equal(ctx.byId.service.attrs['aria-pressed'], undefined); // a select is not a toggle
  chips()[1].onclick();
  assert.equal(ctx.selection.service, 0);
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Filter (2)');
  chips()[0].onclick();
  assert.equal(ctx.selection.kind, 'all');
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Filter (1)');
});

// ---- an active filter is visible with the panel closed (OS-T-GXNDA) ----
test('web filter: a saved filter shows as a number and removable chips; Clear only when something is set', function () {
  var saved = { v: 1, genres: [ACTION.id], keywords: [99], kind: 'all', service: 0 };
  var ctx = screen([movie(1, { genres: [ACTION], de_theatrical: '2099-01-01' }), movie(2)], { storage: { 'reelradar.filter': JSON.stringify(saved) } });
  var chips = ctx.byId['active-tags'].children;
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Filter (2)');
  assert.equal(ctx.byId['filter-toggle'].className, 'rr-chip is-on');
  assert.deepEqual(chips.map(function (c) { return c.textContent; }), ['Action', 'Unknown keyword']);
  assert.equal(ctx.byId['filter-clear'].hidden, false);

  chips[1].onclick();
  ctx.byId['active-tags'].children[0].onclick();
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Filter');
  assert.equal(ctx.byId['active-tags'].children.length, 0);
  assert.equal(ctx.byId['filter-clear'].hidden, true);
  assert.deepEqual(JSON.parse(ctx.storage['reelradar.filter']), { v: 1, genres: [], keywords: [], kind: 'all', service: 0 });

  ctx.selection.kind = 'cinema'; // a kind alone is something to clear too
  ctx.renderTitles();
  assert.equal(ctx.byId['filter-clear'].hidden, false);
});

test('web filter: the count uses one unit', function () {
  var ctx = screen([movie(1, { de_theatrical: '2099-01-01' }), movie(2)]);
  ctx.currentView = 'upcoming';
  ctx.byId.titles.textContent = '';
  ctx.allTitles = [movie(1, { de_theatrical: ctx.isoDay(3), de_digital: ctx.isoDay(40) }), movie(2)];
  ctx.renderTitles();
  assert.equal(ctx.byId.count.textContent, '2 releases');
  ctx.currentView = 'all';
  ctx.allTitles = [movie(1)];
  ctx.renderTitles();
  assert.equal(ctx.byId.count.textContent, '1 title');
});

// ---- Back, refresh and dialogs keep the viewer's place (OS-T-XTPZ8) ----
function current(ctx) {
  var link = ctx.byId.views.children.filter(function (a) { return a.attrs['aria-current'] === 'page'; });
  assert.equal(link.length, 1);
  return link[0].textContent;
}
test('web history: the hash picks the view on load, and Back returns to the previous one', function () {
  assert.equal(current(screen([movie(1)], { hash: '#/genres' })), 'Genres');
  assert.equal(current(screen([movie(1)], { hash: '#nonsense' })), 'Release calendar');
  var ctx = screen([movie(1)]);
  var links = ctx.byId.views.children;
  assert.deepEqual(links.map(function (a) { return a.href; }), ['#/upcoming', '#/trailers', '#/recent', '#/genres', '#/all']);
  ctx.window.follow('#/all');
  assert.equal(current(ctx), 'All titles');
  assert.equal(ctx.byId.views.children[0], links[0], 'the nav is not rebuilt, so focus stays on the link');
  ctx.window.history.back();
  assert.equal(current(ctx), 'Release calendar');
});

test('web history: Back closes the player, then the details, then goes to the previous view', function () {
  var ctx = screen([movie(1)]);
  ctx.window.follow('#/all');
  var opener = ctx.byId.titles.querySelector('button'), focused = [];
  opener.focus = function () { focused.push('opener'); };
  ctx.openDetail({ title: movie(1), kind: null, date: null }, opener);
  var play = ctx.byId.detail.querySelector('.rr-btn--primary');
  play.focus = function () { focused.push('play'); };
  ctx.playTrailer(movie(1), play);
  reply(ctx, '/api/stream/movie/1', { url: '/media/x.mp4' });
  assert.equal(ctx.byId.player.hidden, false);
  assert.equal(ctx.byId.page.inert, true);
  assert.equal(ctx.byId.detail.inert, true);

  ctx.window.history.back();
  assert.equal(ctx.byId.player.hidden, true);
  assert.equal(ctx.byId.detail.hidden, false);
  assert.equal(ctx.byId.detail.inert, false);
  ctx.window.history.back();
  assert.equal(ctx.byId.detail.hidden, true);
  assert.equal(ctx.byId.page.inert, false);
  assert.deepEqual(focused, ['play', 'opener']);
  assert.equal(current(ctx), 'All titles');
  ctx.window.history.back();
  assert.equal(current(ctx), 'Release calendar');
});

test('web history: closing by button, backdrop or Escape leaves no entry behind', function () {
  var ctx = screen([movie(1)]);
  var item = { title: movie(1), kind: null, date: null };
  function open() { ctx.openDetail(item, null); assert.equal(ctx.window.history.length, 2); }
  open(); ctx.closeDetail(); assert.equal(ctx.window.history.length, 1);
  open(); ctx.byId.detail.onclick({ target: ctx.byId.detail }); assert.equal(ctx.window.history.length, 1);
  open(); ctx.handlers.keydown({ key: 'Escape' }); assert.equal(ctx.window.history.length, 1);
  ctx.playTrailer(movie(1), element('button'));
  reply(ctx, '/api/stream/movie/1', { url: '/media/x.mp4' });
  ctx.byId['player-close'].onclick();
  assert.equal(ctx.window.history.length, 1);
  assert.equal(ctx.byId.player.hidden, true);
});

// ---- list cards open details; decision logs stay in the dialog (OS-T-JQ760) ----
test('web cards: poster and title open details; logs only there with ?debug; KinoCheck stays; no poster is an empty box', function () {
  var title = movie(1, { poster_path: null, trailer: { key: 'k', published_at: '2026-11-01', kinocheck_url: 'https://kinocheck.com/x' },
    decisions: [{ key: 'abc', source: 'tmdb', playable: true, reason: 'original language' }] });
  var ctx = screen([title]);
  var card = ctx.card({ title: title, kind: null, date: null });
  function everything(root) { return [root.textContent].concat(root.querySelectorAll('div, p, a, summary, span, button, h3, details').map(function (n) { return n.textContent; })).join('|'); }
  function kinocheck(root) { return root.querySelectorAll('a').filter(function (a) { return a.href === 'https://kinocheck.com/x'; }).length; }
  assert.doesNotMatch(everything(card), /Trailer check|original language/);
  assert.equal(kinocheck(card), 1);
  assert.equal(card.querySelector('.posterwrap').querySelector('.poster').tag, 'span'); // the title is not written twice
  card.querySelector('.open').onclick.call(card.querySelector('.open'));
  assert.doesNotMatch(everything(ctx.byId.detail), /Trailer check/);
  ctx.closeDetail();
  ctx.DEBUG = true;
  var openers = card.querySelectorAll('.open');
  assert.equal(openers.length, 2);
  openers.forEach(function (opener) {
    assert.equal(opener.tag, 'button'); // a native button: Enter and Space work
    opener.onclick.call(opener);
    assert.equal(ctx.byId.detail.hidden, false);
    assert.match(everything(ctx.byId.detail), /Trailer check\|.*original language/);
    assert.equal(kinocheck(ctx.byId.detail), 1);
    assert.equal(ctx.byId.detail.querySelectorAll('.open').length, 0);
    ctx.closeDetail();
  });
});

// ---- long pages: weeks in the wall, month jumps, genre caps, lazy posters (OS-T-065T4) ----
function find(ctx, selector) { return ctx.byId.titles.querySelectorAll(selector); }
function headings(ctx) { return find(ctx, 'h2').map(function (h) { return h.textContent; }); }
function calendar(ctx, layout, view, dates) {
  ctx.layout = layout;
  ctx.currentView = view;
  ctx.allTitles = dates.map(function (date, i) { return movie(i + 1, { de_theatrical: date, poster_path: '/p' + i + '.jpg' }); });
  ctx.renderTitles();
}

test('web wall: the calendar is grouped by week in date order, with month jumps in both layouts', function () {
  var ctx = screen([]);
  assert.equal(ctx.weekStart('2026-11-30'), '2026-11-30'); // a Monday
  assert.equal(ctx.weekStart('2026-12-06'), '2026-11-30'); // its Sunday
  assert.equal(ctx.weekStart('2027-01-01'), '2026-12-28');
  var dates = [ctx.isoDay(1), ctx.isoDay(45), ctx.isoDay(46), ctx.isoDay(100)];
  calendar(ctx, 'wall', 'upcoming', dates);
  var starts = dates.map(ctx.weekStart).filter(function (v, i, all) { return all.indexOf(v) === i; });
  assert.deepEqual(headings(ctx), starts.map(function (start) { return 'Week of ' + ctx.shortDate(start); }));
  assert.equal(find(ctx, '.tile').length, 4);
  ['wall', 'list'].forEach(function (layout) {
    calendar(ctx, layout, 'upcoming', dates);
    var nav = ctx.byId.titles.children[0];
    assert.equal(nav.className, 'months', layout);
    var months = dates.map(function (d) { return d.slice(0, 7); }).filter(function (v, i, all) { return all.indexOf(v) === i; });
    assert.equal(nav.children.length, months.length);
    var scrolled = [];
    find(ctx, '.day').forEach(function (head) { head.scrollIntoView = function () { scrolled.push(head); }; });
    nav.children[nav.children.length - 1].onclick();
    assert.equal(scrolled[0], find(ctx, '.day')[find(ctx, '.day').length - 1], layout);
  });
  ctx.layout = 'list';
  ctx.currentView = 'all';
  ctx.renderTitles();
  assert.equal(find(ctx, '.months').length, 0);
});

test('web wall: no backdrop strip, lazy poster images, and the title where there is no poster', function () {
  var ctx = screen([]);
  ctx.allTitles = [movie(1, { poster_path: '/a.jpg', backdrop_path: '/b.jpg' }), movie(2, { poster_path: null })];
  ctx.currentView = 'all';
  ctx.layout = 'wall';
  ctx.renderTitles();
  assert.equal(ctx.byId.hero.style.backgroundImage, '');
  var tiles = find(ctx, '.tile');
  var image = tiles[0].querySelector('img');
  assert.equal(image.loading, 'lazy');
  assert.match(image.src, /w342\/a\.jpg$/);
  assert.equal(tiles[0].querySelector('.art').style.backgroundImage, undefined);
  assert.equal(tiles[1].querySelector('img'), null);
  assert.equal(tiles[1].querySelector('.name'), null);
  assert.deepEqual(tiles.map(function (t) { return t.querySelector('.ttl').textContent; }), ['Movie 1', 'Movie 2']); // a visible title on every poster
  ctx.layout = 'list';
  ctx.renderTitles();
  assert.match(ctx.byId.hero.style.backgroundImage, /w1280\/b\.jpg/);
});

['list', 'wall'].forEach(function (layout) {
  test('web genres (' + layout + '): 12 per genre until Show all; counts cover every title', function () {
    var ctx = screen([]);
    var titles = [];
    for (var i = 1; i <= 15; i += 1) titles.push(movie(i));
    ctx.allTitles = titles.concat(movie(99, { genres: [ACTION] }));
    ctx.currentView = 'genres';
    ctx.layout = layout;
    ctx.renderTitles();
    var item = layout === 'wall' ? '.tile' : '.card';
    assert.equal(find(ctx, item).length, 13);
    assert.equal(ctx.byId.count.textContent, '16 titles');
    assert.deepEqual(find(ctx, 'small').map(function (n) { return n.textContent; }), ['1 titles', '15 titles']);
    var more = find(ctx, '.more');
    assert.deepEqual(more.map(function (b) { return b.textContent; }), ['Show all 15']);
    more[0].onclick();
    assert.equal(find(ctx, item).length, 16);
    assert.equal(find(ctx, '.more').length, 0);
    ctx.renderTitles(); // Seerr state arriving redraws the list
    assert.equal(find(ctx, item).length, 16);
  });
});

// ---- error recovery (OS-T-1N4NM) ----
test('web: a failed load offers Try again, which survives a view change and loads the list', function () {
  var ctx = load();
  reply(ctx, '/api/titles', { error: 'down' }, 500);
  function retry() { return ctx.byId.titles.querySelector('button'); }
  assert.equal(ctx.byId.titles.querySelector('p').textContent, 'Could not load titles.');
  assert.equal(retry().textContent, 'Try again');
  ctx.window.follow('#/all'); // a view change keeps the message and the button
  assert.equal(retry().textContent, 'Try again');
  retry().onclick();
  assert.equal(ctx.byId.titles.querySelector('p').textContent, 'Loading titles...');
  reply(ctx, '/api/titles', { error: 'down' }, 500);
  retry().onclick();
  reply(ctx, '/api/titles', [movie(1)]);
  assert.equal(ctx.byId.titles.querySelectorAll('.tile').length, 1); // the poster wall is the default layout
  reply(ctx, '/api/seerr', {});
});

test('web player: a broken file shows a message; closing and the next trailer show none', function () {
  var ctx = screen([movie(1)]);
  var video = ctx.byId.video, message = ctx.document.getElementById('player-error');
  var source = null;
  video.getAttribute = function () { return source; };
  video.removeAttribute = function () { source = null; };
  function open() {
    ctx.playTrailer(ctx.allTitles[0], ctx.document.createElement('button'));
    reply(ctx, '/api/stream/movie/1', { url: '/media/1.mp4' });
    source = '/media/1.mp4';
  }
  open();
  assert.equal(message.hidden, true);
  video.listeners.error();
  assert.equal(message.textContent, 'This trailer could not be played.');
  assert.equal(message.hidden, false);
  assert.equal(video.hidden, true);
  ctx.closePlayer();
  open();
  assert.equal(message.hidden, true);
  assert.equal(video.hidden, false);
  ctx.closePlayer();
  video.listeners.error(); // the browser may report the removed source
  assert.equal(message.hidden, true);
});
