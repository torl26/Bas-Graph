// バス停の緯度経度からNominatim逆ジオコーディングで所属市区町村を調べる。
// Nominatimの利用ポリシーに従い1リクエスト/秒程度に制限している。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const busData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../busData.json'), 'utf8'));
const outPath = path.join(__dirname, '../stop_municipalities.json');

let results = {};
if (fs.existsSync(outPath)) {
  results = JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'bus-network-analysis-research/1.0 (cangzhendi@gmail.com)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const stops = busData.stops.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number');
  let done = 0;
  for (const s of stops) {
    const id = String(s.id);
    if (results[id]) { done++; continue; }
    try {
      const data = await reverseGeocode(s.lat, s.lng);
      const addr = data.address || {};
      const municipality = addr.city || addr.town || addr.village || addr.county || null;
      const pref = addr.state || null;
      results[id] = { name: s.name, lat: s.lat, lng: s.lng, municipality, pref };
    } catch (e) {
      results[id] = { name: s.name, lat: s.lat, lng: s.lng, error: String(e) };
    }
    done++;
    if (done % 20 === 0) {
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
      console.log(`progress: ${done}/${stops.length}`);
    }
    await sleep(1100);
  }
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`done: ${done}/${stops.length}`);
}

main();
