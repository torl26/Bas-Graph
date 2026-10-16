// 久留米市のバス停データをOverpass APIから取得する
// 行政境界での絞り込みは、area["name"="..."]による名前検索だと
// 公開Overpassインスタンスで504/429になりやすい。
// そこで久留米市の行政境界リレーション(OSM relation id: 4008314)を
// area idに変換して直接指定する(area id = 3600000000 + relation id)。
// これなら名前検索を伴わないため速く、かつ市境界で正確に絞り込める。
const KURUME_RELATION_ID = 4008314;
const KURUME_AREA_ID = 3600000000 + KURUME_RELATION_ID;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export async function fetchBusStops() {
  const query = `
    [out:json][timeout:30];
    area(${KURUME_AREA_ID})->.kurume;
    (
      node[highway=bus_stop](area.kurume);
      node[public_transport=stop_position](area.kurume);
      node[public_transport=platform](area.kurume);
    );
    out body;
  `;

  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data = await res.json();
  return data.elements;
}

// バス路線（relation）のデータも取得してエッジを作る
export async function fetchBusRoutes() {
  const query = `
    [out:json][timeout:60];
    area(${KURUME_AREA_ID})->.kurume;
    relation[route=bus](area.kurume);
    out body;
    >;
    out skel qt;
  `;

  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data = await res.json();
  return data.elements;
}
