// 与 location-picker/server.js 的 PAGE 保持一致（地图选点 UI）
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Location Picker</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" crossorigin="anonymous">
<style>
  html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
  .bar{padding:8px;display:flex;gap:6px;box-sizing:border-box}
  .bar{flex-wrap:wrap}
  .bar input{min-width:0;flex:1 1 160px;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:8px}
  .bar button{padding:10px 14px;font-size:16px;border:0;border-radius:8px;background:#007aff;color:#fff}
  .bar button:disabled{opacity:.55}
  .results{margin:0 8px;border:1px solid #e2e2e2;border-radius:8px;max-height:34vh;overflow:auto;display:none}
  .results.show{display:block}
  .rrow{padding:10px 12px;font-size:14px;border-bottom:1px solid #eee;color:#222;display:flex;align-items:center;gap:8px}
  .rrow:last-child{border-bottom:0}
  .rrow:active{background:#f0f6ff}
  .rrow .fname{flex:1;min-width:0}
  .rrow .fdel{padding:6px 10px;font-size:13px;border:0;border-radius:6px;background:#ff3b30;color:#fff;flex-shrink:0}
  #map{height:52vh;min-height:260px}
  .coords{display:flex;flex-wrap:wrap;gap:8px;padding:8px 10px;align-items:flex-end}
  .coords label{display:flex;flex:1 1 140px;flex-direction:column;font-size:13px}
  .coords input{min-width:0;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:6px}
  .coords button{padding:10px;font-size:15px;border:0;border-radius:6px;background:#007aff;color:white}
  #coorderror,#mapnotice{padding:4px 10px;color:#9b3b00;font-size:14px}
  #mapnotice:empty,#coorderror:empty{display:none}
  .attribution{padding:4px 10px;font-size:12px}
  button.rrow{width:100%;background:white;border:0;text-align:left;cursor:pointer}
  #info{padding:8px 10px;font-size:13px;line-height:1.4}
  .opts{padding:6px 10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
  .opts label{font-size:13px;color:#444;display:flex;flex-direction:column}
  .opts input{width:88px;padding:8px;font-size:15px;border:1px solid #ccc;border-radius:6px;margin-top:2px}
  #savebtn{padding:11px 20px;font-size:16px;border:0;border-radius:8px;background:#34c759;color:#fff;font-weight:600}
  #restorebtn{padding:11px 16px;font-size:15px;border:0;border-radius:8px;background:#8e8e93;color:#fff}
  #favadd,#favlistbtn{padding:11px 14px;font-size:15px;border:0;border-radius:8px;background:#5856d6;color:#fff}
  .toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,.85);color:#fff;padding:10px 16px;border-radius:8px;
    font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999}
  .toast.show{opacity:1}
</style>
</head>
<body>
<div class="bar">
  <input id="q" aria-label="Search for a place" maxlength="200" placeholder="Search for a place">
  <button id="locatebtn" disabled>Current Location</button>
  <button id="btn">Search</button>
</div>
<div class="results" id="results"></div>
<div class="coords">
  <label>Latitude<input id="lat" type="text" inputmode="text" autocomplete="off" spellcheck="false" aria-describedby="coorderror"></label>
  <label>Longitude<input id="lng" type="text" inputmode="text" autocomplete="off" spellcheck="false" aria-describedby="coorderror"></label>
  <button id="usecoords">Use Coordinates</button>
</div>
<div id="coorderror" role="alert"></div>
<div id="map"></div>
<div id="mapnotice" role="status"></div>
<div class="attribution">Search data: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></div>
<div id="info" role="status">Loading…</div>
<div class="opts">
  <label>Altitude (m)<input id="alt" type="number" inputmode="numeric"></label>
  <label>Horizontal Accuracy<input id="hacc" type="number" inputmode="numeric"></label>
  <label>Vertical Accuracy<input id="vacc" type="number" inputmode="numeric"></label>
  <button id="savebtn">Save Location</button>
  <button id="restorebtn">Restore Real Location</button>
  <button id="favadd">Favorite This Location</button>
  <button id="favlistbtn">My Favorites</button>
</div>
<div class="results" id="favs"></div>
<div class="toast" id="toast" role="status"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH" crossorigin="anonymous"></script>
<script>
var token = new URLSearchParams(location.search).get("token") || "";

var GCJ = (function(){
  var PI = Math.PI, a = 6378245.0, ee = 0.00669342162296594323;
  function outOfChina(lat,lng){return (lng<72.004||lng>137.8347)||(lat<0.8293||lat>55.8271);}
  function tLat(x,y){
    var r=-100.0+2.0*x+3.0*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x));
    r+=(20.0*Math.sin(6.0*x*PI)+20.0*Math.sin(2.0*x*PI))*2.0/3.0;
    r+=(20.0*Math.sin(y*PI)+40.0*Math.sin(y/3.0*PI))*2.0/3.0;
    r+=(160.0*Math.sin(y/12.0*PI)+320*Math.sin(y*PI/30.0))*2.0/3.0;return r;
  }
  function tLng(x,y){
    var r=300.0+x+2.0*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
    r+=(20.0*Math.sin(6.0*x*PI)+20.0*Math.sin(2.0*x*PI))*2.0/3.0;
    r+=(20.0*Math.sin(x*PI)+40.0*Math.sin(x/3.0*PI))*2.0/3.0;
    r+=(150.0*Math.sin(x/12.0*PI)+300*Math.sin(x/30.0*PI))*2.0/3.0;return r;
  }
  function wgs2gcj(lat,lng){
    if(outOfChina(lat,lng))return [lat,lng];
    var dLat=tLat(lng-105.0,lat-35.0), dLng=tLng(lng-105.0,lat-35.0);
    var radLat=lat/180.0*PI, m=Math.sin(radLat); m=1-ee*m*m; var sm=Math.sqrt(m);
    dLat=(dLat*180.0)/((a*(1-ee))/(m*sm)*PI);
    dLng=(dLng*180.0)/(a/sm*Math.cos(radLat)*PI);
    return [lat+dLat,lng+dLng];
  }
  function gcj2wgs(lat,lng){ // 迭代反解，往返误差 <0.001 米
    if(outOfChina(lat,lng))return [lat,lng];
    var wlat=lat, wlng=lng;
    for(var i=0;i<3;i++){ var g=wgs2gcj(wlat,wlng); wlat+=lat-g[0]; wlng+=lng-g[1]; }
    return [wlat,wlng];
  }
  return {wgs2gcj:wgs2gcj, gcj2wgs:gcj2wgs, outOfChina:outOfChina};
})();

var map, marker;
var WGS = {lat:0, lng:0};
var datum = "gcj";
var saved = true;
var enabledState = true;  // true=伪造中；false=已恢复真实定位（脚本放行）

function $(id){return document.getElementById(id);}
function toast(t){var e=$("toast");e.textContent=t;e.classList.add("show");setTimeout(function(){e.classList.remove("show");},1800);}
function numOrNull(id){var v=$(id).value.trim();return v===""?null:Number(v);}
// Leaflet 在重复世界地图上可能返回 -239 这类经度，需要归一化。
function wrapLng(lng){lng=Number(lng);return lng>=-180&&lng<=180?lng:((((lng+180)%360)+360)%360)-180;}

function setLocateBusy(busy){
  var b=$("locatebtn");
  b.disabled=!!busy;
  b.textContent=busy?"Locating…":"Current Location";
}

function geolocationErrorMessage(err){
  if(err&&err.code===1)return "Location permission denied. Allow location access in Safari settings.";
  if(err&&err.code===2)return "Your current location is unavailable.";
  if(err&&err.code===3)return "Location request timed out. Try again in an open area.";
  return "Could not get your current location.";
}

var FAV_KEY="lp_favs_v1";
var FAV_MAX=12;
function loadFavs(){
  try{
    var raw=localStorage.getItem(FAV_KEY);
    var a=raw?JSON.parse(raw):[];
    return Array.isArray(a)?a:[];
  }catch(e){return [];}
}
function saveFavs(list){
  try{localStorage.setItem(FAV_KEY,JSON.stringify(list.slice(0,FAV_MAX)));}catch(e){}
}
function applyFavorite(it){
  var lat=Number(it.lat), lng=Number(it.lng);
  if(!validCoordinates(lat,lng)){toast("Invalid favorite coordinates.");return;}
  WGS={lat:lat,lng:lng};
  saved=false;
  selectionRevision++;
  if(it.alt!=null&&it.alt!=="")$("alt").value=it.alt;
  if(it.hacc!=null&&it.hacc!=="")$("hacc").value=it.hacc;
  if(it.vacc!=null&&it.vacc!=="")$("vacc").value=it.vacc;
  var p=dispPos();
  marker.setLatLng(p);
  map.setView(p,15);
  syncCoordinates();
  info();
  toast("Favorite loaded. Review it, then save.");
}
function renderFavs(){
  var box=$("favs");
  var list=loadFavs();
  box.innerHTML="";
  if(!list.length){box.classList.remove("show");return;}
  list.forEach(function(it,idx){
    var row=document.createElement("div");
    row.className="rrow";
    var name=document.createElement("span");
    name.className="fname";
    name.textContent=it.name||(Number(it.lat).toFixed(4)+","+Number(it.lng).toFixed(4));
    name.addEventListener("click",function(){
      $("results").classList.remove("show");
      applyFavorite(it);
    });
    var del=document.createElement("button");
    del.className="fdel";
    del.type="button";
    del.textContent="Delete";
    del.addEventListener("click",function(e){
      e.stopPropagation();
      var next=loadFavs();
      next.splice(idx,1);
      saveFavs(next);
      if(next.length)renderFavs();else{box.innerHTML="";box.classList.remove("show");}
      toast("Favorite deleted.");
    });
    row.appendChild(name);
    row.appendChild(del);
    box.appendChild(row);
  });
  box.classList.add("show");
}
function addFavorite(){
  if(!Number.isFinite(WGS.lat)||!Number.isFinite(WGS.lng)){toast("Invalid current coordinates.");return;}
  var def=$("q").value.trim()||(WGS.lat.toFixed(4)+","+WGS.lng.toFixed(4));
  var name=window.prompt("Favorite name",def);
  if(name===null)return;
  name=String(name).trim()||def;
  var list=loadFavs().filter(function(it){
    return Math.abs(Number(it.lat)-WGS.lat)>1e-5||Math.abs(Number(it.lng)-WGS.lng)>1e-5;
  });
  list.unshift({
    name:name,
    lat:WGS.lat,
    lng:WGS.lng,
    alt:numOrNull("alt"),
    hacc:numOrNull("hacc"),
    vacc:numOrNull("vacc"),
    ts:Date.now()
  });
  saveFavs(list);
  renderFavs();
  toast("Favorite saved.");
}
function toggleFavs(){
  var box=$("favs");
  if(box.classList.contains("show")){box.classList.remove("show");return;}
  $("results").classList.remove("show");
  if(!loadFavs().length){toast("No favorites yet.");return;}
  renderFavs();
}

function syncCoordinates(){
  $("lat").value=String(WGS.lat);
  $("lng").value=String(WGS.lng);
  $("coorderror").textContent="";
}
function info(){
  var state=enabledState?"Spoofing enabled":"Real location restored. Toggle Location Services to apply.";
  var tag=saved?"Saved":"Unsaved — select Save Location to apply";
  $("info").textContent=state+" · "+tag+" · WGS-84 "+
    WGS.lat.toFixed(10)+", "+WGS.lng.toFixed(10)+" · Altitude "+($("alt").value||"?")+" m";
}

// 切换按钮外观：伪造中(灰按钮“恢复真实定位”) / 已恢复(橙按钮“重新开启伪造”)
function updateEnabledUI(){
  var b=$("restorebtn");
  if(enabledState){ b.textContent="Restore Real Location"; b.style.background="#8e8e93"; }
  else { b.textContent="Re-enable Spoofing"; b.style.background="#ff9500"; }
  info();
}

// 一键切换 伪造/恢复真实
function toggleEnabled(){
  var want = !enabledState;
  fetch("/enable?token="+encodeURIComponent(token),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:want})})
    .then(function(r){
      if(r.ok){ enabledState=want; updateEnabledUI();
        toast(want ? "Spoofing enabled. Toggle Location Services to apply." : "Real location restored. Toggle Location Services to apply."); }
      else toast("Could not change spoofing state: "+r.status);
    })
    .catch(function(){ toast("Network error. Please try again."); });
}

function dispPos(){return datum==="gcj"?GCJ.wgs2gcj(WGS.lat,WGS.lng):[WGS.lat,WGS.lng];}
function toWgs(lat,lng){lng=wrapLng(lng);return datum==="gcj"?GCJ.gcj2wgs(lat,lng):[lat,lng];}

function fetchElevation(lat,lng){
  lng=wrapLng(lng);
  return fetch("https://api.open-meteo.com/v1/elevation?latitude="+lat+"&longitude="+lng)
    .then(function(r){if(!r.ok)throw new Error("Elevation unavailable");return r.json();})
    .then(function(d){return (d&&d.elevation&&d.elevation.length)?d.elevation[0]:null;})
    .catch(function(){return null;});
}

function validCoordinates(lat,lng){
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
}
function readCoordinates(){
  var latText=$("lat").value.trim(), lngText=$("lng").value.trim();
  var lat=Number(latText), lng=Number(lngText);
  if(!latText||!lngText||!validCoordinates(lat,lng)){
    $("coorderror").textContent="Enter a latitude from -90 to 90 and longitude from -180 to 180. Both must be finite numbers.";
    return null;
  }
  $("coorderror").textContent="";
  return {lat:lat,lng:lng};
}
var selectionRevision=0;
function previewLocation(lat,lng,zoom){
  if(!validCoordinates(lat,lng)){toast("Invalid coordinates.");return;}
  WGS={lat:lat,lng:lng};
  saved=false;
  var revision=++selectionRevision;
  var p=dispPos();
  if(marker)marker.setLatLng(p);
  if(map&&zoom)map.setView(p,zoom);
  syncCoordinates();
  info();
  fetchElevation(lat,lng).then(function(el){
    if(revision!==selectionRevision)return;
    if(el!==null)$("alt").value=Math.round(el);
    info();
  });
}
function useCoordinates(){
  var coords=readCoordinates();
  if(!coords)return;
  previewLocation(coords.lat,coords.lng,16);
}
function movePin(dispLat,dispLng){
  var w=toWgs(dispLat,dispLng);
  previewLocation(w[0],wrapLng(w[1]));
}

function commit(){
  var coords=readCoordinates();
  if(!coords)return;
  if(coords.lat!==WGS.lat||coords.lng!==WGS.lng){
    $("coorderror").textContent="Select Use Coordinates to preview your changes before saving.";
    return;
  }
  var revision=selectionRevision;
  var payload={lat:WGS.lat, lng:WGS.lng,
    altitude:numOrNull("alt"), horizontalAccuracy:numOrNull("hacc"), verticalAccuracy:numOrNull("vacc")};
  fetch("/set?token="+encodeURIComponent(token),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
    .then(function(r){ if(r.ok){ saved=revision===selectionRevision; enabledState=true; updateEnabledUI(); toast("Location saved. Allow your proxy to refresh, then toggle Location Services."); } else { toast("Could not save location: "+r.status); } })
    .catch(function(){ toast("Network error. Please try again."); });
}

function locateCurrent(){
  if(enabledState){
    toast("Restore real location and refresh Location Services first.");
    return;
  }
  if(!navigator.geolocation){
    toast("This browser does not support location access.");
    return;
  }

  setLocateBusy(true);
  navigator.geolocation.getCurrentPosition(
    function(pos){
      var lat=Number(pos&&pos.coords&&pos.coords.latitude);
      var lng=wrapLng(pos&&pos.coords&&pos.coords.longitude);
      if(!validCoordinates(lat,lng)){
        toast("Could not get your current location.");
        setLocateBusy(false);
        return;
      }

      previewLocation(lat,lng,16);
      toast("Current location selected. Review it, then save.");
      setLocateBusy(false);
    },
    function(err){
      toast(geolocationErrorMessage(err));
      setLocateBusy(false);
    },
    {enableHighAccuracy:true,maximumAge:0,timeout:12000}
  );
}

var searchBusy=false;
function search(){
  if(searchBusy)return;
  var q=$("q").value.trim();
  if(!q||q.length>200){toast("Enter a place name between 1 and 200 characters.");return;}
  searchBusy=true;
  $("btn").disabled=true;
  $("btn").textContent="Searching…";
  var box=$("results");box.innerHTML="";box.classList.remove("show");
  return fetch("/geocode?token="+encodeURIComponent(token)+"&q="+encodeURIComponent(q))
    .then(function(r){
      if(!r.ok)throw new Error(r.status===429?"Please wait a moment before searching again.":"Search failed. Please try again.");
      return r.json();
    })
    .then(function(a){
      if(!Array.isArray(a))throw new Error("Search returned an invalid response.");
      if(!a.length){toast("No results found.");return;}
      a.forEach(function(it){
        var row=document.createElement("button");
        row.type="button";row.className="rrow";row.textContent=it.label;
        row.addEventListener("click",function(){
          box.classList.remove("show");box.innerHTML="";
          previewLocation(it.lat,it.lng,15);
          toast("Place selected. Review it, then save.");
        });
        box.appendChild(row);
      });
      box.classList.add("show");
    })
    .catch(function(err){toast(err.message||"Search failed. Please try again.");})
    .finally(function(){searchBusy=false;$("btn").disabled=false;$("btn").textContent="Search";});
}

function switchDatum(layer){
  datum=layer.datum;
  var p=dispPos();
  if(marker)marker.setLatLng(p);
  if(map)map.setView(p,map.getZoom());
  info();
}
function watchTiles(layer,tiles){
  var errors=0;
  tiles.forEach(function(tile){
    tile.on("tileerror",function(){
      if(!map.hasLayer(layer))return;
      errors++;
      if(errors>=3)$("mapnotice").textContent="Map tiles could not be loaded. Check your connection or choose another map layer.";
    });
    tile.on("tileload",function(){
      if(!map.hasLayer(layer))return;
      errors=0;$("mapnotice").textContent="";
    });
  });
}

function load(){
  fetch("/loc.json?token="+encodeURIComponent(token)).then(function(r){if(!r.ok)throw new Error("Could not load location");return r.json();}).then(function(d){
    WGS={lat:d.latitude, lng:d.longitude};
    syncCoordinates();
    saved=true;
    enabledState=(d.enabled!==false);
    $("alt").value=(d.altitude!==undefined?d.altitude:"");
    $("hacc").value=(d.horizontalAccuracy!==undefined?d.horizontalAccuracy:39);
    $("vacc").value=(d.verticalAccuracy!==undefined?d.verticalAccuracy:1000);

    var amapVec=L.tileLayer("https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7",{subdomains:"1234",maxZoom:18,attribution:"Amap Street"});
    amapVec.datum="gcj";
    var amapSat=L.layerGroup([
      L.tileLayer("https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",{subdomains:"1234",maxZoom:18}),
      L.tileLayer("https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8",{subdomains:"1234",maxZoom:18})
    ]);
    amapSat.datum="gcj";
    var osm=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',referrerPolicy:"origin"});
    osm.datum="wgs";

    map=L.map("map");
    var initial=GCJ.outOfChina(WGS.lat,WGS.lng)?osm:amapVec;
    datum=initial.datum;
    watchTiles(amapVec,[amapVec]);
    watchTiles(amapSat,amapSat.getLayers());
    watchTiles(osm,[osm]);
    initial.addTo(map);
    map.setView(dispPos(),13);
    L.control.layers({"Amap Street":amapVec,"Amap Satellite":amapSat,"OpenStreetMap":osm},null,{collapsed:false}).addTo(map);

    marker=L.marker(dispPos(),{draggable:true}).addTo(map);
    updateEnabledUI();
    setLocateBusy(false);

    map.on("baselayerchange",function(e){$("mapnotice").textContent="";switchDatum(e.layer);});
    map.on("click",function(e){movePin(e.latlng.lat,e.latlng.lng);});
    marker.on("dragend",function(){var p=marker.getLatLng(); movePin(p.lat,p.lng);});
  }).catch(function(){$("info").textContent="Could not load location. Check your access token and connection.";});
}

$("usecoords").addEventListener("click",useCoordinates);
$("btn").addEventListener("click",search);
$("q").addEventListener("keydown",function(e){if(e.key==="Enter")search();});
$("locatebtn").addEventListener("click",locateCurrent);
$("savebtn").addEventListener("click",commit);
$("restorebtn").addEventListener("click",toggleEnabled);
$("favadd").addEventListener("click",addFavorite);
$("favlistbtn").addEventListener("click",toggleFavs);
load();
</script>
</body>
</html>`;
