// 各町丁目shapefileをパースし、busData.jsonの各バス停に
// 「点がポリゴン内に入っている町丁目」(なければ最寄り重心の町丁目)の人口(JINKO)を割り当てる。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as shapefile from 'shapefile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..');
const RAW_DIR = path.join(DATA_DIR, 'chome_raw');
const BUSDATA_PATH = path.join(DATA_DIR, '../busData.json');

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonGeom(x, y, geometry) {
  if (geometry.type === 'Polygon') {
    if (!pointInRing(x, y, geometry.coordinates[0])) return false;
    // 穴(holes)は無視(小地域データでは稀)
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => pointInRing(x, y, poly[0]));
  }
  return false;
}

async function loadAreasForCode(code) {
  const dir = path.join(RAW_DIR, code);
  const files = fs.readdirSync(dir);
  const shp = files.find(f => f.endsWith('.shp'));
  const dbf = files.find(f => f.endsWith('.dbf'));
  const source = await shapefile.open(path.join(dir, shp), path.join(dir, dbf), { encoding: 'shift-jis' });
  const areas = [];
  let result;
  while (!(result = await source.read()).done) {
    const { properties, geometry } = result.value;
    if (!geometry) continue;
    const jinko = Number(properties.JINKO);
    areas.push({
      cityCode: code,
      cityName: properties.CITY_NAME,
      areaName: properties.S_NAME,
      population: Number.isFinite(jinko) ? jinko : 0,
      centroid: [Number(properties.X_CODE), Number(properties.Y_CODE)],
      geometry,
    });
  }
  return areas;
}

async function main() {
  const codes = fs.readdirSync(RAW_DIR).filter(f => /^\d{5}$/.test(f));
  console.log('municipality codes found:', codes);

  let allAreas = [];
  for (const code of codes) {
    const areas = await loadAreasForCode(code);
    console.log(`  ${code}: ${areas.length} areas loaded`);
    allAreas = allAreas.concat(areas);
  }
  console.log('total areas:', allAreas.length);

  const busData = JSON.parse(fs.readFileSync(BUSDATA_PATH, 'utf8'));
  const assignment = {};
  let containedCount = 0, nearestCount = 0, missingCoords = 0;

  busData.stops.forEach(s => {
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') {
      missingCoords++;
      return;
    }
    const x = s.lng, y = s.lat;
    let match = allAreas.find(a => pointInPolygonGeom(x, y, a.geometry));
    let method = 'contains';
    if (!match) {
      // 最寄り重心の町丁目にフォールバック
      let best = null, bestDist = Infinity;
      for (const a of allAreas) {
        const dx = a.centroid[0] - x, dy = a.centroid[1] - y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = a; }
      }
      match = best;
      method = 'nearest_centroid';
    }
    if (match) {
      if (method === 'contains') containedCount++; else nearestCount++;
      assignment[String(s.id)] = {
        name: s.name,
        cityName: match.cityName,
        areaName: match.areaName,
        population: match.population,
        method,
      };
    }
  });

  console.log(`contained: ${containedCount}, nearest_centroid fallback: ${nearestCount}, missing coords: ${missingCoords}`);
  fs.writeFileSync(path.join(DATA_DIR, 'stop_population.json'), JSON.stringify(assignment, null, 2));
  console.log('wrote stop_population.json');
}

main().catch(e => { console.error(e); process.exit(1); });
