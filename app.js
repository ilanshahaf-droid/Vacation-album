(function(){
"use strict";

const T = "album_trips", BUCKET = "album-photos";
const CATS = [
  {key:"places", title:"מקומות שביקרנו בהם", icon:"📍", ph:"למשל: העיר העתיקה, נמל הדייגים"},
  {key:"restaurants", title:"מסעדות שאכלנו בהן", icon:"🍽️", ph:"שם המסעדה", rating:true},
  {key:"sites", title:"אתרים שביקרנו בהם", icon:"🏛️", ph:"למשל: מבצר, פארק לאומי, תצפית"},
  {key:"shows", title:"הצגות, מופעים, מוזיאונים ואטרקציות", icon:"🎭", ph:"שם ההצגה / המוזיאון / האטרקציה",
    types:["הצגה","מופע","מוזיאון","אטרקציה","סיור","אחר"]},
];
const $ = id => document.getElementById(id);
const app = $("app");

let user = null, trips = [], loaded = false, homeQuery = "", homeSort = "desc", uploading = "";
const urls = {};          // storage path -> signed url
const wanted = new Set(); // paths waiting for a signed url

/* ---------- Supabase ---------- */
const cfg = window.ALBUM_CONFIG || {};
const sb = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const COLS = {title:"title", location:"location", startDate:"start_date", endDate:"end_date", companions:"companions",
  summary:"summary", places:"places", restaurants:"restaurants", sites:"sites", shows:"shows", photos:"photos", cover:"cover", updatedAt:"updated_at"};
function toRow(o){ const r = {}; for (const k in o) if (COLS[k]) r[COLS[k]] = (k === "startDate" || k === "endDate") ? (o[k] || null) : o[k]; return r; }
function fromRow(r){
  return {id:r.id, title:r.title || "", location:r.location || "", startDate:r.start_date || "", endDate:r.end_date || "",
    companions:r.companions || "", summary:r.summary || "", places:r.places || [], restaurants:r.restaurants || [],
    sites:r.sites || [], shows:r.shows || [], photos:r.photos || [], cover:r.cover || "", createdAt:Date.parse(r.created_at) || 0};
}

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pd = s => s ? new Date(s + "T00:00:00") : null;
const fmtD = (d, opt) => d.toLocaleDateString("he-IL", opt);
function fmtRange(s, e){
  const a = pd(s), b = pd(e), full = {day:"numeric", month:"long", year:"numeric"};
  if (!a && !b) return "";
  if (!a || !b || +a === +b) return fmtD(a || b, full);
  if (a.getFullYear() === b.getFullYear()){
    if (a.getMonth() === b.getMonth()) return a.getDate() + "–" + fmtD(b, full);
    return fmtD(a, {day:"numeric", month:"long"}) + " – " + fmtD(b, full);
  }
  return fmtD(a, {day:"numeric", month:"short", year:"numeric"}) + " – " + fmtD(b, {day:"numeric", month:"short", year:"numeric"});
}
function nights(s, e){ const a = pd(s), b = pd(e); if (!a || !b) return 0; return Math.max(0, Math.round((b - a) / 864e5)); }
const mapUrl = q => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
let tt;
function toast(msg, ms){
  let t = document.querySelector(".toast");
  if (!t){ t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = "block"; clearTimeout(tt); tt = setTimeout(() => t.style.display = "none", ms || 3000);
}
const tripById = id => trips.find(t => t.id === id);
const coverOf = t => t.cover && (t.photos || []).some(p => p.path === t.cover) ? t.cover : ((t.photos || [])[0] || {}).path || "";

/* signed urls for the private bucket, fetched in batches */
let urlTimer = null;
function imgTag(path, extra){
  const u = urls[path];
  if (!u) wanted.add(path);
  return `<img ${u ? `src="${esc(u)}"` : 'class="wait"'} data-path="${esc(path)}" alt="" loading="lazy" ${extra || ""}>`;
}
function fetchUrls(){
  clearTimeout(urlTimer);
  urlTimer = setTimeout(async () => {
    const list = [...wanted].filter(p => !urls[p]); wanted.clear();
    if (!list.length) return;
    for (let i = 0; i < list.length; i += 100){
      const part = list.slice(i, i + 100);
      const {data, error} = await sb.storage.from(BUCKET).createSignedUrls(part, 60 * 60 * 24 * 7);
      if (error || !data) continue;
      data.forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
    }
    // fill images in place instead of re-rendering
    document.querySelectorAll("img[data-path]").forEach(im => {
      const u = urls[im.dataset.path];
      if (u && !im.getAttribute("src")){ im.src = u; im.classList.remove("wait"); }
    });
  }, 30);
}

/* ---------- data ---------- */
async function loadAll(){
  const {data, error} = await sb.from(T).select("*").order("start_date", {ascending:false, nullsFirst:false});
  loaded = true;
  if (error){
    app.innerHTML = `<div class="banner">${/permission denied|does not exist|schema cache/i.test(error.message || "")
      ? "הטבלאות של האלבום עוד לא קיימות. צריך להריץ פעם אחת את schema.sql ב-Supabase."
      : "לא הצלחתי לטעון את האלבום. בדוק את החיבור לאינטרנט ורענן."}</div>`;
    return;
  }
  trips = data.map(fromRow);
  render();
}
async function createTrip(o){
  const {data, error} = await sb.from(T).insert(Object.assign(toRow(o), {user_id:user.id})).select().single();
  if (error) throw error;
  const t = fromRow(data); trips.push(t); return t.id;
}
const queues = {};
/* patchFn gets the freshest copy of the trip and returns the fields to change */
function saveTrip(id, patchFn){
  const run = async () => {
    const t = tripById(id); if (!t) return;
    const before = JSON.parse(JSON.stringify(t));
    const patch = patchFn(t);
    Object.assign(t, patch); render();
    const {error} = await sb.from(T).update(toRow(Object.assign({}, patch, {updatedAt:new Date().toISOString()}))).eq("id", id);
    if (error){ Object.assign(t, before); render(); toast("השמירה נכשלה, נסה שוב"); throw error; }
  };
  queues[id] = (queues[id] || Promise.resolve()).then(run, run);
  return queues[id];
}
async function removeTrip(id){
  const {error} = await sb.from(T).delete().eq("id", id);
  if (error) throw error;
  trips = trips.filter(t => t.id !== id);
}
async function removeFiles(paths){
  if (!paths.length) return;
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100)).catch(() => {});
}

/* ---------- render ---------- */
function render(){
  if (!user) return;
  const keep = {}; let focusKey = null, sel = null;
  app.querySelectorAll("[data-keep]").forEach(el => { keep[el.dataset.keep] = el.value; });
  const ae = document.activeElement;
  if (ae && ae.dataset && ae.dataset.keep){ focusKey = ae.dataset.keep; try{ sel = ae.selectionStart; }catch(e){} }

  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("trip-")){
    const t = tripById(h.slice(5));
    if (t) renderTrip(t);
    else if (!loaded) app.innerHTML = '<div class="loading">טוען…</div>';
    else { location.hash = ""; return; }
  } else if (!loaded) app.innerHTML = '<div class="loading">טוען את האלבום…</div>';
  else renderHome();

  app.querySelectorAll("[data-keep]").forEach(el => { if (keep[el.dataset.keep] != null) el.value = keep[el.dataset.keep]; });
  if (focusKey){ const el = app.querySelector('[data-keep="' + focusKey + '"]'); if (el){ el.focus(); try{ if (sel != null) el.setSelectionRange(sel, sel); }catch(e){} } }
  if (wanted.size) fetchUrls();
}

function renderHome(){
  const totalPhotos = trips.reduce((s, t) => s + (t.photos || []).length, 0);
  const totalDays = trips.reduce((s, t) => s + (t.startDate && t.endDate ? nights(t.startDate, t.endDate) + 1 : 0), 0);
  const q = homeQuery.trim().toLowerCase();
  const list = trips.filter(t => {
    if (!q) return true;
    const hay = [t.title, t.location, t.companions, t.summary]
      .concat(...CATS.map(c => (t[c.key] || []).map(i => i.name + " " + (i.note || ""))))
      .concat((t.photos || []).map(p => p.caption || "")).join(" ").toLowerCase();
    return hay.includes(q);
  });
  list.sort((a, b) => {
    const ka = a.startDate || a.endDate || "", kb = b.startDate || b.endDate || "";
    if (!ka && kb) return 1; if (ka && !kb) return -1;
    return homeSort === "desc" ? kb.localeCompare(ka) || b.createdAt - a.createdAt : ka.localeCompare(kb) || a.createdAt - b.createdAt;
  });

  let body = "";
  if (!trips.length){
    body = `<div class="empty"><div class="big">🧳</div><h2>האלבום עדיין ריק</h2>
      <p>כל חופשה מקבלת דף משלה: מיקום, תאריכים, מקומות, מסעדות, אתרים, מופעים ותמונות.</p>
      <p style="margin-top:18px"><button class="btn primary" data-act="new">+ להוסיף את החופשה הראשונה</button></p></div>`;
  } else if (!list.length){
    body = `<div class="empty"><div class="big">🔍</div><p>לא נמצאו חופשות שמתאימות לחיפוש.</p></div>`;
  } else {
    let lastYear = null, open = false;
    for (const t of list){
      const d = pd(t.startDate || t.endDate);
      const y = d ? String(d.getFullYear()) : "ללא תאריך";
      if (y !== lastYear){ if (open) body += "</div>"; body += `<div class="year">${esc(y)}</div><div class="grid">`; open = true; lastYear = y; }
      body += cardHtml(t);
    }
    if (open) body += "</div>";
  }

  app.innerHTML = `<header class="top">
      <div><h1>אלבום <span>החופשות</span> שלנו</h1>
      <p class="sub">${trips.length} חופשות · ${totalPhotos} תמונות${totalDays ? " · " + totalDays + " ימי נופש" : ""}</p></div>
      <button class="btn primary" data-act="new">+ חופשה חדשה</button>
    </header>
    ${trips.length ? `<div class="tools">
      <input type="search" id="q" data-keep="q" placeholder="חיפוש: מקום, מסעדה, אטרקציה…" value="${esc(homeQuery)}">
      <select id="sort"><option value="desc"${homeSort === "desc" ? " selected" : ""}>מהחדשה לישנה</option><option value="asc"${homeSort === "asc" ? " selected" : ""}>מהישנה לחדשה</option></select>
    </div>` : ""}
    ${body}`;
}

function cardHtml(t){
  const c = coverOf(t);
  const counts = CATS.map(k => (t[k.key] || []).length ? `<span>${k.icon} ${(t[k.key] || []).length}</span>` : "").join("")
    + ((t.photos || []).length ? `<span>📷 ${t.photos.length}</span>` : "");
  return `<a class="card" href="#trip-${encodeURIComponent(t.id)}">
    <div class="ph">${c ? imgTag(c) : "🏝️"}</div>
    <h3>${esc(t.title || "חופשה ללא שם")}</h3>
    ${t.location ? `<div class="meta">📍 ${esc(t.location)}</div>` : ""}
    ${fmtRange(t.startDate, t.endDate) ? `<div class="meta">📅 ${esc(fmtRange(t.startDate, t.endDate))}</div>` : ""}
    ${counts ? `<div class="counts">${counts}</div>` : ""}
  </a>`;
}

function renderTrip(t){
  const c = coverOf(t);
  const range = fmtRange(t.startDate, t.endDate), n = nights(t.startDate, t.endDate);
  const secs = CATS.map(cat => {
    const items = t[cat.key] || [];
    const lis = items.map(it => `<li>
        <div class="it"><b>${esc(it.name)}</b>${it.type ? `<span class="badge">${esc(it.type)}</span>` : ""}${it.rating ? `<span class="stars">${"★".repeat(it.rating)}${"☆".repeat(5 - it.rating)}</span>` : ""}
        ${it.note ? `<span class="note">${esc(it.note)}</span>` : ""}</div>
        <div class="acts">
          <a class="icon-btn" href="${mapUrl(it.name + (t.location ? " " + t.location : ""))}" target="_blank" rel="noopener" title="במפה">🗺️</a>
          <button class="icon-btn" data-act="edit-item" data-cat="${cat.key}" data-id="${esc(it.id)}" title="עריכה">✎</button>
          <button class="icon-btn" data-act="rm-item" data-cat="${cat.key}" data-id="${esc(it.id)}" title="מחיקה">✕</button>
        </div></li>`).join("");
    return `<section class="sec">
      <h2>${cat.icon} ${cat.title} ${items.length ? `<span class="n">${items.length}</span>` : ""}</h2>
      ${items.length ? `<ul>${lis}</ul>` : `<p class="nothing">עוד לא נוסף כלום.</p>`}
      <form class="add" data-cat="${cat.key}">
        <input class="field f-name" name="name" data-keep="${cat.key}-name" placeholder="${esc(cat.ph)}" required>
        <input class="field f-note" name="note" data-keep="${cat.key}-note" placeholder="רשמים / הערה (לא חובה)">
        ${cat.types ? `<select class="field" name="type" data-keep="${cat.key}-type">${cat.types.map(x => `<option>${x}</option>`).join("")}</select>` : ""}
        ${cat.rating ? `<select class="field" name="rating" data-keep="${cat.key}-rating" title="דירוג"><option value="0">דירוג</option>${[5,4,3,2,1].map(r => `<option value="${r}">${"★".repeat(r)}</option>`).join("")}</select>` : ""}
        <button class="btn small primary" type="submit">הוספה</button>
      </form></section>`;
  }).join("");

  const photos = t.photos || [];
  const pg = photos.map((p, i) => `<figure class="pol">
      ${p.path === c ? '<span class="is-cover">שער</span>' : ""}
      ${imgTag(p.path, `data-act="open" data-i="${i}"`)}
      <figcaption>${esc(p.caption || "")}</figcaption>
      <div class="acts">
        <button class="icon-btn" data-act="cap" data-id="${esc(p.path)}" title="כיתוב">✎</button>
        ${p.path !== c ? `<button class="icon-btn" data-act="cover" data-id="${esc(p.path)}" title="קביעה כתמונת שער">★</button>` : ""}
        <button class="icon-btn" data-act="rm-photo" data-id="${esc(p.path)}" title="מחיקה">🗑</button>
      </div></figure>`).join("");

  app.innerHTML = `<nav class="bar"><a class="back" href="#">→ לכל החופשות</a>
      <div style="display:flex;gap:6px"><button class="btn small" data-act="edit">✎ עריכת פרטים</button><button class="btn small ghost danger" data-act="del">מחיקה</button></div></nav>
    <section class="hero">
      ${c ? imgTag(c) : `<div class="nocover">✈️</div>`}
      <div class="shade"></div>
      <div class="ht"><h1>${esc(t.title || "חופשה ללא שם")}</h1>
        <div class="facts">
          ${t.location ? `<span>📍 <a href="${mapUrl(t.location)}" target="_blank" rel="noopener">${esc(t.location)}</a></span>` : ""}
          ${range ? `<span>📅 ${esc(range)}${n ? ` · ${n === 1 ? "לילה אחד" : n + " לילות"}` : ""}</span>` : ""}
          ${t.companions ? `<span>👨‍👩‍👧 ${esc(t.companions)}</span>` : ""}
        </div></div>
    </section>
    ${t.summary ? `<div class="notes"><h2>רשמים וזיכרונות</h2>${esc(t.summary)}</div>` : ""}
    <div class="secs">${secs}</div>
    <section class="sec photos">
      <div class="head"><h2>📷 תמונות שצילמנו ${photos.length ? `<span class="n">${photos.length}</span>` : ""}</h2>
        <div style="display:flex;gap:10px;align-items:center">${uploading ? `<span class="progress">${esc(uploading)}</span>` : ""}
        <label class="btn primary small" ${uploading ? 'style="pointer-events:none;opacity:.6"' : ""}>+ הוספת תמונות<input type="file" id="upl" accept="image/*" multiple hidden></label></div></div>
      ${photos.length ? `<div class="pgrid">${pg}</div>` : `<div class="drop">עוד אין תמונות. אפשר להעלות כמה בבת אחת.</div>`}
    </section>`;
}

/* ---------- modal ---------- */
function modal({title, html, submit, danger, onSubmit}){
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<form class="modal"><h2>${esc(title)}</h2>${html || ""}
    <div class="foot"><button class="btn ${danger ? "danger" : "primary"}" type="submit">${esc(submit || "שמירה")}</button>
    <button class="btn ghost" type="button" data-x>ביטול</button></div></form>`;
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.addEventListener("click", e => { if (e.target === ov || e.target.hasAttribute("data-x")) close(); });
  ov.querySelector("form").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const b = e.target.querySelector("[type=submit]"); b.disabled = true;
    try { const r = await onSubmit(fd); if (r !== false) close(); else b.disabled = false; }
    catch(err){ b.disabled = false; }
  });
  document.body.appendChild(ov);
  const f = ov.querySelector("input,textarea"); if (f) f.focus();
}

function tripForm(t){
  t = t || {};
  return `<label>שם החופשה *</label><input class="field" name="title" required value="${esc(t.title)}" placeholder="למשל: אילת בקיץ, טיול משפחתי לרומא">
    <label>מיקום</label><input class="field" name="location" value="${esc(t.location)}" placeholder="עיר / אזור / מדינה">
    <div class="row"><div><label>מתאריך</label><input class="field" type="date" name="startDate" value="${esc(t.startDate)}"></div>
    <div><label>עד תאריך</label><input class="field" type="date" name="endDate" value="${esc(t.endDate)}"></div></div>
    <label>מי היה איתנו</label><input class="field" name="companions" value="${esc(t.companions)}" placeholder="לא חובה">
    <label>רשמים וזיכרונות</label><textarea class="field" name="summary" placeholder="מה היה הכי כיף, רגעים מצחיקים, מה לזכור לפעם הבאה…">${esc(t.summary)}</textarea>`;
}
function cleanTrip(fd){
  const o = {title:(fd.title || "").trim(), location:(fd.location || "").trim(), startDate:fd.startDate || "", endDate:fd.endDate || "",
    companions:(fd.companions || "").trim(), summary:(fd.summary || "").trim()};
  if (o.startDate && o.endDate && o.endDate < o.startDate){ const x = o.startDate; o.startDate = o.endDate; o.endDate = x; }
  return o;
}

/* ---------- photos ---------- */
async function shrink(file){
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600, w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement("canvas"); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
    const b = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.8));
    if (!b) throw new Error("encode");
    return b;
  } finally { URL.revokeObjectURL(url); }
}
async function handleUpload(tripId, files){
  files = Array.from(files || []);
  if (!files.length) return;
  const added = []; let failed = 0, stop = false;
  for (let i = 0; i < files.length && !stop; i++){
    uploading = `מעלה ${i + 1} מתוך ${files.length}…`; render();
    try {
      const blob = await shrink(files[i]);
      const path = `${user.id}/${tripId}/${rid()}.jpg`;
      const {error} = await sb.storage.from(BUCKET).upload(path, blob, {contentType:"image/jpeg", upsert:false});
      if (error){
        if (/quota|exceed|limit/i.test(error.message || "")){ toast("נגמר המקום באחסון התמונות", 4500); stop = true; }
        throw error;
      }
      urls[path] = URL.createObjectURL(blob);   // show immediately, no round trip
      added.push({path, caption:""});
    } catch(e){ failed++; }
  }
  uploading = "";
  if (added.length){
    try { await saveTrip(tripId, t => ({photos:(t.photos || []).concat(added), cover:t.cover || added[0].path})); }
    catch(e){ await removeFiles(added.map(a => a.path)); }
  }
  render();
  if (failed && !stop) toast(failed === 1 ? "תמונה אחת לא עלתה (ייתכן שהפורמט לא נתמך, למשל HEIC)" : failed + " תמונות לא עלו (ייתכן שהפורמט לא נתמך, למשל HEIC)", 4500);
  else if (added.length) toast(added.length === 1 ? "התמונה נוספה" : added.length + " תמונות נוספו");
}

function lightbox(t, start){
  const photos = t.photos || []; if (!photos.length) return;
  let i = start;
  const ov = document.createElement("div"); ov.className = "lb";
  const draw = () => {
    const p = photos[i];
    ov.innerHTML = `<button class="x" data-lb="x" aria-label="סגירה">✕</button>
      ${photos.length > 1 ? `<button class="pv" data-lb="p" aria-label="הקודמת">›</button><button class="nx" data-lb="n" aria-label="הבאה">‹</button>` : ""}
      ${imgTag(p.path)}<div class="cap">${esc(p.caption || "")}</div><div class="ctr">${i + 1} / ${photos.length}</div>`;
    if (wanted.size) fetchUrls();
  };
  const go = d => { i = (i + d + photos.length) % photos.length; draw(); };
  const close = () => { ov.remove(); document.removeEventListener("keydown", key); };
  const key = e => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") go(1); if (e.key === "ArrowRight") go(-1); };
  ov.addEventListener("click", e => { const a = e.target.dataset.lb; if (a === "x" || e.target === ov) close(); else if (a === "n") go(1); else if (a === "p") go(-1); });
  let sx = null;
  ov.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, {passive:true});
  ov.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx > 0 ? 1 : -1); sx = null; });
  document.addEventListener("keydown", key);
  draw(); document.body.appendChild(ov);
}

/* ---------- events ---------- */
function currentTrip(){ const h = decodeURIComponent(location.hash.slice(1)); return h.startsWith("trip-") ? tripById(h.slice(5)) : null; }

app.addEventListener("input", e => { if (e.target.id === "q"){ homeQuery = e.target.value; render(); } });
app.addEventListener("change", e => {
  if (e.target.id === "sort"){ homeSort = e.target.value; render(); }
  if (e.target.id === "upl"){ const t = currentTrip(); if (t) handleUpload(t.id, e.target.files); }
});
app.addEventListener("submit", async e => {
  const f = e.target.closest("form.add"); if (!f) return;
  e.preventDefault();
  const t = currentTrip(); if (!t) return;
  const cat = CATS.find(c => c.key === f.dataset.cat);
  const fd = Object.fromEntries(new FormData(f).entries());
  const name = (fd.name || "").trim(); if (!name) return;
  const item = {id:rid(), name, note:(fd.note || "").trim()};
  if (cat.types) item.type = fd.type || "";
  if (cat.rating) item.rating = +fd.rating || 0;
  f.querySelectorAll("input").forEach(i => i.value = "");
  if (cat.rating) f.querySelector("[name=rating]").value = "0";
  const p = saveTrip(t.id, x => ({[cat.key]:(x[cat.key] || []).concat(item)}));
  const ni = app.querySelector(`form.add[data-cat="${cat.key}"] [name=name]`); if (ni) ni.focus();
  try { await p; } catch(err){}
});
app.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, t = currentTrip();

  if (act === "new"){
    modal({title:"חופשה חדשה", html:tripForm(), submit:"יצירה", onSubmit: async fd => {
      try { const id = await createTrip(cleanTrip(fd)); location.hash = "trip-" + id; }
      catch(err){ toast("השמירה נכשלה, נסה שוב"); return false; }
    }});
  }
  if (!t) return;
  if (act === "edit"){
    modal({title:"עריכת פרטי החופשה", html:tripForm(t), onSubmit: async fd => {
      try { await saveTrip(t.id, () => cleanTrip(fd)); } catch(err){ return false; }
    }});
  }
  if (act === "del"){
    modal({title:"למחוק את החופשה?", danger:true, submit:"מחיקה לצמיתות",
      html:`<p>"${esc(t.title)}" תימחק יחד עם כל הפרטים ו-${(t.photos || []).length} התמונות שלה. אי אפשר לבטל את זה.</p>`,
      onSubmit: async () => {
        const paths = (t.photos || []).map(p => p.path);
        try { await removeTrip(t.id); } catch(err){ toast("המחיקה נכשלה, נסה שוב"); return false; }
        location.hash = "";
        await removeFiles(paths);
        toast("החופשה נמחקה");
      }});
  }
  if (act === "rm-item" || act === "edit-item"){
    const cat = CATS.find(c => c.key === el.dataset.cat), id = el.dataset.id;
    const it = (t[cat.key] || []).find(x => x.id === id); if (!it) return;
    if (act === "rm-item"){
      saveTrip(t.id, x => ({[cat.key]:(x[cat.key] || []).filter(y => y.id !== id)})).then(() => toast(`"${it.name}" הוסר`), () => {});
    } else {
      modal({title:"עריכה", html:`<label>שם</label><input class="field" name="name" required value="${esc(it.name)}">
        <label>רשמים / הערה</label><textarea class="field" name="note">${esc(it.note)}</textarea>
        ${cat.types ? `<label>סוג</label><select class="field" name="type">${cat.types.map(o => `<option${o === it.type ? " selected" : ""}>${o}</option>`).join("")}</select>` : ""}
        ${cat.rating ? `<label>דירוג</label><select class="field" name="rating"><option value="0">ללא</option>${[5,4,3,2,1].map(r => `<option value="${r}"${r === it.rating ? " selected" : ""}>${"★".repeat(r)}</option>`).join("")}</select>` : ""}`,
        onSubmit: async fd => {
          const upd = {name:(fd.name || "").trim() || it.name, note:(fd.note || "").trim()};
          if (cat.types) upd.type = fd.type || ""; if (cat.rating) upd.rating = +fd.rating || 0;
          try { await saveTrip(t.id, x => ({[cat.key]:(x[cat.key] || []).map(y => y.id === id ? Object.assign({}, y, upd) : y)})); } catch(err){ return false; }
        }});
    }
  }
  if (act === "open") lightbox(t, +el.dataset.i);
  if (act === "cap"){
    const p = (t.photos || []).find(x => x.path === el.dataset.id); if (!p) return;
    modal({title:"כיתוב לתמונה", html:`<input class="field" name="caption" maxlength="80" value="${esc(p.caption)}" placeholder="למשל: שקיעה בחוף">`,
      onSubmit: async fd => { try { await saveTrip(t.id, x => ({photos:(x.photos || []).map(y => y.path === p.path ? Object.assign({}, y, {caption:(fd.caption || "").trim()}) : y)})); } catch(err){ return false; } }});
  }
  if (act === "cover") saveTrip(t.id, () => ({cover:el.dataset.id})).then(() => toast("נקבעה תמונת שער"), () => {});
  if (act === "rm-photo"){
    const pid = el.dataset.id;
    modal({title:"למחוק את התמונה?", danger:true, submit:"מחיקה", html:"<p>התמונה תימחק מהאלבום לצמיתות.</p>", onSubmit: async () => {
      try { await saveTrip(t.id, x => { const ph = (x.photos || []).filter(y => y.path !== pid); return {photos:ph, cover:x.cover === pid ? ((ph[0] || {}).path || "") : x.cover}; }); }
      catch(err){ return false; }
      await removeFiles([pid]);
    }});
  }
});
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

/* ---------- auth ---------- */
function show(view){ $("loadingView").hidden = view !== "loading"; $("authView").hidden = view !== "auth"; $("appView").hidden = view !== "app"; }
const authErr = e => { const m = (e && e.message) || "";
  if (/Invalid login credentials/.test(m)) return "האימייל או הסיסמה שגויים.";
  if (/already registered/.test(m)) return "האימייל הזה כבר רשום. אפשר להיכנס.";
  if (/Email not confirmed/.test(m)) return "צריך לאשר את האימייל דרך הקישור שנשלח אליך.";
  if (/Password should be/i.test(m)) return "הסיסמה צריכה להכיל לפחות 6 תווים.";
  if (/rate limit/i.test(m)) return "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.";
  if (/fetch/i.test(m)) return "אין חיבור לשרת. בדוק את החיבור לאינטרנט.";
  return m || "הפעולה נכשלה."; };
function authMsg(err, ok){ $("aErr").textContent = err || ""; $("aMsg").textContent = ok || ""; }
const redirectTo = () => location.origin + location.pathname;

function setUser(u){
  const prev = user && user.id;
  user = u;
  if (!u){ trips = []; loaded = false; show("auth"); return; }
  if (prev === u.id) return;
  $("acctEmail").textContent = u.email || "";
  show("app"); loaded = false; render(); loadAll();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (!sb){
  show("auth");
  authMsg("לא ניתן לטעון את Supabase. בדוק את החיבור לאינטרנט ורענן.");
  return;
}
$("aForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("aEmail").value.trim(), password = $("aPass").value;
  if (!email || !password) return authMsg("יש למלא אימייל וסיסמה.");
  authMsg(); $("aLogin").disabled = true;
  const {error} = await sb.auth.signInWithPassword({email, password});
  $("aLogin").disabled = false;
  if (error) authMsg(authErr(error));
});
$("aSignup").onclick = async () => {
  const email = $("aEmail").value.trim(), password = $("aPass").value;
  if (!email || !password) return authMsg("יש למלא אימייל וסיסמה כדי להירשם.");
  const {data, error} = await sb.auth.signUp({email, password, options:{emailRedirectTo:redirectTo()}});
  if (error) return authMsg(authErr(error));
  if (!data.session) authMsg("", "נשלח אליך מייל אימות. אחרי לחיצה על הקישור אפשר להיכנס.");
};
$("aGoogle").onclick = async () => {
  authMsg(); $("aGoogle").disabled = true;
  const {error} = await sb.auth.signInWithOAuth({provider:"google", options:{redirectTo:redirectTo(), queryParams:{prompt:"select_account"}}});
  if (error){ $("aGoogle").disabled = false; authMsg(authErr(error)); }
};
$("aForgot").onclick = async () => {
  const email = $("aEmail").value.trim();
  if (!email) return authMsg("יש להזין את האימייל ואז ללחוץ שוב.");
  const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo:redirectTo()});
  if (error) authMsg(authErr(error)); else authMsg("", "נשלח אליך מייל עם קישור לאיפוס הסיסמה.");
};
$("btnLogout").onclick = () => sb.auth.signOut();
sb.auth.onAuthStateChange((ev, session) => {
  setUser(session ? session.user : null);
  if (ev === "PASSWORD_RECOVERY") setTimeout(() => modal({title:"סיסמה חדשה", submit:"שמירה",
    html:'<input class="field" type="password" name="p" minlength="6" required placeholder="לפחות 6 תווים" dir="ltr">',
    onSubmit: async fd => { const {error} = await sb.auth.updateUser({password:fd.p}); if (error){ toast(authErr(error)); return false; } toast("הסיסמה עודכנה"); }}), 300);
});
sb.auth.getSession().then(({data}) => setUser(data.session ? data.session.user : null)).catch(() => show("auth"));
})();
