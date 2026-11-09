(function () {
  'use strict';
  var app = document.getElementById('app');

  // DOM builder: text always goes in as text, never as markup.
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
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t) } catch (e) {}
        if (!r.ok) { var err = new Error((j && j.error) || 'Request failed (' + r.status + ')'); err.status = r.status; err.fields = (j && j.fields) || {}; throw err }
        return j;
      });
    }, function () { var e = new Error('Cannot reach the server.'); e.fields = {}; throw e });
  }
  var JSONH = { 'Content-Type': 'application/json' };
  function usd(c) { var n = Number(c) / 100; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 }) }
  function dollars(c) { return c == null ? '' : (Number(c) % 100 ? (Number(c) / 100).toFixed(2) : String(Number(c) / 100)) }
  function twoStep(label, action) {
    var armed = false, b = h('button', { class: 'btn danger', type: 'button', text: label, onclick: function () {
      if (!armed) { armed = true; b.classList.add('armed'); b.textContent = 'Sure?'; setTimeout(function () { armed = false; b.classList.remove('armed'); b.textContent = label }, 3500); return }
      b.disabled = true; action();
    } });
    return b;
  }

  /* ---------- uploads: shrink big photos in the browser, show progress ---------- */
  // Phone photos are often 4 to 12 MB. They are resized here (longest side 2400 px) before sending,
  // so they fit the 5 MB limit and upload in seconds. GIFs (may be animated) and small files are sent as they are.
  var MAX_SIDE = 2400, MAX_BYTES = 5 * 1024 * 1024;
  function shrink(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || (file.size < 1024 * 1024)) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file) };
      img.onload = function () {
        URL.revokeObjectURL(url);
        var k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        // PNG/WebP may be transparent (the home page photo): keep transparency with WebP. Photos become JPEG.
        var type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
        c.toBlob(function (b) {
          if (!b || b.size >= file.size || (type === 'image/webp' && b.type !== 'image/webp')) return resolve(file);
          resolve(new File([b], file.name.replace(/\.\w+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.webp'), { type: b.type }));
        }, type, 0.86);
      };
      img.src = url;
    });
  }
  function tooBig(file) { return file && file.size > MAX_BYTES ? 'This image is still larger than 5 MB after resizing. Choose a smaller one.' : '' }
  // Like api() but with an upload progress callback (fetch cannot report upload progress).
  function send(method, url, body, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest(); x.open(method, url);
      if (onProgress) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)) };
      x.onload = function () {
        var j = null; try { j = JSON.parse(x.responseText) } catch (e) {}
        if (x.status >= 200 && x.status < 300) return resolve(j);
        var err = new Error((j && (j.error && (j.error.message || j.error))) || 'Upload failed (' + x.status + ')'); err.status = x.status; err.fields = (j && j.fields) || {}; reject(err);
      };
      x.onerror = function () { var e = new Error('Upload interrupted. Check the connection and try again.'); e.fields = {}; reject(e) };
      x.send(body);
    });
  }

  /* ---------- sign in ---------- */
  function showLogin(note) {
    app.textContent = '';
    var msg = h('p', { class: 'msg err', role: 'alert', text: note || '' });
    var pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', 'aria-label': 'Password', placeholder: 'Password' });
    app.appendChild(h('form', { class: 'login', onsubmit: function (e) {
      e.preventDefault(); msg.textContent = '';
      api('/api/admin/login', { method: 'POST', headers: JSONH, body: JSON.stringify({ password: pw.value }) }).then(start).catch(function (er) { msg.textContent = er.message });
    } }, [h('h1', { text: 'Ink Nation admin' }), pw, h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' }), msg]));
    pw.focus();
  }

  /* ---------- shell ---------- */
  var TABS = [['bookings', 'Bookings'], ['orders', 'Orders & payments'], ['tiers', 'Pricing'], ['payments', 'Ways to pay'], ['artists', 'Artists'], ['artist_photos', 'Artist photos'], ['works', 'Recent work'], ['reviews', 'Reviews'], ['faqs', 'FAQ'], ['inquiries', 'Questions'], ['studio', 'Studio']];
  var main, tabsEl, current = 'bookings';
  function start() {
    app.textContent = '';
    app.appendChild(h('header', { class: 'bar' }, [
      h('h1', { text: 'Ink Nation admin' }),
      h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener', text: 'View site' }),
      h('button', { class: 'btn', type: 'button', text: 'Sign out', onclick: function () { api('/api/admin/logout', { method: 'POST' }).then(function () { showLogin() }) } })
    ]));
    tabsEl = h('nav', { class: 'tabs', role: 'tablist' });
    TABS.forEach(function (t) { tabsEl.appendChild(h('button', { type: 'button', role: 'tab', 'data-tab': t[0], text: t[1], onclick: function () { go(t[0]) } })) });
    main = h('main'); app.appendChild(tabsEl); app.appendChild(main);
    go(location.hash.slice(1) || 'bookings');
  }
  function go(tab) {
    if (!TABS.some(function (t) { return t[0] === tab })) tab = 'bookings';
    current = tab; location.hash = tab;
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false') });
    main.textContent = '';
    var view = { bookings: bookingsView, orders: ordersView, payments: paymentsView, inquiries: inquiriesView, studio: studioView }[tab] || function () { resourceView(tab) };
    Promise.resolve().then(view).catch(handle);
  }
  function handle(err) {
    if (err.status === 401) return showLogin('Your session ended. Please sign in again.');
    main.appendChild(h('p', { class: 'msg err', text: err.message }));
  }

  /* ---------- bookings ---------- */
  var STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
  var LABEL = { bw: 'black and white', colour: 'colour', both: 'b&w + colour', undecided: 'undecided' };
  var bf = { status: '', artistId: '', q: '', page: 1 };
  function bookingsView() {
    var cards = h('div', { class: 'cards' }), table = h('div'), pager = h('div', { class: 'pager' }), msg = h('p', { class: 'msg' });
    var artistSel = h('select', { 'aria-label': 'Artist' }, [h('option', { value: '', text: 'All artists' })]);
    var statusSel = h('select', { 'aria-label': 'Status' }, [h('option', { value: '', text: 'All statuses' })].concat(STATUSES.map(function (s) { return h('option', { value: s, text: s }) })));
    var q = h('input', { type: 'search', placeholder: 'Search name, email or code', 'aria-label': 'Search', value: bf.q });
    statusSel.value = bf.status;
    function load() {
      bf.status = statusSel.value; bf.artistId = artistSel.value; bf.q = q.value.trim();
      var qs = '?page=' + bf.page + (bf.status ? '&status=' + bf.status : '') + (bf.artistId ? '&artistId=' + bf.artistId : '') + (bf.q ? '&q=' + encodeURIComponent(bf.q) : '');
      Promise.all([api('/api/admin/stats'), api('/api/admin/bookings' + qs)]).then(function (r) {
        var s = r[0], list = r[1];
        cards.textContent = '';
        [['Pending', s.pending], ['Confirmed', s.confirmed], ['Upcoming', s.upcoming], ['Completed', s.completed], ['Open questions', s.open_questions], ['Payments to check', s.payments_to_check], ['Money received', usd(s.received_cents)]].forEach(function (c) { cards.appendChild(h('div', { class: 'card' }, [h('b', { text: String(c[1]) }), h('span', { text: c[0] })])) });
        renderTable(list);
      }).catch(handle);
    }
    function renderTable(list) {
      table.textContent = ''; pager.textContent = '';
      if (!list.data.length) { table.appendChild(h('p', { class: 'muted', text: 'No bookings match.' })); return }
      var tbody = h('tbody');
      list.data.forEach(function (b) {
        var sel = h('select', { 'aria-label': 'Status for ' + b.reference, onchange: function () {
          msg.className = 'msg'; msg.textContent = '';
          api('/api/admin/bookings/' + b.id, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ status: sel.value }) })
            .then(function () { msg.className = 'msg ok'; msg.textContent = b.reference + ' is now ' + sel.value + '.'; load() })
            .catch(function (e) { if (e.status === 401) return handle(e); msg.className = 'msg err'; msg.textContent = e.message; sel.value = b.status });
        } }, STATUSES.map(function (s) { return h('option', { value: s, text: s, selected: s === b.status }) }));
        tbody.appendChild(h('tr', {}, [
          h('td', {}, [h('b', { text: b.reference }), h('div', { class: 'small', text: 'sent ' + b.created_at.slice(0, 16) })]),
          h('td', {}, [h('div', { text: b.name }), h('a', { class: 'small', href: 'mailto:' + b.email, text: b.email }), h('div', { class: 'small' }, [h('a', { href: 'tel:' + b.phone.replace(/[^+\d]/g, ''), text: b.phone })])]),
          h('td', { text: b.artist_name || 'Not chosen' }),
          h('td', { text: b.preferred_date }),
          h('td', {}, [h('div', { text: b.piece }), h('div', { class: 'small', text: LABEL[b.colour_mode] }), b.deposit_cents ? h('div', { class: 'small', text: 'Deposit ' + usd(b.deposit_cents) + (b.deposit_paid ? ' · PAID' : ' · not paid yet') }) : null]),
          h('td', {}, [b.idea ? h('div', { text: b.idea, style: 'max-width:260px;white-space:pre-wrap' }) : h('span', { class: 'small', text: 'No notes' }), b.reference_image ? h('a', { href: b.reference_image, target: '_blank', rel: 'noopener', class: 'small', text: 'View reference image' }) : null]),
          h('td', {}, [h('span', { class: 'badge ' + b.status, text: b.status }), h('div', {}, [sel])]),
          h('td', {}, [twoStep('Delete', function () { api('/api/admin/bookings/' + b.id, { method: 'DELETE' }).then(load).catch(handle) })])
        ]));
      });
      table.appendChild(h('div', { class: 'tablewrap' }, [h('table', {}, [
        h('thead', {}, [h('tr', {}, ['Reference', 'Client', 'Artist', 'Date', 'Piece', 'Notes', 'Status', ''].map(function (t) { return h('th', { text: t }) }))]), tbody])]));
      var pages = Math.max(1, Math.ceil(list.total / list.limit));
      pager.appendChild(h('button', { class: 'btn', type: 'button', text: 'Previous', disabled: list.page <= 1 ? '' : false, onclick: function () { bf.page--; load() } }));
      pager.appendChild(h('span', { class: 'muted', text: 'Page ' + list.page + ' of ' + pages + ' · ' + list.total + ' bookings' }));
      pager.appendChild(h('button', { class: 'btn', type: 'button', text: 'Next', disabled: list.page >= pages ? '' : false, onclick: function () { bf.page++; load() } }));
    }
    var go1 = function () { bf.page = 1; load() };
    statusSel.addEventListener('change', go1); artistSel.addEventListener('change', go1);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') go1() });
    main.appendChild(cards);
    main.appendChild(h('div', { class: 'filters' }, [statusSel, artistSel, q, h('button', { class: 'btn', type: 'button', text: 'Search', onclick: go1 })]));
    main.appendChild(msg); main.appendChild(table); main.appendChild(pager);
    return api('/api/admin/artists').then(function (as) { as.forEach(function (a) { artistSel.appendChild(h('option', { value: a.id, text: a.name })) }); artistSel.value = bf.artistId; load() });
  }

  /* ---------- questions ---------- */
  function inquiriesView() {
    var box = h('div', { class: 'rows' });
    main.appendChild(h('h2', { class: 'sec', text: 'Questions from the website' })); main.appendChild(box);
    function load() {
      api('/api/admin/inquiries').then(function (list) {
        box.textContent = '';
        if (!list.length) box.appendChild(h('p', { class: 'muted', text: 'No questions yet.' }));
        list.forEach(function (i) {
          box.appendChild(h('div', { class: 'row', style: 'align-items:flex-start' }, [
            h('div', { class: 'grow' }, [
              h('div', {}, [h('b', { text: i.name + ' ' }), h('a', { class: 'small', href: 'mailto:' + i.email + '?subject=' + encodeURIComponent('Your question to the studio'), text: i.email }), h('span', { class: 'small', text: '  ' + i.created_at.slice(0, 16) })]),
              h('p', { text: i.question, style: 'white-space:pre-wrap;overflow:visible;margin-top:4px' })
            ]),
            h('button', { class: 'btn', type: 'button', text: i.handled ? 'Reopen' : 'Mark handled', onclick: function () { api('/api/admin/inquiries/' + i.id, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ handled: !i.handled }) }).then(load).catch(handle) } }),
            twoStep('Delete', function () { api('/api/admin/inquiries/' + i.id, { method: 'DELETE' }).then(load).catch(handle) })
          ]));
        });
      }).catch(handle);
    }
    load();
  }

  /* ---------- artists, work, FAQ: one editor, three configurations ---------- */
  var ART_KEYS = { artists: ['waves', 'rose', 'mandala'], works: ['irezumi', 'rose', 'mandala'] };
  var RES = {
    artists: { title: 'Artists', one: 'artist', image: { key: 'photo', label: 'Photo (shown instead of the drawn portrait)' }, label: function (r) { return r.name }, sub: function (r) { return r.specialty + (r.active ? '' : ' · hidden') },
      note: 'Each artist has a personal gallery in the "Artist photos" tab. Add at least 3 photos per artist there. Personal work never appears in Recent work.',
      fields: [['name', 'Name', 'text'], ['slug', 'Web name (lower case, e.g. laura)', 'text'], ['specialty', 'Specialty', 'text'], ['experience_years', 'Years of experience', 'number'], ['bio', 'Bio', 'textarea'], ['art_key', 'Drawn portrait style (used when there is no photo)', 'select', 'art'], ['sort_order', 'Order on the page (smallest first)', 'number'], ['active', 'Show on the website', 'check']] },
    artist_photos: { title: 'Artist photos', one: 'artist photo', image: { key: 'image', label: 'Photo of their work' }, artistLabel: true,
      label: function (r) { return (r.artist_name || 'Artist ' + r.artist_id) + (r.title ? ' · ' + r.title : '') },
      sub: function (r) { return 'Shown in the Our team section only'; },
      note: 'Add at least 3 photos for each artist. These photos appear in the Our team section only, never in Recent work.',
      fields: [['artist_id', 'Artist', 'select', 'artist'], ['title', 'Caption (optional)', 'text'], ['sort_order', 'Order in the gallery (smallest first)', 'number']] },
    works: { title: 'Recent work', one: 'work slide', image: { key: 'image', label: 'Photo (shown full width instead of the drawn art)' }, label: function (r) { return r.title }, sub: function (r) { return r.description },
      note: 'Recent work is for studio pieces. Each artist\'s personal work belongs in the "Artist photos" tab so their gallery does not flood this strip.',
      fields: [['title', 'Title', 'text'], ['description', 'Description', 'textarea'], ['art_key', 'Drawn art style (used when there is no photo)', 'select', 'art'], ['sort_order', 'Order on the page (smallest first)', 'number']] },
    tiers: { title: 'Pricing: tattoo sizes and deposits', one: 'size', image: { key: 'image', label: 'Photo for this size (shown on the prices page)' }, label: function (r) { return r.name }, sub: function (r) { return usd(r.price_cents) + (r.price_max_cents ? ' – ' + usd(r.price_max_cents) : '') + ' · deposit ' + usd(r.deposit_cents) + (r.active ? '' : ' · hidden') },
      fields: [['name', 'Name (for example Small tattoo)', 'text'], ['description', 'Short description (optional)', 'textarea'], ['price_cents', 'Price in dollars (or the lowest price)', 'money'], ['price_max_cents', 'Highest price in dollars (leave empty for a single price)', 'money'], ['deposit_cents', 'Deposit in dollars', 'money'], ['sort_order', 'Order on the page (smallest first)', 'number'], ['active', 'Show on the website', 'check']] },
    reviews: { title: 'Customer reviews', one: 'review', image: { key: 'image', label: "Reviewer's photo (optional)" }, label: function (r) { return r.name + ' · ' + r.rating + (r.rating === 1 ? ' star' : ' stars') }, sub: function (r) { return r.review + (r.active ? '' : ' · hidden') },
      fields: [['name', 'Customer name', 'text'], ['rating', 'Rating', 'select', 'rating'], ['review', 'Review', 'textarea'], ['sort_order', 'Order on the page (smallest first)', 'number'], ['active', 'Show on the website', 'check']] },
    faqs: { title: 'FAQ', one: 'question', label: function (r) { return r.question }, sub: function (r) { return r.answer },
      fields: [['question', 'Question', 'text'], ['answer', 'Answer', 'textarea'], ['sort_order', 'Order (smallest first)', 'number']] }
  };

  function resourceView(name) {
    var cfg = RES[name], listBox = h('div', { class: 'rows' }), formBox = h('div');
    main.appendChild(h('h2', { class: 'sec', text: cfg.title }));
    main.appendChild(h('div', { class: 'actions', style: 'margin-bottom:14px' }, [h('button', { class: 'btn primary', type: 'button', text: 'Add ' + cfg.one, onclick: function () { openForm(null) } })]));
    if (cfg.note) main.appendChild(h('p', { class: 'small', style: 'max-width:70ch;margin:-6px 0 16px', text: cfg.note }));
    main.appendChild(formBox); main.appendChild(listBox);
    var artists = [];
    function load() {
      var needsArtists = name === 'works' || name === 'artist_photos';
      return Promise.all([api('/api/admin/' + name), needsArtists ? api('/api/admin/artists') : Promise.resolve([])]).then(function (r) {
        artists = r[1]; listBox.textContent = '';
        if (!r[0].length) listBox.appendChild(h('p', { class: 'muted', text: 'Nothing here yet.' }));
        r[0].forEach(function (row) {
          if (cfg.artistLabel) {
            var owner = artists.filter(function (a) { return a.id === row.artist_id })[0];
            row.artist_name = owner ? owner.name : '';
          }
          var img = cfg.image && row[cfg.image.key] ? h('img', { src: row[cfg.image.key], alt: '' }) : h('div', { class: 'thumb' });
          listBox.appendChild(h('div', { class: 'row' }, [
            cfg.image ? img : null,
            h('div', { class: 'grow' }, [h('b', { text: cfg.label(row) }), h('p', { class: 'small', text: cfg.sub(row) })]),
            h('button', { class: 'btn', type: 'button', text: 'Edit', onclick: function () { openForm(row) } }),
            twoStep('Delete', function () { api('/api/admin/' + name + '/' + row.id, { method: 'DELETE' }).then(load).catch(handle) })
          ]));
        });
      }).catch(handle);
    }
    function openForm(row) {
      formBox.textContent = '';
      var wraps = {}, inputs = {};
      var form = h('form', { class: 'edit', novalidate: '' });
      form.appendChild(h('h2', { class: 'sec', text: (row ? 'Edit ' : 'New ') + cfg.one, style: 'margin:0' }));
      cfg.fields.forEach(function (f) {
        var key = f[0], type = f[2], val = row ? row[key] : (key === 'active' ? 1 : (type === 'number' && f[4] !== 'blank' ? 0 : ''));
        if (type === 'money') val = row ? dollars(row[key]) : '';
        if (key === 'artist_id' && !row && artists.length) val = artists[0].id;
        var inp;
        if (type === 'textarea') inp = h('textarea', { name: key }); else if (type === 'select') {
          inp = h('select', { name: key });
          if (f[3] === 'art') ART_KEYS[name].forEach(function (k) { inp.appendChild(h('option', { value: k, text: k })) });
          else if (f[3] === 'rating') [5, 4, 3, 2, 1].forEach(function (n) { inp.appendChild(h('option', { value: n, text: n + (n === 1 ? ' star' : ' stars') })) });
          else {
            if (name !== 'artist_photos') inp.appendChild(h('option', { value: '', text: 'No artist' }));
            artists.forEach(function (a) { inp.appendChild(h('option', { value: a.id, text: a.name })) });
          }
        } else if (type === 'check') inp = h('input', { type: 'checkbox', name: key });
        else if (type === 'money') inp = h('input', { type: 'text', inputmode: 'decimal', name: key, placeholder: 'for example 250' });
        else inp = h('input', { type: type, name: key });
        if (type === 'check') inp.checked = !!Number(val); else inp.value = val == null ? '' : val;
        inputs[key] = inp;
        var wrap = type === 'check' ? h('label', { class: 'check' }, [inp, f[1]]) : h('label', { class: 'f' }, [f[1], inp]);
        wraps[key] = wrap; form.appendChild(wrap);
      });
      var file, remove;
      if (cfg.image) {
        file = h('input', { type: 'file', name: 'image', accept: 'image/jpeg,image/png,image/webp,image/gif' });
        form.appendChild(h('label', { class: 'f' }, [cfg.image.label + ' (JPG, PNG, WebP or GIF; big phone photos are resized automatically)', file]));
        wraps.image = file.parentNode;
        if (row && row[cfg.image.key]) {
          remove = h('input', { type: 'checkbox' });
          form.appendChild(h('img', { class: 'preview', src: row[cfg.image.key], alt: 'Current image' }));
          form.appendChild(h('label', { class: 'check' }, [remove, 'Remove the current image']));
        }
      }
      var msg = h('p', { class: 'msg', role: 'alert' });
      form.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'submit', text: 'Save' }), h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { formBox.textContent = '' } })]));
      form.appendChild(msg);
      form.addEventListener('submit', function (e) {
        e.preventDefault(); msg.className = 'msg'; msg.textContent = '';
        Object.keys(wraps).forEach(function (k) { wraps[k].classList.remove('bad'); var old = wraps[k].querySelector('em'); if (old) old.remove() });
        var fd = new FormData();
        cfg.fields.forEach(function (f) { var i = inputs[f[0]]; fd.set(f[0], f[2] === 'check' ? (i.checked ? '1' : '0') : i.value) });
        if (remove && remove.checked) fd.set('remove_image', '1');
        var save = form.querySelector('button[type=submit]'); save.disabled = true;
        var picked = file && file.files[0];
        if (picked) msg.textContent = 'Preparing the photo…';
        shrink(picked).then(function (img) {
          var big = tooBig(img); if (big) { var e = new Error(big); e.fields = { image: big }; throw e }
          if (img) fd.set('image', img);
          return send(row ? 'PUT' : 'POST', '/api/admin/' + name + (row ? '/' + row.id : ''), fd, img ? function (p) { msg.textContent = p < 100 ? 'Uploading… ' + p + '%' : 'Saving…' } : null);
        }).then(function () { formBox.textContent = ''; load() }).catch(function (er) {
          save.disabled = false;
          if (er.status === 401) return handle(er);
          msg.className = 'msg err'; msg.textContent = er.message;
          Object.keys(er.fields || {}).forEach(function (k) { var w = wraps[k]; if (w) { w.classList.add('bad'); w.appendChild(h('em', { text: er.fields[k] })) } });
        });
      });
      formBox.appendChild(form); form.querySelector('input,textarea,select').focus();
    }
    return load();
  }


  /* ---------- orders and deposits ---------- */
  var OSTAT = [['awaiting_payment', 'Awaiting payment'], ['payment_submitted', 'Customer says: sent'], ['paid', 'Paid'], ['fulfilled', 'Fulfilled'], ['cancelled', 'Cancelled']];
  var OLABEL = {}; OSTAT.forEach(function (x) { OLABEL[x[0]] = x[1] });
  var METHOD_LABEL = { card: 'Card / Apple Pay', zelle: 'Zelle', chime: 'Chime', bitcoin: 'Bitcoin' };
  var of = { status: '', kind: '', q: '', page: 1 };
  function ordersView() {
    var table = h('div'), pager = h('div', { class: 'pager' }), msg = h('p', { class: 'msg' });
    var statusSel = h('select', { 'aria-label': 'Status' }, [h('option', { value: '', text: 'All statuses' })].concat(OSTAT.map(function (x) { return h('option', { value: x[0], text: x[1] }) })));
    var kindSel = h('select', { 'aria-label': 'Type' }, [h('option', { value: '', text: 'All payments' }), h('option', { value: 'deposit', text: 'Booking deposits only' })]);
    var q = h('input', { type: 'search', placeholder: 'Search name, email or code', 'aria-label': 'Search', value: of.q });
    statusSel.value = of.status; kindSel.value = of.kind;
    function load() {
      of.status = statusSel.value; of.kind = kindSel.value; of.q = q.value.trim();
      var qs = '?page=' + of.page + (of.status ? '&status=' + of.status : '') + (of.kind ? '&kind=' + of.kind : '') + (of.q ? '&q=' + encodeURIComponent(of.q) : '');
      api('/api/admin/orders' + qs).then(draw).catch(handle);
    }
    function draw(list) {
      table.textContent = ''; pager.textContent = '';
      if (!list.data.length) { table.appendChild(h('p', { class: 'muted', text: 'No orders match.' })); return }
      var tbody = h('tbody');
      list.data.forEach(function (o) {
        var sel = h('select', { 'aria-label': 'Status for ' + o.reference, onchange: function () {
          msg.className = 'msg'; msg.textContent = '';
          api('/api/admin/orders/' + o.id, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ status: sel.value }) })
            .then(function () { msg.className = 'msg ok'; msg.textContent = o.reference + ' is now "' + OLABEL[sel.value] + '".'; load() })
            .catch(function (e) { if (e.status === 401) return handle(e); msg.className = 'msg err'; msg.textContent = e.message; sel.value = o.status });
        } }, OSTAT.map(function (x) { return h('option', { value: x[0], text: x[1], selected: x[0] === o.status }) }));
        var how = [h('div', { text: METHOD_LABEL[o.method] || o.method })];
        if (o.method === 'bitcoin' && o.btc_sats) how.push(h('div', { class: 'small', text: (Number(o.btc_sats) / 1e8).toFixed(8) + ' BTC' }));
        if (o.payment_note) how.push(h('div', { class: 'small', text: 'Customer note: ' + o.payment_note, style: 'max-width:200px;white-space:pre-wrap' }));
        tbody.appendChild(h('tr', {}, [
          h('td', {}, [h('b', { text: o.reference }), h('div', { class: 'small', text: o.created_at.slice(0, 16) }), h('div', { class: 'small', text: o.kind === 'deposit' ? 'Booking deposit' : 'Older order' })]),
          h('td', {}, [h('div', { text: o.name }), h('a', { class: 'small', href: 'mailto:' + o.email, text: o.email }), o.phone ? h('div', { class: 'small', text: o.phone }) : null, o.note ? h('div', { class: 'small', text: 'Note: ' + o.note, style: 'max-width:220px;white-space:pre-wrap' }) : null]),
          h('td', {}, o.items.map(function (i) { return h('div', { text: (i.qty > 1 ? i.qty + ' × ' : '') + i.name }) })),
          h('td', {}, [h('b', { text: usd(o.total_cents) })]),
          h('td', {}, how),
          h('td', {}, [h('span', { class: 'badge ' + o.status, text: OLABEL[o.status] }), h('div', {}, [sel])]),
          h('td', {}, [o.status === 'cancelled' ? twoStep('Delete', function () { api('/api/admin/orders/' + o.id, { method: 'DELETE' }).then(load).catch(function (e) { msg.className = 'msg err'; msg.textContent = e.message; load() }) }) : null])
        ]));
      });
      table.appendChild(h('div', { class: 'tablewrap' }, [h('table', {}, [h('thead', {}, [h('tr', {}, ['Order', 'Customer', 'What', 'Total', 'Paid with', 'Status', ''].map(function (t) { return h('th', { text: t }) }))]), tbody])]));
      var pages = Math.max(1, Math.ceil(list.total / list.limit));
      pager.appendChild(h('button', { class: 'btn', type: 'button', text: 'Previous', disabled: list.page <= 1 ? '' : false, onclick: function () { of.page--; load() } }));
      pager.appendChild(h('span', { class: 'muted', text: 'Page ' + list.page + ' of ' + pages + ' · ' + list.total + ' orders' }));
      pager.appendChild(h('button', { class: 'btn', type: 'button', text: 'Next', disabled: list.page >= pages ? '' : false, onclick: function () { of.page++; load() } }));
    }
    var go1 = function () { of.page = 1; load() };
    statusSel.addEventListener('change', go1); kindSel.addEventListener('change', go1);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') go1() });
    main.appendChild(h('h2', { class: 'sec', text: 'Orders and deposits' }));
    main.appendChild(h('p', { class: 'small', style: 'max-width:70ch;margin:-6px 0 14px', text: 'Card payments turn to "Paid" by themselves. For Zelle, Chime and Bitcoin, check your own account, then set the deposit to "Paid". Payments that need checking are listed first. Cancelling an unpaid deposit lets the customer pay it again.' }));
    main.appendChild(h('div', { class: 'filters' }, [statusSel, kindSel, q, h('button', { class: 'btn', type: 'button', text: 'Search', onclick: go1 })]));
    main.appendChild(msg); main.appendChild(table); main.appendChild(pager);
    load();
  }

  /* ---------- ways to pay ---------- */
  var ACCOUNT_LABEL = { zelle: 'Zelle: the email address or phone number registered with Zelle', chime: 'Chime: your ChimeSign ($yourname), email or phone', bitcoin: 'Bitcoin wallet address (copy it from your wallet app)' };
  function paymentsView() {
    main.appendChild(h('h2', { class: 'sec', text: 'Ways to pay' }));
    return api('/api/admin/payments').then(function (d) {
      main.appendChild(h('p', { class: 'small', style: 'max-width:70ch;margin:-6px 0 16px', text: 'Switch on the ways customers can pay their booking deposit. Zelle, Chime and Bitcoin go straight to your own accounts: customers see your details and the exact amount, then tell you they sent it, and you confirm in Orders & payments.' }));
      d.methods.forEach(function (m) {
        var inputs = {}, msg = h('p', { class: 'msg', role: 'alert' });
        var form = h('form', { class: 'edit', novalidate: '' });
        form.appendChild(h('h2', { class: 'sec', text: METHOD_LABEL[m.method] || m.method, style: 'margin:0' }));
        if (m.method === 'card') form.appendChild(h('p', { class: d.stripe_configured ? 'msg ok' : 'msg err', text: d.stripe_configured ? 'Stripe key found.' + (d.webhook_configured ? ' Webhook secret found.' : ' No webhook secret yet: payments are still confirmed when the customer returns to the site. See UPDATE.md.') : 'No Stripe key in the .env file yet, so this cannot be switched on. See UPDATE.md, section "Card payments and Apple Pay".' }));
        inputs.enabled = h('input', { type: 'checkbox', name: 'enabled' }); inputs.enabled.checked = !!m.enabled;
        form.appendChild(h('label', { class: 'check', 'data-f': 'enabled' }, [inputs.enabled, 'Offer this to customers']));
        inputs.label = h('input', { type: 'text', name: 'label', value: m.label }); form.appendChild(h('label', { class: 'f', 'data-f': 'label' }, ['Name shown to customers', inputs.label]));
        if (m.method !== 'card') { inputs.account = h('input', { type: 'text', name: 'account', value: m.account, autocomplete: 'off' }); form.appendChild(h('label', { class: 'f', 'data-f': 'account' }, [ACCOUNT_LABEL[m.method], inputs.account])) }
        inputs.instructions = h('textarea', { name: 'instructions', style: 'min-height:64px' }); inputs.instructions.value = m.instructions;
        form.appendChild(h('label', { class: 'f', 'data-f': 'instructions' }, ['Instructions shown to customers', inputs.instructions]));
        form.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'submit', text: 'Save' })])); form.appendChild(msg);
        form.addEventListener('submit', function (e) {
          e.preventDefault(); msg.className = 'msg'; msg.textContent = '';
          Array.prototype.forEach.call(form.querySelectorAll('[data-f]'), function (w) { w.classList.remove('bad'); var em = w.querySelector('em'); if (em) em.remove() });
          var body = { label: inputs.label.value, enabled: inputs.enabled.checked ? '1' : '0', account: inputs.account ? inputs.account.value : '', instructions: inputs.instructions.value };
          api('/api/admin/payments/' + m.method, { method: 'PUT', headers: JSONH, body: JSON.stringify(body) }).then(function () { msg.className = 'msg ok'; msg.textContent = 'Saved.' }).catch(function (er) {
            if (er.status === 401) return handle(er);
            msg.className = 'msg err'; msg.textContent = er.message;
            Object.keys(er.fields || {}).forEach(function (k) { var w = form.querySelector('[data-f="' + k + '"]'); if (w) { w.classList.add('bad'); w.appendChild(h('em', { text: er.fields[k] })) } });
          });
        });
        main.appendChild(form);
      });
    });
  }

  /* ---------- studio details + hero photo ---------- */
  function studioView() {
    return api('/api/admin/studio').then(function (s) {
      var fields = [['studio_name', 'Studio name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['hours', 'Opening hours (use a new line for the second line)'], ['discover_intro', 'Text at the top of the Discover page'], ['pricing_note', 'Note under the tattoo prices']];
      var inputs = {}, form = h('form', { class: 'edit', novalidate: '' }), msg = h('p', { class: 'msg', role: 'alert' });
      form.appendChild(h('h2', { class: 'sec', text: 'Studio details', style: 'margin:0' }));
      fields.forEach(function (f) {
        var inp = (f[0] === 'hours' || f[0] === 'discover_intro' || f[0] === 'pricing_note') ? h('textarea', { name: f[0], style: 'min-height:64px' }) : h('input', { name: f[0], type: 'text' });
        inp.value = s[f[0]] || ''; inputs[f[0]] = inp; form.appendChild(h('label', { class: 'f' }, [f[1], inp]));
      });
      form.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'submit', text: 'Save details' })])); form.appendChild(msg);
      form.addEventListener('submit', function (e) {
        e.preventDefault(); msg.className = 'msg'; msg.textContent = '';
        var body = {}; fields.forEach(function (f) { body[f[0]] = inputs[f[0]].value });
        api('/api/admin/studio', { method: 'PUT', headers: JSONH, body: JSON.stringify(body) }).then(function () { msg.className = 'msg ok'; msg.textContent = 'Saved. The website shows the new details now.' }).catch(function (er) { if (er.status === 401) return handle(er); msg.className = 'msg err'; msg.textContent = er.message });
      });
      var heroBox = h('div');
      function drawHero(url) {
        heroBox.textContent = '';
        var f = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif' }), m = h('p', { class: 'msg', role: 'alert' });
        heroBox.appendChild(h('form', { class: 'edit', onsubmit: function (e) {
          e.preventDefault(); if (!f.files[0]) { m.className = 'msg err'; m.textContent = 'Choose an image first.'; return }
          m.className = 'msg'; m.textContent = 'Preparing the photo…';
          shrink(f.files[0]).then(function (img) {
            var big = tooBig(img); if (big) throw new Error(big);
            var fd = new FormData(); fd.set('image', img);
            return send('POST', '/api/admin/studio/hero', fd, function (p) { m.textContent = p < 100 ? 'Uploading… ' + p + '%' : 'Saving…' });
          }).then(function (r) { drawHero(r.hero_image) }).catch(function (er) { if (er.status === 401) return handle(er); m.className = 'msg err'; m.textContent = er.message });
        } }, [
          h('h2', { class: 'sec', text: 'Home page photo', style: 'margin:0' }),
          h('p', { class: 'small', text: 'Shown large on the home page, next to the INK NATION lettering. A transparent PNG of a person or tattoo (background removed) stands in front of the lettering, as in the design. A JPG is placed behind the lettering.' }),
          url ? h('img', { class: 'preview', src: url, alt: 'Current home page photo' }) : h('p', { class: 'muted', text: 'No photo yet: the drawn mandala is shown.' }),
          h('label', { class: 'f' }, ['Choose a photo (JPG, PNG, WebP or GIF, up to 5 MB)', f]),
          h('div', { class: 'actions' }, [h('button', { class: 'btn primary', type: 'submit', text: 'Upload photo' }), url ? twoStep('Remove photo', function () { api('/api/admin/studio/hero', { method: 'DELETE' }).then(function () { drawHero('') }).catch(handle) }) : null]), m
        ]));
      }
      drawHero(s.hero_image);
      var vidBox = h('div');
      function drawVideo(url) {
        vidBox.textContent = '';
        var f = h('input', { type: 'file', accept: 'video/mp4,video/webm' }), m = h('p', { class: 'msg', role: 'alert' }), go = h('button', { class: 'btn primary', type: 'submit', text: 'Upload video' });
        vidBox.appendChild(h('form', { class: 'edit', onsubmit: function (e) {
          e.preventDefault(); if (!f.files[0]) { m.className = 'msg err'; m.textContent = 'Choose a video first.'; return }
          var v = f.files[0], limit = direct ? 100 : 30;
          if (v.size > limit * 1024 * 1024) { m.className = 'msg err'; m.textContent = 'This video is larger than ' + limit + ' MB. Shorten or compress it first (a 10 to 20 second loop is plenty).'; return }
          go.disabled = true; m.className = 'msg'; m.textContent = 'Uploading… 0%';
          var progress = function (p) { m.textContent = p < 100 ? 'Uploading… ' + p + '%' : 'Processing the video…' };
          var done = direct
            // Straight from this browser to Cloudinary: faster, and the website server never has to hold the file.
            ? api('/api/admin/studio/video/sign', { method: 'POST' }).then(function (sig) {
                var fd = new FormData(); Object.keys(sig.fields).forEach(function (k) { fd.set(k, sig.fields[k]) }); fd.set('file', v);
                return send('POST', sig.url, fd, progress);
              }).then(function (r) { return api('/api/admin/studio/video/direct', { method: 'POST', headers: JSONH, body: JSON.stringify(r) }) })
            : (function () { var fd = new FormData(); fd.set('video', v); return send('POST', '/api/admin/studio/video', fd, progress) })();
          done.then(function (r) { drawVideo(r.team_video) }).catch(function (er) { if (er.status === 401) return handle(er); go.disabled = false; m.className = 'msg err'; m.textContent = er.message });
        } }, [
          h('h2', { class: 'sec', text: 'Studio video', style: 'margin:0' }),
          h('p', { class: 'small', text: 'A silent, looping clip that plays full width after the team section. Use a short MP4 or WebM (10 to 20 seconds, up to ' + (direct ? 100 : 30) + ' MB). Without your own video, a sample clip is shown.' }),
          url ? h('video', { src: url, class: 'preview', controls: '', muted: '', playsinline: '', style: 'max-width:320px' }) : h('p', { class: 'muted', text: 'No video uploaded yet: the sample clip is shown.' }),
          h('label', { class: 'f' }, ['Choose a video (MP4 or WebM)', f]),
          h('div', { class: 'actions' }, [go, url ? twoStep('Remove video', function () { api('/api/admin/studio/video', { method: 'DELETE' }).then(function () { drawVideo('') }).catch(handle) }) : null]), m
        ]));
      }
      var direct = false;
      var moveBox = h('div');
      api('/api/admin/media').then(function (r) { direct = !!(r && r.direct_video); drawMove(r && r.to_move) }).catch(function () {}).then(function () { drawVideo(s.team_video) });
      // Photos uploaded before Cloudinary was set up are still served from the database (slow). One click moves them.
      function drawMove(n) {
        moveBox.textContent = '';
        if (!n) return;
        var m = h('p', { class: 'msg', role: 'alert' }), b = h('button', { class: 'btn primary', type: 'button', text: 'Move them now', onclick: function () {
          b.disabled = true; m.className = 'msg'; m.textContent = 'Moving ' + n + ' file' + (n === 1 ? '' : 's') + '… this can take a minute, keep this page open.';
          api('/api/admin/media/move', { method: 'POST' }).then(function (r) {
            var left = r.missing.length + r.failed.length;
            m.className = left ? 'msg err' : 'msg ok';
            m.textContent = r.moved + ' moved.' + (r.missing.length ? ' ' + r.missing.length + ' file(s) were already missing: upload them again.' : '') + (r.failed.length ? ' ' + r.failed.length + ' failed: click again to retry.' : '');
            b.disabled = false; if (!r.failed.length) b.remove();
          }).catch(function (er) { if (er.status === 401) return handle(er); b.disabled = false; m.className = 'msg err'; m.textContent = er.message });
        } });
        moveBox.appendChild(h('div', { class: 'edit' }, [h('h2', { class: 'sec', text: 'Speed up older photos', style: 'margin:0' }),
          h('p', { class: 'small', text: n + ' photo' + (n === 1 ? ' or video was' : 's or videos were') + ' uploaded before fast storage (Cloudinary) was switched on. Move them so they load quickly too.' }),
          h('div', { class: 'actions' }, [b]), m]));
      }
      main.appendChild(moveBox); main.appendChild(form); main.appendChild(heroBox); main.appendChild(vidBox);
    });
  }

  function start0() { api('/api/admin/me').then(start).catch(function (e) { if (e.status === 401) showLogin(); else app.textContent = e.message }) }
  start0();
})();
