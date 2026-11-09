(function () {
  'use strict';
  var I = window.Ink, h = I.h, $ = I.$, api = I.api, usd = I.usd;
  I.initMenu(); I.initMark();

  /* ---------- studio text ---------- */
  api('/api/studio').then(function (s) {
    I.bindStudio(s);
    $('#intro').textContent = s.discover_intro || '';
    $('#pricingNote').textContent = s.pricing_note || '';
  }).catch(function () {});

  /* ---------- pricing ---------- */
  api('/api/tiers').then(function (tiers) {
    var ol = $('#tiers'); ol.textContent = '';
    if (!tiers.length) { ol.appendChild(h('li', { class: 'loaderr', text: 'Prices will be shown here soon.' })); return }
    tiers.forEach(function (t, i) {
      ol.appendChild(h('li', { class: 'tier' + (t.image ? ' has-pic' : '') }, [
        h('span', { class: 'n', text: String(i + 1).padStart(2, '0') }),
        t.image ? h('div', { class: 'tier-pic' }, [h('img', { src: /^https:\/\/res\.cloudinary\.com\//.test(t.image) ? t.image.replace('/c_limit,w_2000/', '/c_limit,w_900/') : t.image, alt: t.name, loading: 'lazy', decoding: 'async' })]) : null,
        h('div', { class: 'tn' }, [h('h3', { text: t.name }), t.description ? h('p', { text: t.description }) : null]),
        h('div', { class: 'tp' }, [h('b', { text: I.priceRange(t) }), h('small', { text: 'Deposit ' + usd(t.deposit_cents) })]),
        h('a', { class: 'btn btn-line', href: '/?tier=' + t.id + '#book', text: 'Book this size' })
      ]));
    });
  }).catch(function (e) { var ol = $('#tiers'); ol.textContent = ''; ol.appendChild(h('li', { class: 'loaderr', text: 'The prices could not be loaded. ' + e.message })) });

  /* ---------- ways to pay ---------- */
  api('/api/payment-methods').then(function (ms) {
    var ul = $('#ways'); ul.textContent = '';
    $('#waysLede').textContent = ms.length ? 'Pay your booking deposit in advance with any of these:' : 'Online payment is not switched on yet. Contact the studio to pay.';
    ms.forEach(function (m) { ul.appendChild(h('li', {}, [h('b', { text: m.label }), h('span', { text: m.instructions })])) });
  }).catch(function () { $('#waysLede').textContent = '' });

  /* ---------- deposit lookup ---------- */
  var lf = $('#lookForm'), lm = $('#lookMsg');
  lf.addEventListener('submit', function (e) {
    e.preventDefault();
    var ref = $('#l-ref').value.trim(), em = $('#l-email').value.trim();
    if (!ref || !em) { lm.textContent = 'Enter the payment code and the email you used.'; return }
    lm.textContent = 'Checking…';
    InkPay.lookup(ref, em).then(function () { lm.textContent = '' }).catch(function (er) { lm.textContent = er.status === 404 ? 'No payment matches that code and email. Check both and try again.' : er.message });
  });

  /* ---------- coming back from the card payment page ---------- */
  var q = new URLSearchParams(location.search), back = q.get('order');
  if (back) {
    var mem = InkPay.remembered(), ref = back.toUpperCase();
    $('#l-ref').value = ref;
    if (mem && mem.reference === ref && mem.email) { $('#l-email').value = mem.email; InkPay.lookup(ref, mem.email).catch(function () {}) }
    else $('#lookup').scrollIntoView();
    history.replaceState(null, '', location.pathname);
  }
})();
