// The payment window: choose how to pay, then see exactly what to do. Used for booking deposits.
(function () {
  'use strict';
  var I = window.Ink, h = I.h, api = I.api, usd = I.usd;
  var dlg, STORE = 'ink_last_order';

  function ensure() {
    if (dlg) return;
    dlg = h('dialog', { class: 'paydlg', 'aria-labelledby': 'payTitle' });
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close() });
  }
  function close() { if (dlg && dlg.open) dlg.close() }
  function panel(title, nodes) {
    ensure(); dlg.textContent = '';
    dlg.appendChild(h('div', { class: 'pd-head' }, [h('h2', { id: 'payTitle', text: title }), h('button', { class: 'pd-x', type: 'button', 'aria-label': 'Close', text: '×', onclick: close })]));
    var body = h('div', { class: 'pd-body' }, nodes);
    dlg.appendChild(body);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    return body;
  }
  function field(label, input, key) { return h('label', { class: 'pd-f', 'data-f': key }, [h('span', { text: label }), input]) }
  function lineList(lines) {
    return h('ul', { class: 'pd-lines' }, lines.map(function (l) {
      return h('li', {}, [h('span', { text: (l.qty > 1 ? l.qty + ' × ' : '') + l.name }), h('b', { text: usd(l.unit_cents * l.qty) })]);
    }));
  }
  function totalRow(c) { return h('p', { class: 'pd-total' }, [h('span', { text: 'Total' }), h('b', { text: usd(c) })]) }

  /* ---------- step 1: details and method ---------- */
  // opts: { title, lines:[{name,qty,unit_cents}], total_cents, fields:bool, email, create(data, method) -> Promise(order), created(order) }
  function open(opts) {
    var msg = h('p', { class: 'pd-msg', role: 'alert' }), form = h('form', { class: 'pd-form', novalidate: '' });
    var inputs = {};
    var body = panel(opts.title, [h('p', { class: 'pd-muted', text: 'Loading…' })]);
    api('/api/payment-methods').then(function (methods) {
      body.textContent = '';
      body.appendChild(lineList(opts.lines)); body.appendChild(totalRow(opts.total_cents));
      if (!methods.length) { body.appendChild(h('p', { class: 'pd-msg err', text: 'Online payment is not switched on yet. Please contact the studio to pay.' })); return }
      if (opts.fields) {
        [['name', 'Your name', 'text', 'name'], ['email', 'Email (we send nothing without your say-so; it is how you look up your order)', 'email', 'email'], ['phone', 'Phone (optional)', 'tel', 'tel'], ['note', 'Note for the studio (optional)', 'text', 'off']].forEach(function (f) {
          inputs[f[0]] = h('input', { name: f[0], type: f[2], autocomplete: f[3], maxlength: f[0] === 'note' ? '500' : '160' });
          form.appendChild(field(f[1], inputs[f[0]], f[0]));
        });
      }
      var chosen = methods[0].method, group = h('fieldset', { class: 'pd-methods', 'data-f': 'method' }, [h('legend', { text: 'How do you want to pay?' })]);
      methods.forEach(function (m, i) {
        var r = h('input', { type: 'radio', name: 'method', value: m.method, checked: i === 0 ? '' : false, onchange: function () { chosen = m.method } });
        group.appendChild(h('label', { class: 'pd-method' }, [r, h('span', {}, [h('b', { text: m.label }), h('small', { text: m.instructions })])]));
      });
      form.appendChild(group);
      var btn = h('button', { class: 'btn btn-light', type: 'submit', text: 'Continue to payment' });
      form.appendChild(btn); form.appendChild(msg);
      form.addEventListener('submit', function (e) {
        e.preventDefault(); msg.textContent = '';
        Array.prototype.forEach.call(form.querySelectorAll('.pd-f'), function (w) { w.classList.remove('bad'); var em = w.querySelector('em'); if (em) em.remove() });
        var data = {}; Object.keys(inputs).forEach(function (k) { data[k] = inputs[k].value.trim() });
        btn.disabled = true; btn.textContent = 'One moment…';
        opts.create(data, chosen).then(function (order) {
          if (opts.created) opts.created(order);
          showOrder(order, data.email || opts.email);
        }).catch(function (err) {
          btn.disabled = false; btn.textContent = 'Continue to payment';
          msg.className = 'pd-msg err'; msg.textContent = err.message;
          Object.keys(err.fields || {}).forEach(function (k) { var w = form.querySelector('[data-f="' + k + '"]'); if (w && k !== 'method') { w.classList.add('bad'); w.appendChild(h('em', { text: err.fields[k] })) } });
        });
      });
      body.appendChild(form);
      var first = form.querySelector('input'); if (first) first.focus();
    }).catch(function (e) { body.textContent = ''; body.appendChild(h('p', { class: 'pd-msg err', text: e.message })) });
  }

  /* ---------- step 2: what to do next ---------- */
  function codeRow(order) {
    var code = h('code', { text: order.reference });
    var copy = h('button', { class: 'btn btn-line', type: 'button', text: 'Copy code', onclick: function () { I.copyText(order.reference, copy, 'Copy code') } });
    return h('div', { class: 'pd-code' }, [code, copy]);
  }
  function summary(order) { return [lineList(order.items), totalRow(order.total_cents)] }

  function showOrder(order, email) {
    email = (email || '').trim();
    var p = order.payment, title;
    if (order.status === 'paid' || order.status === 'fulfilled') {
      title = 'Payment received';
      return panel(title, [h('p', { text: 'Thank you, ' + order.name + '. Your payment of ' + usd(order.total_cents) + ' is confirmed.' }), codeRow(order)].concat(summary(order), [
        h('p', { class: 'pd-muted', text: order.kind === 'deposit' ? 'Your deposit is on your booking. The studio will be in touch to confirm the date.' : 'The studio will get in touch about collecting or delivering your order. Keep this code.' }),
        h('button', { class: 'btn btn-line', type: 'button', text: 'Close', onclick: close })]));
    }
    if (order.status === 'cancelled') return panel('Order cancelled', [codeRow(order), h('p', { text: 'This order was cancelled and nothing is owed.' }), h('button', { class: 'btn btn-line', type: 'button', text: 'Close', onclick: close })]);
    if (!p) return panel('Order ' + order.reference, summary(order));

    if (p.type === 'redirect') {
      try { localStorage.setItem(STORE, JSON.stringify({ reference: order.reference, email: email })) } catch (e) {}
      var go = function () { location.href = p.url };
      panel('Secure card payment', [codeRow(order)].concat(summary(order), [
        h('p', { text: 'You will pay on a secure page run by our payment provider. Apple Pay and Google Pay are offered there on devices that support them.' }),
        h('button', { class: 'btn btn-light', type: 'button', text: 'Go to secure payment', onclick: go })]));
      setTimeout(go, 600);
      return;
    }

    var nodes = [codeRow(order)];
    if (p.submitted) {
      nodes.push(h('p', { class: 'pd-ok', text: 'Thank you. You told us you sent ' + usd(order.total_cents) + '. The studio confirms it as soon as the money arrives.' }));
      nodes.push(h('p', { class: 'pd-muted', text: 'You can check the status any time on the Discover page with this code and your email.' }));
      nodes.push(h('button', { class: 'btn btn-line', type: 'button', text: 'Close', onclick: close }));
      return panel('Waiting for the studio', nodes);
    }
    var rows = h('dl', { class: 'pd-steps' });
    function row(k, v, copyable) {
      var dd = h('dd', {}, [h('span', { text: v })]);
      if (copyable) { var b = h('button', { class: 'pd-copy', type: 'button', text: 'Copy', onclick: function () { I.copyText(v, b, 'Copy') } }); dd.appendChild(b) }
      rows.appendChild(h('div', {}, [h('dt', { text: k }), dd]));
    }
    var ico = null;
    if (p.type === 'manual') {
      row('Pay with', p.label); row('Send to', p.account, true); row('Exact amount', usd(p.amount_cents), false); row('Write in the note', p.memo, true);
    } else {
      row('Pay with', 'Bitcoin'); row('Exact amount', p.btc + ' BTC (about ' + usd(p.amount_cents) + ')', false); row('Send to address', p.address, true); row('Write in the note, if your wallet allows', p.memo, false);
      ico = h('div', { class: 'pd-qr' }, [h('img', { src: p.qr, alt: 'QR code to pay ' + p.btc + ' bitcoin', width: '200', height: '200' }), h('small', { text: 'Scan with your wallet. Rate used: 1 BTC = ' + usd(Math.round(p.rate_usd * 100)) + ' at the moment you ordered.' })]);
    }
    nodes.push(rows); if (ico) nodes.push(ico);
    if (p.instructions) nodes.push(h('p', { class: 'pd-muted', text: p.instructions }));
    nodes.push(h('p', { class: 'pd-muted', text: 'Send the exact amount, then press the button below so the studio knows to look for it.' }));
    var ref = h('input', { name: 'payment_note', maxlength: '200', placeholder: p.type === 'bitcoin' ? 'Transaction ID (optional)' : 'Confirmation number or name on the account (optional)' });
    var msg = h('p', { class: 'pd-msg', role: 'alert' });
    var done = h('button', { class: 'btn btn-light', type: 'submit', text: 'I have sent the payment' });
    nodes.push(h('form', { class: 'pd-form', onsubmit: function (e) {
      e.preventDefault(); done.disabled = true; msg.textContent = '';
      I.post('/api/orders/' + encodeURIComponent(order.reference) + '/submitted', { email: email, payment_note: ref.value.trim() }).then(function (o) { showOrder(o, email) })
        .catch(function (er) { done.disabled = false; msg.className = 'pd-msg err'; msg.textContent = er.message });
    } }, [field('Optional details', ref, 'payment_note'), done, msg]));
    var armed = false, cancel = h('button', { class: 'pd-link', type: 'button', text: 'Cancel this order', onclick: function () {
      if (!armed) { armed = true; cancel.textContent = 'Click again to cancel'; setTimeout(function () { armed = false; cancel.textContent = 'Cancel this order' }, 4000); return }
      I.post('/api/orders/' + encodeURIComponent(order.reference) + '/cancel', { email: email }).then(function (o) { showOrder(o, email) }).catch(function (er) { msg.className = 'pd-msg err'; msg.textContent = er.message });
    } });
    nodes.push(cancel);
    panel('Send your payment', nodes);
  }

  // Pay the deposit for a booking the visitor just made (or is looking at).
  function openDeposit(booking, email) {
    open({
      title: 'Pay your deposit', email: email,
      lines: [{ name: 'Deposit for ' + booking.piece + ' (' + booking.reference + ')', qty: 1, unit_cents: booking.deposit_cents }], total_cents: booking.deposit_cents, fields: false,
      create: function (data, method) { return I.post('/api/bookings/' + encodeURIComponent(booking.reference) + '/deposit', { email: email, method: method }) }
    });
  }

  // Look an order up with its code and email, then show where it stands.
  function lookup(reference, email) {
    return api('/api/orders/' + encodeURIComponent(reference) + '?email=' + encodeURIComponent(email)).then(function (o) { showOrder(o, email); return o });
  }
  function remembered() { try { return JSON.parse(localStorage.getItem(STORE) || 'null') } catch (e) { return null } }

  window.InkPay = { open: open, openDeposit: openDeposit, showOrder: showOrder, lookup: lookup, remembered: remembered, close: close };
})();
