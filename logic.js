/*
  Turo Sync Watch: the rules.

  Everything the tool decides lives in this file: what counts as a blind
  booking, which connections to chase first, who keeps a double-booked car,
  which replacement car to offer, and what the messages say.

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

  // Bigger number = bigger car. Used to rank replacement cars.
  const CLASS_RANK = { compact: 1, midsize: 2, suv: 3, premium: 4 };
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
  // Resolving one double-booking
  // ---------------------------------------------------------------------------

  // Who keeps the car. Whoever already has it keeps it. Otherwise the Turo
  // renter keeps it: a host who cancels on Turo pays a fee and gets an automatic
  // review on the listing (turo.com/us/en/policies/cancellation), while the site
  // renter is the operator's own customer, so the operator can talk to them.
  function decideKeeper(col, now) {
    const n = ms(now);
    const driving = (b) => ms(b.start) <= n && n < ms(b.end);

    if (driving(col.direct) && !driving(col.turo)) {
      return {
        keep: col.direct,
        move: col.turo,
        moveSource: 'turo',
        reasons: [
          `${col.direct.renter} already has the car.`,
          `${col.turo.renter}'s Turo trip has to change, and Turo trips can only be changed in Turo.`,
        ],
      };
    }

    const reasons = driving(col.turo)
      ? [`${col.turo.renter} already has the car.`]
      : ['Neither trip has started yet.', "Cancelling a Turo trip costs the host a fee and puts an automatic review on the car's Turo listing saying they cancelled."];
    reasons.push(`${col.direct.renter} booked on the operator's own site, so the operator can talk to them directly and offer another car.`);
    return { keep: col.turo, move: col.direct, moveSource: 'direct', reasons };
  }

  // Every other car in the fleet, checked for the moving renter's dates.
  // `moves` are earlier decisions: bookings already moved or refunded.
  // A moved booking frees its old car and holds its new one.
  function replacementOptions(op, col, moving, moves) {
    const done = moves || [];
    const movedIds = new Set(done.map((m) => m.bookingId));
    const want = CLASS_RANK[carById(op, col.carId).cls];

    return op.cars
      .filter((c) => c.id !== col.carId)
      .map((car) => {
        const clash =
          op.bookings.find((b) => b.carId === car.id && b.id !== moving.id && !movedIds.has(b.id) && overlaps(b, moving)) ||
          done.find((m) => m.toCarId === car.id && m.bookingId !== moving.id && overlaps(m, moving)) ||
          null;
        const rank = CLASS_RANK[car.cls];
        const fit = rank === want ? 'same' : rank > want ? 'bigger' : 'smaller';
        return { car, fit, free: !clash, blockedBy: clash };
      });
  }

  // Same size first. Then the smallest bigger car, at no extra cost.
  // Nothing suitable free: refund.
  function recommend(options) {
    const free = options.filter((o) => o.free);
    const same = free.filter((o) => o.fit === 'same');
    if (same.length) return { kind: 'swap', carId: same[0].car.id };
    const bigger = free
      .filter((o) => o.fit === 'bigger')
      .sort((a, b) => CLASS_RANK[a.car.cls] - CLASS_RANK[b.car.cls]);
    if (bigger.length) return { kind: 'upgrade', carId: bigger[0].car.id };
    return { kind: 'refund', carId: null };
  }

  // Turns a pick (a car id, or 'refund') into what the messages need.
  function choiceFor(options, pick) {
    const opt = pick && pick !== 'refund' ? options.find((o) => o.car.id === pick && o.free) : null;
    if (opt) {
      const kind = opt.fit === 'same' ? 'swap' : opt.fit === 'bigger' ? 'upgrade' : 'downgrade';
      return { kind, car: opt.car };
    }
    const free = options.filter((o) => o.free);
    const sameOrBigger = free.filter((o) => o.fit !== 'smaller');
    const smaller = free.filter((o) => o.fit === 'smaller');
    let why = 'chosen';
    if (!free.length) why = 'none-free';
    else if (!sameOrBigger.length) why = 'only-smaller';
    return { kind: 'refund', car: null, why, smallerFree: why === 'only-smaller' ? smaller.map((o) => o.car) : [] };
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  // To the renter who has to move. Honest about what happened, no blame on them.
  function renterMessage(op, col, keeper, choice) {
    const orig = carById(op, col.carId).name;
    const b = keeper.move;
    const days = fmtDays(b.start, b.end);
    const hi = `Hi ${firstName(b.renter)},`;

    if (keeper.moveSource === 'turo') {
      const opening = `This is ${op.owner.first}, your host for the ${orig} on Turo (${days}). A calendar error on my side let the car be booked twice for your dates. I'm sorry.`;
      const offer = choice.kind === 'refund'
        ? "I don't have another car free for your dates, so I'll cancel through Turo and you'll get a full refund through Turo."
        : `The ${choice.car.name} is free for the same dates. If you'd like it, reply here and I'll arrange the change through Turo.`;
      return `${hi}\n\n${opening}\n\n${offer}\n\nSorry again,\n${op.owner.first}`;
    }

    const opening = `This is ${op.owner.first} from ${op.name}. There's a problem with your booking of the ${orig} for ${days}. A calendar error on our side let the same car be booked twice for your dates. That's our mistake, not yours.`;
    const fallback = "If that doesn't work for you, reply and we'll cancel with a full refund.";
    let offer;
    switch (choice.kind) {
      case 'swap':
        offer = `We've kept a ${choice.car.name} free for you instead. Same size, same dates, same price. Reply YES and it's yours. Nothing else about your booking changes.\n\n${fallback}`;
        break;
      case 'upgrade':
        offer = `We've kept a ${choice.car.name} free for you instead. It's a bigger car at no extra cost, for the same dates. Reply YES and it's yours. Nothing else about your booking changes.\n\n${fallback}`;
        break;
      case 'downgrade':
        offer = `The only car free for your dates is a ${choice.car.name}, which is smaller than the ${orig}. If it works for you, reply YES and we'll switch you over and refund the difference. If not, reply and we'll cancel with a full refund.`;
        break;
      default: {
        const lead = choice.why === 'none-free'
          ? "Every other car we have is booked for your dates, so we're cancelling this booking and refunding you in full."
          : choice.why === 'only-smaller'
            ? "No car the same size or bigger is free for your dates, so we're cancelling this booking and refunding you in full."
            : "We're cancelling this booking and refunding you in full.";
        offer = `${lead} The refund goes back to the card you paid with.`;
        if (choice.smallerFree && choice.smallerFree.length) {
          offer += `\n\nIf a smaller car would work, the ${choice.smallerFree[0].name} is free for your dates. Reply and we'll book it for you instead.`;
        }
      }
    }
    return `${hi}\n\n${opening}\n\n${offer}\n\nSorry for the trouble,\n${op.owner.first}\n${op.name}`;
  }

  // What the operator has to do after the message goes out.
  function operatorSteps(op, col, keeper, choice) {
    const b = keeper.move;
    const who = firstName(b.renter);
    if (keeper.moveSource === 'turo') {
      return [
        `Send the message to ${who} in Turo messages.`,
        choice.kind === 'refund' ? `Cancel ${who}'s trip in Turo.` : `Change ${who}'s trip in Turo once they agree.`,
      ];
    }
    if (choice.kind === 'refund') {
      return [`Cancel and refund ${who}'s booking in 1Now.`, `Send ${who} the message.`];
    }
    return [
      `Send ${who} the message.`,
      `When ${who} replies YES, move the booking to the ${choice.car.name} in 1Now.`,
      `Have the ${choice.car.name} ready for ${fmtWhen(b.start)}.`,
    ];
  }

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

  // The close-out summary sent to the operator.
  // `outcomes` is one entry per double-booking: { col, keeper, kind, toCar }.
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
      lines.push(`What it hit: ${plural(outcomes.length, 'car was', 'cars were')} double-booked.`);
      for (const o of outcomes) {
        const car = carById(op, o.col.carId).name;
        const moving = o.keeper.move;
        const kept = o.keeper.keep;
        const keptLabel = o.keeper.moveSource === 'direct' ? `${kept.renter} (Turo)` : kept.renter;
        let what;
        if (o.kind === 'refund') what = `${moving.renter} is refunded.`;
        else if (o.kind === 'upgrade') what = `${moving.renter} moves to the ${o.toCar.name} at no extra cost.`;
        else if (o.kind === 'downgrade') what = `${moving.renter} moves to the ${o.toCar.name}, with the difference refunded.`;
        else what = `${moving.renter} moves to the ${o.toCar.name}.`;
        lines.push(`- ${car}, ${fmtDays(moving.start, moving.end)}: ${keptLabel} keeps it. ${what}`);
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
    MIN, HOUR, DAY, CLASS_RANK, CLASS_LABEL, REASONS, TIERS, PATCH_NOTE,
    ms, fmtDay, fmtTime, fmtWhen, fmtTrip, fmtDays, fmtLength, fmtUntil, monthShort, dayOfMonth, isWeekend,
    ordinal, plural, firstName,
    overlaps, isDown, brokeAt, carById, bookingById, fleetSize,
    takenBlind, hiddenTuro, visibleBookings, breaksLast60, isRepeat, escalation,
    findCollisions, checkResults, decideKeeper, replacementOptions, recommend, choiceFor,
    renterMessage, operatorSteps, reconnectMessage, ticketSummary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
