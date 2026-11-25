'use strict';

// A DOM small enough to read, with the selectors, classes and rectangles the two pages' scripts use. Nothing is laid
// out: a test that needs rectangles sets them.
var assert = require('node:assert/strict');

function element(tag) {
  var text = '';
  var e = {
    tag: tag, className: '', children: [], style: {}, attrs: {}, parentNode: null, rect: { left: 0, top: 0, width: 0, height: 0 },
    scrollTop: 0, scrollLeft: 0, scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    appendChild: function (child) { child.parentNode = e; e.children.push(child); return child; },
    removeChild: function (child) { e.children.splice(e.children.indexOf(child), 1); child.parentNode = null; return child; },
    insertBefore: function (child, ref) { child.parentNode = e; var at = e.children.indexOf(ref); e.children.splice(at < 0 ? e.children.length : at, 0, child); return child; },
    setAttribute: function (name, value) { e.attrs[name] = String(value); },
    getAttribute: function (name) { return e.attrs[name] === undefined ? null : e.attrs[name]; },
    removeAttribute: function (name) { delete e.attrs[name]; },
    getBoundingClientRect: function () { var r = e.rect; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height }; },
    querySelectorAll: function (selector) { return all(e).filter(function (node) { return matches(node, selector); }); },
    querySelector: function (selector) { return e.querySelectorAll(selector)[0] || null; },
    addEventListener: function (type, fn) { (e.listeners = e.listeners || {})[type] = fn; }, load: function () {}, pause: function () {}, play: function () {}, focus: function () {}
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
// '.a', '.a.b', '[data-x="y"]', tag names and comma lists: all the scripts need.
function matches(node, selector) {
  return selector.split(',').some(function (one) {
    var parts = one.trim().match(/^[a-z][a-z0-9]*|\.[\w-]+|\[[\w-]+="[^"]*"\]/g) || [];
    assert.equal(parts.join(''), one.trim(), 'unsupported selector ' + selector);
    return parts.every(function (part) {
      if (part[0] === '.') return (' ' + node.className + ' ').indexOf(' ' + part.slice(1) + ' ') !== -1;
      if (part[0] !== '[') return node.tag === part;
      var m = part.match(/^\[([\w-]+)="([^"]*)"\]$/);
      return node.attrs[m[1]] === m[2];
    });
  });
}
module.exports = { element: element, all: all, matches: matches };
