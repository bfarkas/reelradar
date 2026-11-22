'use strict';

// Runs the real inline script of tv-app/index.html against a stub DOM and checks the player overlay helpers.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var html = fs.readFileSync(path.join(__dirname, '..', '..', 'tv-app', 'index.html'), 'utf8');
var script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function stub() {
  return new Proxy(function () {}, {
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

test('fmtTime renders m:ss and survives bad input', function () {
  var ctx = load();
  assert.equal(ctx.fmtTime(0), '0:00');
  assert.equal(ctx.fmtTime(9.9), '0:09');
  assert.equal(ctx.fmtTime(65), '1:05');
  assert.equal(ctx.fmtTime(754), '12:34');
  assert.equal(ctx.fmtTime(NaN), '0:00');
  assert.equal(ctx.fmtTime(Infinity), '0:00');
  assert.equal(ctx.fmtTime(-5), '0:00');
});

test('seekPosition clamps to the start and, once known, the end', function () {
  var ctx = load();
  assert.equal(ctx.seekPosition(30, 10, 120), 40);
  assert.equal(ctx.seekPosition(5, -10, 120), 0);
  assert.equal(ctx.seekPosition(115, 10, 120), 120);
  assert.equal(ctx.seekPosition(30, 10, NaN), 40); // duration not loaded yet
});

test('overlayState gives the "m:ss / m:ss" text and the played percentage', function () {
  var ctx = load();
  var s = ctx.overlayState(30, 120);
  assert.equal(s.text, '0:30 / 2:00');
  assert.equal(s.percent, 25);
  assert.equal(ctx.overlayState(30, NaN).percent, 0);
  assert.equal(ctx.overlayState(500, 120).percent, 100);
});
