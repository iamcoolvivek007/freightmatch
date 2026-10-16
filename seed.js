// Demo data: node seed.js  (resets existing demo rows only)
import { db } from './db.js';

db.exec('DELETE FROM assignments; DELETE FROM offers; DELETE FROM loads; DELETE FROM trucks;');
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('assignments','offers','loads','trucks')");

const today = new Date();
const inDays = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);

const loads = [
  ['L-1042', 'Cedar Foods', '555-0141', 'Palletized produce', 'Fresno', 'CA', 'Dallas', 'TX', inDays(2), 'reefer', 38000, 310000, 'Reefer set to 34F, drop trailer available.'],
  ['L-1043', 'Ironwood Building Supply', '555-0177', 'Lumber bundles', 'Tacoma', 'WA', 'Boise', 'ID', inDays(1), 'flatbed', 44000, 285000, 'Tarps required, chains on driver.'],
  ['L-1044', 'Summit Paper', '555-0102', 'Roll paper', 'Green Bay', 'WI', 'Nashville', 'TN', inDays(4), 'dryvan', 41000, 265000, 'Appointment delivery, 0900-1300.'],
  ['L-1045', 'Harbor Chemicals', '555-0190', 'Non-haz liquid', 'Baton Rouge', 'LA', 'Atlanta', 'GA', inDays(0), 'tanker', 44000, 420000, 'Food-grade tank, washout cert required.'],
];
const trucks = [
  ['Ray Calloway', '555-1000', 'Unit 214', 'dryvan', 45000, 'Dallas', 'TX', inDays(0), 240000, 'Runs Texas corridor, no touch freight.'],
  ['Maria Sandoval', '555-1001', 'Unit 87', 'reefer', 44000, 'Fresno', 'CA', inDays(1), 290000, 'Food-grade, prefers west coast reefer.'],
  ['Dee Okafor', '555-1002', 'Unit 55', 'flatbed', 48000, 'Portland', 'OR', inDays(0), 265000, 'Owns chains and tarps.'],
  ['Bo Halvorsen', '555-1003', 'Unit 3', 'dryvan', 42000, 'Milwaukee', 'WI', inDays(2), 250000, 'Team driver, will run anywhere.'],
  ['Ivy Tran', '555-1004', 'Unit 61', 'tanker', 45000, 'Houston', 'TX', inDays(0), 400000, 'Food-grade tanker, clean only.'],
];

const lIns = db.prepare('INSERT INTO loads (ref,shipper,shipper_phone,commodity,origin_city,origin_state,dest_city,dest_state,pickup_date,equipment,weight_lb,offered_rate_cents,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
for (const r of loads) lIns.run(...r);
const tIns = db.prepare('INSERT INTO trucks (driver,phone,truck_number,equipment,capacity_lb,city,state,available_date,min_rate_cents,notes) VALUES (?,?,?,?,?,?,?,?,?,?)');
for (const r of trucks) tIns.run(...r);

console.log(`seeded ${loads.length} loads, ${trucks.length} trucks`);