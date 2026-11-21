'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var scheduler = require('../scheduler');

test('next run is later today, or tomorrow once the time has passed', function () {
  var now = new Date(2026, 10, 22, 3, 30);
  assert.deepEqual(scheduler.nextRun(now, '04:00'), new Date(2026, 10, 22, 4, 0));
  assert.deepEqual(scheduler.nextRun(new Date(2026, 10, 22, 4, 0), '04:00'), new Date(2026, 10, 23, 4, 0));
  assert.deepEqual(scheduler.nextRun(new Date(2026, 11, 31, 23, 0), '04:00'), new Date(2027, 0, 1, 4, 0));
});

test('rejects a malformed time', function () {
  assert.throws(function () { scheduler.nextRun(new Date(), '25:00'); }, /HH:MM/);
  assert.throws(function () { scheduler.nextRun(new Date(), '4am'); }, /HH:MM/);
});
