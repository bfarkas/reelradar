'use strict';

// Daily job at a local wall-clock time ("HH:MM", container TZ). One run at a time.

function nextRun(now, time) {
  var match = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('IMPORT_TIME must be HH:MM, got ' + time);
  var next = new Date(now.getTime());
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function daily(time, job, logger) {
  var running = false;
  function run() {
    if (running) { logger.warn('scheduled job skipped: previous run still busy'); return Promise.resolve(); }
    running = true;
    return Promise.resolve().then(job).catch(function (error) {
      logger.error('scheduled job failed: ' + error.message);
    }).finally(function () { running = false; });
  }
  (function arm() {
    var at = nextRun(new Date(), time);
    logger.log('next scheduled import at ' + at.toString());
    setTimeout(function () { run().then(arm); }, at - Date.now());
  })();
  return run; // also used for the start-up import, so the two never overlap
}

module.exports = { daily: daily, nextRun: nextRun };
