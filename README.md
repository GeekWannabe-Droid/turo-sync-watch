# Turo Sync Watch

A support console for one 1Now problem: an operator's Turo connection stops syncing, nobody notices, and the same car gets booked twice.

**Live demo:** https://geekwannabe-droid.github.io/turo-sync-watch/

Built with Claude for the 1Now Client Success & Support assignment. All data is sample data.

## The problem

1Now keeps an operator's Turo calendar and their own booking site in sync, both ways. When that stops working, operators write in. It's common enough to have its own FAQ: [Why aren't my Turo bookings blocking dates on 1Now?](https://1now.ai/support)

When the connection breaks:

- 1Now stops seeing new Turo bookings, and Turo stops seeing new site bookings.
- Nothing warns the operator. An empty calendar looks exactly like a calendar 1Now can't read.
- One connection covers the whole Turo account, so every car stops syncing at the same moment.
- A double-booking needs both bookings to land after the break. Anything booked before the break stays blocked.
- Nobody finds out until two renters turn up for the same car.

Today the loop starts when the operator notices. By then it has already cost him.

## What the tool does

It's the support team's screen, not the operator's. It has two places.

**1. The list of all operators.** Every Turo connection, most urgent first. For each broken one: how long it's been down, why it broke, how many site bookings were taken with no Turo check, when the first of those renters picks up, and how hard to chase the operator.

**2. One page per operator.** It changes as the ticket moves:

- **While the connection is down:** the cause, every car on the account, every booking taken blind, and a message asking the operator to reconnect, worded for the reason it broke. Nothing can be checked until they reconnect, so this is about getting them to do it.
- **After reconnect:** 1Now pulls the Turo bookings it missed and compares both calendars, car by car. Double-bookings are confirmed here and nowhere earlier. Each one shows the two bookings, which cars are free for each renter's dates, and a message to the operator. Then the agent marks it "told" and, once the operator has dealt with it, "sorted", with a note of what he decided.
- **When everything is sorted:** a plain summary for the operator of what broke, for how long, what it hit, and what's fixed. Then the ticket closes.

## What support does and doesn't do

Support gives the operator the facts and tracks the ticket until it's closed. The operator makes the decisions and does the fixing in his own 1Now app.

- **Support does:** spot dead connections, decide how hard to chase, find the double-bookings, tell the operator what clashed and what's free, record what he decided, and send the summary.
- **The operator does:** reconnect Turo in Settings, decide who keeps a double-booked car, move or cancel bookings, and talk to his renters.

The tool never decides who keeps the car. It does give the operator one fact that matters for that decision: if he cancels the Turo trip, Turo can charge him a fee and adds an automatic review to the listing saying he cancelled ([Turo's cancellation policy](https://turo.com/us/en/policies/cancellation)).

## How hard to chase an operator

| Situation | Next step |
| --- | --- |
| Site bookings taken blind, first pickup within 7 days | Call now |
| Site bookings taken blind, first pickup later | Message today |
| Down 24 hours or more, 3+ breaks in 60 days, or access removed on the Turo side | At least message today |
| Caught early, no bookings taken since | Automatic email |
| Turo is limiting 1Now's requests | Engineering. The operator isn't contacted, since they can't fix it. Escalate after 6 hours. |

Each reason a connection breaks needs a different conversation: sign-in expired, Turo password changed, access removed on Turo, or Turo limiting requests.

## What's real and what's mocked

- **Real:** the rules in `logic.js`, covered by the tests in `tests/logic.test.js`.
- **Mocked:** every operator, renter and booking in `data.js`. The sample bookings have fixed dates, so the tool runs as if today is Mon 28 Sep 2026, 09:00. That way it shows the same thing on any day.
- **Assumed:** I don't know exactly how 1Now connects to Turo. The tool only assumes that when a sync attempt fails, 1Now records when and why. The four reasons above are examples of what that record could say.
- **Simulated:** the "Simulate: operator reconnects" button stands in for the operator reconnecting in Settings.

## Run it

- **Online:** the live demo link at the top.
- **On your computer:** download this repo and open `index.html` in a browser. Nothing to install.
- **Tests:** `node --test tests/logic.test.js` (Node 18 or newer, nothing to install).

## Files

| File | What's in it |
| --- | --- |
| `index.html` | The page |
| `app.js` | The two places: the operator list and each operator's page |
| `logic.js` | Every rule the tool follows |
| `data.js` | Sample operators and bookings |
| `style.css` | Styles |
| `tests/logic.test.js` | 24 tests on the rules and the sample data |

## What this doesn't fix

This tool is a patch that catches dead connections early and cleans up after them, but it doesn't stop them breaking. The lasting fix is to warn operators before the Turo sign-in expires, which has to be built into 1Now itself.
