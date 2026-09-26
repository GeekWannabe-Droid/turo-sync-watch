/*
  Sample data for Turo Sync Watch.
  Every operator, renter and booking in this file is made up.

  Times are the operator's local time, written without a time zone on purpose.
  The demo runs on a fixed clock (DEMO_NOW) so it behaves the same on any
  computer, on any day.

  Each booking has:
    source     'turo'   = booked on Turo
               'direct' = booked on the operator's own 1Now site
    createdAt  when the booking was made. This is what matters. A Turo booking
               made after the connection broke is invisible to 1Now until the
               operator reconnects, and a site booking made in that window was
               never checked against Turo.
*/
(function (root) {
  'use strict';

  const DEMO_NOW = '2026-09-28T09:00'; // Monday

  // The support agent's name, used to sign the summary sent to operators.
  const AGENT_NAME = 'Zahid';

  const car = (id, name, cls) => ({ id, name, cls });
  const booking = (id, carId, source, renter, start, end, createdAt) =>
    ({ id, carId, source, renter, start, end, createdAt });

  const operators = [
    {
      // The worst case: down 9 days, 12 site bookings taken blind, 2 double-bookings.
      id: 'harbor-drive',
      name: 'Harbor Drive Rentals',
      city: 'Miami, FL',
      owner: { name: 'Luis Ortega', first: 'Luis', phone: '(305) 555-0142' },
      connection: {
        status: 'down',
        reason: 'SIGNIN_EXPIRED',
        lastSync: '2026-09-19T08:12',
        breaks: ['2026-06-02T11:40', '2026-09-19T08:12'],
      },
      cars: [
        car('civic', 'Honda Civic', 'compact'),
        car('corolla', 'Toyota Corolla', 'compact'),
        car('elantra', 'Hyundai Elantra', 'compact'),
        car('camry', 'Toyota Camry', 'midsize'),
        car('altima', 'Nissan Altima', 'midsize'),
        car('rav4', 'Toyota RAV4', 'suv'),
        car('jeep', 'Jeep Grand Cherokee', 'suv'),
        car('model3', 'Tesla Model 3', 'premium'),
      ],
      bookings: [
        // Made before the connection broke. Both sides saw these.
        booking('hd-p1', 'corolla', 'turo', 'Grant W.', '2026-10-01T10:00', '2026-10-05T10:00', '2026-09-10T14:20'),
        booking('hd-p2', 'camry', 'direct', 'Leah Foster', '2026-10-08T09:00', '2026-10-10T09:00', '2026-09-12T11:05'),
        booking('hd-p3', 'jeep', 'turo', 'Noah C.', '2026-09-29T10:00', '2026-10-03T10:00', '2026-09-05T09:30'),
        booking('hd-p4', 'model3', 'turo', 'Ivy L.', '2026-09-27T10:00', '2026-09-30T10:00', '2026-09-01T18:40'),
        booking('hd-p5', 'altima', 'turo', 'Paul R.', '2026-09-26T12:00', '2026-09-29T12:00', '2026-09-08T08:15'),
        booking('hd-p6', 'rav4', 'direct', 'Sara Mendes', '2026-10-12T10:00', '2026-10-15T10:00', '2026-09-15T20:50'),

        // Taken on the operator's site after the break. Never checked against Turo.
        booking('hd-d1', 'civic', 'direct', 'Priya Shah', '2026-10-02T14:00', '2026-10-04T14:00', '2026-09-24T16:40'),
        booking('hd-d2', 'corolla', 'direct', 'Jordan Blake', '2026-10-17T09:00', '2026-10-19T09:00', '2026-09-25T11:05'),
        booking('hd-d3', 'elantra', 'direct', 'Aisha Karim', '2026-10-09T10:00', '2026-10-12T10:00', '2026-09-20T13:22'),
        booking('hd-d4', 'camry', 'direct', 'Ben Walters', '2026-09-30T09:00', '2026-10-03T09:00', '2026-09-21T18:45'),
        booking('hd-d5', 'altima', 'direct', 'Grace Liu', '2026-10-05T12:00', '2026-10-08T12:00', '2026-09-22T09:10'),
        booking('hd-d6', 'rav4', 'direct', 'Omar Haddad', '2026-10-01T08:00', '2026-10-04T20:00', '2026-09-23T20:30'),
        booking('hd-d7', 'jeep', 'direct', 'Hannah Price', '2026-10-10T10:00', '2026-10-14T10:00', '2026-09-19T21:02'),
        booking('hd-d8', 'model3', 'direct', 'Diego Ramos', '2026-10-03T10:00', '2026-10-06T10:00', '2026-09-26T10:15'),
        booking('hd-d9', 'elantra', 'direct', 'Chris Novak', '2026-10-23T09:00', '2026-10-26T09:00', '2026-09-27T14:50'),
        booking('hd-d10', 'camry', 'direct', 'Fatima Noor', '2026-10-17T08:00', '2026-10-20T08:00', '2026-09-25T19:30'),
        booking('hd-d11', 'civic', 'direct', 'Sam Keller', '2026-10-20T10:00', '2026-10-23T10:00', '2026-09-26T17:40'),
        booking('hd-d12', 'model3', 'direct', 'Mia Rossi', '2026-10-16T15:00', '2026-10-19T15:00', '2026-09-27T09:20'),

        // Made on Turo after the break. 1Now can't see these until the operator reconnects.
        booking('hd-t1', 'civic', 'turo', 'Marcus T.', '2026-10-02T10:00', '2026-10-06T10:00', '2026-09-22T07:55'),
        booking('hd-t2', 'corolla', 'turo', 'Elena V.', '2026-10-16T12:00', '2026-10-18T18:00', '2026-09-23T12:30'),
        booking('hd-t3', 'civic', 'turo', 'Tyler B.', '2026-10-16T09:00', '2026-10-19T09:00', '2026-09-25T08:40'),
        booking('hd-t4', 'elantra', 'turo', 'Nina P.', '2026-10-15T10:00', '2026-10-18T10:00', '2026-09-21T16:00'),
        booking('hd-t5', 'altima', 'turo', 'Kevin M.', '2026-10-16T18:00', '2026-10-19T18:00', '2026-09-24T09:00'),
        booking('hd-t6', 'jeep', 'turo', 'Laura S.', '2026-10-17T07:00', '2026-10-20T07:00', '2026-09-20T10:10'),
        booking('hd-t7', 'rav4', 'turo', 'Owen D.', '2026-10-07T09:00', '2026-10-09T09:00', '2026-09-26T13:00'),
        booking('hd-t8', 'camry', 'turo', 'Zoe H.', '2026-10-23T10:00', '2026-10-25T10:00', '2026-09-27T11:30'),
        booking('hd-t9', 'model3', 'turo', 'Ravi K.', '2026-10-09T12:00', '2026-10-12T12:00', '2026-09-22T15:45'),
      ],
    },
    {
      // Password changed. Third break in 60 days. One double-booking, and no car free for it.
      id: 'peachtree',
      name: 'Peachtree Auto Share',
      city: 'Atlanta, GA',
      owner: { name: 'Dana Brooks', first: 'Dana', phone: '(404) 555-0187' },
      connection: {
        status: 'down',
        reason: 'PASSWORD_CHANGED',
        lastSync: '2026-09-26T07:30',
        breaks: ['2026-08-04T16:20', '2026-09-02T09:45', '2026-09-26T07:30'],
      },
      cars: [
        car('forte', 'Kia Forte', 'compact'),
        car('accord', 'Honda Accord', 'midsize'),
        car('malibu', 'Chevrolet Malibu', 'midsize'),
        car('highlander', 'Toyota Highlander', 'suv'),
        car('cx5', 'Mazda CX-5', 'suv'),
      ],
      bookings: [
        booking('pt-p1', 'accord', 'turo', 'Liam K.', '2026-10-07T10:00', '2026-10-12T10:00', '2026-09-14T12:00'),
        booking('pt-p2', 'highlander', 'direct', 'Owen Park', '2026-10-09T08:00', '2026-10-13T08:00', '2026-09-18T15:30'),
        booking('pt-p3', 'cx5', 'turo', 'Kara T.', '2026-10-08T10:00', '2026-10-11T18:00', '2026-09-20T09:40'),
        booking('pt-d1', 'forte', 'direct', 'Ella Jensen', '2026-10-09T10:00', '2026-10-11T10:00', '2026-09-26T15:20'),
        booking('pt-d2', 'accord', 'direct', 'Mark Diaz', '2026-10-13T09:00', '2026-10-15T09:00', '2026-09-27T10:00'),
        booking('pt-d3', 'highlander', 'direct', 'Rosa Garcia', '2026-10-20T12:00', '2026-10-24T12:00', '2026-09-27T18:10'),
        booking('pt-t1', 'forte', 'turo', 'Jake R.', '2026-10-08T12:00', '2026-10-11T12:00', '2026-09-27T08:45'),
        booking('pt-t2', 'malibu', 'turo', 'Tina W.', '2026-10-08T09:00', '2026-10-12T09:00', '2026-09-26T20:00'),
      ],
    },
    {
      // Caught 40 minutes after it broke. Nothing taken since. An automatic email is enough.
      id: 'desert-mile',
      name: 'Desert Mile Cars',
      city: 'Phoenix, AZ',
      owner: { name: 'Ray Castillo', first: 'Ray', phone: '(602) 555-0119' },
      connection: {
        status: 'down',
        reason: 'SIGNIN_EXPIRED',
        lastSync: '2026-09-28T08:20',
        breaks: ['2026-07-14T13:05', '2026-09-28T08:20'],
      },
      cars: [
        car('prius', 'Toyota Prius', 'compact'),
        car('jetta', 'Volkswagen Jetta', 'compact'),
        car('escape', 'Ford Escape', 'suv'),
        car('outback', 'Subaru Outback', 'suv'),
      ],
      bookings: [
        booking('dm-p1', 'prius', 'direct', 'Carla Nunez', '2026-10-01T10:00', '2026-10-03T10:00', '2026-09-20T10:00'),
        booking('dm-p2', 'jetta', 'turo', 'Dev S.', '2026-10-02T09:00', '2026-10-04T09:00', '2026-09-22T17:25'),
        booking('dm-t1', 'escape', 'turo', 'Ana M.', '2026-10-05T09:00', '2026-10-07T09:00', '2026-09-28T08:45'),
      ],
    },
    {
      // Access removed on the Turo side. Might be on purpose, so ask first.
      id: 'northline',
      name: 'Northline Fleet Co.',
      city: 'Denver, CO',
      owner: { name: 'Tom Hadley', first: 'Tom', phone: '(303) 555-0164' },
      connection: {
        status: 'down',
        reason: 'ACCESS_REVOKED',
        lastSync: '2026-09-27T07:05',
        breaks: ['2026-09-27T07:05'],
      },
      cars: [
        car('explorer', 'Ford Explorer', 'suv'),
        car('tahoe', 'Chevrolet Tahoe', 'suv'),
        car('camry', 'Toyota Camry', 'midsize'),
      ],
      bookings: [
        booking('nl-p1', 'tahoe', 'turo', 'Ben A.', '2026-10-03T10:00', '2026-10-06T10:00', '2026-09-10T08:00'),
        booking('nl-p2', 'camry', 'direct', 'Lucy Grant', '2026-10-08T09:00', '2026-10-10T09:00', '2026-09-15T13:10'),
        booking('nl-d1', 'explorer', 'direct', 'Theo Adams', '2026-10-22T10:00', '2026-10-25T10:00', '2026-09-27T19:00'),
      ],
    },
    {
      // Turo is limiting 1Now's requests. That's on 1Now's side, so engineering handles it.
      id: 'blue-key',
      name: 'Blue Key Rentals',
      city: 'Tampa, FL',
      owner: { name: 'Maya Chen', first: 'Maya', phone: '(813) 555-0133' },
      connection: {
        status: 'down',
        reason: 'RATE_LIMITED',
        lastSync: '2026-09-28T06:10',
        breaks: ['2026-09-28T06:10'],
      },
      cars: [
        car('sentra', 'Nissan Sentra', 'compact'),
        car('sorento', 'Kia Sorento', 'suv'),
        car('bmw3', 'BMW 3 Series', 'premium'),
      ],
      bookings: [
        booking('bk-p1', 'bmw3', 'turo', 'Iris N.', '2026-10-05T10:00', '2026-10-08T10:00', '2026-09-12T19:30'),
        booking('bk-d1', 'sorento', 'direct', 'Joel Park', '2026-10-14T10:00', '2026-10-16T10:00', '2026-09-28T07:30'),
        booking('bk-t1', 'sentra', 'turo', 'Rae L.', '2026-10-01T10:00', '2026-10-03T10:00', '2026-09-28T07:50'),
      ],
    },
    {
      id: 'lakeside',
      name: 'Lakeside Wheels',
      city: 'Austin, TX',
      owner: { name: 'Erin Walsh', first: 'Erin', phone: '(512) 555-0171' },
      connection: { status: 'ok', reason: null, lastSync: '2026-09-28T08:56', breaks: [] },
      fleetSize: 6,
      cars: [],
      bookings: [],
    },
    {
      id: 'cedar-lane',
      name: 'Cedar Lane Rentals',
      city: 'Charlotte, NC',
      owner: { name: 'Andre Mills', first: 'Andre', phone: '(704) 555-0158' },
      connection: { status: 'ok', reason: null, lastSync: '2026-09-28T08:58', breaks: [] },
      fleetSize: 11,
      cars: [],
      bookings: [],
    },
  ];

  const data = { DEMO_NOW, AGENT_NAME, operators };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.SYNC_DATA = data;
})(typeof window !== 'undefined' ? window : globalThis);
