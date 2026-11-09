(function () {
  'use strict';
  var doc = document.documentElement, NS = 'http://www.w3.org/2000/svg';
  doc.classList.add('js');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, r) { return (r || document).querySelector(s) }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) }

  // Builds DOM nodes without ever putting text through innerHTML, so nothing typed by a visitor or an admin can inject markup.
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

  /* ---------- hero art (replaced by a photo when one is uploaded) ---------- */
  Art.mandala($('#heroArt'), { sw: .42 });
  Art.ornament($('#ornAbout'), 11);
  Art.ornament($('#ornBook'), 23);

  /* ---------- preloader: waits for the content as well as the animation ---------- */
  var pre = $('#pre'), preNum = $('#preNum'), preBar = $('#preBar'), started = false, counted = false, loaded = false;
  function ready() {
    if (started) return; started = true;
    doc.classList.add('ready');
    if (pre) { pre.classList.add('done'); setTimeout(function () { pre && pre.parentNode && pre.parentNode.removeChild(pre) }, 1000) }
    if (location.hash.length > 1) { var hid = decodeURIComponent(location.hash.slice(1)); if (hid.indexOf('artist-') === 0) setTimeout(function () { goToArtist(hid.slice(7)) }, 80); else { var t = document.getElementById(hid); if (t) setTimeout(function () { t.scrollIntoView() }, 50) } }
  }
  function maybeReady() { if (counted && loaded) setTimeout(ready, 120) }
  if (reduced) { counted = true }
  else {
    var t0 = performance.now(), dur = 1500;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 2.2);
      preNum.textContent = Math.round(e * 100) + '%'; preBar.style.transform = 'scaleX(' + e + ')';
      if (p < 1) requestAnimationFrame(step); else { counted = true; maybeReady() }
    })(t0);
  }
  setTimeout(ready, 4000);

  /* ---------- menu ---------- */
  var menu = $('#menu'), burger = $('#burger');
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

  /* ---------- scroll effects ---------- */
  var spinners = $$('[data-spin]'), ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      spinners.forEach(function (s) { s.style.transform = 'rotate(' + (y * parseFloat(s.dataset.spin)) + 'deg)' });
      ticking = false;
    });
  }
  if (!reduced) { window.addEventListener('scroll', onScroll, { passive: true }); onScroll() }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in-view'); io.unobserve(x.target) } }) }, { threshold: .15 });
    $$('.js-reveal').forEach(function (n) { io.observe(n) });
  } else $$('.js-reveal').forEach(function (n) { n.classList.add('in-view') });

  /* ---------- footer wordmark: fits its row, and the STUDIO letters roll while it is on screen ---------- */
  var mark = $('#mark');
  function fit() {
    var box = mark.parentNode, cs = getComputedStyle(box);
    mark.style.fontSize = '100px';
    var avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var w = $('.k', mark).offsetWidth + $('.studio', mark).offsetWidth;
    if (w > 0) mark.style.fontSize = (100 * avail / w * .99) + 'px';
  }
  fit(); window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { en.forEach(function (x) { mark.classList.toggle('run', x.isIntersecting) }) }, { threshold: .15 }).observe(mark);
  } else mark.classList.add('run');
  $('#year').textContent = new Date().getFullYear();

  /* ---------- content from the API ---------- */
  var artistsById = {};
  function failBox(node, text) { node.appendChild(h('p', { class: 'loaderr', text: text })) }

  function renderStudio(s) {
    $$('[data-bind]').forEach(function (n) {
      var k = n.dataset.bind, v = s[k];
      if (k === 'hours-inline') { n.textContent = (s.hours || '').replace(/\s*\n\s*/g, ', '); return }
      if (v === undefined) return;
      n.textContent = '';
      if (k === 'email') n.appendChild(h('a', { href: 'mailto:' + v, text: v }));
      else if (k === 'phone') n.appendChild(h('a', { href: 'tel:' + v.replace(/[^+\d]/g, ''), text: v }));
      else n.textContent = v;
    });
    if (s.studio_name) document.title = s.studio_name;
    if (s.team_video) { vid.removeAttribute('poster'); vid.src = s.team_video }
    if (s.hero_image) {
      // A PNG or WebP may have a transparent background, so it stands in front of the lettering like the design. A JPG is a solid rectangle, so it goes behind.
      $('.hero').insertBefore(h('img', { class: 'hero-photo' + (/\.(png|webp)$/i.test(s.hero_image) ? '' : ' behind'), src: s.hero_image, alt: '', decoding: 'async' }), $('#heroArt'));
      $('#heroArt').setAttribute('hidden', '');
    }
  }

  /* ---------- sizes, prices and deposits (edited in the admin area) ---------- */
  var tiersById = {};
  function renderTiers(list) {
    var sel = $('#f-tier');
    list.forEach(function (t) {
      tiersById[t.id] = t;
      sel.appendChild(h('option', { value: t.id, text: t.name + ' · ' + Ink.priceRange(t) }));
    });
    var want = new URLSearchParams(location.search).get('tier');
    if (want && tiersById[want]) sel.value = want;
    showTierHint();
  }
  function showTierHint() {
    var t = tiersById[$('#f-tier').value], hint = $('#tierHint'); hint.textContent = '';
    if (!t) { hint.appendChild(document.createTextNode('Choosing a size shows the deposit that secures your booking. See ')); hint.appendChild(h('a', { href: '/discover.html#pricing', text: 'all prices' })); hint.appendChild(document.createTextNode('.')); return }
    hint.textContent = t.name + ': ' + Ink.priceRange(t) + '. A deposit of ' + Ink.usd(t.deposit_cents) + ' secures your booking and is taken off the final price. You can pay it online right after you book.';
  }
  $('#f-tier').addEventListener('change', showTierHint);

  var ART = { irezumi: Art.irezumi, rose: Art.rose, mandala: Art.colourMandala };
  var CLS = { irezumi: 's1', rose: 's2', mandala: 's3' };
  function renderWorks(list) {
    var box = $('#work');
    if (!list.length) { box.hidden = true; return }
    list.forEach(function (w) {
      var slide = h('article', { class: 'slide ' + (CLS[w.art_key] || 's1') });
      if (w.image) { slide.appendChild(h('img', { class: 'photo', src: w.image, alt: w.title, loading: 'lazy', decoding: 'async' })); slide.appendChild(h('div', { class: 'shade' })) }
      else {
        var art = svg({ 'class': 'art', viewBox: '0 0 1200 800', preserveAspectRatio: 'xMaxYMid slice', 'aria-hidden': 'true' });
        (ART[w.art_key] || Art.irezumi)(art); slide.appendChild(art);
      }
      slide.appendChild(h('div', { class: 'in' }, [
        h('p', { class: 'tag', text: 'Recent work' }),
        h('div', { class: 'copy' }, [
          h('h3', { text: w.title }),
          h('p', { class: 'd', text: w.description }),
          h('a', { class: 'btn btn-line', href: '#team', text: 'Meet the artists', onclick: function (e) { e.preventDefault(); teamSec.scrollIntoView() } })
        ])
      ]));
      box.appendChild(slide);
    });
  }

  var artistList = [], worksList = [], panels = [], pinned = false, dist = 0;
  function renderArtists(list) {
    var sel = $('#f-artist');
    list.forEach(function (a) { artistsById[a.id] = a; sel.appendChild(h('option', { value: a.id, text: a.name })) });
    artistList = list;
  }
  // The drawn art or the uploaded photo of a piece of work.
  function workMedia(w) {
    function drawn() { var art = svg({ viewBox: '0 0 1200 800', preserveAspectRatio: 'xMaxYMid slice', 'aria-hidden': 'true' }); (ART[w.art_key] || Art.irezumi)(art); return art }
    if (!w.image) return drawn();
    var img = h('img', { src: w.image, alt: w.title + (w.artist_name ? ', by ' + w.artist_name : ''), loading: 'lazy', decoding: 'async' });
    // If a photo file is missing, show the drawn art instead of a broken picture.
    img.addEventListener('error', function () { if (img.parentNode) img.parentNode.replaceChild(drawn(), img) });
    return img;
  }
  function renderTeam() {
    var track = $('#teamList'); track.textContent = ''; panels = [];
    artistList.forEach(function (a) {
      var mine = (a.photos || []).map(function (p) {
        return { image: p.image, title: p.title || 'Work by ' + a.name, description: '', art_key: a.art_key, artist_name: a.name };
      });
      var pic = h('div', { class: 'tm-pic' });
      function drawnPortrait() { var s = svg({ viewBox: '0 0 300 400', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }); Art.portrait(s, a.art_key, a.name.charAt(0).toUpperCase()); return s }
      if (a.photo) { var pi = h('img', { src: a.photo, alt: 'Portrait of ' + a.name, loading: 'lazy', decoding: 'async' }); pi.addEventListener('error', function () { if (pi.parentNode) pi.parentNode.replaceChild(drawnPortrait(), pi) }); pic.appendChild(pi) }
      else pic.appendChild(drawnPortrait());
      var thumbs = h('div', { class: 'tm-thumbs' }, mine.map(function (w, i) {
        var box = h('button', { class: 'tm-thumb ' + (CLS[w.art_key] || 's1'), type: 'button', 'aria-label': 'View ' + w.title, onclick: function () { openWork(mine, i) } }, [workMedia(w), h('span', { text: w.title })]);
        return box;
      }));
      var panel = h('article', { class: 'tm-panel', id: 'artist-' + a.slug, 'aria-label': a.name }, [
        pic,
        h('div', { class: 'tm-bio' }, [
          h('h3', { text: a.name }), h('p', { class: 'role', text: 'Tattoo artist' }),
          h('p', { class: 'tm-about', text: a.bio }),
          h('dl', {}, [
            h('div', {}, [h('dt', { text: 'Specialty' }), h('dd', { text: a.specialty })]),
            h('div', {}, [h('dt', { text: 'Experience' }), h('dd', { text: a.experience_years + (a.experience_years === 1 ? ' year' : ' years') })])
          ]),
          h('div', { class: 'actions' }, [h('button', { class: 'btn btn-light', type: 'button', text: "Let's tattoo", onclick: function () { chooseArtist(a.id) } })])
        ]),
        h('div', { class: 'tm-works' + (mine.length ? '' : ' none') }, [h('p', { class: 'tm-label', text: mine.length ? 'Work by ' + a.name : '' }), thumbs])
      ]);
      panels.push(panel); track.appendChild(panel);
    });
    $('#team').hidden = !panels.length;
    layoutTeam();
  }

  /* work viewer: opens right here, it does not jump to another part of the page */
  var wdlg = null;
  function openWork(list, idx) {
    if (!wdlg) { wdlg = h('dialog', { class: 'workdlg', 'aria-label': 'Work' }); document.body.appendChild(wdlg); wdlg.addEventListener('click', function (e) { if (e.target === wdlg) wdlg.close() }); wdlg.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1) }) }
    function step(d) { var n = idx + d; if (n >= 0 && n < list.length) { idx = n; draw() } }
    function draw() {
      var w = list[idx]; wdlg.textContent = '';
      var prev = h('button', { type: 'button', text: '←', 'aria-label': 'Previous work', disabled: idx === 0 ? '' : false, onclick: function () { step(-1) } });
      var next = h('button', { type: 'button', text: '→', 'aria-label': 'Next work', disabled: idx === list.length - 1 ? '' : false, onclick: function () { step(1) } });
      wdlg.appendChild(h('div', { class: 'wk' }, [
        h('div', { class: 'wk-media ' + (CLS[w.art_key] || 's1') }, [workMedia(w), h('button', { class: 'wk-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { wdlg.close() } })]),
        h('div', { class: 'wk-text' }, [
          h('p', { class: 'by', text: w.artist_name ? 'Tattoo artist: ' + w.artist_name : 'Recent work' }),
          h('h3', { text: w.title }),
          w.description ? h('p', { class: 'd', text: w.description }) : null,
          h('div', { class: 'wk-nav' }, list.length > 1 ? [prev, h('span', { class: 'tm-label', text: (idx + 1) + ' / ' + list.length }), next] : [])
        ])
      ]));
    }
    draw(); if (!wdlg.open) wdlg.showModal();
  }

  /* sideways-on-scroll team strip (desktop). On small screens it is a normal swipeable strip. */
  var teamSec = $('#team'), teamTrack = $('#teamList'), curIdx = 0;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
  function layoutTeam() {
    pinned = !reduced && window.innerWidth >= 900 && panels.length > 1;
    teamSec.classList.toggle('pinned', pinned);
    teamTrack.style.transform = '';
    if (!pinned) { teamSec.style.height = ''; paintCount(); return }
    var gap = parseFloat(getComputedStyle(teamTrack).columnGap) || 24;
    dist = (panels.length - 1) * (panels[0].offsetWidth + gap);
    teamSec.style.height = (window.innerHeight + dist * .6) + 'px';
    onTeamScroll();
  }
  function progress() { var r = teamSec.getBoundingClientRect(), room = teamSec.offsetHeight - window.innerHeight; return room > 0 ? clamp(-r.top / room, 0, 1) : 0 }
  function onTeamScroll() {
    if (!pinned) return;
    var p = progress(); teamTrack.style.transform = 'translate3d(' + (-p * dist) + 'px,0,0)';
    curIdx = Math.round(p * (panels.length - 1)); paintCount();
  }
  function paintCount() {
    var n = panels.length; $('#teamCount').textContent = n ? (curIdx + 1) + ' / ' + n : '';
    $('#teamPrev').disabled = curIdx <= 0; $('#teamNext').disabled = curIdx >= n - 1;
  }
  function goToIndex(i) {
    i = clamp(i, 0, panels.length - 1);
    if (pinned) {
      var top = teamSec.getBoundingClientRect().top + window.scrollY, room = teamSec.offsetHeight - window.innerHeight;
      window.scrollTo({ top: top + (panels.length > 1 ? i / (panels.length - 1) : 0) * room, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      teamTrack.scrollTo({ left: panels[i].offsetLeft - teamTrack.offsetLeft - parseFloat(getComputedStyle(teamTrack).paddingLeft), behavior: reduced ? 'auto' : 'smooth' });
      curIdx = i; paintCount();
    }
  }
  function goToArtist(slug) {
    var i = panels.map(function (p) { return p.id }).indexOf('artist-' + slug);
    if (i < 0) { teamSec.scrollIntoView(); return }
    if (pinned) goToIndex(i); else { teamSec.scrollIntoView(); goToIndex(i) }
  }
  $('#teamPrev').addEventListener('click', function () { goToIndex(curIdx - 1) });
  $('#teamNext').addEventListener('click', function () { goToIndex(curIdx + 1) });
  teamTrack.addEventListener('scroll', function () {
    if (pinned || !panels.length) return;
    var best = 0, bd = 1e9; panels.forEach(function (p, i) { var d = Math.abs(p.offsetLeft - teamTrack.offsetLeft - parseFloat(getComputedStyle(teamTrack).paddingLeft) - teamTrack.scrollLeft); if (d < bd) { bd = d; best = i } });
    if (best !== curIdx) { curIdx = best; paintCount() }
  }, { passive: true });
  window.addEventListener('scroll', function () { onTeamScroll(); onVideoScroll() }, { passive: true });
  window.addEventListener('resize', function () { layoutTeam(); onVideoScroll() });

  /* the studio video grows to fill the screen after the team */
  var vsec = $('#studioVideo'), vbox = $('#vbox'), vid = $('#studioVid');
  function onVideoScroll() {
    if (reduced) return;
    var r = vsec.getBoundingClientRect(), room = vsec.offsetHeight - window.innerHeight;
    vbox.style.setProperty('--p', room > 0 ? clamp(-r.top / (room * .8), 0, 1).toFixed(3) : 1);
  }
  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { var p = vid.play(); if (p && p.catch) p.catch(function () {}) } else vid.pause() }) }, { threshold: .1 }).observe(vsec);
  onVideoScroll();

  function renderFaq(list) {
    var box = $('#faqList');
    list.forEach(function (f, i) { box.appendChild(h('details', { open: i === 0 }, [h('summary', { text: f.question }), h('p', { text: f.answer })])) });
  }

  function renderReviews(list) {
    var box = $('#reviews'), ul = $('#reviewsList');
    ul.textContent = '';
    if (!list.length) { box.hidden = true; return }
    list.forEach(function (r) {
      var n = Math.max(1, Math.min(5, Number(r.rating) || 5));
      var avatar = r.image
        ? h('img', { class: 'review-pic', src: r.image, alt: 'Photo of ' + r.name, loading: 'lazy', decoding: 'async' })
        : h('span', { class: 'review-pic review-initial', 'aria-hidden': 'true', text: (r.name || '?').charAt(0).toUpperCase() });
      ul.appendChild(h('li', { class: 'review' }, [
        h('p', { class: 'stars', 'aria-label': n + ' out of 5 stars', text: '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n) }),
        h('blockquote', { text: r.review }),
        h('div', { class: 'review-who' }, [avatar, h('cite', { text: r.name })])
      ]));
    });
    box.hidden = false;
  }

  var jobs = [
    api('/api/studio').then(renderStudio).catch(function (e) { failBox($('#top'), e.message) }),
    api('/api/works').then(function (l) { worksList = l; renderWorks(l) }).catch(function () { $('#work').hidden = true }),
    api('/api/artists').then(renderArtists).catch(function (e) { failBox($('#teamList'), 'The team could not be loaded. ' + e.message) }),
    api('/api/tiers').then(renderTiers).catch(function () {}),
    api('/api/reviews').then(renderReviews).catch(function () { $('#reviews').hidden = true }),
    api('/api/faq').then(renderFaq).catch(function (e) { failBox($('#faqList'), 'The questions could not be loaded. ' + e.message) })
  ];
  Promise.all(jobs).then(function () { renderTeam(); loaded = true; maybeReady(); fit() });

  /* ---------- forms: shared helpers ---------- */
  function clearErrors(f) { $$('.fld.bad', f).forEach(function (n) { n.classList.remove('bad') }); $$('.fld em', f).forEach(function (n) { n.remove() }) }
  function fieldError(f, key, text) {
    var w = $('[data-f="' + key + '"]', f); if (!w) return false;
    w.classList.add('bad'); w.appendChild(h('em', { text: text })); return true;
  }
  function showErrors(f, fields) {
    var general = [];
    Object.keys(fields || {}).forEach(function (k) { if (!fieldError(f, k, fields[k])) general.push(fields[k]) });
    var first = $('.fld.bad input, .fld.bad select, .fld.bad textarea', f); if (first) first.focus();
    return general;
  }
  function setMsg(node, text, isErr) { node.className = (node.className || '').replace(/\berr\b/g, '').trim() + (isErr ? ' err' : ''); node.textContent = text }

  /* ---------- booking ---------- */
  var form = $('#bookForm'), msg = $('#formMsg'), dateEl = $('#f-date'), artistEl = $('#f-artist'), btn = $('#bookBtn');
  (function () { var d = new Date(); dateEl.min = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })();

  var fullCache = {};
  function loadFull(id) {
    if (!id) return Promise.resolve([]);
    if (fullCache[id]) return Promise.resolve(fullCache[id]);
    return api('/api/availability?artistId=' + id).then(function (r) { return (fullCache[id] = r.full) }).catch(function () { return [] });
  }
  function isWeekend(v) { var d = new Date(v + 'T00:00:00'); return d.getDay() === 0 || d.getDay() === 6 }
  function checkDate() {
    var w = $('[data-f="date"]', form); $$('em', w).forEach(function (n) { n.remove() }); w.classList.remove('bad');
    var v = dateEl.value; if (!v) return;
    if (isWeekend(v)) { fieldError(form, 'date', 'The studio is open Monday to Friday. Please choose a weekday.'); return }
    loadFull(artistEl.value).then(function (full) { if (full.indexOf(v) > -1 && dateEl.value === v) fieldError(form, 'date', 'This artist is fully booked that day. Pick another day or another artist.') });
  }
  dateEl.addEventListener('change', checkDate); artistEl.addEventListener('change', checkDate);

  function chooseArtist(id) {
    artistEl.value = String(id);
    $('#book').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    setTimeout(function () { $('#f-name').focus({ preventScroll: true }) }, reduced ? 0 : 700);
    checkDate();
  }

  // Shown when the chosen size has a deposit that is not paid yet.
  function depositBox(r, email) {
    if (!r.deposit_cents) return null;
    if (r.deposit_paid) return h('p', { class: 'deposit', text: 'Deposit of ' + Ink.usd(r.deposit_cents) + ' paid. Thank you.' });
    if (r.status !== 'pending' && r.status !== 'confirmed') return null;
    return h('div', { class: 'deposit' }, [
      h('p', {}, [h('b', { text: 'Secure your booking: ' + Ink.usd(r.deposit_cents) + ' deposit' })]),
      h('p', { text: 'Pay it now with a card, Apple Pay, Zelle, Chime or Bitcoin. You can also pay later from the status check below.' }),
      h('button', { class: 'btn btn-dark', type: 'button', text: 'Pay deposit now', onclick: function () { InkPay.openDeposit(r, email) } })
    ]);
  }

  var LABEL = { bw: 'black and white', colour: 'colour', both: 'black and white and colour', undecided: 'style to be discussed' };
  function showDone(r) {
    var box = $('#bookDone'); box.textContent = '';
    var email = $('#f-email').value.trim();
    var code = h('code', { text: r.reference });
    var copy = h('button', { class: 'btn btn-line', type: 'button', text: 'Copy code', onclick: function () {
      var ok = function () { copy.textContent = 'Copied' }, no = function () { var rg = document.createRange(); rg.selectNodeContents(code); var s = getSelection(); s.removeAllRanges(); s.addRange(rg); copy.textContent = 'Press Ctrl+C' };
      try { navigator.clipboard.writeText(r.reference).then(ok, no) } catch (e) { no() }
    } });
    box.appendChild(h('div', { class: 'done', role: 'status', tabindex: '-1' }, [
      h('h3', { text: 'Request received, ' + r.name + '.' }),
      h('p', { text: r.piece + ' with ' + (r.artist || 'an artist chosen with you') + ', ' + (LABEL[r.colour_mode] || '') + ', around ' + r.date + '.' }),
      h('div', { class: 'code' }, [code, copy]),
      depositBox(r, email),
      h('p', { text: 'Keep this code. With the email you used, it lets you check or cancel the request below. The studio will get in touch to confirm the date.' }),
      h('button', { class: 'btn btn-dark', type: 'button', text: 'Make another request', onclick: function () { box.hidden = true; form.hidden = false; $('#f-name').focus() } })
    ]));
    form.hidden = true; box.hidden = false; $('.done', box).focus();
    $('#t-ref').value = r.reference; $('#t-email').value = $('#f-email').value;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors(form); setMsg(msg, '');
    var file = $('#f-ref').files[0];
    if (file && file.size > 5 * 1024 * 1024) { showErrors(form, { reference_image: 'This image is larger than 5 MB.' }); return }
    if (dateEl.value && isWeekend(dateEl.value)) { showErrors(form, { date: 'The studio is open Monday to Friday. Please choose a weekday.' }); return }
    var fd = new FormData(form);
    fd.set('bw', $('#f-bw').checked ? '1' : '0'); fd.set('colour', $('#f-col').checked ? '1' : '0');
    if (!file) fd.delete('reference_image');
    btn.disabled = true; btn.textContent = 'Sending…';
    api('/api/bookings', { method: 'POST', body: fd }).then(function (r) {
      delete fullCache[artistEl.value];
      showDone(r); form.reset(); $$('[name=bw],[name=colour]', form).forEach(function (c) { c.checked = false });
      showTierHint();
    }).catch(function (err) {
      var general = showErrors(form, err.fields);
      setMsg(msg, general.length ? general.join(' ') : err.message, true);
      if (err.status === 409) delete fullCache[artistEl.value];
    }).then(function () { btn.disabled = false; btn.textContent = 'Book' });
  });
  ['#f-name', '#f-phone', '#f-email', '#f-idea'].forEach(function (s) { $(s).addEventListener('input', function () { var w = this.closest('.fld'); w.classList.remove('bad'); $$('em', w).forEach(function (n) { n.remove() }) }) });

  /* ---------- check / cancel a request ---------- */
  var trackForm = $('#trackForm'), trackOut = $('#trackResult'), armed = null;
  function showStatus(r) {
    trackOut.textContent = ''; armed = null;
    var nodes = [
      h('p', {}, [h('span', { class: 'badge ' + r.status, text: r.status }), ' ' + r.reference]),
      h('p', { text: r.piece + ' with ' + (r.artist || 'an artist to be chosen') + ', ' + (LABEL[r.colour_mode] || '') + ', around ' + r.date + '.' }),
      depositBox(r, $('#t-email').value.trim())
    ];
    if (r.status === 'pending' || r.status === 'confirmed') {
      var cancel = h('button', { class: 'btn btn-line', type: 'button', style: 'color:inherit;padding:9px 14px', text: 'Cancel this request', onclick: function () {
        if (armed !== r.reference) { armed = r.reference; cancel.textContent = 'Click again to confirm'; setTimeout(function () { if (armed === r.reference) { armed = null; cancel.textContent = 'Cancel this request' } }, 4000); return }
        cancel.disabled = true;
        api('/api/bookings/' + encodeURIComponent(r.reference) + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#t-email').value.trim() }) })
          .then(function (x) { fullCache = {}; showStatus(x) }).catch(function (er) { trackOut.textContent = er.message });
      } });
      nodes.push(cancel);
    }
    nodes.forEach(function (n) { trackOut.appendChild(n) });
  }
  trackForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var ref = $('#t-ref').value.trim(), em = $('#t-email').value.trim();
    if (!ref || !em) { trackOut.textContent = 'Enter the reference code and the email you used.'; return }
    trackOut.textContent = 'Checking…';
    api('/api/bookings/' + encodeURIComponent(ref) + '?email=' + encodeURIComponent(em)).then(showStatus).catch(function (er) { trackOut.textContent = er.status === 404 ? 'No request matches that code and email. Check both and try again.' : er.message });
  });

  /* ---------- ask a question ---------- */
  var ask = $('#askForm'), askMsg = $('#askMsg');
  ask.addEventListener('submit', function (e) {
    e.preventDefault(); clearErrors(ask); setMsg(askMsg, '');
    var body = { name: $('#q-name').value, email: $('#q-email').value, question: $('#q-text').value };
    api('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function () {
      ask.reset(); setMsg(askMsg, 'Thank you. Your question has been sent to the studio.', false);
    }).catch(function (err) { var g = showErrors(ask, err.fields); setMsg(askMsg, g.length || !Object.keys(err.fields || {}).length ? (g.join(' ') || err.message) : '', true) });
  });
})();
