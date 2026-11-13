const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ouml: 'ö',
  Ouml: 'Ö',
  uuml: 'ü',
  Uuml: 'Ü',
};

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? match;
  });
}

export function stripTags(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : undefined;
}

/** HTML içindeki tabloları basitçe ayrıştırır (iç içe tablolar desteklenmez). */
export function parseTables(html) {
  const tables = [];
  for (const tm of String(html).matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const body = tm[2];
    let headers = [];
    const rows = [];
    for (const rm of body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rm[0];
      const cells = [];
      let hasTd = false;
      for (const cm of rm[2].matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
        if (cm[1].toLowerCase() === 'td') hasTd = true;
        cells.push({
          tag: cm[1].toLowerCase(),
          text: stripTags(cm[3]),
          html: cm[3],
          label: attr(cm[2], 'data-label') ?? attr(cm[2], 'data-title') ?? attr(cm[2], 'title'),
        });
      }
      if (cells.length === 0) continue;
      if (!hasTd && headers.length === 0) {
        headers = cells.map((c) => c.text);
      } else if (hasTd) {
        rows.push({ cells, html: rowHtml });
      }
    }
    tables.push({ attrs: tm[1], headers, rows });
  }
  return tables;
}

// Türkiye sınırları (kaba)
export function inTurkey(lat, lon) {
  return lat >= 35.5 && lat <= 42.5 && lon >= 25.5 && lon <= 45.0;
}

export function normalizeLatLon(a, b) {
  const x = typeof a === 'string' ? parseFloat(a.replace(',', '.')) : a;
  const y = typeof b === 'string' ? parseFloat(b.replace(',', '.')) : b;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (inTurkey(x, y)) return [x, y];
  if (inTurkey(y, x)) return [y, x];
  return null;
}

const COORD_PATTERNS = [
  /[?&;](?:q|ll|query|destination|daddr|center|sll|coordinates?)=\s*(-?\d{1,2}\.\d{3,})\s*(?:,|%2C)\s*(-?\d{1,3}\.\d{3,})/i,
  /@(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,
  /data-lat(?:itude)?\s*=\s*["']?(-?\d{1,2}[.,]\d{3,})["']?[\s\S]{0,200}?data-(?:lng|lon|long|longitude)\s*=\s*["']?(-?\d{1,3}[.,]\d{3,})/i,
  /enlem[^0-9-]{0,30}(-?\d{1,2}[.,]\d{3,})[\s\S]{0,120}?boylam[^0-9-]{0,30}(-?\d{1,3}[.,]\d{3,})/i,
  /\(\s*["']?(-?\d{2}\.\d{4,})["']?\s*,\s*["']?(-?\d{2}\.\d{4,})["']?\s*\)/,
];

/** Bir satırın HTML'indeki harita bağlantısı / data-* özniteliklerinden koordinat çıkarır. */
export function extractCoords(html) {
  const s = String(html ?? '');
  // data-lng önce gelirse
  const rev = s.match(
    /data-(?:lng|lon|long|longitude)\s*=\s*["']?(-?\d{1,3}[.,]\d{3,})["']?[\s\S]{0,200}?data-lat(?:itude)?\s*=\s*["']?(-?\d{1,2}[.,]\d{3,})/i,
  );
  if (rev) {
    const c = normalizeLatLon(rev[2], rev[1]);
    if (c) return c;
  }
  for (const re of COORD_PATTERNS) {
    const m = s.match(re);
    if (m) {
      const c = normalizeLatLon(m[1], m[2]);
      if (c) return c;
    }
  }
  return null;
}
