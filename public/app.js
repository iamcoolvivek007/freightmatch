const EQUIPMENT = ['dryvan', 'reefer', 'flatbed', 'stepdeck', 'tanker'];
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || '', textContent: text ?? '' });
const usd = (c) => '$' + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

for (const id of ['#equip-load', '#equip-truck']) {
  $(id).append(...EQUIPMENT.map((e) => new Option(e, e)));
}

for (const b of document.querySelectorAll('#tabs button')) {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    for (const v of ['board', 'load', 'truck']) $('#view-' + v).hidden = v !== b.dataset.view;
    if (b.dataset.view === 'board') loadBoard();
  };
}

// --- board -------------------------------------------------------------------
async function loadBoard() {
  const b = await api('/board');
  $('#loads-count').textContent = `${b.loads.length}`;
  $('#trucks-count').textContent = `${b.trucks.length}`;

  $('#loads-list').replaceChildren(...b.loads.map((l) => {
    const li = el('li', 'card');
    li.innerHTML = `<div class="row"><span class="route">${esc(l.origin_city)}, ${esc(l.origin_state)} → ${esc(l.dest_city)}, ${esc(l.dest_state)}</span>
      <span class="pill ${l.status}">${l.status}</span></div>
      <div class="row muted"><span>${esc(l.ref)} · ${esc(l.shipper)} · ${esc(l.commodity)}</span><span>${usd(l.offered_rate_cents)} · ${esc(l.equipment)} · ${esc(l.pickup_date)}</span></div>`;
    li.onclick = () => openLoad(l.id);
    return li;
  }));
  if (!b.loads.length) $('#loads-list').append(emptyCard('No open loads. Log one from a shipper call.'));

  $('#trucks-list').replaceChildren(...b.trucks.map((t) => {
    const li = el('li', 'card');
    li.innerHTML = `<div class="row"><span class="route">${esc(t.driver)}${t.truck_number ? ' · ' + esc(t.truck_number) : ''}</span>
      <span class="pill available">${esc(t.equipment)}</span></div>
      <div class="row muted"><span>${esc(t.city)}, ${esc(t.state)}</span><span>free ${esc(t.available_date)} · floor ${usd(t.min_rate_cents)}</span></div>`;
    li.onclick = () => openTruck(t.id);
    return li;
  }));
  if (!b.trucks.length) $('#trucks-list').append(emptyCard('No available trucks. Log one from a driver call.'));

  $('#booked-list').replaceChildren(...b.booked.map((a) => {
    const li = el('li', 'card');
    li.innerHTML = `<div class="row"><span class="route">${esc(a.ref)} · ${esc(a.driver)}</span><span class="pill assigned">${usd(a.rate_cents)}</span></div>
      <div class="row muted"><span>${esc(a.origin_city)}, ${esc(a.origin_state)} → ${esc(a.dest_city)}, ${esc(a.dest_state)}</span><button class="ghost">Revoke</button></div>`;
    $('button', li).onclick = async (e) => {
      e.stopPropagation();
      await api(`/assignments/${a.id}/revoke`, { method: 'POST' });
      toast('Assignment revoked'); loadBoard();
    };
    return li;
  }));
  if (!b.booked.length) $('#booked-list').append(emptyCard('Nothing booked yet.'));
}

const emptyCard = (msg) => Object.assign(el('li', 'card muted', msg), { style: 'cursor:default' });

// --- load deal room: matches + negotiation threads -----------------------------
async function openLoad(id) {
  const d = await api(`/loads/${id}`);
  const l = d.load;
  $('#deal-title').textContent = `${l.ref} · ${l.origin_city}, ${l.origin_state} → ${l.dest_city}, ${l.dest_state}`;
  const body = $('#deal-body');
  body.replaceChildren();

  const head = el('div', 'row');
  head.innerHTML = `<div><strong>${esc(l.shipper)}</strong> ${l.shipper_phone ? `<span class="muted">${esc(l.shipper_phone)}</span>` : ''}
    <div class="muted">${esc(l.commodity)} · ${l.weight_lb.toLocaleString()} lb · ${esc(l.equipment)} · pickup ${esc(l.pickup_date)}</div></div>
    <div class="pill ${l.status}">${l.status} · ${usd(l.offered_rate_cents)}</div>`;
  body.append(head);

  if (d.assignment) {
    const a = d.assignment;
    const done = el('div', 'thread');
    done.innerHTML = `<strong style="color:var(--success)">Booked with ${esc(a.driver)}${a.truck_number ? ' (' + esc(a.truck_number) + ')' : ''} at ${usd(a.rate_cents)}</strong>`;
    const b = el('button', 'ghost', 'Revoke & reopen');
    b.onclick = async () => { await api(`/assignments/${a.id}/revoke`, { method: 'POST' }); toast('Reopened'); openLoad(id); loadBoard(); };
    done.append(b);
    body.append(done);
  }

  body.append(el('h3', '', 'Best matches'));
  if (!d.matches.length) body.append(emptyCard('No available truck fits this load (equipment/capacity/status).'));
  for (const m of d.matches) body.append(matchRow(m, l, d));

  body.append(el('h3', '', 'Negotiation threads'));
  const seen = new Set();
  for (const o of d.offers) {
    seen.add(o.truck_id);
    let t = $('#thread-' + o.truck_id);
    if (!t) {
      t = el('div', 'thread');
      t.id = 'thread-' + o.truck_id;
      t.innerHTML = `<strong>${esc(o.driver)}</strong> <span class="muted">${esc(o.truck_number || '')}</span><div class="msgs"></div>`;
      const row = el('div', 'offers-row');
      const amount = el('input');
      amount.type = 'number'; amount.step = '0.01'; amount.min = '1'; amount.placeholder = 'rate $';
      const counter = el('input'); counter.type = 'text'; counter.placeholder = 'note';
      const send = el('button', 'ghost', 'Counter');
      send.onclick = () => act(() => api('/offers', { method: 'POST', body: { load_id: l.id, truck_id: o.truck_id, by: 'broker', rate_cents: Math.round(Number(amount.value) * 100), note: counter.value } }), 'Counter sent', () => openLoad(l.id));
      const take = el('button', '', 'Accept latest');
      take.onclick = () => act(async () => {
        const open = d.offers.filter((x) => x.truck_id === o.truck_id && x.status === 'open');
        const last = open[open.length - 1];
        if (!last) throw new Error('No open offer on this thread');
        return api(`/offers/${last.id}/accept`, { method: 'POST' });
      }, 'Assigned', () => openLoad(l.id));
      row.append(amount, counter, send, take);
      t.append(row);
      body.append(t);
    }
    const msgs = $('.msgs', t);
    msgs.append(msgRow(o));
    msgs.append(el('div', 'muted', ' '));
  }
  if (!d.offers.length) body.append(emptyCard('No offers yet — make one from a match above.'));

  $('#deal').showModal();
}

const msgRow = (o) => {
  const who = o.by === 'broker' ? 'You' : (o.driver || 'Driver');
  return Object.assign(el('div', `msg ${o.status}`), {
    innerHTML: `<span>${who}: ${usd(o.rate_cents)}${o.note ? ' — ' + esc(o.note) : ''}</span><span class="muted">${esc(o.created_at)}</span>`,
  });
};

function matchRow(m, l) {
  const row = el('div', 'match');
  const cls = m.total >= 75 ? 'good' : m.total >= 55 ? 'ok' : 'weak';
  row.innerHTML = `<div class="score ${cls}">${m.total}</div>
    <div><strong>${esc(m.truck.driver)}</strong> <span class="muted">${esc(m.truck.city)}, ${esc(m.truck.state)} · ${esc(m.truck.equipment)} · ${m.truck.capacity_lb.toLocaleString()} lb · floor ${usd(m.truck.min_rate_cents)}</span>
    <div class="reasons">${m.reasons.map(esc).join(' · ')}</div></div>`;
  const actions = el('div');
  const offer = el('input');
  offer.type = 'number'; offer.step = '0.01'; offer.min = '1'; offer.value = (l.offered_rate_cents / 100).toFixed(0);
  offer.title = 'offer $';
  const send = el('button', '', 'Offer');
  send.onclick = () => act(() => api('/offers', { method: 'POST', body: { load_id: l.id, truck_id: m.truck.id, by: 'broker', rate_cents: Math.round(Number(offer.value) * 100), note: '' } }), 'Offer sent', () => openLoad(l.id));
  actions.append(offer, send);
  row.append(actions);
  return row;
}

// --- truck deal room: loads this truck fits ------------------------------------
async function openTruck(id) {
  const matches = await api(`/trucks/${id}/matches`);
  const t = matches[0]?.truck;
  $('#deal-title').textContent = t ? `${t.driver}${t.truck_number ? ' · ' + t.truck_number : ''}` : `Truck #${id}`;
  const body = $('#deal-body');
  body.replaceChildren();

  const best = matches[0];
  if (best) {
    const head = el('div', 'row');
    head.innerHTML = `<div class="muted">${esc(t.city)}, ${esc(t.state)} · ${esc(t.equipment)} · ${t.capacity_lb.toLocaleString()} lb · free ${esc(t.available_date)} · floor ${usd(t.min_rate_cents)}</div>`;
    body.append(head);
    body.append(el('h3', '', `Fits ${matches.length} open load(s)`));
  } else {
    body.append(emptyCard('This truck fits no open loads right now.'));
    $('#deal').showModal();
    return;
  }

  for (const m of matches) {
    const l = m.load;
    const row = el('div', 'match');
    const cls = m.total >= 75 ? 'good' : m.total >= 55 ? 'ok' : 'weak';
    row.innerHTML = `<div class="score ${cls}">${m.total}</div>
      <div><strong>${esc(l.ref)}</strong> · ${esc(l.origin_city)}, ${esc(l.origin_state)} → ${esc(l.dest_city)}, ${esc(l.dest_state)}
      <div class="reasons">${esc(l.shipper)} · ${esc(l.commodity)} · ${usd(l.offered_rate_cents)} · ${m.reasons.map(esc).join(' · ')}</div></div>`;
    const actions = el('div');
    const ask = el('input');
    ask.type = 'number'; ask.step = '0.01'; ask.min = '1'; ask.value = Math.max(l.offered_rate_cents, t.min_rate_cents) / 100;
    ask.title = 'ask $';
    const send = el('button', '', 'Ask rate');
    send.onclick = () => act(() => api('/offers', { method: 'POST', body: { load_id: l.id, truck_id: t.id, by: 'truck', rate_cents: Math.round(Number(ask.value) * 100), note: '' } }), 'Rate asked', () => openTruck(t.id));
    actions.append(ask, send);
    row.append(actions);
    body.append(row);
  }
  $('#deal').showModal();
}

async function act(fn, okMsg, refresh) {
  try { await fn(); toast(okMsg); await loadBoard(); if (refresh) await refresh(); }
  catch (e) { toast(e.message, true); }
}

// --- intake forms -------------------------------------------------------------
$('#form-load').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  await act(() => api('/loads', {
    method: 'POST',
    body: {
      ref: f.ref, shipper: f.shipper, shipper_phone: f.shipper_phone, commodity: f.commodity,
      origin_city: f.origin_city, origin_state: f.origin_state, dest_city: f.dest_city, dest_state: f.dest_state,
      pickup_date: f.pickup_date, equipment: f.equipment, weight_lb: f.weight_lb,
      offered_rate_cents: Math.round(Number(f.offered_rate) * 100), notes: f.notes,
    },
  }), 'Load saved');
  e.target.reset();
  document.querySelector('#tabs button[data-view=board]').click();
};

$('#form-truck').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  await act(() => api('/trucks', {
    method: 'POST',
    body: {
      driver: f.driver, phone: f.phone, truck_number: f.truck_number, equipment: f.equipment,
      capacity_lb: f.capacity_lb, city: f.city, state: f.state, available_date: f.available_date,
      min_rate_cents: Math.round(Number(f.min_rate) * 100), notes: f.notes,
    },
  }), 'Truck saved');
  e.target.reset();
  document.querySelector('#tabs button[data-view=board]').click();
};

$('#deal-close').onclick = () => $('#deal').close();
loadBoard();