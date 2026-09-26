/*
  Turo Sync Watch: the rules.

  Everything the tool works out lives in this file: which site bookings were
  taken blind, which connections to chase first, which bookings clash after a
  reconnect, which cars are free, and what the messages say.

  It never decides who keeps a double-booked car. That's the operator's call.
  Support gives him the facts, then records what he decided.

  No screen code here, so every rule can be tested on its own
  (see tests/logic.test.js).
*/
(function (root) {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  // ---------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------

  // Times are fixed clock readings like '2026-10-02T14:00'. They are read and
  // formatted as UTC so the demo shows the same thing in every time zone.
  function ms(value) {
    if (typeof value === 'number') return value;
    const s = String(value);
    const iso = s.length === 16 ? s + ':00Z' : s.length === 19 ? s + 'Z' : s;
    const out = Date.parse(iso);
    if (Number.isNaN(out)) throw new Error('Unreadable time: ' + s);
    return out;
  }

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => (n < 10 ? '0' : '') + n;

  function fmtDay(v) {
    const d = new Date(ms(v));
    return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  }
  function fmtTime(v) {
    const d = new Date(ms(v));
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  function fmtWhen(v) {
    return `${fmtDay(v)}, ${fmtTime(v)}`;
  }
  function fmtTrip(b) {
    return `${fmtDay(b.start)} ${fmtTime(b.start)} → ${fmtDay(b.end)} ${fmtTime(b.end)}`;
  }
  function monthShort(v) {
    return MON[new Date(ms(v)).getUTCMonth()];
  }
  function dayOfMonth(v) {
    return new Date(ms(v)).getUTCDate();
  }
  function isWeekend(v) {
    const d = new Date(ms(v)).getUTCDay();
    return d === 0 || d === 6;
  }

  // "Fri 2 – Sun 4 Oct", or "Wed 30 Sep – Sat 3 Oct" across months.
  function fmtDays(start, end) {
    const a = new Date(ms(start));
    const b = new Date(ms(end));
    if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
      return `${DOW[a.getUTCDay()]} ${a.getUTCDate()} – ${DOW[b.getUTCDay()]} ${b.getUTCDate()} ${MON[b.getUTCMonth()]}`;
    }
    return `${fmtDay(start)} – ${fmtDay(end)}`;
  }

  // A length of time in words: "40 min", "2 hr 50 min", "25 hours", "9 days".
  function fmtLength(span) {
    if (span < HOUR) return `${Math.max(1, Math.floor(span / MIN))} min`;
    if (span < DAY) {
      const h = Math.floor(span / HOUR);
      const m = Math.floor((span % HOUR) / MIN);
      return m ? `${h} hr ${m} min` : `${h} hr`;
    }
    if (span < 2 * DAY) return `${Math.floor(span / HOUR)} hours`;
    return `${Math.floor(span / DAY)} days`;
  }

  // How far away something is: "in 4 days", "in 5 hr", "already started".
  function fmtUntil(target, now) {
    const span = ms(target) - ms(now);
    if (span <= 0) return 'already started';
    if (span < DAY) return `in ${fmtLength(span)}`;
    const d = Math.floor(span / DAY);
    return d === 1 ? 'in 1 day' : `in ${d} days`;
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const firstName = (name) => String(name).split(' ')[0];

  // ---------------------------------------------------------------------------
  // Reference lists
  // ---------------------------------------------------------------------------

  const CLASS_LABEL = { compact: 'Compact', midsize: 'Midsize', suv: 'SUV', premium: 'Premium' };

  // Why a connection broke. Each reason needs a different conversation.
  // These are examples of what 1Now could record when a sync attempt fails.
  const REASONS = {
    SIGNIN_EXPIRED: {
      label: 'Sign-in expired',
      fixedBy: 'operator',
      detail: 'The Turo sign-in 1Now uses has expired. The operator did nothing wrong, but only they can reconnect.',
    },
    PASSWORD_CHANGED: {
      label: 'Turo password changed',
      fixedBy: 'operator',
      detail: 'The Turo password was changed, which disconnects 1Now. The operator reconnects with the new password.',
    },
    ACCESS_REVOKED: {
      label: 'Access removed on Turo',
      fixedBy: 'operator',
      detail: "1Now's access was removed from the Turo side. That may have been on purpose, so ask before sending a reconnect link.",
    },
    RATE_LIMITED: {
      label: 'Turo is limiting requests',
      fixedBy: '1now',
      detail: "Turo is limiting how often 1Now can check this account. That's on 1Now's side. The operator can't fix it and doesn't need to hear about it yet.",
    },
  };

  const TIERS = {
    1: { label: 'Call now', action: 'Phone the operator now and stay with them until they reconnect.' },
    2: { label: 'Message today', action: "Send a personal message today. Call if there's no reply by the end of the day." },
    3: { label: 'Auto email', action: 'The automatic reconnect email is enough. Check again tomorrow.' },
  };

  // How long a Turo limit can last before engineering gets pulled in.
  const ENGINEERING_AFTER = 6 * HOUR;

  // A fact the operator needs before deciding who keeps a double-booked car.
  // Source: https://turo.com/us/en/policies/cancellation
  // ("can" because Turo excuses the fee for some hosts, such as All-Star Hosts.)
  const TURO_CANCEL_FACT =
    "If you cancel the Turo trip, Turo can charge you a fee and adds an automatic review to the car's listing saying you cancelled.";

  // ---------------------------------------------------------------------------
  // Bookings and connections
  // ---------------------------------------------------------------------------

  // Two trips clash if each starts before the other ends.
  // A trip ending at 10:00 and one starting at 10:00 don't clash.
  function overlaps(a, b) {
    return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
  }

  const isDown = (op) => op.connection.status === 'down';
  const brokeAt = (op) => ms(op.connection.lastSync);
  const carById = (op, id) => op.cars.find((c) => c.id === id) || null;
  const bookingById = (op, id) => op.bookings.find((b) => b.id === id) || null;
  const fleetSize = (op) => (op.cars && op.cars.length ? op.cars.length : op.fleetSize || 0);

  // Site bookings taken after the connection broke, for trips not over yet.
  // None of them were checked against Turo, and Turo was never told about them.
  function takenBlind(op, now) {
    if (!isDown(op)) return [];
    const cut = brokeAt(op);
    const n = ms(now);
    return op.bookings
      .filter((b) => b.source === 'direct' && ms(b.createdAt) > cut && ms(b.end) > n)
      .sort((a, b) => ms(a.start) - ms(b.start));
  }

  // Turo bookings made after the connection broke. 1Now can't see these
  // until the operator reconnects.
  function hiddenTuro(op) {
    if (!isDown(op)) return [];
    const cut = brokeAt(op);
    return op.bookings
      .filter((b) => b.source === 'turo' && ms(b.createdAt) > cut)
      .sort((a, b) => ms(a.start) - ms(b.start));
  }

  // What 1Now can actually see right now.
  function visibleBookings(op, reconnected) {
    if (!isDown(op) || reconnected) return op.bookings.slice();
    const cut = brokeAt(op);
    return op.bookings.filter((b) => b.source === 'direct' || ms(b.createdAt) <= cut);
  }

  function breaksLast60(op, now) {
    const n = ms(now);
    return (op.connection.breaks || []).filter((x) => ms(x) <= n && n - ms(x) <= 60 * DAY).length;
  }
  const isRepeat = (op, now) => breaksLast60(op, now) >= 3;

  // ---------------------------------------------------------------------------
  // Escalation: how hard to chase this operator
  // ---------------------------------------------------------------------------

  function escalation(op, now) {
    if (!isDown(op)) return null;
    const n = ms(now);
    const down = n - brokeAt(op);
    const blind = takenBlind(op, now);
    const count = blind.length;
    const first = count ? ms(blind[0].start) : null;
    const reasons = [];
    const takenLine = `${plural(count, 'booking')} taken on the site with no Turo check`;

    if (op.connection.reason === 'RATE_LIMITED') {
      const escalateAt = brokeAt(op) + ENGINEERING_AFTER;
      reasons.push("Turo is limiting 1Now's requests. The operator can't fix this.");
      if (count) reasons.push(takenLine);
      const action = n >= escalateAt
        ? 'Escalate to engineering now. Turo has been limiting requests for over 6 hours.'
        : `Retries run on their own. Escalate to engineering at ${fmtWhen(escalateAt)} if it's still failing.`;
      return { tier: 'internal', label: 'Engineering', action, reasons, first };
    }

    let tier = 3;
    if (count) {
      reasons.push(takenLine);
      reasons.push(first <= n ? 'One of those trips has already started' : `First pickup ${fmtUntil(first, now)}`);
      tier = first - n <= 7 * DAY ? 1 : 2;
    }
    if (down >= DAY) {
      reasons.push(`Down for ${fmtLength(down)}`);
      tier = Math.min(tier, 2);
    }
    if (isRepeat(op, now)) {
      reasons.push(`${breaksLast60(op, now)} breaks in the last 60 days`);
      tier = Math.min(tier, 2);
    }
    if (op.connection.reason === 'ACCESS_REVOKED') {
      reasons.push('Access was removed on the Turo side. Ask before sending a link.');
      tier = Math.min(tier, 2);
    }
    if (tier === 3) reasons.push(`Caught ${fmtLength(down)} after it broke. No bookings taken since.`);

    return { tier, label: TIERS[tier].label, action: TIERS[tier].action, reasons, first };
  }

  // ---------------------------------------------------------------------------
  // After reconnect: find the double-bookings
  // ---------------------------------------------------------------------------

  // Every Turo trip and site booking on the same car whose dates overlap.
  // Only meaningful once the operator has reconnected and 1Now can see both sides.
  function findCollisions(op, now) {
    const n = ms(now);
    const out = [];
    for (const car of op.cars) {
      const onCar = op.bookings.filter((b) => b.carId === car.id);
      const turo = onCar.filter((b) => b.source === 'turo');
      const direct = onCar.filter((b) => b.source === 'direct');
      for (const tb of turo) {
        for (const db of direct) {
          if (!overlaps(tb, db)) continue;
          const clashEnd = Math.min(ms(tb.end), ms(db.end));
          if (clashEnd <= n) continue; // already in the past
          out.push({
            id: `${tb.id}~${db.id}`,
            carId: car.id,
            turo: tb,
            direct: db,
            clashStart: Math.max(ms(tb.start), ms(db.start)),
            clashEnd,
          });
        }
      }
    }
    return out.sort((a, b) => a.clashStart - b.clashStart);
  }

  // The blind bookings split into fine and double-booked.
  function checkResults(op, now) {
    const checked = takenBlind(op, now);
    const collisions = findCollisions(op, now);
    const hit = new Set(collisions.map((c) => c.direct.id));
    return {
      checked,
      clashing: checked.filter((b) => hit.has(b.id)),
      clear: checked.filter((b) => !hit.has(b.id)),
      collisions,
      pulled: hiddenTuro(op),
    };
  }

  // ---------------------------------------------------------------------------
  // One double-booking: the facts the operator needs to decide
  // ---------------------------------------------------------------------------

  // Other cars in the fleet with nothing booked during this booking's dates.
  function freeCarsFor(op, booking, excludeCarId) {
    return op.cars.filter(
      (car) => car.id !== excludeCarId && !op.bookings.some((b) => b.carId === car.id && overlaps(b, booking)),
    );
  }

  // Facts only. Who keeps the car is left to the operator.
  function clashFacts(op, col, now) {
    const n = ms(now);
    const driving = (b) => ms(b.start) <= n && n < ms(b.end);
    const freeTuro = freeCarsFor(op, col.turo, col.carId);
    const freeSite = freeCarsFor(op, col.direct, col.carId);
    return {
      car: carById(op, col.carId),
      freeTuro,
      freeSite,
      shared: freeTuro.filter((c) => freeSite.some((d) => d.id === c.id)),
      turoDriving: driving(col.turo),
      siteDriving: driving(col.direct),
    };
  }

  // ---------------------------------------------------------------------------
  // Messages to the operator
  // ---------------------------------------------------------------------------

  // Asking the operator to reconnect. Different wording for each reason.
  function reconnectMessage(op, now) {
    const r = op.connection.reason;
    if (!isDown(op) || r === 'RATE_LIMITED') return null;
    const who = op.owner.first;
    const since = fmtWhen(op.connection.lastSync);
    const count = takenBlind(op, now).length;
    let risk = 'No bookings have come in on your site since, so nothing is at risk yet.';
    if (count === 1) {
      risk = "Since then, 1 booking came in on your site that couldn't be checked against Turo. Until you reconnect, we can't tell if it clashes with a Turo trip.";
    } else if (count > 1) {
      risk = `Since then, ${count} bookings came in on your site that couldn't be checked against Turo. Until you reconnect, we can't tell if any of them clash with a Turo trip.`;
    }
    const after = "Reply here when it's done and we'll check every booking from the gap.";

    if (r === 'PASSWORD_CHANGED') {
      let msg = `Hi ${who}, your Turo password was changed on ${since}, which disconnected 1Now. ${risk}\n\nPlease open Settings in 1Now and reconnect Turo with the new password. ${after}`;
      if (isRepeat(op, now)) {
        msg += `\n\nThis is the ${ordinal(breaksLast60(op, now))} time in 60 days a password change has disconnected you. If more than one person uses your Turo login, reconnect 1Now right after any password change.`;
      }
      return msg;
    }
    if (r === 'ACCESS_REVOKED') {
      return `Hi ${who}, 1Now lost access to your Turo account on ${since}. It looks like access was removed on the Turo side. ${risk}\n\nIf that wasn't on purpose, please open Settings in 1Now and reconnect Turo. If it was, reply and let us know what's going on so we can help.`;
    }
    return `Hi ${who}, your Turo connection in 1Now stopped on ${since} because the Turo sign-in expired. ${risk}\n\nPlease open Settings in 1Now and reconnect Turo. It only takes a minute. ${after}`;
  }

  // Telling the operator about one double-booking. Facts and options only:
  // the operator decides what happens.
  function clashMessage(op, col, now) {
    const f = clashFacts(op, col, now);
    const names = (cars) => cars.map((c) => c.name).join(', ');
    const back = op.connection.reason === 'RATE_LIMITED' ? 'now that syncing is back' : "now that you've reconnected";
    const lines = [
      `Hi ${op.owner.first}, ${back}, we checked every booking from the gap. Your ${f.car.name} is double-booked:`,
      '',
      `- ${col.turo.renter} booked it on Turo: ${fmtTrip(col.turo)}`,
      `- ${col.direct.renter} booked it on your site: ${fmtTrip(col.direct)}`,
      '',
    ];

    if (f.turoDriving) lines.push(`${col.turo.renter} already has the car.`);
    else if (f.siteDriving) lines.push(`${col.direct.renter} already has the car.`);
    else lines.push(`They overlap from ${fmtWhen(col.clashStart)}, which is ${fmtUntil(col.clashStart, now)}.`);
    lines.push('');

    if (!f.freeTuro.length && !f.freeSite.length) {
      lines.push("No other car in your fleet is free for either renter's dates.");
    } else {
      lines.push(`Cars free for ${firstName(col.turo.renter)}'s dates: ${f.freeTuro.length ? names(f.freeTuro) : 'none'}.`);
      lines.push(`Cars free for ${firstName(col.direct.renter)}'s dates: ${f.freeSite.length ? names(f.freeSite) : 'none'}.`);
      if (f.shared.length === 1) lines.push(`The ${f.shared[0].name} can only go to one of them.`);
      if (f.shared.length > 1) lines.push('Each car that appears in both lists can only go to one of them.');
    }
    lines.push('', TURO_CANCEL_FACT, '');
    lines.push("How do you want to handle it? Tell me what you decide and I'll note it on the ticket. If it helps, I can draft the message to whichever renter you move.");
    return lines.join('\n');
  }

  // The close-out summary sent to the operator.
  // `outcomes` is one entry per double-booking: { col, note }. The note is what
  // the operator decided, in the support agent's words. It can be empty.
  function ticketSummary(op, now, reconnectedAt, outcomes, agentName) {
    const r = op.connection.reason;
    const since = op.connection.lastSync;
    const blind = takenBlind(op, now);
    const pulled = hiddenTuro(op);
    const cars = fleetSize(op);
    const down = ms(reconnectedAt) - brokeAt(op);
    const lines = [];

    lines.push(`Hi ${op.owner.first},`, '');
    lines.push("Here's what happened with your Turo connection and where things stand now.", '');

    const broke = {
      SIGNIN_EXPIRED: `Your Turo connection stopped on ${fmtDay(since)} at ${fmtTime(since)} because the Turo sign-in expired.`,
      PASSWORD_CHANGED: `Your Turo connection stopped on ${fmtDay(since)} at ${fmtTime(since)} when the Turo password was changed.`,
      ACCESS_REVOKED: `Your Turo connection stopped on ${fmtDay(since)} at ${fmtTime(since)} when 1Now's access was removed on the Turo side.`,
      RATE_LIMITED: `On ${fmtDay(since)} at ${fmtTime(since)}, Turo started limiting how often 1Now could check your calendar. That was on our side, not yours.`,
    }[r];
    lines.push(`What broke: ${broke}`);

    const siteCount = blind.length ? `${plural(blind.length, 'booking')} came in on your site` : 'no bookings came in on your site';
    const turoCount = pulled.length ? `${pulled.length} came in on Turo` : 'none came in on Turo';
    lines.push(`How long: ${fmtLength(down)}. In that time ${siteCount} and ${turoCount}, and neither side could see the other.`);

    if (!outcomes.length) {
      lines.push(blind.length
        ? `What it hit: Nothing. ${blind.length === 1 ? 'The booking' : `All ${blind.length} bookings`} taken while it was down checked out fine.`
        : 'What it hit: Nothing. No bookings came in on your site while it was down.');
    } else {
      const all = outcomes.length === 1 ? 'it' : outcomes.length === 2 ? 'both' : 'all of them';
      lines.push(`What it hit: ${plural(outcomes.length, 'car was', 'cars were')} double-booked, and you sorted ${all}.`);
      for (const o of outcomes) {
        const car = carById(op, o.col.carId).name;
        let note = String(o.note || '').replace(/\s+/g, ' ').trim();
        if (note && !/[.!?]$/.test(note)) note += '.';
        lines.push(`- ${car}: ${o.col.turo.renter} (Turo) and ${o.col.direct.renter} (your site) from ${fmtWhen(o.col.clashStart)}. ${note ? `What you did: ${note}` : 'Sorted by you.'}`);
      }
      const fine = blind.length - new Set(outcomes.map((o) => o.col.direct.id)).size;
      if (fine > 0) lines.push(`The other ${plural(fine, 'booking is', 'bookings are')} fine.`);
    }

    const fixedWhen = `${fmtDay(reconnectedAt)} at ${fmtTime(reconnectedAt)}`;
    lines.push(r === 'RATE_LIMITED'
      ? `What's fixed: Syncing recovered on ${fixedWhen}. All ${cars} cars are syncing again, and dates block both ways.`
      : `What's fixed: You reconnected on ${fixedWhen}. All ${cars} cars are syncing again, and dates block both ways.`);

    let watch;
    if (r === 'RATE_LIMITED') watch = 'Nothing to do on your side.';
    else if (r === 'PASSWORD_CHANGED' && isRepeat(op, now)) {
      watch = `This is the ${ordinal(breaksLast60(op, now))} time in 60 days a Turo password change has disconnected 1Now. If more than one person uses the Turo login, reconnect 1Now right after any password change.`;
    } else if (r === 'ACCESS_REVOKED') {
      watch = "If you ever remove 1Now's access on purpose, tell us first. While it's off, your site can't check Turo.";
    } else {
      watch = "If we tell you Turo is disconnected, reconnect the same day. Bookings taken while it's down can't be checked against Turo.";
    }
    lines.push(`What to watch: ${watch}`, '');
    lines.push('Thanks,', agentName ? `${agentName}, 1Now Support` : '1Now Support');
    return lines.join('\n');
  }

  // Internal note shown when closing a ticket. Not sent to the operator.
  const PATCH_NOTE =
    "This tool is a patch that catches dead connections early and cleans up after them, but it doesn't stop them breaking. " +
    'The lasting fix is to warn operators before the Turo sign-in expires, which has to be built into 1Now itself.';

  const api = {
    MIN, HOUR, DAY, CLASS_LABEL, REASONS, TIERS, PATCH_NOTE, TURO_CANCEL_FACT,
    ms, fmtDay, fmtTime, fmtWhen, fmtTrip, fmtDays, fmtLength, fmtUntil, monthShort, dayOfMonth, isWeekend,
    ordinal, plural, firstName,
    overlaps, isDown, brokeAt, carById, bookingById, fleetSize,
    takenBlind, hiddenTuro, visibleBookings, breaksLast60, isRepeat, escalation,
    findCollisions, checkResults, freeCarsFor, clashFacts,
    reconnectMessage, clashMessage, ticketSummary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
