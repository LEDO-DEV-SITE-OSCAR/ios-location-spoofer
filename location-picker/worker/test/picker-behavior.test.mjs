import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { PAGE } from "../src/page.js";

const usa = { lat: 47.4624151053, lng: -122.2553809659 };
const china = { lat: 39.9042, lng: 116.4074 };

function harness(location = usa) {
  const elements = new Map();
  function element() {
    const classes = new Set();
    let value = "";
    return {
      get value() { return value; }, set value(input) { value = String(input); },
      textContent: "", style: {}, children: [], events: {}, disabled: false,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
      addEventListener(name, fn) { this.events[name] = fn; },
      appendChild(child) { this.children.push(child); },
      set innerHTML(value) { this.children = []; },
    };
  }
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const calls = [], layers = [], active = new Set(), stored = new Map();
  let locationCallback;
  const map = {
    events: {}, setView(pos, zoom) { this.center = pos; this.zoom = zoom; },
    getZoom() { return this.zoom; }, hasLayer(layer) { return active.has(layer); },
    on(name, fn) { this.events[name] = fn; },
  };
  const marker = {
    events: {}, setLatLng(pos) { this.pos = pos; }, getLatLng() { return { lat: this.pos[0], lng: this.pos[1] }; },
    addTo() { return this; }, on(name, fn) { this.events[name] = fn; },
  };
  function tile(url, options) {
    const layer = { url, options, events: {}, on(name, fn) { this.events[name] = fn; }, addTo() { active.add(this); return this; } };
    layers.push(layer);
    return layer;
  }
  const context = vm.createContext({
    console, URLSearchParams, Number, Math, JSON, Promise,
    setTimeout: () => 0,
    document: { getElementById: $, createElement: element },
    location: { search: "?token=local-fixture" },
    navigator: { geolocation: { getCurrentPosition(fn) { locationCallback = fn; } } },
    window: { prompt: () => "Favorite" },
    localStorage: { getItem: k => stored.get(k), setItem: (k,v) => stored.set(k,v) },
    L: {
      tileLayer: tile,
      layerGroup: tiles => ({ datum: "gcj", getLayers: () => tiles, addTo() { active.add(this); return this; } }),
      map: () => map, marker: pos => { marker.pos = pos; return marker; },
      control: { layers: definitions => { context.definitions = definitions; return { addTo() {} }; } },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith("/loc.json")) return Response.json({ latitude: location.lat, longitude: location.lng, enabled: true, altitude: 40, horizontalAccuracy: 39, verticalAccuracy: 1000 });
      if (url.startsWith("/geocode")) return Response.json([{ ...usa, label: "Tukwila, Washington, United States" }]);
      if (url.startsWith("/set") || url.startsWith("/enable")) return Response.json({});
      return Response.json({ elevation: [45] });
    },
  });
  vm.runInContext(PAGE.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const ready = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { context, $, calls, map, marker, layers, active, stored, ready, locate: coords => locationCallback({ coords }) };
}

test("English UI and exact coordinate controls", () => {
  const withoutComments = PAGE.split("\n").map(line => line.replace(/\/\/.*$/, "")).join("\n");
  assert.doesNotMatch(withoutComments, /\p{Script=Han}/u);
  assert.match(PAGE, /<html lang="en">/);
  for (const label of ["Latitude", "Longitude", "Use Coordinates", "Save Location", "Restore Real Location", "Current Location", "Amap Street", "Amap Satellite", "OpenStreetMap"]) assert.ok(PAGE.includes(label));
  assert.match(PAGE, /id="lat" type="text"/);
  assert.match(PAGE, /id="lng" type="text"/);
  assert.ok(PAGE.includes("https://tile.openstreetmap.org/{z}/{x}/{y}.png"));
  assert.ok(!PAGE.includes("https://{s}.tile.openstreetmap.org"));
  assert.match(PAGE, /<div class="attribution">Search data: © <a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>OpenStreetMap contributors<\/a><\/div>/);
});

test("exact coordinates preview without persistence, then save unchanged", async () => {
  const h = harness(china); await h.ready();
  h.$("lat").value = " 47.4624151053 "; h.$("lng").value = " -122.2553809659 ";
  h.$("usecoords").events.click(); await h.ready();
  assert.equal(h.context.WGS.lat, usa.lat); assert.equal(h.context.WGS.lng, usa.lng);
  assert.equal(h.$("lng").value, String(usa.lng));
  assert.equal(h.context.saved, false);
  assert.equal(h.marker.pos[0], usa.lat); assert.equal(h.marker.pos[1], usa.lng);
  assert.ok(!h.calls.some(c => c.url.startsWith("/set")));
  h.$("savebtn").events.click(); await h.ready();
  const sent = JSON.parse(h.calls.find(c => c.url.startsWith("/set")).options.body);
  assert.equal(sent.lat, usa.lat); assert.equal(sent.lng, usa.lng);
  assert.equal(h.context.saved, true);
});

test("invalid inputs and unpreviewed edits never call /set", async () => {
  const h = harness(); await h.ready();
  for (const [lat,lng] of [["", "1"], [" ", "1"], ["91", "0"], ["-91", "0"], ["0", "181"], ["0", "-181"], ["NaN", "0"], ["Infinity", "0"], ["0", ""], ["1", "-Infinity"]]) {
    h.$("lat").value = lat; h.$("lng").value = lng;
    h.context.useCoordinates(); h.context.commit();
    assert.ok(h.$("coorderror").textContent);
    assert.equal(h.context.WGS.lat, usa.lat);
  }
  h.$("lat").value = "10"; h.$("lng").value = "20";
  h.context.commit();
  assert.match(h.$("coorderror").textContent, /Use Coordinates/);
  assert.ok(!h.calls.some(c => c.url.startsWith("/set")));
  for (const [lat,lng] of [[90,180],[-90,-180]]) {
    h.$("lat").value=String(lat);h.$("lng").value=String(lng);h.context.useCoordinates();
    assert.equal(h.context.WGS.lat, lat);assert.equal(h.context.WGS.lng, lng);
  }
});

test("Enter/search guards requests; result selects WGS and marker without saving", async () => {
  const h = harness(china); await h.ready();
  h.$("q").value = " Tukwila, WA, United States ";
  h.$("q").events.keydown({ key: "Enter" }); h.context.search();
  assert.equal(h.$("btn").disabled, true);
  await h.ready();
  assert.equal(h.calls.filter(c => c.url.startsWith("/geocode")).length, 1);
  assert.equal(h.$("btn").disabled, false);
  h.$("results").children[0].events.click(); await h.ready();
  assert.equal(h.context.WGS.lng, usa.lng); assert.equal(h.context.saved, false);
  assert.equal(h.$("lat").value, String(usa.lat));
  assert.equal(h.marker.pos[1], usa.lng);
  assert.equal(h.map.center[0], usa.lat); assert.equal(h.map.center[1], usa.lng);
  assert.ok(!h.calls.some(c => c.url.startsWith("/set")));
  assert.ok(!h.calls.some(c => c.url.includes("nominatim")));
});

test("empty results and search errors restore controls with English feedback", async () => {
  const h = harness(); await h.ready(); h.$("q").value = "Missing place";
  for (const [response, message] of [[Response.json([]), /No results found/], [new Response("", { status: 502 }), /Search failed/], [new Response("", { status: 429 }), /wait a moment/]]) {
    h.context.fetch = async () => response;
    await h.context.search();
    assert.match(h.$("toast").textContent, message);assert.equal(h.$("btn").disabled, false);
  }
});

test("USA/China default layers, all switches, tap and drag preserve datum", async () => {
  for (const location of [usa, china]) {
    const h = harness(location); await h.ready();
    assert.equal(h.context.datum, location === usa ? "wgs" : "gcj");
    for (const layer of Object.values(h.context.definitions)) {
      h.map.events.baselayerchange({ layer });
      assert.equal(h.context.WGS.lat, location.lat);assert.equal(h.context.WGS.lng, location.lng);
      const expected = layer.datum === "gcj" ? h.context.GCJ.wgs2gcj(location.lat, location.lng) : [location.lat, location.lng];
      assert.equal(h.marker.pos[0], expected[0]);assert.equal(h.marker.pos[1], expected[1]);
      h.map.events.click({ latlng: { lat: expected[0], lng: expected[1] } });
      assert.ok(Math.abs(h.context.WGS.lat-location.lat) < 1e-8);
      assert.ok(Math.abs(Number(h.$("lng").value)-location.lng) < 1e-8);
      h.marker.events.dragend();
      assert.ok(Math.abs(h.context.WGS.lng-location.lng) < 1e-8);
      // Restore the fixture to test switching independently of round-trip error.
      h.context.previewLocation(location.lat, location.lng);
    }
    assert.ok(!h.calls.some(c => c.url.startsWith("/set")));
  }
});

test("tile failure shows a notice; manual switching has no fallback loop", async () => {
  const h = harness(); await h.ready();
  const osm = h.context.definitions.OpenStreetMap;
  for (let i = 0; i < 3; i++) osm.events.tileerror();
  assert.match(h.$("mapnotice").textContent, /Map tiles could not be loaded/);
  assert.equal(h.context.datum, "wgs");
  h.map.events.baselayerchange({ layer: h.context.definitions["Amap Street"] });
  assert.equal(h.$("mapnotice").textContent, "");
  assert.equal(h.context.WGS.lng, usa.lng);
});

test("OSM -> Amap Street -> Amap Satellite -> OSM leaves canonical WGS exactly unchanged", async () => {
  for(const location of [usa,china]) {
    const h=harness(location); await h.ready();
    const original=h.context.WGS;
    for(const name of ["OpenStreetMap","Amap Street","Amap Satellite","OpenStreetMap"]) {
      const layer=h.context.definitions[name];
      h.map.events.baselayerchange({layer});
      assert.strictEqual(h.context.WGS,original);
      assert.equal(h.context.WGS.lat,location.lat); assert.equal(h.context.WGS.lng,location.lng);
      const expected=layer.datum==="gcj"?h.context.GCJ.wgs2gcj(location.lat,location.lng):[location.lat,location.lng];
      assert.equal(h.marker.pos[0],expected[0]); assert.equal(h.marker.pos[1],expected[1]);
      assert.equal(h.$("lat").value,String(location.lat)); assert.equal(h.$("lng").value,String(location.lng));
    }
    assert.equal(h.context.saved,true);
    assert.ok(!h.calls.some(c=>c.url.startsWith("/set")));
  }
});

test("favorites and current location preview; restore and re-enable keep their API", async () => {
  const h = harness(); await h.ready();
  h.context.addFavorite();
  assert.equal(JSON.parse(h.stored.get("lp_favs_v1"))[0].lng, usa.lng);
  h.context.previewLocation(china.lat, china.lng);
  h.context.applyFavorite(JSON.parse(h.stored.get("lp_favs_v1"))[0]);
  assert.equal(h.$("lng").value, String(usa.lng)); assert.equal(h.context.saved, false);
  h.context.locateCurrent(); assert.match(h.$("toast").textContent, /Restore real location/);
  h.context.toggleEnabled(); await h.ready(); assert.equal(h.context.enabledState, false);
  h.context.locateCurrent(); h.locate({ latitude: china.lat, longitude: china.lng }); await h.ready();
  assert.equal(h.$("lat").value, String(china.lat)); assert.equal(h.context.saved, false);
  h.context.toggleEnabled(); await h.ready(); assert.equal(h.context.enabledState, true);
  assert.equal(h.calls.filter(c => c.url.startsWith("/enable")).length, 2);
  assert.ok(!h.calls.some(c => c.url.startsWith("/set")));
});

test("late elevation response does not move selection or erase input edits", async () => {
  const h = harness(); await h.ready();
  const resolves=[];
  h.context.fetchElevation=()=>new Promise(resolve=>resolves.push(resolve));
  h.context.previewLocation(china.lat,china.lng);
  h.context.previewLocation(usa.lat,usa.lng);
  h.$("lat").value="12.123456789";
  resolves[1](50); resolves[0](900); await h.ready();
  assert.equal(h.$("alt").value,"50");
  assert.equal(h.$("lat").value,"12.123456789");
  assert.equal(h.context.WGS.lng,usa.lng);
});
