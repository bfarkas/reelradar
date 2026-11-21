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

function pickTrailer(candidates, decisions) {
  var byKey = Object.create(null);
  (decisions || []).forEach(function (decision) { byKey[decision.key] = decision; });

  var playable = (candidates || []).filter(function (candidate) {
    var decision = byKey[candidate.key];
    return decision ? decision.playable : candidate.playable;
  });

  playable.sort(function (a, b) {
    var typeDifference = typeRank(a.type) - typeRank(b.type);
    var aTime;
    var bTime;
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
