# FreightMatch

A small desk app for a freight broker who takes shipper loads by phone and driver/truck
availability by phone, then matches, negotiates, and books them.

Zero dependencies — Node's built-in HTTP server and `node:sqlite`. No `npm install`.

```bash
node seed.js     # optional demo data (wipes existing rows)
node server.js   # http://localhost:3000   PORT=8080 node server.js to change port
```

## What it does

**Intake (the two phone calls)**
- *New load* — shipper, commodity, city/state lane, pickup date, equipment, weight, posted rate, notes.
- *New truck* — driver, phone, unit, equipment, capacity, current city/state, date free, all-in rate floor, notes.

**Matching** — open a load and every available truck is scored 1–100:
- hard filters: equipment must match, capacity must cover the weight, truck must be unbooked;
- deadhead miles from truck's current location to the pickup (state centroids + haversine, no geocoding API);
- slack between "available from" and pickup date;
- revenue per mile on the posted rate;
- whether the posted rate clears the driver's floor.

The card explains each point in plain words ("Deadhead 0 mi — on top of the load"), so you can
judge the number instead of trusting it. Opening a truck does the reverse: the loads that fit it.

**Negotiation** — each (load, truck) pair is a thread. Post an offer, log the driver's counter
from the phone call, counter again, then accept. Accepting an offer:
- rejects the other open offers on that load,
- creates the assignment at the agreed rate,
- flips load → `booked` and truck → `booked` (it drops out of the available pool).

Revoke on the Booked list reverses all of it.

## Files

| file | role |
| --- | --- |
| `db.js` | schema (loads, trucks, offers, assignments) |
| `matching.js` | scoring engine — pure functions, no I/O |
| `server.js` | JSON API + static file serving |
| `public/` | UI (no build step) |
| `seed.js` | demo rows |

## API

```
GET  /api/board                      open loads, available trucks, recent bookings
POST /api/loads                      {ref, shipper, commodity, origin_city, origin_state,
                                      dest_city, dest_state, pickup_date, equipment,
                                      weight_lb, offered_rate_cents, shipper_phone?, notes?}
POST /api/loads/:id/status           {status: open|negotiating|booked|cancelled}
GET  /api/loads/:id                  load + ranked matches + offer threads + assignment
POST /api/matches                    {load_id} -> ranked trucks
GET  /api/trucks/:id/matches         loads that fit one truck, ranked
POST /api/trucks                     {driver, phone, equipment, capacity_lb, city, state,
                                      available_date, min_rate_cents, truck_number?, notes?}
POST /api/offers                     {load_id, truck_id, by: broker|truck, rate_cents, note?}
POST /api/offers/:id/accept          books the load at that rate
POST /api/offers/:id/reject
POST /api/assignments/:id/revoke     un-books load + truck
```

Money is integer cents. Dates are ISO `YYYY-MM-DD`. Errors are `{error: "..."}` with 400/404/409.

## Verified

Driven end to end in a real browser and over the API: both intake forms, ranked matches, offer →
counter → accept, booking a load and freeing the truck, revoke, cancel, and the error paths
(bad equipment, bad date, duplicate reference, missing fields, double-booking).