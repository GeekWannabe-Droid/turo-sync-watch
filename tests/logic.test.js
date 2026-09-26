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
const ids = (cars) => cars.map((c) => c.id);

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
// One double-booking: facts for the operator
// ---------------------------------------------------------------------------

test('Civic: Elantra free for Marcus; Elantra and Altima free for Priya', () => {
  const o = op('harbor-drive');
  const f = L.clashFacts(o, L.findCollisions(o, NOW)[0], NOW);
  assert.deepEqual(ids(f.freeTuro), ['elantra']);
  assert.deepEqual(ids(f.freeSite), ['elantra', 'altima']);
  assert.deepEqual(ids(f.shared), ['elantra']);
  assert.equal(f.turoDriving, false);
  assert.equal(f.siteDriving, false);
});

test('Corolla: only the RAV4 is free, for either renter', () => {
  const o = op('harbor-drive');
  const f = L.clashFacts(o, L.findCollisions(o, NOW)[1], NOW);
  assert.deepEqual(ids(f.freeTuro), ['rav4']);
  assert.deepEqual(ids(f.freeSite), ['rav4']);
  assert.deepEqual(ids(f.shared), ['rav4']);
});

test('Peachtree Forte: no other car free for either renter', () => {
  const o = op('peachtree');
  const col = L.findCollisions(o, NOW)[0];
  const f = L.clashFacts(o, col, NOW);
  assert.equal(f.freeTuro.length, 0);
  assert.equal(f.freeSite.length, 0);
  assert.match(L.clashMessage(o, col, NOW), /No other car in your fleet is free for either renter's dates\./);
});

test('the Civic message to the operator, word for word', () => {
  const o = op('harbor-drive');
  const msg = L.clashMessage(o, L.findCollisions(o, NOW)[0], NOW);
  assert.equal(msg, [
    "Hi Luis, now that you've reconnected, we checked every booking from the gap. Your Honda Civic is double-booked:",
    '',
    '- Marcus T. booked it on Turo: Fri 2 Oct 10:00 → Tue 6 Oct 10:00',
    '- Priya Shah booked it on your site: Fri 2 Oct 14:00 → Sun 4 Oct 14:00',
    '',
    'They overlap from Fri 2 Oct, 14:00, which is in 4 days.',
    '',
    "Cars free for Marcus's dates: Hyundai Elantra.",
    "Cars free for Priya's dates: Hyundai Elantra, Nissan Altima.",
    'The Hyundai Elantra can only go to one of them.',
    '',
    "If you cancel the Turo trip, Turo can charge you a fee and adds an automatic review to the car's listing saying you cancelled.",
    '',
    "How do you want to handle it? Tell me what you decide and I'll note it on the ticket. If it helps, I can draft the message to whichever renter you move.",
  ].join('\n'));
});

test('the tool never decides who keeps the car', () => {
  for (const o of down) {
    for (const col of L.findCollisions(o, NOW)) {
      const msg = L.clashMessage(o, col, NOW);
      assert.doesNotMatch(msg, /keeps|keep the car|we've moved|refunded/i);
      assert.match(msg, /How do you want to handle it\?/);
    }
  }
});

test('if a renter already has the car, the message says so', () => {
  const o = {
    owner: { first: 'Sam' },
    connection: { reason: 'SIGNIN_EXPIRED' },
    cars: [{ id: 'a', name: 'Car A', cls: 'compact' }],
    bookings: [],
  };
  const col = {
    carId: 'a',
    turo: { id: 't', renter: 'Tess R.', start: '2026-09-28T12:00', end: '2026-10-01T12:00' },
    direct: { id: 'd', renter: 'Dan Cole', start: '2026-09-27T10:00', end: '2026-09-29T10:00' },
    clashStart: L.ms('2026-09-28T12:00'),
  };
  assert.equal(L.clashFacts(o, col, NOW).siteDriving, true);
  assert.match(L.clashMessage(o, col, NOW), /Dan Cole already has the car\./);
});

// ---------------------------------------------------------------------------
// Messages and summary
// ---------------------------------------------------------------------------

test('messages use real names and never print undefined, NaN or null', () => {
  for (const o of down) {
    const rm = L.reconnectMessage(o, NOW);
    if (rm !== null) assert.doesNotMatch(rm, /undefined|NaN|null/);
    for (const col of L.findCollisions(o, NOW)) {
      assert.doesNotMatch(L.clashMessage(o, col, NOW), /undefined|NaN|null/);
    }
  }
  assert.equal(L.reconnectMessage(op('blue-key'), NOW), null); // internal, no operator message
});

test('Peachtree reconnect message mentions the repeat', () => {
  assert.match(L.reconnectMessage(op('peachtree'), NOW), /This is the 3rd time in 60 days/);
});

test("Harbor Drive summary adds up and records the operator's decisions", () => {
  const o = op('harbor-drive');
  const [civic, corolla] = L.findCollisions(o, NOW);
  const text = L.ticketSummary(o, NOW, L.ms(NOW), [
    { col: civic, note: '  Gave Priya the Nissan Altima  ' },
    { col: corolla, note: '' },
  ], AGENT_NAME);
  assert.match(text, /stopped on Sat 19 Sep at 08:12 because the Turo sign-in expired/);
  assert.match(text, /How long: 9 days\. In that time 12 bookings came in on your site and 9 came in on Turo/);
  assert.match(text, /What it hit: 2 cars were double-booked, and you sorted both\./);
  assert.match(text, /- Honda Civic: Marcus T\. \(Turo\) and Priya Shah \(your site\) from Fri 2 Oct, 14:00\. What you did: Gave Priya the Nissan Altima\./);
  assert.match(text, /- Toyota Corolla: Elena V\. \(Turo\) and Jordan Blake \(your site\) from Sat 17 Oct, 09:00\. Sorted by you\./);
  assert.match(text, /The other 10 bookings are fine\./);
  assert.match(text, /All 8 cars are syncing again/);
  assert.match(text, /Zahid, 1Now Support$/);
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
  const pt = L.ticketSummary(op('peachtree'), NOW, L.ms(NOW), [{ col: L.findCollisions(op('peachtree'), NOW)[0], note: 'Refunded Ella' }], AGENT_NAME);
  assert.match(pt, /1 car was double-booked, and you sorted it\./);
  assert.match(pt, /What you did: Refunded Ella\./);
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
