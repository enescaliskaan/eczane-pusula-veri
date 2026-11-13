import { sleep } from './time.mjs';

export const BROWSER_UA =
  process.env.USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Çerezleri saklayan, yönlendirmeleri elle izleyen basit HTTP oturumu. */
export class Session {
  constructor({ timeoutMs = 25_000, userAgent = BROWSER_UA } = {}) {
    this.cookies = new Map();
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
  }

  cookieHeader(url) {
    const host = new URL(url).hostname;
    const list = [];
    for (const [key, value] of this.cookies) {
      const [domain, name] = key.split('|');
      if (host === domain || host.endsWith(`.${domain}`)) list.push(`${name}=${value}`);
    }
    return list.join('; ');
  }

  storeCookies(url, headers) {
    const host = new URL(url).hostname;
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      for (const a of attrs) {
        const [k, v] = a.split('=');
        if (k?.trim().toLowerCase() === 'domain' && v) domain = v.trim().replace(/^\./, '');
      }
      this.cookies.set(`${domain}|${name}`, value);
    }
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    let current = url;
    let currentMethod = method;
    let currentBody = body;
    for (let hop = 0; hop < 6; hop++) {
      const h = { 'User-Agent': this.userAgent, ...headers };
      const cookie = this.cookieHeader(current);
      if (cookie) h.Cookie = cookie;
      if (currentBody === undefined) delete h['Content-Type'];
      const res = await fetch(current, {
        method: currentMethod,
        headers: h,
        body: currentBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      this.storeCookies(current, res.headers);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        if (res.status !== 307 && res.status !== 308) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      const text = await res.text();
      return { status: res.status, ok: res.ok, url: current, text };
    }
    throw new Error(`Çok fazla yönlendirme: ${url}`);
  }

  get(url, headers) {
    return this.request(url, { headers });
  }

  post(url, form, headers = {}) {
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: form instanceof URLSearchParams ? form.toString() : form,
    });
  }
}

/** Ağ hatalarında birkaç kez tekrar dener. */
export async function withRetry(fn, { tries = 3, delayMs = 2000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw last;
}

export async function getJson(url, { headers = {}, timeoutMs = 30_000, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA, ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`JSON değil (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  return json;
}
