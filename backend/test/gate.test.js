'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var gate = require('../gate');

var cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gate-cases.json')));

cases.forEach(function (fixture) {
  test(fixture.name, function () {
    var result = gate.decide(
      { original_language: fixture.original_language },
      [fixture.candidate],
      { allow: [], deny: [] }
    )[0];
    assert.equal(result.playable, fixture.playable);
  });
});

test('allow list permits a non-English original with only an English trailer', function () {
  var candidate = cases[2].candidate;
  var result = gate.decide({ original_language: 'ko' }, [candidate],
    { allow: [candidate.key], deny: [] })[0];
  assert.equal(result.playable, true);
  assert.equal(result.reason, 'allow list');
});

test('deny list wins over an otherwise matching trailer and the allow list', function () {
  var candidate = cases[0].candidate;
  var result = gate.decide({ original_language: 'en' }, [candidate],
    { allow: [candidate.key], deny: [candidate.key] })[0];
  assert.equal(result.playable, false);
  assert.equal(result.reason, 'deny list');
});

test('German Deutsch is suspected on an English original', function () {
  var candidate = Object.assign({}, cases[0].candidate, { name: 'Film Trailer German Deutsch' });
  var result = gate.decide({ original_language: 'en' }, [candidate], { allow: [], deny: [] })[0];
  assert.equal(result.playable, false);
  assert.equal(result.reason, 'suspected dub/subtitled locale version');
});

test('German Deutsch is allowed as original audio on a German original', function () {
  var candidate = Object.assign({}, cases[0].candidate, {
    key: 'de-original', tmdb_lang: 'de', name: 'Film Trailer German Deutsch'
  });
  var result = gate.decide({ original_language: 'de' }, [candidate], { allow: [], deny: [] })[0];
  assert.equal(result.playable, true);
});

test('picker prefers Trailer over a newer Teaser', function () {
  var candidates = [
    { key: 'teaser', type: 'Teaser', published_at: '2026-11-20T00:00:00Z', official: true },
    { key: 'trailer', type: 'Trailer', published_at: '2026-01-01T00:00:00Z', official: false }
  ];
  var decisions = [
    { key: 'teaser', playable: true },
    { key: 'trailer', playable: true }
  ];
  assert.equal(gate.pickTrailer(candidates, decisions).key, 'trailer');
});

test('without a playable original-language trailer: subtitled before dubbed, English before German', function () {
  function c(key, lang, name, reason) {
    return { key: key, tmdb_lang: lang, name: name, type: 'Trailer', published_at: '2024-01-01', playable: 0, reason: reason };
  }
  var candidates = [
    c('deDub000001', 'de', 'Film Trailer Deutsch', 'suspected dub/subtitled locale version'),
    c('enDub000001', 'en', 'Official Trailer', 'TMDB language en does not match original ja'),
    c('deOmU000001', 'de', 'Film Trailer OmU', 'suspected dub/subtitled locale version'),
    c('enSub000001', 'en', 'Official Trailer [Subtitled]', 'TMDB language en does not match original ja'),
    { key: 'enClip00001', tmdb_lang: 'en', type: 'Clip', playable: 0, reason: 'not a trailer or teaser' },
    c('privateJa01', 'ja', 'Trailer', 'unavailable for download: ERROR: Private video')
  ];
  var order = [];
  var picked;
  while ((picked = gate.pickTrailer(candidates))) {
    order.push(picked.key);
    picked.reason = 'unavailable for download: test';
  }
  assert.deepEqual(order, ['enSub000001', 'deOmU000001', 'enDub000001', 'deDub000001']);
});
