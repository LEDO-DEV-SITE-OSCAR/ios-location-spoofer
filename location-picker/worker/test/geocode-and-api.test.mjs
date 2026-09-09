import assert from "node:assert/strict";
import test from "node:test";
import worker, { GeocodeCoordinator } from "../src/index.js";

const candidate = { lat: "47.4627356", lon: "-122.2559156", display_name: "Tukwila, King County, Washington, United States", private_field: "omit" };
const token = "local-test-fixture";
function setup() {
  const data = new Map(), loc = new Map();
  const storage = { get: async key => structuredClone(data.get(key)), put: async (key,value) => { data.set(key,structuredClone(value)); } };
  const coordinator = new GeocodeCoordinator({ storage }, {});
  const internal = [];
  const env = {
    TOKEN: token,
    LOC_KV: { get: async k => loc.get(k), put: async(k,v) => loc.set(k,v) },
    GEOCODER: {
      idFromName: name => { assert.equal(name,"nominatim-global"); return name; },
      get: () => ({ fetch: url => { internal.push(url); return coordinator.fetch(new Request(url)); } }),
    },
  };
  const call = (path, body, given = token) => {
    const url = new URL(path,"https://picker.example");
    if (given !== null) url.searchParams.set("token",given);
    return worker.fetch(new Request(url, body === undefined ? {} : { method:"POST",body:JSON.stringify(body) }),env);
  };
  return { data, loc, storage, coordinator, env, call, internal };
}

test("geocode authenticates and validates before touching coordinator/upstream", async t => {
  const h=setup(); let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{ calls++; return Response.json([]); });
  for (const given of [null,"wrong",""]) assert.equal((await h.call("/geocode?q=Tukwila",undefined,given)).status,403);
  for (const q of ["", " ", "a".repeat(201), "a\u0000b"]) assert.equal((await h.call("/geocode?q="+encodeURIComponent(q))).status,400);
  assert.equal(h.internal.length,0);assert.equal(calls,0);
});

test("geocode returns only eight English-labelled candidates; never forwards credentials", async t => {
  const h=setup();
  t.mock.method(globalThis,"fetch",async(url,opts)=>{
    assert.equal(url.hostname,"nominatim.openstreetmap.org");
    assert.equal(url.searchParams.get("q"),"Tukwila, WA, United States");
    assert.equal(url.searchParams.get("limit"),"8");
    assert.equal(url.searchParams.get("accept-language"),"en");
    assert.equal(url.searchParams.get("token"),null);
    assert.ok(!JSON.stringify(opts).includes(token));
    assert.match(opts.headers["User-Agent"],/LEDO-DEV-SITE-OSCAR/);
    assert.equal(opts.headers["Accept-Language"],"en");
    assert.equal(opts.redirect,"manual");
    return Response.json(Array(10).fill(candidate));
  });
  const response=await h.call("/geocode?q=%20Tukwila%2C%20WA%2C%20United%20States%20");
  assert.equal(response.status,200);
  const results=await response.json();assert.equal(results.length,8);
  assert.deepEqual(results[0],{lat:47.4627356,lng:-122.2559156,label:candidate.display_name});
  assert.ok(!h.internal[0].includes(token));assert.equal(h.loc.size,0);
});

test("persistent bounded cache serves repeated query without another upstream request", async t => {
  const h=setup();let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json([candidate]);});
  assert.equal((await h.call("/geocode?q=Tukwila")).status,200);
  const restarted=new GeocodeCoordinator({storage:h.storage},{});
  assert.equal((await restarted.fetch(new Request("https://internal/?q=tukwila"))).status,200);
  assert.equal(calls,1);
  h.data.set("cache",Array.from({length:64},(_,i)=>({key:String(i),results:[],expires:Date.now()+10000})));
  h.data.set("nextAllowed",0);
  assert.equal((await h.call("/geocode?q=Seattle")).status,200);
  assert.equal(h.data.get("cache").length,64);
});

test("global object rejects overlapping searches and persists cooldown across restart", async t => {
  const h=setup();let release,started;
  const began=new Promise(resolve=>{started=resolve;});
  t.mock.method(globalThis,"fetch",()=>{started();return new Promise(resolve=>{release=resolve;});});
  const first=h.call("/geocode?q=Tukwila");await began;
  const second=await h.call("/geocode?q=Seattle");
  assert.equal(second.status,429);assert.equal(second.headers.get("Retry-After"),"1");
  assert.ok(h.data.get("nextAllowed")>Date.now());
  release(Response.json([candidate]));assert.equal((await first).status,200);
  const restarted=new GeocodeCoordinator({storage:h.storage},{});
  assert.equal((await restarted.fetch(new Request("https://internal/?q=Seattle"))).status,429);
  h.data.set("nextAllowed",Date.now()-1);
  t.mock.method(globalThis,"fetch",async()=>Response.json([]));
  assert.equal((await restarted.fetch(new Request("https://internal/?q=Seattle"))).status,200);
});

test("different concurrent queries share one outbound limit at the 999/1000 ms boundary", async t => {
  const h=setup();
  let now=100000, release, started;
  const outbound=[];
  t.mock.method(Date,"now",()=>now);
  const began=new Promise(resolve=>{started=resolve;});
  t.mock.method(globalThis,"fetch",url=>{
    outbound.push({q:url.searchParams.get("q"),at:Date.now()});
    if(outbound.length===1) {
      started();
      return new Promise(resolve=>{release=resolve;});
    }
    return Promise.resolve(Response.json([]));
  });
  // Distinct Worker env objects represent callers sharing the same DO namespace.
  const otherEnv={...h.env};
  const other=()=>worker.fetch(new Request("https://picker.example/geocode?token="+token+"&q=Seattle"),otherEnv);
  const first=h.call("/geocode?q=Tukwila");
  await began;
  assert.equal((await other()).status,429);
  assert.deepEqual(outbound,[{q:"Tukwila",at:100000}]);
  release(Response.json([candidate]));
  assert.equal((await first).status,200);

  now=100999;
  assert.equal((await other()).status,429);
  // A cache hit within the cooldown does not use the upstream.
  assert.equal((await h.call("/geocode?q=Tukwila")).status,200);
  assert.equal(outbound.length,1);
  now=101000;
  assert.equal((await other()).status,200);
  assert.deepEqual(outbound,[{q:"Tukwila",at:100000},{q:"Seattle",at:101000}]);
  assert.ok(outbound[1].at-outbound[0].at>=1000);
});

test("cache expires and remains small with long Unicode labels", async t => {
  const h=setup();
  const large=Array(8).fill({...candidate,display_name:"界".repeat(500)});
  h.data.set("cache",Array.from({length:64},(_,i)=>({key:String(i),results:large,expires:Date.now()+10000})));
  h.data.get("cache").push({key:"tukwila",results:[],expires:Date.now()-1});
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(large);});
  assert.equal((await h.call("/geocode?q=Tukwila")).status,200);
  assert.equal(calls,1);
  assert.ok(Buffer.byteLength(JSON.stringify(h.data.get("cache")))<=64*1024);
  assert.equal(h.data.get("cache")[0].key,"tukwila");
});

test("non-2xx, malformed JSON/data, oversized payload and network failure return 502", async t => {
  for (const makeResponse of [
    ()=>new Response("unavailable",{status:503}),
    ()=>new Response("",{status:302,headers:{Location:"https://other.example/"}}),
    ()=>new Response("not JSON"),
    ()=>Response.json({invalid:true}),
    ()=>Response.json([{...candidate,lat:""}]),
    ()=>Response.json([{...candidate,lon:181}]),
    ()=>new Response("x".repeat(128*1024+1)),
    ()=>{throw new Error("Network failed");},
  ]) {
    const h=setup();t.mock.method(globalThis,"fetch",async()=>makeResponse());
    const response=await h.call("/geocode?q=Tukwila");
    assert.equal(response.status,502);assert.match((await response.json()).error,/unavailable/i);
    assert.equal(h.data.has("cache"),false);
  }
});

test("upstream timeout aborts and returns 504", async t => {
  const h=setup();
  t.mock.method(globalThis,"setTimeout",fn=>{queueMicrotask(fn);return 0;});
  t.mock.method(globalThis,"fetch",async(url,{signal})=>{
    await Promise.resolve();signal.throwIfAborted();return Response.json([]);
  });
  const response=await h.call("/geocode?q=Tukwila");assert.equal(response.status,504);
  assert.match((await response.json()).error,/timed out/);
});

test("existing endpoints preserve exact location schema, precision, auth and enable state", async () => {
  const h=setup();
  for (const [path,body] of [["/loc.json",undefined],["/set",{lat:1,lng:2}],["/enable",{enabled:false}],["/",undefined]]) {
    assert.equal((await h.call(path,body,"wrong")).status,403);
  }
  const defaults=await (await h.call("/loc.json")).json();
  const expected={...defaults,latitude:47.4624151053,longitude:-122.2553809659,altitude:80,horizontalAccuracy:12,verticalAccuracy:30};
  const saved=await h.call("/set",{lat:expected.latitude,lng:expected.longitude,altitude:80,horizontalAccuracy:12,verticalAccuracy:30});
  assert.equal(saved.status,200);assert.deepEqual(await saved.json(),expected);
  assert.deepEqual(await (await h.call("/loc.json")).json(),expected);
  assert.deepEqual([...h.loc.keys()],["loc"]);
  assert.equal((await (await h.call("/enable",{enabled:false})).json()).enabled,false);
  assert.equal((await (await h.call("/enable",{enabled:true})).json()).enabled,true);
  assert.equal((await h.call("/health",undefined,null)).status,200);
  const page=await h.call("/");assert.equal(page.status,200);
  assert.equal(page.headers.get("Referrer-Policy"),"origin");
  assert.ok(!page.headers.get("Content-Security-Policy").includes("nominatim"));
});

test("/set rejects empty/nonfinite/out-of-range values without overwriting KV", async () => {
  const h=setup();await h.call("/set",{lat:1,lng:2});const initial=h.loc.get("loc");
  for (const value of [null,""," ","NaN","Infinity",true,[],{},91,-91]) {
    assert.equal((await h.call("/set",{lat:value,lng:2})).status,400);
  }
  for (const value of [null,""," ","NaN","Infinity",181,-181]) {
    assert.equal((await h.call("/set",{lat:1,lng:value})).status,400);
  }
  assert.equal(h.loc.get("loc"),initial);
  for (const [lat,lng] of [[90,180],[-90,-180]]) {
    assert.equal((await h.call("/set",{lat,lng})).status,200);
    const result=await (await h.call("/loc.json")).json();
    assert.equal(result.latitude,lat);assert.equal(result.longitude,lng);
  }
});
