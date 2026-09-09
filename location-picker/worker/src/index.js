/**
 * iOS Location Picker — Cloudflare Worker
 *
 * API（与 location-picker/server.js 兼容）：
 *   GET  /loc.json?token=   → 读取坐标 JSON（Loon / Shadowrocket configUrl）
 *   POST /set?token=        → 保存坐标
 *   GET  /?token=           → 地图选点网页（必须带正确 token）
 */

import { PAGE } from "./page.js";

const KV_KEY = "loc";

const DEFAULT = {
  enabled: true,          // false = 脚本放行原始响应（恢复真实定位）
  latitude: 37.3349,
  longitude: -122.00902,
  altitude: 530,
  horizontalAccuracy: 39,
  verticalAccuracy: 1000,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // 选点页 URL 带 ?token=，务必阻止它经 Referer 泄漏给 unpkg / 高德 / OSM / open-meteo / nominatim
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

// 选点页专属 CSP：页面 URL 带 token，锁死脚本来源与可连接域名做纵深防御，
// 万一 CDN 被投毒也无法把 token 外传。script/style 需 'unsafe-inline'（页面自身内联），
// 外部脚本只放行 unpkg（已配 SRI）；connect 只放行地图/地理编码接口。
const PAGE_CSP = [
  "default-src 'none'",
  "script-src https://unpkg.com 'unsafe-inline'",
  "style-src https://unpkg.com 'unsafe-inline'",
  "img-src 'self' https: data:", // 地图瓦片（高德 wprd0*/webst0*、OSM 多子域）
  "connect-src 'self' https://api.open-meteo.com",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function jsonResponse(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

function textResponse(body, contentType, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

function unauthorized() {
  return jsonResponse({ error: "bad token" }, 403);
}

// 常量时间比较，避免通过响应时延逐字节爆破 token
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (ab.length !== bb.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function checkToken(request, env) {
  const configured = env.TOKEN;
  if (!configured) {
    return { ok: false, error: "server misconfigured: TOKEN secret not set" };
  }
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token == null || !safeEqual(token, configured)) {
    return { ok: false, error: "bad token" };
  }
  return { ok: true };
}

async function readLoc(env) {
  try {
    const raw = await env.LOC_KV.get(KV_KEY);
    if (!raw) {
      return { ...DEFAULT };
    }
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT };
  }
}

async function writeLoc(env, obj) {
  await env.LOC_KV.put(KV_KEY, JSON.stringify(obj));
}

function setInt(target, key, value) {
  if (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value))) {
    target[key] = Math.round(Number(value));
  }
}

function coordinate(value, min, max) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function searchQuery(url) {
  const q = (url.searchParams.get("q") || "").trim();
  return q && q.length <= 200 && !/[\u0000-\u001f\u007f]/.test(q) ? q : null;
}

// One named object for this deployment: all users share the upstream limit.
// Storage survives object eviction; LOC_KV and its `loc` key are never touched.
export class GeocodeCoordinator {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
    this.busy = false;
  }

  async fetch(request) {
    const q = searchQuery(new URL(request.url));
    if (request.method !== "GET" || !q) {
      return jsonResponse({ error: "Enter a place name between 1 and 200 characters." }, 400);
    }
    if (this.busy) return this.rateLimited();
    this.busy = true;
    let timer;
    let reserved = false;
    try {
      const now = Date.now();
      const cache = (await this.storage.get("cache")) || [];
      const key = q.toLowerCase();
      const hit = cache.find(entry => entry.key === key && entry.expires > now);
      if (hit) return jsonResponse(hit.results);
      if (now < ((await this.storage.get("nextAllowed")) || 0)) return this.rateLimited();

      // Also protects against a restart while the upstream request is in flight.
      await this.storage.put("nextAllowed", now + 10000);
      reserved = true;
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 8000);
      // Operator-controlled override allows changing provider without a code update.
      const target = new URL(this.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search");
      if (target.protocol !== "https:" || target.username || target.password) {
        return jsonResponse({ error: "Search provider is misconfigured." }, 503);
      }
      target.search = new URLSearchParams({
        q, format: "jsonv2", addressdetails: "0", limit: "8", "accept-language": "en",
      }).toString();
      const upstream = await fetch(target, {
        headers: {
          "User-Agent": "ios-location-picker/1.0 (+https://github.com/LEDO-DEV-SITE-OSCAR/ios-location-spoofer)",
          "Accept-Language": "en", Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "manual",
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return jsonResponse({ error: "Search provider is unavailable. Please try again later." }, 502);
      }
      const reader = upstream.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) {
          await reader.cancel();
          throw new Error("Oversized geocode response");
        }
        chunks.push(value);
      }
      const data = JSON.parse(await new Blob(chunks).text());
      if (!Array.isArray(data)) throw new Error("Invalid geocode response");
      const results = data.slice(0, 8).map(item => {
        const lat = coordinate(item?.lat, -90, 90);
        const lng = coordinate(item?.lon, -180, 180);
        if (lat === null || lng === null || typeof item.display_name !== "string" || !item.display_name.trim()) {
          throw new Error("Invalid geocode candidate");
        }
        return { lat, lng, label: item.display_name.trim().slice(0, 500) };
      });
      const nextCache = [
        { key, results, expires: Date.now() + 86400000 },
        ...cache.filter(entry => entry.key !== key && entry.expires > now),
      ].slice(0, 64);
      // Bound bytes as well as entries: long Unicode labels can be much larger.
      while (new TextEncoder().encode(JSON.stringify(nextCache)).byteLength > 64 * 1024) nextCache.pop();
      await this.storage.put("cache", nextCache);
      return jsonResponse(results);
    } catch (error) {
      const timedOut = error.name === "AbortError" || error.name === "TimeoutError";
      return jsonResponse({ error: timedOut ? "Search timed out. Please try again." : "Search is unavailable. Please try again." }, timedOut ? 504 : 502);
    } finally {
      clearTimeout(timer);
      try {
        if (reserved) await this.storage.put("nextAllowed", Date.now() + 1000);
      } finally {
        this.busy = false;
      }
    }
  }

  rateLimited() {
    const response = jsonResponse({ error: "Please wait a moment before searching again." }, 429);
    response.headers.set("Retry-After", "1");
    return response;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const auth = checkToken(request, env);

    if (url.pathname === "/geocode" && request.method === "GET") {
      if (!auth.ok) return unauthorized();
      const q = searchQuery(url);
      if (!q) return jsonResponse({ error: "Enter a place name between 1 and 200 characters." }, 400);
      try {
        const id = env.GEOCODER.idFromName("nominatim-global");
        // A new request, not the user's request: no token, cookies or Referer.
        return await env.GEOCODER.get(id).fetch("https://geocoder.internal/?" + new URLSearchParams({ q }));
      } catch {
        return jsonResponse({ error: "Search is unavailable. Please try again." }, 503);
      }
    }

    if (url.pathname === "/loc.json" && request.method === "GET") {
      if (!auth.ok) {
        return unauthorized();
      }
      const loc = await readLoc(env);
      return jsonResponse(loc);
    }

    if (url.pathname === "/set" && request.method === "POST") {
      if (!auth.ok) {
        return unauthorized();
      }
      let bodyText;
      try {
        bodyText = await request.text();
        if (bodyText.length > 10000) {
          return jsonResponse({ error: "payload too large" }, 413);
        }
        const j = JSON.parse(bodyText);
        const la = coordinate(j?.lat, -90, 90);
        const lo = coordinate(j?.lng, -180, 180);
        if (la === null || lo === null) {
          return jsonResponse({ error: "bad coords" }, 400);
        }
        const cur = await readLoc(env);
        cur.enabled = true; // 保存一个新位置 = 开启伪造
        cur.latitude = la;
        cur.longitude = lo;
        setInt(cur, "altitude", j.altitude);
        setInt(cur, "horizontalAccuracy", j.horizontalAccuracy);
        setInt(cur, "verticalAccuracy", j.verticalAccuracy);
        await writeLoc(env, cur);
        return jsonResponse(cur);
      } catch {
        return jsonResponse({ error: "bad json" }, 400);
      }
    }

    // ---- 一键切换：伪造 / 恢复真实定位 ----
    if (url.pathname === "/enable" && request.method === "POST") {
      if (!auth.ok) {
        return unauthorized();
      }
      let bodyText;
      try {
        bodyText = await request.text();
        if (bodyText.length > 10000) {
          return jsonResponse({ error: "payload too large" }, 413);
        }
        const j = JSON.parse(bodyText);
        const cur = await readLoc(env);
        cur.enabled = j.enabled !== false; // false=恢复真实定位（脚本放行）
        await writeLoc(env, cur);
        return jsonResponse(cur);
      } catch (error) {
        return jsonResponse({ error: "bad json" }, 400);
      }
    }

    if ((url.pathname === "/" || url.pathname === "") && request.method === "GET") {
      if (!auth.ok) {
        return unauthorized();
      }
      return new Response(PAGE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": PAGE_CSP,
          ...CORS,
          // OSM requires a Referer; origin alone never exposes the query token.
          "Referrer-Policy": "origin",
        },
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, kv: !!env.LOC_KV, tokenConfigured: !!env.TOKEN });
    }

    // 浏览器会自动请求 favicon；这里静默返 204，避免落到 404 分支产生噪音日志
    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204, headers: CORS });
    }

    return textResponse("not found", "text/plain", 404);
  },
};
