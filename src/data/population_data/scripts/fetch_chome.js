// e-Stat 令和2年国勢調査 小地域(町丁・字等)境界データ(人口属性つき)を
// 市区町村コードのリストから一括ダウンロード・解凍する。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '../chome_raw');
fs.mkdirSync(RAW_DIR, { recursive: true });

// 引数: 市区町村コード(5桁)をスペース区切りで渡す
const codes = process.argv.slice(2);
if (codes.length === 0) {
  console.error('usage: node fetch_chome.js <code1> <code2> ...');
  process.exit(1);
}

async function fetchOne(code) {
  const url = `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${code}&coordSys=1&format=shape&downloadType=5`;
  const zipPath = path.join(RAW_DIR, `${code}.zip`);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    console.error(`code=${code}: HTTP ${res.status}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) {
    console.error(`code=${code}: suspiciously small response (${buf.length} bytes), skipping`);
    return false;
  }
  fs.writeFileSync(zipPath, buf);
  const destDir = path.join(RAW_DIR, code);
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`);
  fs.unlinkSync(zipPath); // 解凍済みフォルダと内容が重複するのでzipは残さない
  console.log(`code=${code}: OK (${buf.length} bytes)`);
  return true;
}

async function main() {
  for (const code of codes) {
    try {
      await fetchOne(code);
    } catch (e) {
      console.error(`code=${code}: ERROR ${e}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

main();
