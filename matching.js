// Scoring engine: ranks trucks for a load. No dependencies — haversine + state centroids.

const STATE_CENTROIDS = {
  AL: [32.8, -86.8], AK: [64.2, -149.5], AZ: [34.0, -111.1], AR: [34.8, -92.4], CA: [37.2, -119.5],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], FL: [28.0, -82.4], GA: [32.6, -83.4],
  HI: [20.8, -156.3], IA: [42.0, -93.5], ID: [44.1, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3],
  KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.0, -92.0], MA: [42.3, -71.8], MD: [39.0, -76.7],
  MI: [44.3, -85.6], MN: [46.3, -94.3], MO: [38.5, -92.5], MS: [32.7, -89.7], MT: [47.0, -109.6],
  NC: [35.5, -79.4], ND: [47.5, -100.4], NE: [41.5, -99.8], NH: [43.7, -71.6], NJ: [40.1, -74.5],
  NM: [34.4, -106.1], NV: [39.3, -116.6], NY: [43.0, -75.0], OH: [40.3, -82.8], OK: [35.6, -97.5],
  OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.8, -80.9], SD: [44.4, -100.2],
  TN: [35.8, -86.3], TX: [31.5, -99.3], UT: [39.3, -111.7], VA: [37.5, -78.7], VT: [44.0, -72.7],
  WA: [47.4, -121.1], WV: [38.6, -80.6], WI: [44.5, -89.7], WY: [43.0, -107.6],
};

const R_EARTH_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function milesBetween(a, b) {
  if (!a || !b) return null;
  if (a.state && b.state && a.state === b.state && a.city === b.city) return 0;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pointFor(city, state) {
  const st = String(state || '').toUpperCase();
  const base = STATE_CENTROIDS[st];
  if (!base) return null;
  // Nudge the centroid deterministically by city so same-state pairs are not 0 apart.
  let seed = 0;
  for (const ch of String(city || '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return [base[0] + ((seed % 71) - 35) / 200, base[1] + (((seed >> 6) % 71) - 35) / 200];
}

const days = (a, b) => (Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;

/**
 * score(truck, load) -> { total, reasons[], hardBlock }
 * 0..100. Equipment and capacity are hard requirements; everything else ranks.
 */
export function scoreTruck(truck, load, { today }) {
  const reasons = [];
  if (truck.status !== 'available') return { total: 0, reasons: ['Truck already booked'], hardBlock: 'booked' };
  if (truck.equipment !== load.equipment) return { total: 0, reasons: [`Needs ${load.equipment}`], hardBlock: 'equipment' };
  if (truck.capacity_lb < load.weight_lb) return { total: 0, reasons: [`Capacity ${truck.capacity_lb} lb < ${load.weight_lb} lb`], hardBlock: 'capacity' };

  let score = 40; // viable-and-close baseline
  const deadhead = milesBetween(pointFor(truck.city, truck.state), pointFor(load.origin_city, load.origin_state));
  if (deadhead !== null) {
    if (deadhead <= 25) { score += 30; reasons.push(`Deadhead ${Math.round(deadhead)} mi — on top of the load`); }
    else if (deadhead <= 150) { score += 18; reasons.push(`Deadhead ${Math.round(deadhead)} mi`); }
    else if (deadhead <= 400) { score += 6; reasons.push(`Deadhead ${Math.round(deadhead)} mi — repositioning`); }
    else { score -= 12; reasons.push(`Deadhead ${Math.round(deadhead)} mi — long reposition`); }
  }

  const lead = days(load.pickup_date, truck.available_date);
  if (lead < 0) { score -= 25; reasons.push(`Available ${truck.available_date}, after ${load.pickup_date} pickup`); }
  else if (lead === 0) { score += 15; reasons.push('Ready on pickup day'); }
  else if (lead <= 2) { score += 10; reasons.push(`Free ${lead} day(s) before pickup`); }
  else { score -= 5; reasons.push(`Sits ${lead} days before pickup`); }

  const miles = milesBetween(
    pointFor(load.origin_city, load.origin_state),
    pointFor(load.dest_city, load.dest_state),
  );
  const offer = load.offered_rate_cents / 100;
  if (miles && offer) {
    const rpm = offer / miles;
    score += rpm >= 3.2 ? 15 : rpm >= 2.6 ? 8 : rpm >= 2 ? 2 : -10;
    reasons.push(`$${offer.toFixed(0)} over ${Math.round(miles)} mi = $${rpm.toFixed(2)}/mi`);
  }

  // Rate vs driver floor — a broker deal below the floor needs a hard sell.
  const floor = truck.min_rate_cents / 100;
  if (offer >= floor) { score += 12; reasons.push('Covers driver floor'); }
  else { score -= 15; reasons.push(`$${(floor - offer).toFixed(0)} under driver floor`); }

  return { total: Math.max(1, Math.min(100, Math.round(score))), reasons, hardBlock: null, deadhead: deadhead && Math.round(deadhead) };
}

export function rankTrucks(trucks, load, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  return trucks
    .map((t) => ({ truck: t, ...scoreTruck(t, load, { today }) }))
    .filter((r) => !r.hardBlock)
    .sort((a, b) => b.total - a.total);
}