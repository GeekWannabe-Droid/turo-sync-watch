/*
  Tests for the rules in logic.js, run against the sample data in data.js.
  Run with:  node --test tests/logic.test.js     (Node 18 or newer, nothing to install)

  The expected numbers below were worked out by hand from data.js first,
  then checked against the code.
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');
const { DEMO_NOW: NOW, operators, AGENT_NAME } = require('../data.js');

const op = (id) => operators.find((o) => o.id === id);
const down = operators.filter((o) => L.isDown(o));

// Resolve a collision the way the screens do: recommended pick, then record the move.
function resolveAll(o) {
  const moves = [];
  const outcomes = [];
  for (const col of L.findCollisions(o, NOW)) {
    const keeper = L.decideKeeper(col, NOW);
    const opts = L.replacementOptions(o, col, keeper.move, moves);
    const rec = L.recommend(opts);
    const choice = L.choiceFor(opts, rec.carId || 'refund');
    moves.push({ bookingId: keeper.move.id, toCarId: rec.carId, start: keeper.move.start, end: keeper.move.end, renter: keeper.move.renter, source: 'moved' });
    outcomes.push({ col, keeper, kind: choice.kind, toCar: choice.car });
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// The data itself has to be believable
// ---------------------------------------------------------------------------

test('no platform double-books itself: Turo vs Turo and site vs site never overlap', () => {
  for (const o of operators) {
    for (const car of o.cars) {
      for (const source of ['turo', 'direct']) {
        const list = o.bookings.filter((b) => b.carId === car.id && b.source === source);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            assert.equal(L.overlaps(list[i], list[j]), false, `${o.id}: ${list[i].id} vs ${list[j].id}`);
          }
        }
      }
    }
  }
});

test('every double-booking was made entirely after the connection broke', () => {
  // Anything synced before the break stays blocked, so a clash needs BOTH
  // bookings to have been made after the break.
  for (const o of down) {
    for (const col of L.findCollisions(o, NOW)) {
      assert.ok(L.ms(col.turo.createdAt) > L.brokeAt(o), `${col.id}: Turo booking predates the break`);
      assert.ok(L.ms(col.direct.createdAt) > L.brokeAt(o), `${col.id}: site booking predates the break`);
    }
  }
});

test('every booking points at a car that exists, and ends after it starts', () => {
  for (const o of operators) {
    for (const b of o.bookings) {
      assert.ok(L.carById(o, b.carId), `${b.id} has unknown car ${b.carId}`);
      assert.ok(L.ms(b.end) > L.ms(b.start), `${b.id} ends before it starts`);
    }
  }
});

// ---------------------------------------------------------------------------
// While disconnected
// ---------------------------------------------------------------------------

test('Harbor Drive: 12 site bookings taken blind, first pickup in 2 days', () => {
  const blind = L.takenBlind(op('harbor-drive'), NOW);
  assert.equal(blind.length, 12);
  assert.equal(blind[0].id, 'hd-d4');
  assert.equal(L.fmtUntil(blind[0].start, NOW), 'in 2 days');
});

test('Harbor Drive: 9 Turo bookings hidden until reconnect', () => {
  assert.equal(L.hiddenTuro(op('harbor-drive')).length, 9);
});

test('while disconnected, hidden Turo bookings are not visible; after reconnect they are', () => {
  const o = op('harbor-drive');
  assert.equal(L.visibleBookings(o, false).length, o.bookings.length - 9);
  assert.equal(L.visibleBookings(o, true).length, o.bookings.length);
});

test('blind counts for every operator', () => {
  const expected = { 'harbor-drive': 12, peachtree: 3, 'desert-mile': 0, northline: 1, 'blue-key': 1, lakeside: 0, 'cedar-lane': 0 };
  for (const [id, n] of Object.entries(expected)) assert.equal(L.takenBlind(op(id), NOW).length, n, id);
});

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

test('escalation tiers', () => {
  assert.equal(L.escalation(op('harbor-drive'), NOW).tier, 1); // 12 blind, first pickup in 2 days
  assert.equal(L.escalation(op('peachtree'), NOW).tier, 2); // first pickup in 11 days, repeat
  assert.equal(L.escalation(op('northline'), NOW).tier, 2); // access removed: ask first
  assert.equal(L.escalation(op('desert-mile'), NOW).tier, 3); // 40 min, nothing taken
  assert.equal(L.escalation(op('blue-key'), NOW).tier, 'internal'); // Turo limiting 1Now
  assert.equal(L.escalation(op('lakeside'), NOW), null); // healthy
});

test('escalation reasons say why', () => {
  const r = L.escalation(op('harbor-drive'), NOW).reasons;
  assert.deepEqual(r, ['12 bookings taken on the site with no Turo check', 'First pickup in 2 days', 'Down for 9 days']);
  assert.match(L.escalation(op('desert-mile'), NOW).reasons[0], /Caught 40 min after it broke/);
  assert.match(L.escalation(op('blue-key'), NOW).action, /Escalate to engineering at Mon 28 Sep, 12:10/);
});

test('repeat flag: Peachtree has 3 breaks in 60 days, Desert Mile only 1 (July is too old)', () => {
  assert.equal(L.breaksLast60(op('peachtree'), NOW), 3);
  assert.equal(L.isRepeat(op('peachtree'), NOW), true);
  assert.equal(L.breaksLast60(op('desert-mile'), NOW), 1);
  assert.equal(L.isRepeat(op('desert-mile'), NOW), false);
});

// ---------------------------------------------------------------------------
// After reconnect
// ---------------------------------------------------------------------------

test('Harbor Drive: exactly 2 double-bookings, Civic first', () => {
  const cols = L.findCollisions(op('harbor-drive'), NOW);
  assert.deepEqual(cols.map((c) => c.id), ['hd-t1~hd-d1', 'hd-t2~hd-d2']);
  assert.equal(L.fmtWhen(cols[0].clashStart), 'Fri 2 Oct, 14:00');
  assert.equal(L.fmtUntil(cols[0].clashStart, NOW), 'in 4 days');
  assert.equal(L.fmtWhen(cols[1].clashStart), 'Sat 17 Oct, 09:00');
  const res = L.checkResults(op('harbor-drive'), NOW);
  assert.equal(res.clear.length, 10);
  assert.equal(res.clashing.length, 2);
});

test('double-booking counts for every operator', () => {
  const expected = { 'harbor-drive': 2, peachtree: 1, 'desert-mile': 0, northline: 0, 'blue-key': 0 };
  for (const [id, n] of Object.entries(expected)) assert.equal(L.findCollisions(op(id), NOW).length, n, id);
});

test('trips that touch end-to-start are not a clash', () => {
  const a = { start: '2026-10-01T10:00', end: '2026-10-03T10:00' };
  const b = { start: '2026-10-03T10:00', end: '2026-10-05T10:00' };
  assert.equal(L.overlaps(a, b), false);
  assert.equal(L.overlaps(a, { start: '2026-10-03T09:59', end: '2026-10-04T10:00' }), true);
});

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

test('Civic: Turo renter keeps it, Elantra offered, booked cars skipped', () => {
  const o = op('harbor-drive');
  const col = L.findCollisions(o, NOW)[0];
  const k = L.decideKeeper(col, NOW);
  assert.equal(k.keep.renter, 'Marcus T.');
  assert.equal(k.move.renter, 'Priya Shah');
  const opts = L.replacementOptions(o, col, k.move, []);
  const free = opts.filter((x) => x.free).map((x) => x.car.id);
  assert.deepEqual(free, ['elantra', 'altima']);
  assert.deepEqual(L.recommend(opts), { kind: 'swap', carId: 'elantra' });
  const corolla = opts.find((x) => x.car.id === 'corolla');
  assert.equal(corolla.blockedBy.id, 'hd-p1'); // Grant W. on Turo
});

test('Corolla: no compact free, RAV4 offered as a free upgrade', () => {
  const o = op('harbor-drive');
  const col = L.findCollisions(o, NOW)[1];
  const k = L.decideKeeper(col, NOW);
  assert.equal(k.keep.renter, 'Elena V.');
  assert.equal(k.move.renter, 'Jordan Blake');
  const opts = L.replacementOptions(o, col, k.move, []);
  assert.deepEqual(opts.filter((x) => x.free).map((x) => x.car.id), ['rav4']);
  assert.deepEqual(L.recommend(opts), { kind: 'upgrade', carId: 'rav4' });
});

test('Peachtree Forte: every other car booked, so refund', () => {
  const o = op('peachtree');
  const col = L.findCollisions(o, NOW)[0];
  const k = L.decideKeeper(col, NOW);
  assert.equal(k.keep.renter, 'Jake R.');
  const opts = L.replacementOptions(o, col, k.move, []);
  assert.equal(opts.filter((x) => x.free).length, 0);
  assert.deepEqual(L.recommend(opts), { kind: 'refund', carId: null });
  const choice = L.choiceFor(opts, 'refund');
  assert.equal(choice.why, 'none-free');
  assert.match(L.renterMessage(o, col, k, choice), /Every other car we have is booked for your dates/);
});

test('a car already held for one renter is not offered to another', () => {
  const o = {
    cars: [{ id: 'a', name: 'Car A', cls: 'compact' }, { id: 'b', name: 'Car B', cls: 'compact' }],
    bookings: [
      { id: 't1', carId: 'a', source: 'turo', renter: 'T', start: '2026-10-02T10:00', end: '2026-10-05T10:00', createdAt: '2026-09-25T10:00' },
      { id: 'd1', carId: 'a', source: 'direct', renter: 'D One', start: '2026-10-03T10:00', end: '2026-10-04T10:00', createdAt: '2026-09-25T11:00' },
    ],
  };
  const col = { id: 'x', carId: 'a', turo: o.bookings[0], direct: o.bookings[1] };
  const hold = [{ bookingId: 'other', toCarId: 'b', start: '2026-10-03T12:00', end: '2026-10-05T12:00', renter: 'Someone', source: 'moved' }];
  const opts = L.replacementOptions(o, col, o.bookings[1], hold);
  assert.equal(opts[0].free, false);
  assert.equal(opts[0].blockedBy.renter, 'Someone');
});

test('a booking moved off a car frees that car for someone else', () => {
  const o = {
    cars: [{ id: 'a', name: 'Car A', cls: 'compact' }, { id: 'b', name: 'Car B', cls: 'compact' }],
    bookings: [
      { id: 't1', carId: 'a', source: 'turo', renter: 'T', start: '2026-10-02T10:00', end: '2026-10-05T10:00', createdAt: '2026-09-25T10:00' },
      { id: 'd1', carId: 'a', source: 'direct', renter: 'D One', start: '2026-10-03T10:00', end: '2026-10-04T10:00', createdAt: '2026-09-25T11:00' },
      { id: 'd2', carId: 'b', source: 'direct', renter: 'D Two', start: '2026-10-03T10:00', end: '2026-10-04T10:00', createdAt: '2026-09-25T12:00' },
    ],
  };
  const col = { id: 'x', carId: 'a', turo: o.bookings[0], direct: o.bookings[1] };
  assert.equal(L.replacementOptions(o, col, o.bookings[1], [])[0].free, false);
  const moved = [{ bookingId: 'd2', toCarId: null, start: '2026-10-03T10:00', end: '2026-10-04T10:00', renter: 'D Two', source: 'moved' }];
  assert.equal(L.replacementOptions(o, col, o.bookings[1], moved)[0].free, true);
});

test('if the site renter is already driving the car, they keep it and the Turo trip moves', () => {
  const col = {
    turo: { id: 't', renter: 'Tess R.', start: '2026-09-28T12:00', end: '2026-10-01T12:00' },
    direct: { id: 'd', renter: 'Dan Cole', start: '2026-09-27T10:00', end: '2026-09-29T10:00' },
  };
  const k = L.decideKeeper(col, NOW);
  assert.equal(k.keep.id, 'd');
  assert.equal(k.moveSource, 'turo');
});

test('refund wording never claims every car is booked when one is free', () => {
  const o = op('harbor-drive');
  const col = L.findCollisions(o, NOW)[0];
  const k = L.decideKeeper(col, NOW);
  const opts = L.replacementOptions(o, col, k.move, []);
  const choice = L.choiceFor(opts, 'refund'); // agent chose refund although Elantra is free
  assert.equal(choice.why, 'chosen');
  const msg = L.renterMessage(o, col, k, choice);
  assert.doesNotMatch(msg, /Every other car/);
  assert.match(msg, /We're cancelling this booking and refunding you in full/);
});

// ---------------------------------------------------------------------------
// Messages and summary
// ---------------------------------------------------------------------------

test('messages use real names and never print undefined or NaN', () => {
  for (const o of down) {
    const rm = L.reconnectMessage(o, NOW);
    if (rm !== null) assert.doesNotMatch(rm, /undefined|NaN|null/);
    for (const out of resolveAll(o)) {
      const opts = L.replacementOptions(o, out.col, out.keeper.move, []);
      const choice = L.choiceFor(opts, out.toCar ? out.toCar.id : 'refund');
      const msg = L.renterMessage(o, out.col, out.keeper, choice);
      assert.doesNotMatch(msg, /undefined|NaN|null/);
      assert.match(msg, new RegExp(`Hi ${L.firstName(out.keeper.move.renter)},`));
    }
  }
  assert.equal(L.reconnectMessage(op('blue-key'), NOW), null); // internal, no operator message
});

test('Civic message offers the Elantra at the same price', () => {
  const o = op('harbor-drive');
  const col = L.findCollisions(o, NOW)[0];
  const k = L.decideKeeper(col, NOW);
  const opts = L.replacementOptions(o, col, k.move, []);
  const msg = L.renterMessage(o, col, k, L.choiceFor(opts, 'elantra'));
  assert.match(msg, /^Hi Priya,/);
  assert.match(msg, /Honda Civic for Fri 2 – Sun 4 Oct/);
  assert.match(msg, /Hyundai Elantra free for you instead\. Same size, same dates, same price\./);
});

test('Peachtree reconnect message mentions the repeat', () => {
  assert.match(L.reconnectMessage(op('peachtree'), NOW), /This is the 3rd time in 60 days/);
});

test('Harbor Drive summary adds up', () => {
  const o = op('harbor-drive');
  const text = L.ticketSummary(o, NOW, L.ms(NOW), resolveAll(o), AGENT_NAME);
  assert.match(text, /stopped on Sat 19 Sep at 08:12 because the Turo sign-in expired/);
  assert.match(text, /How long: 9 days\. In that time 12 bookings came in on your site and 9 came in on Turo/);
  assert.match(text, /2 cars were double-booked/);
  assert.match(text, /- Honda Civic, Fri 2 – Sun 4 Oct: Marcus T\. \(Turo\) keeps it\. Priya Shah moves to the Hyundai Elantra\./);
  assert.match(text, /- Toyota Corolla, Sat 17 – Mon 19 Oct: Elena V\. \(Turo\) keeps it\. Jordan Blake moves to the Toyota RAV4 at no extra cost\./);
  assert.match(text, /The other 10 bookings are fine\./);
  assert.match(text, /All 8 cars are syncing again/);
  assert.doesNotMatch(text, /undefined|NaN|null/);
});

test('summaries for the quiet cases', () => {
  const dm = L.ticketSummary(op('desert-mile'), NOW, L.ms(NOW), [], AGENT_NAME);
  assert.match(dm, /No bookings came in on your site while it was down/);
  const nl = L.ticketSummary(op('northline'), NOW, L.ms(NOW), [], AGENT_NAME);
  assert.match(nl, /The booking taken while it was down checked out fine/);
  const bk = L.ticketSummary(op('blue-key'), NOW, L.ms(NOW), [], AGENT_NAME);
  assert.match(bk, /That was on our side, not yours/);
  assert.match(bk, /Syncing recovered/);
  const pt = L.ticketSummary(op('peachtree'), NOW, L.ms(NOW), resolveAll(op('peachtree')), AGENT_NAME);
  assert.match(pt, /Ella Jensen is refunded/);
  assert.match(pt, /3rd time in 60 days/);
});

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

test('times read the same in any time zone', () => {
  assert.equal(L.fmtWhen(NOW), 'Mon 28 Sep, 09:00');
  assert.equal(L.fmtDays('2026-09-30T09:00', '2026-10-03T09:00'), 'Wed 30 Sep – Sat 3 Oct');
  assert.equal(L.fmtLength(40 * L.MIN), '40 min');
  assert.equal(L.fmtLength(2 * L.HOUR + 50 * L.MIN), '2 hr 50 min');
  assert.equal(L.fmtLength(25 * L.HOUR + 55 * L.MIN), '25 hours');
  assert.equal(L.fmtLength(9 * L.DAY + 48 * L.MIN), '9 days');
});
