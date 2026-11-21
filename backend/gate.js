'use strict';

function acceptedType(type) {
  return type === 'Trailer' || type === 'Teaser' || type === 'Teaser Trailer';
}

function suspectedLocaleVersion(name, originalLanguage) {
  var value = name || '';
  var withoutGermanWords = value;

  if (originalLanguage === 'de') {
    withoutGermanWords = withoutGermanWords.replace(/german deutsch|deutsch/ig, '');
  }

  return /german deutsch|deutsch|dubbed|synchro|\bOmU\b|\bOmdU\b/i.test(withoutGermanWords) ||
    /\bUT\b/.test(withoutGermanWords);
}

function decide(title, candidates, lists) {
  var allow = new Set((lists && lists.allow) || []);
  var deny = new Set((lists && lists.deny) || []);
  var originalLanguage = title && title.original_language;

  return (candidates || []).map(function (candidate) {
    var result = { key: candidate.key, playable: false, reason: 'missing or unknown language signals' };

    if (deny.has(candidate.key)) {
      result.reason = 'deny list';
      return result;
    }
    if (allow.has(candidate.key)) {
      result.playable = true;
      result.reason = 'allow list';
      return result;
    }
    if (candidate.site !== 'YouTube') {
      result.reason = 'not YouTube';
      return result;
    }
    if (!acceptedType(candidate.type)) {
      result.reason = 'not a trailer or teaser';
      return result;
    }
    if (suspectedLocaleVersion(candidate.name, originalLanguage)) {
      result.reason = 'suspected dub/subtitled locale version';
      return result;
    }
    if (!originalLanguage) return result;

    if (candidate.tmdb_lang) {
      if (candidate.tmdb_lang === originalLanguage) {
        result.playable = true;
        result.reason = 'TMDB language matches original (' + originalLanguage + ')';
      } else {
        result.reason = 'TMDB language ' + candidate.tmdb_lang +
          ' does not match original ' + originalLanguage;
      }
      return result;
    }

    if ((originalLanguage === 'en' || originalLanguage === 'de') &&
        candidate.kc_lang === originalLanguage) {
      result.playable = true;
      result.reason = 'KinoCheck language matches original (' + originalLanguage + ')';
    } else {
      result.reason = 'KinoCheck label cannot verify ' + originalLanguage +
        ' original; needs allow list';
    }
    return result;
  });
}

function typeRank(type) {
  return type === 'Trailer' ? 0 : 1;
}

// Rejected only because of language: these may stand in when no original-language trailer is playable.
var LANGUAGE_REASON = /^(TMDB language .* does not match|suspected dub|KinoCheck label cannot verify|missing or unknown language)/;

// Owner order (2026-11-22) when no original-language trailer plays: subtitled versions (original
// audio) before dubbed ones; within each, English before German before anything else.
function subtitled(name) {
  return /subtitled|untertitel|\bOmd?U\b|\bsubs?\b/i.test(name || '') || /\bUT\b/.test(name || '');
}
function fallbackRank(candidate) {
  var language = candidate.tmdb_lang || candidate.kc_lang;
  return (subtitled(candidate.name) ? 0 : 3) + (language === 'en' ? 0 : language === 'de' ? 1 : 2);
}

function pickTrailer(candidates, decisions) {
  var byKey = Object.create(null);
  (decisions || []).forEach(function (decision) { byKey[decision.key] = decision; });
  function decisionOf(candidate) { return byKey[candidate.key] || candidate; }

  var playable = (candidates || []).filter(function (candidate) { return decisionOf(candidate).playable; });
  var fallback = !playable.length;
  if (fallback) {
    playable = (candidates || []).filter(function (candidate) {
      return LANGUAGE_REASON.test(decisionOf(candidate).reason || '');
    });
  }

  playable.sort(function (a, b) {
    var aTime;
    var bTime;
    if (fallback) {
      var fallbackDifference = fallbackRank(a) - fallbackRank(b);
      if (fallbackDifference) return fallbackDifference;
    }
    var typeDifference = typeRank(a.type) - typeRank(b.type);
    if (typeDifference) return typeDifference;
    aTime = Date.parse(a.published_at || '') || 0;
    bTime = Date.parse(b.published_at || '') || 0;
    if (aTime !== bTime) return bTime - aTime;
    return Number(Boolean(b.official)) - Number(Boolean(a.official));
  });

  return playable.length ? playable[0] : null;
}

module.exports = decide;
module.exports.decide = decide;
module.exports.gate = decide;
module.exports.pickTrailer = pickTrailer;
