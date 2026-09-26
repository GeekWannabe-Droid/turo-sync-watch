/*
  Turo Sync Watch: the screens.
  Rules live in logic.js and sample data in data.js. This file only draws
  screens and reacts to clicks. Nothing is saved: Reset demo starts over.
*/
(function () {
  'use strict';

  const L = window.SyncLogic;
  const D = window.SYNC_DATA;
  const NOW = D.DEMO_NOW;
  const app = document.getElementById('app');

  const fresh = () => ({
    view: 'monitor',
    opId: null,
    colId: null,
    flash: null,
    contacted: {}, // opId -> time
    reconnected: {}, // opId -> time
    collisions: {}, // opId -> collisions found at reconnect
    moves: {}, // collisionId -> decision { bookingId, toCarId, kind, ... }
    picks: {}, // collisionId -> car id or 'refund'
    drafts: {}, // collisionId -> edited message text
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
  const openCollisions = (op) => collisionsOf(op).filter((c) => !S.moves[c.id]);
  const movesOf = (op) => collisionsOf(op).map((c) => S.moves[c.id]).filter(Boolean);
  const otherMoves = (op, col) => movesOf(op).filter((m) => m.colId !== col.id);

  function stateOf(op) {
    if (!L.isDown(op)) return 'healthy';
    if (S.closed[op.id]) return 'closed';
    if (S.reconnected[op.id]) return openCollisions(op).length ? 'resolving' : 'ready';
    return 'down';
  }

  function srcTag(source) {
    return source === 'turo' ? '<span class="src src-turo">Turo</span>' : '<span class="src src-site">Site</span>';
  }

  function blockedText(b) {
    if (!b) return '';
    if (b.source === 'moved') return `Held for ${b.renter}`;
    return b.source === 'turo' ? `Booked on Turo (${b.renter})` : `Booked on the site (${b.renter})`;
  }

  function optionsFor(op, col) {
    const k = L.decideKeeper(col, NOW);
    const opts = L.replacementOptions(op, col, k.move, otherMoves(op, col));
    return { k, opts, rec: L.recommend(opts) };
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
          <span class="clock" title="The demo runs on a fixed clock so it behaves the same every time.">Demo clock <b>${esc(L.fmtWhen(NOW))}</b></span>
          <button type="button" class="btn btn-quiet btn-small" data-action="reset">Reset demo</button>
        </div>
      </header>`;
  }

  const STEPS = [
    ['monitor', 'Monitor'],
    ['operator', 'Operator'],
    ['check', 'Check after reconnect'],
    ['resolve', 'Resolve'],
    ['close', 'Close'],
  ];

  function stepsNav() {
    const idx = STEPS.findIndex((s) => s[0] === S.view);
    const items = STEPS.map((s, i) => {
      const cls = i === idx ? 'is-current' : i < idx ? 'is-done' : '';
      return `<li class="${cls}"${i === idx ? ' aria-current="step"' : ''}><span class="step-n">${i + 1}</span>${esc(s[1])}</li>`;
    }).join('');
    return `<nav class="steps" aria-label="Where you are in the flow"><ol>${items}</ol></nav>`;
  }

  function footer() {
    return `<footer class="footer">All operators, renters and bookings are made up. The rules are in logic.js and tested in tests/logic.test.js.</footer>`;
  }

  function flashLine() {
    if (!S.flash) return '';
    return `<p class="flash${S.flash.error ? ' is-error' : ''}" role="status">${esc(S.flash.text)}</p>`;
  }

  function render() {
    let body;
    try {
      const op = S.opId ? opById(S.opId) : null;
      if (S.view === 'operator' && op) body = viewOperator(op);
      else if (S.view === 'check' && op) body = viewCheck(op);
      else if (S.view === 'resolve' && op) body = viewResolve(op, collisionsOf(op).find((c) => c.id === S.colId));
      else if (S.view === 'close' && op) body = viewClose(op);
      else {
        S.view = 'monitor';
        body = viewMonitor();
      }
    } catch (err) {
      console.error(err);
      body = `<section class="panel"><h2>This screen failed to draw</h2><p>${esc(err.message)}</p><div class="actions"><button type="button" class="btn" data-action="reset">Reset demo</button></div></section>`;
    }
    app.innerHTML = header() + stepsNav() + `<main class="view">${flashLine()}${body}</main>` + footer();
  }

  function go(view, flash) {
    S.view = view;
    S.flash = flash || null;
    render();
    window.scrollTo(0, 0);
    const h = app.querySelector('h1');
    if (h) h.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // 1. Monitor
  // ---------------------------------------------------------------------------

  function priority(op) {
    const st = stateOf(op);
    const far = Number.MAX_SAFE_INTEGER;
    if (st === 'healthy') return [9, 0];
    if (st === 'closed') return [8, 0];
    if (st === 'ready') return [5, 0];
    if (st === 'resolving') return [1, openCollisions(op)[0].clashStart];
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
    const open = ops.reduce((n, o) => n + (S.reconnected[o.id] ? openCollisions(o).length : 0), 0);
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
        ${stat(open, 'double-bookings to resolve', open ? 'crit' : 'muted')}
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
      const n = openCollisions(op).length;
      const status = st === 'resolving'
        ? `<span class="pill pill-warn">Reconnected</span><div class="sub">${L.plural(n, 'double-booking')} open</div>`
        : '<span class="pill pill-info">Reconnected</span><div class="sub">All clear</div>';
      const next = st === 'resolving'
        ? '<span class="pill pill-crit">Resolve double-bookings</span>'
        : '<span class="pill pill-info">Send summary and close</span>';
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
  // 2. Operator (still disconnected)
  // ---------------------------------------------------------------------------

  function viewOperator(op) {
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
      <a href="#" class="back" data-action="go" data-view="monitor">← All operators</a>
      <section class="page-head">
        <h1 tabindex="-1">${esc(op.name)}</h1>
        <p class="lede">${esc(op.city)} · ${L.fleetSize(op)} cars · owner ${esc(op.owner.name)}, <span class="mono select">${esc(op.owner.phone)}</span></p>
      </section>

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
    const msg = L.reconnectMessage(op, NOW);
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
        <textarea id="${id}" class="message" rows="8">${esc(msg)}</textarea>
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

  // ---------------------------------------------------------------------------
  // 3. Check after reconnect
  // ---------------------------------------------------------------------------

  function viewCheck(op) {
    const res = L.checkResults(op, NOW);
    const cols = collisionsOf(op);
    const open = openCollisions(op);
    const at = S.reconnected[op.id];
    const internal = op.connection.reason === 'RATE_LIMITED';
    const n = res.checked.length;
    const bad = res.clashing.length;

    let summary;
    let sev = 'ok';
    if (n === 0) summary = 'No bookings were taken on the site while the connection was down, so there is nothing to check.';
    else if (!bad) summary = n === 1 ? '1 booking checked. It is fine.' : `${n} bookings checked. All of them are fine.`;
    else {
      sev = open.length ? 'crit' : 'ok';
      summary = `${n} bookings checked. ${n - bad} ${n - bad === 1 ? 'is' : 'are'} fine. ${bad} ${bad === 1 ? 'is' : 'are'} double-booked${open.length ? '' : ', and all are resolved'}.`;
    }

    const pulled = res.pulled.length;
    const clearN = res.clear.length;
    const syncLines = [
      `${L.plural(pulled, 'Turo booking')} made while disconnected ${pulled === 1 ? 'now blocks its dates' : 'now block their dates'} on the operator's site.`,
      `${L.plural(clearN, 'site booking')} taken while disconnected ${clearN === 1 ? 'now blocks its dates' : 'now block their dates'} on Turo.`,
    ];
    if (cols.length) {
      syncLines.push(open.length
        ? `${L.plural(open.length, 'double-booking')} ${open.length === 1 ? 'waits' : 'wait'} for a decision below.`
        : 'Every double-booking has a decision.');
    }

    const checkedRows = res.checked.map((b) => {
      const clash = cols.find((c) => c.direct.id === b.id);
      const verdict = clash
        ? (S.moves[clash.id] ? '<span class="chip chip-ok">Double-booked, resolved</span>' : '<span class="chip chip-crit">Double-booked</span>')
        : '<span class="chip">Fine</span>';
      return `<tr><td>${verdict}</td><td>${esc(L.carById(op, b.carId).name)}</td><td>${esc(b.renter)}</td><td class="mono">${esc(L.fmtTrip(b))}</td></tr>`;
    }).join('');

    return `
      <a href="#" class="back" data-action="go" data-view="monitor">← All operators</a>
      <section class="page-head">
        <h1 tabindex="-1">Check after reconnect</h1>
        <p class="lede">${esc(op.name)}. ${internal ? 'Syncing recovered' : 'The operator reconnected'} at <span class="mono">${esc(L.fmtWhen(at))}</span>. 1Now pulled ${L.plural(pulled, 'Turo booking')} it had missed and compared both calendars for all ${L.fleetSize(op)} cars.</p>
      </section>

      <p class="result sev-${sev}">${esc(summary)}</p>

      ${cols.length ? `<section class="page-head"><h2>Double-bookings, soonest first</h2></section>
      <div class="clashes">${cols.map((c) => clashCard(op, c)).join('')}</div>` : ''}

      <section class="panel">
        <div class="panel-head"><h2>Both calendars, side by side</h2><span class="dim hover-hint">Hover a bar for details</span></div>
        <div class="legend">
          <span><i class="sw sw-turo"></i>Turo</span>
          <span><i class="sw sw-site"></i>Operator's site</span>
          <span><i class="sw sw-blind"></i>Booked while disconnected</span>
          <span><i class="sw sw-clash"></i>Double-booked</span>
          ${movesOf(op).some((m) => m.toCarId) ? '<span><i class="sw sw-moved"></i>Moved here</span>' : ''}
          <span><i class="sw-now"></i>Now (demo clock)</span>
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

      <div class="actions end">
        ${open.length ? `<span class="demo-note">Resolve ${open.length === 1 ? 'the double-booking' : open.length === 2 ? 'both double-bookings' : `all ${open.length} double-bookings`} first.</span>` : ''}
        <button type="button" class="btn btn-primary" data-action="go" data-view="close"${open.length ? ' disabled' : ''}>Write the summary and close</button>
      </div>`;
  }

  function clashCard(op, c) {
    const car = L.carById(op, c.carId);
    const mv = S.moves[c.id];
    let done = '';
    if (mv) {
      done = mv.toCarId
        ? `${mv.renter} moves to the ${L.carById(op, mv.toCarId).name}.`
        : `${mv.renter} is refunded.`;
    }
    return `
      <article class="clash${mv ? '' : ' is-open'}">
        <header><h3>${esc(car.name)}</h3><span class="pill ${mv ? 'pill-ok' : 'pill-crit'}">${mv ? 'Resolved' : 'Open'}</span></header>
        <p>Clash starts <b>${esc(L.fmtWhen(c.clashStart))}</b> <span class="dim">(${esc(L.fmtUntil(c.clashStart, NOW))})</span></p>
        <dl class="pair">
          <div><dt>${srcTag('turo')}</dt><dd>${esc(c.turo.renter)}<span class="mono">${esc(L.fmtTrip(c.turo))}</span></dd></div>
          <div><dt>${srcTag('direct')}</dt><dd>${esc(c.direct.renter)}<span class="mono">${esc(L.fmtTrip(c.direct))}</span></dd></div>
        </dl>
        ${mv
          ? `<p class="done-note">${esc(done)} Message sent.</p>`
          : `<button type="button" class="btn btn-primary" data-action="resolve" data-col="${esc(c.id)}">Resolve</button>`}
      </article>`;
  }

  function timeline(op) {
    const cols = collisionsOf(op);
    const moves = movesOf(op);
    const movedIds = new Set(moves.map((m) => m.bookingId));
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

    const bar = (b, source, moved) => {
      const s = L.ms(b.start);
      const e = L.ms(b.end);
      if (e <= startDay || s >= endDay) return '';
      const left = pct(s);
      const width = Math.max(pct(e) - left, 0.8);
      const blind = L.ms(b.createdAt) > cutoff;
      const title = `${source === 'turo' ? 'Turo' : 'Site'} · ${b.renter} · ${L.fmtTrip(b)} · booked ${L.fmtWhen(b.createdAt)}${blind ? ' (while disconnected)' : ''}${moved ? ' · moved here' : ''}`;
      const cls = `bar bar-${source === 'turo' ? 'turo' : 'site'}${blind ? ' is-blind' : ''}${moved ? ' is-moved' : ''}`;
      return `<div class="${cls}" style="left:${left}%;width:${width}%" title="${esc(title)}">${esc(b.renter)}</div>`;
    };

    const nowLeft = pct(nowMs);
    const rows = op.cars.map((car) => {
      const onCar = op.bookings.filter((b) => b.carId === car.id && !movedIds.has(b.id));
      const movedHere = moves
        .filter((m) => m.toCarId === car.id)
        .map((m) => L.bookingById(op, m.bookingId))
        .filter(Boolean);
      const carCols = cols.filter((c) => c.carId === car.id);
      const openCols = carCols.filter((c) => !S.moves[c.id]);
      const zones = openCols.map((c) => {
        const l = pct(c.clashStart);
        return `<div class="clash-zone" style="left:${l}%;width:${Math.max(pct(c.clashEnd) - l, 0.8)}%" title="Double-booked ${esc(L.fmtWhen(c.clashStart))} → ${esc(L.fmtWhen(c.clashEnd))}"></div>`;
      }).join('');
      let flag = '<span class="chip">Clear</span>';
      if (openCols.length) flag = '<span class="chip chip-crit">Double-booked</span>';
      else if (carCols.length) flag = '<span class="chip chip-ok">Resolved</span>';

      const turo = onCar.filter((b) => b.source === 'turo').map((b) => bar(b, 'turo')).join('')
        + movedHere.filter((b) => b.source === 'turo').map((b) => bar(b, 'turo', true)).join('');
      const site = onCar.filter((b) => b.source === 'direct').map((b) => bar(b, 'direct')).join('')
        + movedHere.filter((b) => b.source === 'direct').map((b) => bar(b, 'direct', true)).join('');

      return `<div class="tl-row">
        <div class="tl-label"><b>${esc(car.name)}</b><span class="cls">${esc(L.CLASS_LABEL[car.cls])}</span>${flag}</div>
        <div class="tl-track" style="--days:${days}">
          <div class="lane lane-turo">${turo}</div>
          <div class="lane lane-site">${site}</div>
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
  // 4. Resolve one double-booking
  // ---------------------------------------------------------------------------

  function viewResolve(op, c) {
    if (!c) return viewCheck(op);
    const car = L.carById(op, c.carId);
    const { k, opts, rec } = optionsFor(op, c);
    const pick = S.picks[c.id];
    const isKeep = (b) => b.id === k.keep.id;

    const bcard = (b) => {
      const keep = isKeep(b);
      const where = b.source === 'turo' ? 'Booked on Turo' : 'Booked on the site';
      return `<div class="bcard ${keep ? 'is-keep' : 'is-move'}">
        <div class="top">${srcTag(b.source)}<span class="pill ${keep ? 'pill-ok' : 'pill-warn'}">${keep ? 'Keeps the car' : 'Needs a new car'}</span></div>
        <div class="who">${esc(b.renter)}</div>
        <div class="mono">${esc(L.fmtTrip(b))}</div>
        <div class="meta">${where} ${esc(L.fmtWhen(b.createdAt))}</div>
      </div>`;
    };

    const optRows = opts.map((o) => optionRow(c, o, rec, pick)).join('');
    const refundId = `opt-${safeId(c.id)}-refund`;
    const refundRow = `<label class="opt opt-refund${pick === 'refund' ? ' is-picked' : ''}" for="${refundId}">
      <input type="radio" name="pick-${safeId(c.id)}" id="${refundId}" value="refund" data-action="pick" data-col="${esc(c.id)}"${pick === 'refund' ? ' checked' : ''}>
      <span class="opt-main"><b>Cancel and refund</b><span class="opt-sub">${rec.kind === 'refund' ? 'No car the same size or bigger is free for these dates' : `Use this if ${esc(L.firstName(k.move.renter))} says no to a new car`}</span></span>
      ${rec.kind === 'refund' ? '<span class="chip chip-accent">Recommended</span>' : ''}
    </label>`;

    return `
      <a href="#" class="back" data-action="go" data-view="check">← Check results</a>
      <section class="page-head">
        <h1 tabindex="-1">Double-booking: ${esc(car.name)}</h1>
        <p class="lede">Both renters expect this car from <b>${esc(L.fmtWhen(c.clashStart))}</b> (${esc(L.fmtUntil(c.clashStart, NOW))}).</p>
      </section>

      <section class="pair-cards">${bcard(c.turo)}${bcard(c.direct)}</section>

      <section class="panel">
        <h2>Who keeps the car</h2>
        <p><b>${esc(k.keep.renter)}</b> keeps the ${esc(car.name)}. <b>${esc(k.move.renter)}</b> needs a different car.</p>
        <ul class="reasons">${k.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Other cars for ${esc(L.firstName(k.move.renter))}'s dates</h2><span class="mono dim">${esc(L.fmtTrip(k.move))}</span></div>
        <p class="muted">Every other car in the fleet, checked against Turo trips, site bookings and anyone already moved. Same size first, then a bigger car at no extra cost, then a refund.</p>
        <fieldset class="options">
          <legend class="sr-only">Pick what to offer ${esc(k.move.renter)}</legend>
          ${optRows}
          ${refundRow}
        </fieldset>
      </section>

      ${draftBlock(op, c)}`;
  }

  function optionRow(c, o, rec, pick) {
    const id = `opt-${safeId(c.id)}-${safeId(o.car.id)}`;
    const fit = { same: 'Same size', bigger: 'Bigger car', smaller: 'Smaller car' }[o.fit];
    const picked = pick === o.car.id;
    const status = o.free ? '<span class="chip chip-ok">Free</span>' : `<span class="chip">${esc(blockedText(o.blockedBy))}</span>`;
    return `<label class="opt${o.free ? '' : ' is-blocked'}${picked ? ' is-picked' : ''}" for="${id}">
      <input type="radio" name="pick-${safeId(c.id)}" id="${id}" value="${esc(o.car.id)}" data-action="pick" data-col="${esc(c.id)}"${o.free ? '' : ' disabled'}${picked ? ' checked' : ''}>
      <span class="opt-main"><b>${esc(o.car.name)}</b><span class="opt-sub">${esc(L.CLASS_LABEL[o.car.cls])} · ${fit}</span></span>
      ${status}${rec.carId === o.car.id ? '<span class="chip chip-accent">Recommended</span>' : ''}
    </label>`;
  }

  function draftBlock(op, c) {
    const { k, opts } = optionsFor(op, c);
    const choice = L.choiceFor(opts, S.picks[c.id]);
    const edited = typeof S.drafts[c.id] === 'string';
    const msg = edited ? S.drafts[c.id] : L.renterMessage(op, c, k, choice);
    const id = `draft-${safeId(c.id)}`;
    const via = k.moveSource === 'turo' ? 'Send in Turo messages.' : 'Send by text or email from 1Now.';
    const steps = L.operatorSteps(op, c, k, choice);
    return `
      <section class="panel" id="draft-block">
        <h2>Message to ${esc(k.move.renter)}</h2>
        <p class="muted">${via} ${edited ? 'You edited this draft. Picking another option replaces your edits.' : 'Picking another option above rewrites it.'}</p>
        <label class="sr-only" for="${id}">Message to ${esc(k.move.renter)}</label>
        <textarea id="${id}" class="message" rows="13" data-kind="draft" data-col="${esc(c.id)}">${esc(msg)}</textarea>
        <p class="note-keep"><b>${esc(k.keep.renter)}</b> gets no message. Their trip doesn't change, so contacting them would only worry them.</p>
        <h3>What the operator does next</h3>
        <ol class="todo">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="actions">
          <button type="button" class="btn" data-action="copy" data-target="${id}">Copy message</button>
          <button type="button" class="btn btn-primary" data-action="confirm" data-col="${esc(c.id)}">Mark as sent and resolve</button>
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // 5. Close
  // ---------------------------------------------------------------------------

  function viewClose(op) {
    const open = openCollisions(op);
    if (open.length) {
      return `
        <a href="#" class="back" data-action="go" data-view="check">← Check results</a>
        <section class="page-head"><h1 tabindex="-1">Not ready to close</h1>
        <p class="lede">${esc(op.name)} still has ${L.plural(open.length, 'open double-booking')}. Resolve ${open.length === 1 ? 'it' : 'them'} first.</p></section>`;
    }
    const outcomes = collisionsOf(op).map((c) => {
      const mv = S.moves[c.id];
      return { col: c, keeper: L.decideKeeper(c, NOW), kind: mv.kind, toCar: mv.toCarId ? L.carById(op, mv.toCarId) : null };
    });
    const text = L.ticketSummary(op, NOW, S.reconnected[op.id], outcomes, D.AGENT_NAME);
    const id = `summary-${safeId(op.id)}`;
    return `
      <a href="#" class="back" data-action="go" data-view="check">← Check results</a>
      <section class="page-head">
        <h1 tabindex="-1">Close the ticket</h1>
        <p class="lede">${esc(op.name)}. Send this to ${esc(op.owner.name)} so they know what happened, what it hit, and what's fixed.</p>
      </section>
      <section class="panel">
        <label class="field-label" for="${id}">Summary for ${esc(op.owner.first)}</label>
        <textarea id="${id}" class="message summary" rows="18">${esc(text)}</textarea>
        <div class="actions"><button type="button" class="btn" data-action="copy" data-target="${id}">Copy summary</button></div>
      </section>
      <section class="panel internal-note">
        <span class="eyebrow">Internal note · not sent to the operator</span>
        <p>${esc(L.PATCH_NOTE)}</p>
      </section>
      <div class="actions end">
        <button type="button" class="btn btn-primary" data-action="close-ticket">Mark summary sent and close ticket</button>
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

      case 'go':
        go(el.dataset.view);
        break;

      case 'open': {
        S.opId = el.dataset.op;
        const st = stateOf(opById(S.opId));
        go(st === 'down' ? 'operator' : 'check');
        break;
      }

      case 'contacted':
        S.contacted[op.id] = nowMs;
        S.flash = { text: `Marked ${op.owner.name} as contacted.` };
        render();
        break;

      case 'reconnect': {
        S.reconnected[op.id] = nowMs;
        S.collisions[op.id] = L.findCollisions(op, NOW);
        const n = S.collisions[op.id].length;
        const how = op.connection.reason === 'RATE_LIMITED' ? 'Syncing recovered' : 'Reconnected';
        go('check', { text: `${how}. ${n ? `Found ${L.plural(n, 'double-booking')}.` : 'No double-bookings.'}`, error: n > 0 });
        break;
      }

      case 'resolve': {
        const c = collisionsOf(op).find((x) => x.id === el.dataset.col);
        if (!c) return;
        S.colId = c.id;
        if (S.picks[c.id] === undefined) S.picks[c.id] = optionsFor(op, c).rec.carId || 'refund';
        go('resolve');
        break;
      }

      case 'confirm': {
        const c = collisionsOf(op).find((x) => x.id === el.dataset.col);
        if (!c) return;
        const { k, opts } = optionsFor(op, c);
        const choice = L.choiceFor(opts, S.picks[c.id]);
        const toCarId = choice.car ? choice.car.id : null;
        S.moves[c.id] = {
          colId: c.id,
          bookingId: k.move.id,
          toCarId,
          kind: choice.kind,
          start: k.move.start,
          end: k.move.end,
          renter: k.move.renter,
          source: 'moved',
        };
        const text = toCarId
          ? `${k.move.renter} moves to the ${choice.car.name}. Message marked as sent.`
          : `${k.move.renter}'s booking is cancelled and refunded. Message marked as sent.`;
        go('check', { text });
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
    const action = el.dataset.action;
    if (action === 'pick') return; // handled on change
    if (el.tagName === 'A') ev.preventDefault();
    if (el.disabled) return;
    act(action, el);
  });

  app.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!el.dataset || el.dataset.action !== 'pick') return;
    const colId = el.dataset.col;
    S.picks[colId] = el.value;
    delete S.drafts[colId];
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      fieldset.querySelectorAll('.opt').forEach((label) => {
        const input = label.querySelector('input');
        label.classList.toggle('is-picked', !!(input && input.checked));
      });
    }
    const op = opById(S.opId);
    const c = op && collisionsOf(op).find((x) => x.id === colId);
    const block = document.getElementById('draft-block');
    if (c && block) block.outerHTML = draftBlock(op, c);
  });

  app.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.kind === 'draft') S.drafts[el.dataset.col] = el.value;
  });

  render();
})();
