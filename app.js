/*
  Turo Sync Watch: the screens.
  Rules live in logic.js and sample data in data.js. This file only draws
  screens and reacts to clicks. Nothing is saved: Reset demo starts over.

  Two places only:
    1. The list of all operators.
    2. One page per operator. It changes as the ticket moves:
       down -> reconnected (double-bookings) -> all sorted (close the ticket).
*/
(function () {
  'use strict';

  const L = window.SyncLogic;
  const D = window.SYNC_DATA;
  const NOW = D.DEMO_NOW;
  const app = document.getElementById('app');

  const fresh = () => ({
    view: 'monitor', // or 'operator'
    opId: null,
    flash: null,
    contacted: {}, // opId -> time
    reconnected: {}, // opId -> time
    collisions: {}, // opId -> double-bookings found at reconnect
    clash: {}, // collision id -> { status: 'told' | 'sorted', note }
    notes: {}, // collision id -> what the operator decided, as typed so far
    edits: {}, // textarea id -> edited text
    closed: {}, // opId -> time
  });
  let S = fresh();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const safeId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '-');
  const opById = (id) => D.operators.find((o) => o.id === id) || null;
  const nowMs = L.ms(NOW);

  const collisionsOf = (op) => S.collisions[op.id] || [];
  const clashStatus = (c) => (S.clash[c.id] ? S.clash[c.id].status : 'open');
  const unsorted = (op) => collisionsOf(op).filter((c) => clashStatus(c) !== 'sorted');

  function stateOf(op) {
    if (!L.isDown(op)) return 'healthy';
    if (S.closed[op.id]) return 'closed';
    if (S.reconnected[op.id]) return unsorted(op).length ? 'resolving' : 'ready';
    return 'down';
  }

  function srcTag(source) {
    return source === 'turo' ? '<span class="src src-turo">Turo</span>' : '<span class="src src-site">Site</span>';
  }

  // A textarea keeps whatever the agent typed into it, even when the page redraws.
  function textarea(id, text, rows, extraClass) {
    const value = typeof S.edits[id] === 'string' ? S.edits[id] : text;
    return `<textarea id="${id}" class="message${extraClass ? ' ' + extraClass : ''}" rows="${rows}" data-edit="1">${esc(value)}</textarea>`;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  function header() {
    return `
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <div class="brand-name">Turo Sync Watch</div>
            <div class="brand-sub">1Now support console · prototype with sample data</div>
          </div>
        </div>
        <div class="topbar-right">
          <span class="clock" title="The sample bookings have fixed dates, so the tool always counts from this moment. That way it works the same on any day.">Runs as if today is <b>${esc(L.fmtWhen(NOW))}</b></span>
          <button type="button" class="btn btn-quiet btn-small" data-action="reset">Reset demo</button>
        </div>
      </header>`;
  }

  function footer() {
    return '<footer class="footer">All operators, renters and bookings are made up. The rules are in logic.js and tested in tests/logic.test.js.</footer>';
  }

  function flashLine() {
    if (!S.flash) return '';
    return `<p class="flash${S.flash.error ? ' is-error' : ''}" role="status">${esc(S.flash.text)}</p>`;
  }

  function render() {
    let body;
    try {
      const op = S.opId ? opById(S.opId) : null;
      if (S.view === 'operator' && op && stateOf(op) !== 'healthy' && stateOf(op) !== 'closed') {
        body = viewOperator(op);
      } else {
        S.view = 'monitor';
        body = viewMonitor();
      }
    } catch (err) {
      console.error(err);
      body = `<section class="panel"><h2>This screen failed to draw</h2><p>${esc(err.message)}</p><div class="actions"><button type="button" class="btn" data-action="reset">Reset demo</button></div></section>`;
    }
    app.innerHTML = header() + `<main class="view">${flashLine()}${body}</main>` + footer();
  }

  // Switch page and start at the top.
  function go(view, flash) {
    S.view = view;
    S.flash = flash || null;
    render();
    window.scrollTo(0, 0);
    const h = app.querySelector('h1');
    if (h) h.focus({ preventScroll: true });
  }

  // Redraw in place (same page), then put focus where the agent's next step is.
  function redraw(focusId) {
    S.flash = null;
    render();
    const el = focusId && document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center' });
    }
  }

  // ---------------------------------------------------------------------------
  // 1. The list of all operators
  // ---------------------------------------------------------------------------

  function priority(op) {
    const st = stateOf(op);
    const far = Number.MAX_SAFE_INTEGER;
    if (st === 'healthy') return [9, 0];
    if (st === 'closed') return [8, 0];
    if (st === 'ready') return [5, 0];
    if (st === 'resolving') return [1, unsorted(op)[0].clashStart];
    const e = L.escalation(op, NOW);
    const rank = { 1: 0, 2: 2, 3: 3, internal: 4 }[e.tier];
    return [rank, e.first == null ? far : e.first];
  }

  function byPriority(a, b) {
    const pa = priority(a);
    const pb = priority(b);
    return pa[0] - pb[0] || pa[1] - pb[1];
  }

  function stat(n, label, sev) {
    return `<div class="stat sev-${sev}"><span class="stat-n">${n}</span><span class="stat-l">${esc(label)}</span></div>`;
  }

  function viewMonitor() {
    const ops = D.operators;
    const downOps = ops.filter((o) => stateOf(o) === 'down');
    const callNow = downOps.filter((o) => L.escalation(o, NOW).tier === 1).length;
    const blind = downOps.reduce((n, o) => n + L.takenBlind(o, NOW).length, 0);
    const open = ops.reduce((n, o) => n + (S.reconnected[o.id] && !S.closed[o.id] ? unsorted(o).length : 0), 0);
    const rows = ops.slice().sort(byPriority).map(monitorRow).join('');

    return `
      <section class="page-head">
        <h1 tabindex="-1">Turo connections</h1>
        <p class="lede">Operators whose Turo connection has stopped syncing, most urgent first. While a connection is down, bookings on Turo and bookings on the operator's own site can't see each other.</p>
      </section>
      <section class="stats" aria-label="Summary">
        ${stat(downOps.length, downOps.length === 1 ? 'connection down' : 'connections down', downOps.length ? 'crit' : 'ok')}
        ${stat(callNow, 'to call now', callNow ? 'crit' : 'muted')}
        ${stat(blind, 'site bookings taken with no Turo check', blind ? 'warn' : 'muted')}
        ${stat(open, 'double-bookings not sorted yet', open ? 'crit' : 'muted')}
      </section>
      <div class="table-wrap">
        <table class="grid monitor">
          <thead>
            <tr>
              <th scope="col">Operator</th>
              <th scope="col">Connection</th>
              <th scope="col">Why it broke</th>
              <th scope="col" class="num">Taken blind</th>
              <th scope="col">First pickup</th>
              <th scope="col">Next step</th>
              <th scope="col"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="footnote"><b>Taken blind</b> means site bookings accepted while the connection was down. None of them were checked against Turo, and Turo was never told about them. A double-booking can only be confirmed once the operator reconnects and both calendars can be compared.</p>`;
  }

  function monitorRow(op) {
    const st = stateOf(op);
    const cars = L.fleetSize(op);
    let opCell = `<div class="op-name">${esc(op.name)}</div><div class="sub">${esc(op.city)} · ${cars} cars</div>`;
    const openBtn = `<button type="button" class="btn btn-small" data-action="open" data-op="${esc(op.id)}" aria-label="Open ${esc(op.name)}">Open</button>`;

    if (st === 'healthy') {
      const ago = L.fmtLength(nowMs - L.ms(op.connection.lastSync));
      return `<tr class="row-quiet">
        <td>${opCell}</td>
        <td><span class="pill pill-ok">Syncing</span><div class="sub">Last sync ${esc(ago)} ago</div></td>
        <td class="dim">–</td><td class="num dim">–</td><td class="dim">–</td><td class="dim">Nothing to do</td><td></td>
      </tr>`;
    }

    const reason = L.REASONS[op.connection.reason];
    if (st === 'closed') {
      return `<tr class="row-quiet">
        <td>${opCell}</td>
        <td><span class="pill pill-ok">Fixed</span><div class="sub">Ticket closed ${esc(L.fmtTime(S.closed[op.id]))}</div></td>
        <td>${esc(reason.label)}</td><td class="num">${L.takenBlind(op, NOW).length}</td><td class="dim">–</td>
        <td class="dim">Done</td><td></td>
      </tr>`;
    }

    if (st === 'resolving' || st === 'ready') {
      const left = unsorted(op);
      const notTold = left.filter((c) => clashStatus(c) === 'open').length;
      const status = st === 'resolving'
        ? `<span class="pill pill-warn">Reconnected</span><div class="sub">${L.plural(left.length, 'double-booking')} not sorted</div>`
        : `<span class="pill pill-info">Reconnected</span><div class="sub">${collisionsOf(op).length ? 'All sorted' : 'All clear'}</div>`;
      let next = '<span class="pill pill-info">Send summary and close</span>';
      if (notTold) next = '<span class="pill pill-crit">Tell the operator</span>';
      else if (left.length) next = '<span class="pill pill-warn">Waiting on the operator</span>';
      return `<tr>
        <td>${opCell}</td><td>${status}</td><td>${esc(reason.label)}</td>
        <td class="num">${L.takenBlind(op, NOW).length}</td><td class="dim">Checked</td>
        <td>${next}</td><td>${openBtn}</td>
      </tr>`;
    }

    // Still down.
    const e = L.escalation(op, NOW);
    const blind = L.takenBlind(op, NOW);
    const down = L.fmtLength(nowMs - L.brokeAt(op));
    if (L.isRepeat(op, NOW)) opCell += `<span class="chip chip-warn">${L.breaksLast60(op, NOW)} breaks in 60 days</span>`;
    const tierPill = { 1: 'pill-crit', 2: 'pill-warn', 3: 'pill-info', internal: 'pill-quiet' }[e.tier];
    const contacted = S.contacted[op.id] ? `<div class="sub">Contacted ${esc(L.fmtTime(S.contacted[op.id]))}</div>` : '';
    const who = e.tier === 'internal'
      ? '<div class="sub">No operator contact yet</div>'
      : `<div class="sub">${esc(op.owner.name)} · <span class="mono">${esc(op.owner.phone)}</span></div>`;
    const first = blind.length
      ? `${esc(L.fmtDay(blind[0].start))}<div class="sub">${esc(L.fmtUntil(blind[0].start, NOW))}</div>`
      : '<span class="dim">–</span>';

    return `<tr>
      <td>${opCell}</td>
      <td><span class="pill pill-crit">Down ${esc(down)}</span><div class="sub">All ${cars} cars exposed</div></td>
      <td>${esc(reason.label)}</td>
      <td class="num"><span class="big-n">${blind.length}</span></td>
      <td>${first}</td>
      <td><span class="pill ${tierPill}">${esc(e.label)}</span>${who}${contacted}</td>
      <td>${openBtn}</td>
    </tr>`;
  }

  // ---------------------------------------------------------------------------
  // 2. One operator's page
  // ---------------------------------------------------------------------------

  function viewOperator(op) {
    const head = `
      <a href="#" class="back" data-action="go-monitor">← All operators</a>
      <section class="page-head">
        <h1 tabindex="-1">${esc(op.name)}</h1>
        <p class="lede">${esc(op.city)} · ${L.fleetSize(op)} cars · owner ${esc(op.owner.name)}, <span class="mono select">${esc(op.owner.phone)}</span></p>
      </section>`;
    return head + (S.reconnected[op.id] ? afterReconnect(op) : whileDown(op));
  }

  // --- While the connection is down ---------------------------------------

  function whileDown(op) {
    const e = L.escalation(op, NOW);
    const reason = L.REASONS[op.connection.reason];
    const blind = L.takenBlind(op, NOW);
    const down = L.fmtLength(nowMs - L.brokeAt(op));
    const internal = e.tier === 'internal';
    const since = L.fmtWhen(op.connection.lastSync);

    const perCar = op.cars.map((c) => {
      const n = blind.filter((b) => b.carId === c.id).length;
      return `<div class="fleet-car"><b>${esc(c.name)}</b><span>${esc(L.CLASS_LABEL[c.cls])} · ${n ? L.plural(n, 'blind booking') : 'no blind bookings'}</span></div>`;
    }).join('');

    return `
      <section class="split">
        <div class="panel">
          <div class="panel-head"><h2>Turo connection down for ${esc(down)}</h2><span class="pill pill-crit">Down</span></div>
          <dl class="facts">
            <div><dt>Last good sync</dt><dd class="mono">${esc(since)}</dd></div>
            <div><dt>Why</dt><dd><b>${esc(reason.label)}.</b> ${esc(reason.detail)}</dd></div>
            <div><dt>Exposed</dt><dd>All ${L.fleetSize(op)} cars. Nothing syncs in either direction until this is fixed.</dd></div>
            <div><dt>Can't see</dt><dd>Any Turo booking made since ${esc(since)}.</dd></div>
          </dl>
        </div>
        <div class="panel escalation tier-${e.tier}">
          <span class="eyebrow">How hard to chase</span>
          <h2>${esc(e.label)}</h2>
          <p>${esc(e.action)}</p>
          <ul class="reasons">${e.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>${blind.length ? `${L.plural(blind.length, 'booking')} taken with no Turo check` : 'No bookings taken while disconnected'}</h2>
          ${blind.length ? '<span class="chip chip-warn">Unverified</span>' : ''}
        </div>
        <p class="muted">${blind.length
          ? `These came in on the operator's site after ${esc(since)}. Any Turo trip booked in the same time is invisible to 1Now, so we can't tell yet which of these are safe.`
          : 'Nothing is at risk yet. The sooner they reconnect, the better.'}</p>
        ${blind.length ? blindTable(op, blind) : ''}
      </section>

      <section class="panel">
        <h2>Every car on the account is exposed</h2>
        <p class="muted">One Turo connection covers the whole account, so all ${L.fleetSize(op)} cars stopped syncing at the same moment, not just the one someone noticed.</p>
        <div class="fleet">${perCar}</div>
      </section>

      ${internal ? internalPanel(op, e) : contactPanel(op, e)}

      <section class="panel">
        <h2>${internal ? 'Wait for syncing to recover' : 'Get the operator to reconnect'}</h2>
        <p class="muted">${internal
          ? 'Nothing can be checked until Turo lets 1Now sync again.'
          : 'Nothing can be checked until they reconnect. When they do, 1Now pulls every Turo booking it missed and compares both calendars.'}</p>
        <div class="actions">
          <button type="button" class="btn btn-primary" data-action="reconnect">${internal ? 'Simulate: syncing recovers' : 'Simulate: operator reconnects'}</button>
          <span class="demo-note">Demo step. For real, this happens when ${internal ? 'Turo stops limiting requests' : 'the operator reconnects in Settings'}.</span>
        </div>
      </section>`;
  }

  function blindTable(op, list) {
    const rows = list.map((b) => `
      <tr>
        <td><b>${esc(L.fmtUntil(b.start, NOW))}</b></td>
        <td>${esc(L.carById(op, b.carId).name)}</td>
        <td>${esc(b.renter)}</td>
        <td class="mono">${esc(L.fmtTrip(b))}</td>
        <td class="mono">${esc(L.fmtWhen(b.createdAt))}</td>
      </tr>`).join('');
    return `<div class="table-wrap"><table class="grid bookings">
      <thead><tr><th scope="col">Pickup</th><th scope="col">Car</th><th scope="col">Renter</th><th scope="col">Trip</th><th scope="col">Booked on the site</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function contactPanel(op, e) {
    const id = `contact-${safeId(op.id)}`;
    const done = S.contacted[op.id];
    const phone = `<span class="mono select">${esc(op.owner.phone)}</span>`;
    let lead;
    if (e.tier === 1) lead = `Call ${esc(op.owner.first)} first on ${phone}. If there's no answer, send this:`;
    else if (e.tier === 2) lead = `Send this today. Call ${phone} if there's no reply by the end of the day.`;
    else lead = 'This goes out as the automatic reconnect email:';
    return `
      <section class="panel">
        <h2>Contact ${esc(op.owner.name)}</h2>
        <p>${lead}</p>
        <label class="field-label" for="${id}">Message to ${esc(op.owner.first)}</label>
        ${textarea(id, L.reconnectMessage(op, NOW), 8)}
        <div class="actions">
          <button type="button" class="btn" data-action="copy" data-target="${id}">Copy message</button>
          <button type="button" class="btn" data-action="contacted"${done ? ' disabled' : ''}>${done ? `Contacted at ${esc(L.fmtTime(done))}` : 'Mark as contacted'}</button>
        </div>
      </section>`;
  }

  function internalPanel(op, e) {
    return `
      <section class="panel">
        <h2>No operator contact yet</h2>
        <p class="muted">${esc(L.REASONS.RATE_LIMITED.detail)}</p>
        <p><b>${esc(e.action)}</b></p>
      </section>`;
  }

  // --- After reconnect ----------------------------------------------------

  function afterReconnect(op) {
    const res = L.checkResults(op, NOW);
    const cols = collisionsOf(op);
    const left = unsorted(op);
    const at = S.reconnected[op.id];
    const internal = op.connection.reason === 'RATE_LIMITED';
    const n = res.checked.length;
    const bad = res.clashing.length;

    let summary;
    let sev = 'ok';
    if (n === 0) summary = 'No bookings were taken on the site while the connection was down, so there is nothing to check.';
    else if (!bad) summary = n === 1 ? '1 booking checked. It is fine.' : `${n} bookings checked. All of them are fine.`;
    else {
      sev = left.length ? 'crit' : 'ok';
      summary = `${n} bookings checked. ${n - bad} ${n - bad === 1 ? 'is' : 'are'} fine. ${bad} ${bad === 1 ? 'is' : 'are'} double-booked${left.length ? '' : ', and the operator has sorted them'}.`;
    }

    const pulled = res.pulled.length;
    const clearN = res.clear.length;
    const syncLines = [
      `${L.plural(pulled, 'Turo booking')} made while disconnected ${pulled === 1 ? 'now blocks its dates' : 'now block their dates'} on the operator's site.`,
      `${L.plural(clearN, 'site booking')} taken while disconnected ${clearN === 1 ? 'now blocks its dates' : 'now block their dates'} on Turo.`,
    ];
    if (cols.length) {
      syncLines.push(left.length
        ? `${L.plural(left.length, 'double-booking')} ${left.length === 1 ? 'is' : 'are'} waiting on the operator.`
        : 'The operator has sorted every double-booking.');
    }

    const checkedRows = res.checked.map((b) => {
      const clash = cols.find((c) => c.direct.id === b.id);
      let verdict = '<span class="chip">Fine</span>';
      if (clash) verdict = clashStatus(clash) === 'sorted' ? '<span class="chip chip-ok">Double-booked, sorted</span>' : '<span class="chip chip-crit">Double-booked</span>';
      return `<tr><td>${verdict}</td><td>${esc(L.carById(op, b.carId).name)}</td><td>${esc(b.renter)}</td><td class="mono">${esc(L.fmtTrip(b))}</td></tr>`;
    }).join('');

    return `
      <p class="status-line"><span class="pill pill-info">${internal ? 'Syncing recovered' : 'Reconnected'}</span> <span class="muted">${esc(L.fmtWhen(at))}. 1Now pulled ${L.plural(pulled, 'Turo booking')} it had missed and compared both calendars for all ${L.fleetSize(op)} cars.</span></p>

      <p class="result sev-${sev}">${esc(summary)}</p>

      ${cols.length ? `
      <section class="page-head">
        <h2>Double-bookings, soonest first</h2>
        <p class="muted">Who keeps the car is ${esc(op.owner.first)}'s decision. Give him the facts, then note what he decided.</p>
      </section>
      <div class="clashes">${cols.map((c) => clashCard(op, c)).join('')}</div>` : ''}

      <section class="panel">
        <div class="panel-head"><h2>Both calendars, side by side</h2><span class="dim hover-hint">Hover a bar for details</span></div>
        <div class="legend">
          <span><i class="sw sw-turo"></i>Turo</span>
          <span><i class="sw sw-site"></i>Operator's site</span>
          <span><i class="sw sw-blind"></i>Booked while disconnected</span>
          <span><i class="sw sw-clash"></i>Double-booked</span>
          <span><i class="sw-now"></i>Now</span>
        </div>
        <div class="tl-scroll">${timeline(op)}</div>
      </section>

      <section class="panel">
        <h2>Back in sync</h2>
        <ul class="sync-list">${syncLines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </section>

      ${n ? `<section class="panel"><details class="checked"><summary>All ${n} bookings taken while disconnected</summary>
        <div class="table-wrap"><table class="grid bookings"><thead><tr><th scope="col">Result</th><th scope="col">Car</th><th scope="col">Renter</th><th scope="col">Trip</th></tr></thead><tbody>${checkedRows}</tbody></table></div>
      </details></section>` : ''}

      ${closePanel(op)}`;
  }

  function freeList(cars) {
    if (!cars.length) return '<span class="dim">None</span>';
    return cars.map((c) => `<span class="car-chip">${esc(c.name)} <span class="dim">${esc(L.CLASS_LABEL[c.cls])}</span></span>`).join('');
  }

  function clashCard(op, c) {
    const f = L.clashFacts(op, c, NOW);
    const st = clashStatus(c);
    const key = safeId(c.id);
    const who = op.owner.first;
    const pill = {
      open: '<span class="pill pill-crit">Tell the operator</span>',
      told: '<span class="pill pill-warn">Waiting on the operator</span>',
      sorted: '<span class="pill pill-ok">Sorted</span>',
    }[st];

    const renter = (b, driving) => `<div><dt>${srcTag(b.source)}</dt><dd>${esc(b.renter)}${driving ? ' <span class="chip chip-warn">Has the car now</span>' : ''}<span class="mono">${esc(L.fmtTrip(b))}</span></dd></div>`;

    let free;
    if (!f.freeTuro.length && !f.freeSite.length) {
      free = '<p><b>No other car is free</b> for either renter\'s dates.</p>';
    } else {
      free = `<dl class="free">
          <div><dt>Free for ${esc(L.firstName(c.turo.renter))}'s dates</dt><dd>${freeList(f.freeTuro)}</dd></div>
          <div><dt>Free for ${esc(L.firstName(c.direct.renter))}'s dates</dt><dd>${freeList(f.freeSite)}</dd></div>
        </dl>
        ${f.shared.length === 1 ? `<p class="muted">The ${esc(f.shared[0].name)} can only go to one of them.</p>` : ''}
        ${f.shared.length > 1 ? '<p class="muted">Each car in both lists can only go to one of them.</p>' : ''}`;
    }

    const msgId = `msg-${key}`;
    const noteId = `note-${key}`;
    let action;
    if (st === 'open') {
      action = `
        <label class="field-label" for="${msgId}">Message to ${esc(who)}</label>
        ${textarea(msgId, L.clashMessage(op, c, NOW), 15)}
        <div class="actions">
          <button type="button" class="btn" data-action="copy" data-target="${msgId}">Copy message</button>
          <button type="button" class="btn btn-primary" data-action="told" data-col="${esc(c.id)}">Mark ${esc(who)} as told</button>
        </div>`;
    } else if (st === 'told') {
      const typed = typeof S.notes[c.id] === 'string' ? S.notes[c.id] : '';
      action = `
        <details class="sent-msg"><summary>Message sent to ${esc(who)}</summary>${textarea(msgId, L.clashMessage(op, c, NOW), 15)}</details>
        <label class="field-label" for="${noteId}">What did ${esc(who)} decide?</label>
        <input type="text" id="${noteId}" class="note-input" data-note="${esc(c.id)}" value="${esc(typed)}" placeholder="For example: Gave Priya the Nissan Altima">
        <div class="actions">
          <button type="button" class="btn btn-primary" data-action="sorted" data-col="${esc(c.id)}">Mark sorted</button>
          <span class="demo-note">Leave it blank if he didn't say.</span>
        </div>`;
    } else {
      const note = S.clash[c.id].note;
      action = `<p class="done-note">${note ? `Sorted. What ${esc(who)} did: ${esc(note)}` : 'Sorted.'}</p>`;
    }

    return `
      <article class="clash is-${st}" id="clash-${key}">
        <header><h3 id="clash-title-${key}" tabindex="-1">${esc(f.car.name)}</h3>${pill}</header>
        <p>Both renters expect this car from <b>${esc(L.fmtWhen(c.clashStart))}</b> <span class="dim">(${esc(L.fmtUntil(c.clashStart, NOW))})</span></p>
        <dl class="pair">
          ${renter(c.turo, f.turoDriving)}
          ${renter(c.direct, f.siteDriving)}
        </dl>
        ${st === 'sorted' ? '' : `${free}
        <p class="fact">If ${esc(who)} cancels the Turo trip, Turo can charge him a fee and adds an automatic review to the car's listing saying he cancelled. <a href="https://turo.com/us/en/policies/cancellation" target="_blank" rel="noopener">Turo's policy</a></p>`}
        ${action}
      </article>`;
  }

  function closePanel(op) {
    const left = unsorted(op);
    if (left.length) {
      return `
        <section class="panel close-panel is-waiting">
          <h2>Close the ticket</h2>
          <p class="muted">Sort ${left.length === 1 ? 'the double-booking' : left.length === 2 ? 'both double-bookings' : `all ${left.length} double-bookings`} first. Then the summary for ${esc(op.owner.first)} appears here.</p>
        </section>`;
    }
    const outcomes = collisionsOf(op).map((c) => ({ col: c, note: S.clash[c.id].note }));
    const id = `summary-${safeId(op.id)}`;
    return `
      <section class="panel close-panel" id="close-${safeId(op.id)}">
        <h2 tabindex="-1" id="close-title-${safeId(op.id)}">Close the ticket</h2>
        <p class="muted">Send this to ${esc(op.owner.name)} so he knows what happened, what it hit, and what's fixed.</p>
        <label class="field-label" for="${id}">Summary for ${esc(op.owner.first)}</label>
        ${textarea(id, L.ticketSummary(op, NOW, S.reconnected[op.id], outcomes, D.AGENT_NAME), 17, 'summary')}
        <div class="actions"><button type="button" class="btn" data-action="copy" data-target="${id}">Copy summary</button></div>
        <div class="internal-note">
          <span class="eyebrow">Internal note · not sent to the operator</span>
          <p>${esc(L.PATCH_NOTE)}</p>
        </div>
        <div class="actions end">
          <button type="button" class="btn btn-primary" data-action="close-ticket">Mark summary sent and close ticket</button>
        </div>
      </section>`;
  }

  function timeline(op) {
    const cols = collisionsOf(op);
    const cutoff = L.brokeAt(op);
    const DAY = L.DAY;

    const startDay = Math.floor(nowMs / DAY) * DAY;
    const ends = op.bookings.map((b) => L.ms(b.end)).filter((e) => e > nowMs);
    const lastEnd = Math.max(nowMs + 7 * DAY, ...ends);
    const endDay = Math.min(Math.ceil(lastEnd / DAY) * DAY, startDay + 42 * DAY);
    const span = endDay - startDay;
    const days = Math.round(span / DAY);
    const pct = (v) => ((Math.min(Math.max(v, startDay), endDay) - startDay) / span) * 100;

    let ticks = '';
    for (let i = 0; i < days; i++) {
      const d = startDay + i * DAY;
      const month = i === 0 || L.dayOfMonth(d) === 1;
      ticks += `<div class="tick${L.isWeekend(d) ? ' wkend' : ''}${month ? '' : ' no-month'}" style="left:${pct(d)}%;width:${100 / days}%">${month ? `<em>${esc(L.monthShort(d))}</em>` : ''}${L.dayOfMonth(d)}</div>`;
    }

    const bar = (b) => {
      const s = L.ms(b.start);
      const e = L.ms(b.end);
      if (e <= startDay || s >= endDay) return '';
      const left = pct(s);
      const width = Math.max(pct(e) - left, 0.8);
      const blind = L.ms(b.createdAt) > cutoff;
      const title = `${b.source === 'turo' ? 'Turo' : 'Site'} · ${b.renter} · ${L.fmtTrip(b)} · booked ${L.fmtWhen(b.createdAt)}${blind ? ' (while disconnected)' : ''}`;
      const cls = `bar bar-${b.source === 'turo' ? 'turo' : 'site'}${blind ? ' is-blind' : ''}`;
      return `<div class="${cls}" style="left:${left}%;width:${width}%" title="${esc(title)}">${esc(b.renter)}</div>`;
    };

    const nowLeft = pct(nowMs);
    const rows = op.cars.map((car) => {
      const onCar = op.bookings.filter((b) => b.carId === car.id);
      const carCols = cols.filter((c) => c.carId === car.id);
      const openCols = carCols.filter((c) => clashStatus(c) !== 'sorted');
      const zones = openCols.map((c) => {
        const l = pct(c.clashStart);
        return `<div class="clash-zone" style="left:${l}%;width:${Math.max(pct(c.clashEnd) - l, 0.8)}%" title="Double-booked ${esc(L.fmtWhen(c.clashStart))} → ${esc(L.fmtWhen(c.clashEnd))}"></div>`;
      }).join('');
      let flag = '<span class="chip">Clear</span>';
      if (openCols.length) flag = '<span class="chip chip-crit">Double-booked</span>';
      else if (carCols.length) flag = '<span class="chip chip-ok">Sorted</span>';

      return `<div class="tl-row">
        <div class="tl-label"><b>${esc(car.name)}</b><span class="cls">${esc(L.CLASS_LABEL[car.cls])}</span>${flag}</div>
        <div class="tl-track" style="--days:${days}">
          <div class="lane lane-turo">${onCar.filter((b) => b.source === 'turo').map(bar).join('')}</div>
          <div class="lane lane-site">${onCar.filter((b) => b.source === 'direct').map(bar).join('')}</div>
          ${zones}
          <div class="now-line" style="left:${nowLeft}%"></div>
        </div>
      </div>`;
    }).join('');

    return `<div class="tl" role="img" aria-label="Turo and site bookings for each car, ${esc(L.fmtDay(startDay))} to ${esc(L.fmtDay(endDay - DAY))}">
      <div class="tl-head"><div></div><div class="tl-days">${ticks}</div></div>
      ${rows}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function copyFrom(targetId, btn) {
    const box = document.getElementById(targetId);
    if (!box) return;
    const label = btn.textContent;
    const show = (text) => {
      btn.textContent = text;
      setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1600);
    };
    const fallback = () => {
      box.focus();
      box.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      show(ok ? 'Copied' : 'Selected. Press Ctrl+C');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(() => show('Copied'), fallback);
    } else {
      fallback();
    }
  }

  function act(action, el) {
    const op = S.opId ? opById(S.opId) : null;
    switch (action) {
      case 'reset':
        S = fresh();
        go('monitor', { text: 'Demo reset.' });
        break;

      case 'go-monitor':
        go('monitor');
        break;

      case 'open':
        S.opId = el.dataset.op;
        go('operator');
        break;

      case 'contacted':
        S.contacted[op.id] = nowMs;
        redraw();
        break;

      case 'reconnect': {
        S.reconnected[op.id] = nowMs;
        S.collisions[op.id] = L.findCollisions(op, NOW);
        const n = S.collisions[op.id].length;
        const how = op.connection.reason === 'RATE_LIMITED' ? 'Syncing recovered' : 'Reconnected';
        go('operator', { text: `${how}. ${n ? `Found ${L.plural(n, 'double-booking')}.` : 'No double-bookings.'}`, error: n > 0 });
        break;
      }

      case 'told': {
        const id = el.dataset.col;
        S.clash[id] = { status: 'told', note: '' };
        redraw(`note-${safeId(id)}`);
        break;
      }

      case 'sorted': {
        const id = el.dataset.col;
        const input = document.getElementById(`note-${safeId(id)}`);
        const note = String(input ? input.value : S.notes[id] || '').replace(/\s+/g, ' ').trim();
        S.clash[id] = { status: 'sorted', note };
        const next = unsorted(op)[0];
        redraw(next ? `clash-title-${safeId(next.id)}` : `close-title-${safeId(op.id)}`);
        break;
      }

      case 'copy':
        copyFrom(el.dataset.target, el);
        break;

      case 'close-ticket':
        S.closed[op.id] = nowMs;
        go('monitor', { text: `Ticket closed for ${op.name}.` });
        break;

      default:
        break;
    }
  }

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    if (el.tagName === 'A') ev.preventDefault();
    if (el.disabled) return;
    act(el.dataset.action, el);
  });

  app.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!el.dataset) return;
    if (el.dataset.edit) S.edits[el.id] = el.value;
    if (el.dataset.note) S.notes[el.dataset.note] = el.value;
  });

  // Enter in the "what did he decide" box marks it sorted.
  app.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key === 'Enter' && el.dataset && el.dataset.note) {
      ev.preventDefault();
      const btn = app.querySelector(`[data-action="sorted"][data-col="${CSS.escape(el.dataset.note)}"]`);
      if (btn) btn.click();
    }
  });

  render();
})();
