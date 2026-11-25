'use strict';

// Remote navigation and screens of the TV app: the real inline script against a small DOM that has the selectors,
// classes and rectangles the script uses. Rectangles are set by the test; nothing is laid out.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var html = fs.readFileSync(path.join(__dirname, '..', '..', 'tv-app', 'index.html'), 'utf8');
var script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function element(tag) {
  var text = '';
  var e = {
    tag: tag, className: '', children: [], style: {}, attrs: {}, parentNode: null, rect: { left: 0, top: 0, width: 0, height: 0 },
    scrollTop: 0, scrollLeft: 0, scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    appendChild: function (child) { child.parentNode = e; e.children.push(child); return child; },
    insertBefore: function (child, ref) { child.parentNode = e; var at = e.children.indexOf(ref); e.children.splice(at < 0 ? e.children.length : at, 0, child); return child; },
    setAttribute: function (name, value) { e.attrs[name] = String(value); },
    getAttribute: function (name) { return e.attrs[name] === undefined ? null : e.attrs[name]; },
    removeAttribute: function (name) { delete e.attrs[name]; },
    getBoundingClientRect: function () { var r = e.rect; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height }; },
    querySelectorAll: function (selector) { return all(e).filter(function (node) { return matches(node, selector); }); },
    querySelector: function (selector) { return e.querySelectorAll(selector)[0] || null; },
    addEventListener: function () {}, load: function () {}, pause: function () {}, play: function () {}
  };
  Object.defineProperty(e, 'textContent', {
    get: function () { return text; },
    set: function (value) { text = value; e.children.forEach(function (c) { c.parentNode = null; }); e.children = []; }
  });
  Object.defineProperty(e, 'firstChild', { get: function () { return e.children[0] || null; } });
  return e;
}
function all(root) {
  return [].concat.apply([], root.children.map(function (child) { return [child].concat(all(child)); }));
}
// '.a', '.a.b' and '[data-x="y"]' combinations: all the script needs.
function matches(node, selector) {
  var parts = selector.match(/\.[\w-]+|\[[\w-]+="[^"]*"\]/g);
  assert.equal(parts.join(''), selector, 'unsupported selector ' + selector);
  return parts.every(function (part) {
    if (part[0] === '.') return (' ' + node.className + ' ').indexOf(' ' + part.slice(1) + ' ') !== -1;
    var m = part.match(/^\[([\w-]+)="([^"]*)"\]$/);
    return node.attrs[m[1]] === m[2];
  });
}

// The static elements of the page, nested as in the markup.
function load(stored) {
  var byId = {}, handlers = {}, requests = [], timers = [];
  function node(id, parent) {
    byId[id] = element('div');
    byId[id].attrs.id = id;
    if (parent) byId[parent].appendChild(byId[id]);
    return byId[id];
  }
  node('main');
  ['views', 'open-filter', 'clear-filter', 'layout-wall', 'layout-rows', 'count', 'backdrop', 'kicker', 'hero-title', 'hero-date', 'hero-text', 'hero-actions', 'message', 'list'].forEach(function (id) { node(id, 'main'); });
  node('dialog'); ['dlg-poster', 'dlg-title', 'dlg-date', 'dlg-text', 'dlg-actions'].forEach(function (id) { node(id, 'dialog'); });
  node('filter'); ['genres', 'keywords'].forEach(function (id) { node(id, 'filter'); });
  node('player'); ['video', 'status', 'ctl', 'pi', 'ptime', 'pfill'].forEach(function (id) { node(id, 'player'); });
  var body = element('body');
  var storage = stored || {};
  var context = {
    byId: byId, requests: requests, timers: timers, handlers: handlers, storage: storage,
    document: {
      body: body, createElement: element,
      getElementById: function (id) { return byId[id] || node(id); },
      addEventListener: function (type, fn) { handlers[type] = fn; }
    },
    window: { localStorage: { getItem: function (k) { return storage[k] === undefined ? null : storage[k]; }, setItem: function (k, v) { storage[k] = v; } } },
    XMLHttpRequest: function () {
      var request = this;
      request.open = function (method, url) { request.name = method + ' ' + url.replace('http://192.168.42.57:8095', ''); };
      request.send = function () { requests.push(request); };
    },
    setTimeout: function (fn, ms) { var timer = { fn: fn, ms: ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: function (timer) { if (timer) timer.cleared = true; },
    console: console
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

// Answer the pending request whose path ends in url.
function reply(ctx, url, body, status) {
  var request = ctx.requests.filter(function (r) { return !r.done && r.name.slice(-url.length) === url; })[0];
  assert.ok(request, 'no pending request ' + url);
  request.done = true;
  request.status = status || 200;
  request.responseText = JSON.stringify(body);
  request.onload();
}

var DRAMA = { id: 18, name: 'Drama' }, ACTION = { id: 28, name: 'Action' }, COMEDY = { id: 35, name: 'Comedy' };
function movie(id, fields) {
  return Object.assign({ media_type: 'movie', tmdb_id: id, title: 'Movie ' + id, original_title: 'Movie ' + id, de_theatrical: null, de_digital: null,
    genres: [DRAMA], keywords: [], providers: [], trailer: { key: 'k' + id, published_at: '2026-11-01' } }, fields);
}
// Shelves Action (1, 2, 3), Comedy (4) and Drama (5, 6, 7): the middle one is short and off to the left.
function catalogue() {
  return [movie(1, { genres: [ACTION] }), movie(2, { genres: [ACTION] }), movie(3, { genres: [ACTION] }),
    movie(4, { genres: [COMEDY] }), movie(5), movie(6), movie(7)];
}
// Posters in a grid by shelf, hero buttons above them, header above those.
function layOut(ctx) {
  ctx.byId.list.querySelectorAll('.shelf').forEach(function (shelf, row) {
    shelf.children.forEach(function (card, column) { card.rect = { left: 80 + column * 222, top: 700 + row * 420, width: 200, height: 330 }; });
  });
  ctx.byId['hero-actions'].querySelectorAll('.focusable').forEach(function (b, i) { b.rect = { left: 80 + i * 300, top: 540, width: 260, height: 70 }; });
}
function genresScreen(stored) {
  var ctx = load(stored);
  ctx.currentView = 'genres';
  reply(ctx, '/api/titles', catalogue());
  layOut(ctx);
  return ctx;
}
function focusedEl(ctx) { return ctx.byId[ctx.layer].querySelector('.focus'); }
function where(ctx) { var f = focusedEl(ctx); return f.item ? f.getAttribute('data-shelf') + ' ' + f.item.title.tmdb_id : f.textContent; }
function poster(ctx, shelf, id) { return ctx.byId.list.querySelector('[data-shelf="' + shelf + '"][data-id="movie:' + id + '"]'); }

test('tv focus: Up and Down move one shelf; only the first shelf goes to the hero, and Down returns', function () {
  var ctx = genresScreen();
  ctx.setFocus(poster(ctx, 'Drama', 7));
  ctx.move(0, -1); layOut(ctx);
  assert.equal(where(ctx), 'Comedy 4'); // not skipped, though a poster two shelves up is closer to straight above
  ctx.move(0, -1); layOut(ctx);
  assert.equal(where(ctx), 'Action 1');
  ctx.move(1, 0); layOut(ctx);
  ctx.move(0, -1); layOut(ctx);
  assert.match(where(ctx), /Play trailer/);
  ctx.move(0, 1);
  assert.equal(where(ctx), 'Action 2');
  ctx.move(0, 1);
  assert.equal(where(ctx), 'Comedy 4');
});

test('tv focus: closing Filter keeps the focused title, unchanged or changed, and falls back to the first', function () {
  var ctx = genresScreen();
  var before = poster(ctx, 'Drama', 6);
  ctx.setFocus(before);
  ctx.setFocus(ctx.byId['open-filter']);
  ctx.openFilter();
  ctx.closeFilter();
  assert.equal(focusedEl(ctx), before); // the same node: the list was not rebuilt

  ctx.setFocus(ctx.byId['open-filter']);
  ctx.openFilter();
  ctx.selection.genres = [DRAMA.id];
  ctx.closeFilter();
  assert.equal(where(ctx), 'Drama 6');

  ctx.openFilter();
  ctx.selection.genres = [ACTION.id];
  ctx.closeFilter();
  assert.equal(where(ctx), 'Action 1');
});

test('tv focus: Seerr status loading moves no focus, from the header, a poster, a hero button or the filter', function () {
  function loaded() { var ctx = genresScreen(); ctx.setFocus(poster(ctx, 'Comedy', 4)); layOut(ctx); return ctx; }

  var ctx = loaded();
  ctx.setFocus(ctx.byId['open-filter']);
  reply(ctx, '/api/seerr', { 'movie:4': 'requested' });
  assert.equal(focusedEl(ctx), ctx.byId['open-filter']);
  assert.match(ctx.byId['hero-actions'].children[1].textContent, /Requested in Seerr/);

  ctx = loaded();
  var card = focusedEl(ctx);
  reply(ctx, '/api/seerr', {});
  assert.equal(focusedEl(ctx), card);

  ctx = loaded();
  ctx.setFocus(ctx.byId['hero-actions'].querySelectorAll('.focusable')[1]); // the request button
  reply(ctx, '/api/seerr', { 'movie:4': 'requested' });
  assert.match(where(ctx), /Play trailer/); // the button became a label, so its neighbour
  assert.equal(focusedEl(ctx).parentNode, ctx.byId['hero-actions']);

  ctx = loaded();
  ctx.openFilter();
  var tag = focusedEl(ctx);
  reply(ctx, '/api/seerr', { 'movie:4': 'requested' });
  assert.equal(focusedEl(ctx), tag);
  assert.match(ctx.byId['hero-actions'].children[1].textContent, /Requested in Seerr/); // applied, not dropped
});
