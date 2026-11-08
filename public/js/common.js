// Helpers shared by the pages that are not the home page (Discover) and by the payment dialog.
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.add('js');
  var NS = 'http://www.w3.org/2000/svg';
  function $(s, r) { return (r || document).querySelector(s) }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) }

  // Builds DOM nodes without putting text through innerHTML, so nothing a visitor or the admin types can inject markup.
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) });
    return e;
  }
  function svg(attrs) { var e = document.createElementNS(NS, 'svg'); for (var k in attrs) e.setAttribute(k, attrs[k]); return e }

  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t) } catch (e) {}
        if (!r.ok) { var err = new Error((j && j.error) || 'Request failed (' + r.status + ')'); err.status = r.status; err.fields = (j && j.fields) || {}; throw err }
        return j;
      });
    }, function () { var err = new Error('Cannot reach the server. Check your connection and try again.'); err.fields = {}; throw err });
  }
  function post(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }

  // Money arrives from the server as whole cents.
  function usd(cents) {
    var n = Number(cents) / 100;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Number(cents) % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function priceRange(t) { return t.price_max_cents ? usd(t.price_cents) + ' – ' + usd(t.price_max_cents) : usd(t.price_cents) }

  function copyText(text, btn, label) {
    var back = label || btn.textContent;
    function ok() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = back }, 1800) }
    function no() { btn.textContent = 'Select and copy'; setTimeout(function () { btn.textContent = back }, 2500) }
    try { navigator.clipboard.writeText(text).then(ok, no) } catch (e) { no() }
  }

  /* ---------- menu ---------- */
  function initMenu() {
    var menu = $('#menu'), burger = $('#burger'); if (!menu || !burger) return;
    menu.inert = true;
    function openMenu(o) {
      menu.classList.toggle('open', o); menu.inert = !o;
      burger.setAttribute('aria-expanded', o ? 'true' : 'false');
      if (o) $('#menuClose').focus(); else burger.focus();
    }
    burger.addEventListener('click', function () { openMenu(true) });
    $('#menuClose').addEventListener('click', function () { openMenu(false) });
    $$('#menu a').forEach(function (a) { a.addEventListener('click', function () { menu.classList.remove('open'); menu.inert = true; burger.setAttribute('aria-expanded', 'false') }) });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.classList.contains('open')) openMenu(false) });
  }

  /* ---------- studio details in the footer and menu ---------- */
  function bindStudio(s) {
    $$('[data-bind]').forEach(function (n) {
      var k = n.dataset.bind, v = s[k];
      if (k === 'hours-inline') { n.textContent = (s.hours || '').replace(/\s*\n\s*/g, ', '); return }
      if (v === undefined) return;
      n.textContent = '';
      if (k === 'email') n.appendChild(h('a', { href: 'mailto:' + v, text: v }));
      else if (k === 'phone') n.appendChild(h('a', { href: 'tel:' + v.replace(/[^+\d]/g, ''), text: v }));
      else n.textContent = v;
    });
    if (s.studio_name && document.body.dataset.title) document.title = document.body.dataset.title + ' · ' + s.studio_name;
  }

  /* ---------- footer wordmark ---------- */
  function initMark() {
    var mark = $('#mark'); if (!mark) return;
    function fit() {
      var box = mark.parentNode, cs = getComputedStyle(box);
      mark.style.fontSize = '100px';
      var avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var w = $('.k', mark).offsetWidth + $('.studio', mark).offsetWidth;
      if (w > 0) mark.style.fontSize = (100 * avail / w * .99) + 'px';
    }
    fit(); window.addEventListener('resize', fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { en.forEach(function (x) { mark.classList.toggle('run', x.isIntersecting) }) }, { threshold: .15 }).observe(mark);
    else mark.classList.add('run');
    var y = $('#year'); if (y) y.textContent = new Date().getFullYear();
    return fit;
  }

  window.Ink = { $: $, $$: $$, h: h, svg: svg, api: api, post: post, usd: usd, priceRange: priceRange, copyText: copyText, initMenu: initMenu, bindStudio: bindStudio, initMark: initMark };
})();
