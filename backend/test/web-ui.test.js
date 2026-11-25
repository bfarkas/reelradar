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
  var context = {
    byId: byId, requests: requests, handlers: handlers, storage: storage,
    document: {
      body: element('body'), activeElement: null,
      createElement: element,
      createTextNode: function (value) { var t = element('#text'); t.textContent = value; return t; },
      getElementById: node,
      addEventListener: function (type, fn) { handlers[type] = fn; }
    },
    window: { localStorage: { getItem: function (k) { return storage[k] === undefined ? null : storage[k]; }, setItem: function (k, v) { storage[k] = v; } } },
    XMLHttpRequest: function () {
      var request = this;
      request.open = function (method, url) { request.name = method + ' ' + url; };
      request.send = function () { requests.push(request); };
    },
    console: console
  };
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

// ---- an active filter is visible with the panel closed (OS-T-GXNDA) ----
test('web filter: a saved filter shows as a number and removable chips; Clear only when something is set', function () {
  var saved = { v: 1, genres: [ACTION.id], keywords: [99], kind: 'all', service: 0 };
  var ctx = screen([movie(1, { genres: [ACTION], de_theatrical: '2099-01-01' }), movie(2)], { storage: { 'reelradar.filter': JSON.stringify(saved) } });
  var chips = ctx.byId['active-tags'].children;
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Genres & keywords (2)');
  assert.equal(ctx.byId['filter-toggle'].className, 'chip on');
  assert.deepEqual(chips.map(function (c) { return c.textContent; }), ['Action ✕', 'Unknown keyword ✕']);
  assert.equal(ctx.byId['filter-clear'].hidden, false);

  chips[1].onclick();
  ctx.byId['active-tags'].children[0].onclick();
  assert.equal(ctx.byId['filter-toggle'].textContent, 'Genres & keywords');
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
