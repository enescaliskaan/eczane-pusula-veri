// Ağ gerektirmeyen testler: sahte e-Devlet ve İzmir sunucusu ile uçtan uca deneme.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
let passed = 0;
// Alt süreci eşzamansız çalıştır (sahte sunucu aynı süreçte yanıt verebilsin)
const runNode = (argv, opts) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, argv, opts);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n`, e);
    process.exitCode = 1;
  }
};

// ---------- Sahte sunucu ----------
const TOKEN = 'abc123XYZ';
const RESULT_TABLE = `
<div class="resultContainer"><table class="resultTable">
<thead><tr><th>İlçe</th><th>Eczane Adı</th><th>Adres</th><th>Telefon</th><th>Nöbet Başlangıç</th><th>Nöbet Bitiş</th></tr></thead>
<tbody>
<tr><td>KADIKÖY</td><td>ŞİFA ECZANESİ</td><td>Caferağa Mah. Moda Cad. No:5</td><td>(0216) 555 11 22</td><td>13/11/2026 08:30</td><td>14/11/2026 08:30</td>
<td><a href="https://www.google.com/maps?q=40.9871,29.0262">Harita</a></td></tr>
<tr><td>ÜSKÜDAR</td><td>HAYAT ECZANESİ</td><td>Mimar Sinan Mah. No:1 &amp; 2</td><td>02163334455</td><td>13.11.2026 09:00</td><td>14.11.2026 09:00</td></tr>
</tbody></table></div>`;

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cookie = req.headers.cookie ?? '';
    if (url.pathname === '/izmir') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          { ADI: 'DENİZ ECZANESİ', BOLGE: 'KONAK', ADRES: 'Alsancak', TELEFON: '2324445566', LOKASYON_X: 27.1428, LOKASYON_Y: 38.4237, TARIH: '2026-11-13T00:00:00' },
        ]),
      );
      return;
    }
    if (url.pathname !== '/nobetci') {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'GET' && !url.search) {
      res.writeHead(200, { 'Set-Cookie': 'TURKIYESESSIONID=s1; Path=/; HttpOnly', 'Content-Type': 'text/html' });
      res.end(`<form method="post" action="?submit"><input type="hidden" name="token" value="${TOKEN}"/></form>`);
      return;
    }
    if (req.method === 'POST' && url.search === '?submit') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const okCookie = cookie.includes('TURKIYESESSIONID=s1');
        const okToken = form.get('token') === TOKEN;
        const il = form.get('ilkod');
        if (!okCookie || !okToken || !form.get('nobetTarihi')?.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          res.writeHead(403).end('yasak');
          return;
        }
        res.writeHead(302, { Location: `/nobetci?sonuc=1&il=${il}` });
        res.end();
      });
      return;
    }
    if (req.method === 'GET' && url.searchParams.get('sonuc') === '1') {
      if (!cookie.includes('TURKIYESESSIONID=s1')) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const il = url.searchParams.get('il');
      res.end(il === '34' ? RESULT_TABLE : '<div class="warningContainer">Aradığınız kriterlere uygun kayıt bulunamadı.</div>');
      return;
    }
    res.writeHead(400).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
process.env.EDEVLET_URL = `${base}/nobetci`;
process.env.IZMIR_URL = `${base}/izmir`;

const { parseEdevletResult, findToken, fetchEdevlet } = await import('../src/sources/edevlet.mjs');
const { parseIzmir } = await import('../src/sources/izmir.mjs');
const { Session } = await import('../src/http.mjs');
const { extractCoords, parseTables } = await import('../src/html.mjs');
const { parseTrDateTime, addDays, edevletDate } = await import('../src/time.mjs');
const { resolveCoordinates } = await import('../src/coords.mjs');
const { titleCaseTr, slugTr, cleanPhone } = await import('../src/text.mjs');
const { PROVINCES } = await import('../src/provinces.mjs');

await test('81 il, benzersiz slug', () => {
  assert.equal(PROVINCES.length, 81);
  assert.equal(new Set(PROVINCES.map((p) => p.slug)).size, 81);
  assert.equal(PROVINCES[33].name, 'İstanbul');
  assert.equal(PROVINCES[33].iso, 'TR-34');
  assert.equal(slugTr('Iğdır'), 'igdir');
});

await test('metin yardımcıları', () => {
  assert.equal(titleCaseTr('ŞİFA ECZANESİ'), 'Şifa Eczanesi');
  assert.equal(titleCaseTr('Moda Eczanesi'), 'Moda Eczanesi');
  assert.equal(cleanPhone('(0216) 555 11 22'), '0 (216) 555 11 22');
  assert.equal(cleanPhone('2324445566'), '0 (232) 444 55 66');
});

await test('tarih/saat', () => {
  assert.equal(parseTrDateTime('13/11/2026 08:30'), '2026-11-13T05:30:00.000Z');
  assert.equal(parseTrDateTime('13.11.2026 09:00:00'), '2026-11-13T06:00:00.000Z');
  assert.equal(parseTrDateTime('08:30', '2026-11-13'), '2026-11-13T05:30:00.000Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(edevletDate('2026-11-03'), '03/11/2026');
});

await test('token bulma', () => {
  assert.equal(findToken('<input type="hidden" name="token" value="t1">'), 't1');
  assert.equal(findToken('<input value="t2" type="hidden" name="token" />'), 't2');
  assert.equal(findToken('<b>yok</b>'), null);
});

await test('koordinat çıkarma', () => {
  assert.deepEqual(extractCoords('<a href="https://maps.google.com/?q=41.0123,28.9876">x</a>'), [41.0123, 28.9876]);
  assert.deepEqual(extractCoords('<a data-lng="27.1428" data-lat="38.4237">'), [38.4237, 27.1428]);
  assert.deepEqual(extractCoords("haritadaGoster('39.9208','32.8541')"), [39.9208, 32.8541]);
  assert.deepEqual(extractCoords('https://www.google.com/maps/dir/?api=1&destination=29.0262,40.9871'), [40.9871, 29.0262]);
  assert.equal(extractCoords('tel: 0212 555 11 22'), null);
});

await test('e-Devlet tablosu (başlıklı)', () => {
  const r = parseEdevletResult(RESULT_TABLE, { dateKey: '2026-11-13', ilName: 'İstanbul' });
  assert.equal(r.status, 'ok');
  assert.equal(r.pharmacies.length, 2);
  const [a, b] = r.pharmacies;
  assert.equal(a.name, 'Şifa Eczanesi');
  assert.equal(a.district, 'Kadıköy');
  assert.equal(a.lat, 40.9871);
  assert.equal(a.dutyStart, '2026-11-13T05:30:00.000Z');
  assert.equal(a.dutyEnd, '2026-11-14T05:30:00.000Z');
  assert.equal(b.address, 'Mimar Sinan Mah. No:1 & 2');
  assert.equal(b.lat, undefined);
});

await test('e-Devlet tablosu (data-label, başlıksız)', () => {
  const html = `<table><tr><td data-label="Eczane Adı">MODA ECZANESİ</td><td data-label="İlçe">Kadıköy</td><td data-label="Telefon">0216 111 22 33</td><td data-label="Adres">Moda</td><td data-label="Nöbet Başlangıç Tarihi">13/11/2026 19:00</td><td data-label="Nöbet Bitiş Tarihi">08:30</td></tr></table>`;
  const r = parseEdevletResult(html, { dateKey: '2026-11-13', ilName: 'İstanbul' });
  assert.equal(r.status, 'ok');
  assert.equal(r.pharmacies[0].name, 'Moda Eczanesi');
  assert.equal(r.pharmacies[0].phone, '0 (216) 111 22 33');
  assert.equal(r.pharmacies[0].dutyEnd, '2026-11-14T05:30:00.000Z');
});

await test('e-Devlet boş ve bilinmeyen sayfa', () => {
  assert.equal(parseEdevletResult('<p>Kayıt bulunamadı.</p>', { dateKey: '2026-11-13' }).status, 'empty');
  assert.equal(parseEdevletResult('<p>Güvenlik doğrulaması</p>', { dateKey: '2026-11-13' }).status, 'error');
  assert.equal(parseTables('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>')[0].rows.length, 1);
});

await test('e-Devlet akışı (çerez + token + yönlendirme)', async () => {
  const session = new Session();
  const r = await fetchEdevlet(session, PROVINCES[33], '2026-11-13');
  assert.equal(r.status, 'ok');
  assert.equal(r.pharmacies.length, 2);
  const empty = await fetchEdevlet(session, PROVINCES[25], '2026-11-13');
  assert.equal(empty.status, 'empty');
});

await test('İzmir verisi (büyük harfli alanlar, ters koordinat)', () => {
  const items = parseIzmir([{ ADI: 'DENİZ ECZANESİ', LOKASYON_X: 27.1428, LOKASYON_Y: 38.4237, BOLGE: 'KONAK' }]);
  assert.equal(items[0].name, 'Deniz Eczanesi');
  assert.equal(items[0].lat, 38.4237);
  assert.equal(items[0].lon, 27.1428);
  assert.equal(items[0].district, 'Konak');
  assert.equal(parseIzmir({ Data: [{ Adi: 'Ege Eczanesi', LokasyonX: 38.4, LokasyonY: 27.1 }] })[0].lat, 38.4);
});

await test('koordinat: OSM eşleştirme + önbellek', async () => {
  const osmRows = [
    [40.99, 29.03, 'Hayat Eczanesi', 'Mimar Sinan, Üsküdar', '', '', 'Üsküdar'],
    [41.05, 29.0, 'Hayat Eczanesi', 'Beşiktaş', '', '', 'Beşiktaş'],
    [41.1, 28.9, 'Nur Eczanesi', 'Sarıyer', '', '', 'Sarıyer'],
  ];
  const geocache = {};
  const list = [
    { name: 'Hayat Eczanesi', district: 'Üsküdar', address: 'x' },
    { name: 'Nur Eczanesi', district: 'Sarıyer', address: 'y' },
    { name: 'Bilinmez Eczanesi', district: 'Fatih', address: 'z' },
  ];
  const stats = await resolveCoordinates(PROVINCES[33], list, { geocache, osmRows, budget: { nominatimLeft: 0 } });
  assert.equal(stats.osm, 2);
  assert.equal(stats.missing, 1);
  assert.equal(list[0].lat, 40.99);
  const again = [{ name: 'HAYAT ECZANESİ', district: 'Üsküdar' }];
  const s2 = await resolveCoordinates(PROVINCES[33], again, { geocache, osmRows: [], budget: { nominatimLeft: 0 } });
  assert.equal(s2.cache, 1);
});

await test('uçtan uca çalışma (İstanbul + İzmir + boş il)', async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'eczane-veri-'));
  try {
    const run = await runNode(['src/run.mjs', '--out', out, '--only', '34,35,26', '--no-osm', '--no-nominatim'], {
      cwd: root,
      env: { ...process.env, EDEVLET_DELAY_MS: '0', NOSY_API_KEY: '' },
    });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const ist = JSON.parse(readFileSync(path.join(out, 'v1/il/34.json'), 'utf8'));
    assert.ok(ist.days.length >= 1);
    assert.equal(ist.days[0].pharmacies.length, 2);
    assert.equal(ist.days[0].source, 'edevlet');
    assert.ok(ist.days[0].pharmacies[0].id);
    const izm = JSON.parse(readFileSync(path.join(out, 'v1/il/35.json'), 'utf8'));
    assert.ok(izm.days.some((d) => d.source === 'izmir'));
    assert.match(izm.attribution, /CC BY/);
    const index = JSON.parse(readFileSync(path.join(out, 'v1/index.json'), 'utf8'));
    assert.equal(index.provinces.length, 3);
    const esk = index.provinces.find((p) => p.plaka === 26);
    assert.equal(esk.count, 0);
    assert.ok(readFileSync(path.join(out, 'index.html'), 'utf8').includes('Eczane Pusula'));

    // İkinci çalışma: e-Devlet boş dönse bile önceki dolu veri silinmemeli
    process.env.EDEVLET_URL = `${base}/yok`;
    const run2 = await runNode(['src/run.mjs', '--out', out, '--only', '34', '--no-osm', '--no-nominatim'], {
      cwd: root,
      env: { ...process.env, EDEVLET_DELAY_MS: '0', NOSY_API_KEY: '' },
    });
    assert.equal(run2.status, 1, 'e-Devlet tamamen başarısızsa çıkış kodu 1 olmalı');
    const ist2 = JSON.parse(readFileSync(path.join(out, 'v1/il/34.json'), 'utf8'));
    assert.equal(ist2.days[0].pharmacies.length, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

server.close();
console.log(`\n${passed} test geçti${process.exitCode ? ' — HATALAR VAR' : ''}.`);
