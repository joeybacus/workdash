/* WorkDash app - the online version of opd_clinic.py.
   Patient data lives in your Google Sheet (through the OPD Schedule Web App); this page
   keeps only its settings (Web app URL + key, your defaults) in this browser. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = Forms.esc;
const LS_KEY = "workdash.settings.v1";

// ------------------------------------------------------------------ settings
function loadSettings() {
  try { return { ...WD.DEFAULTS, url: "", token: "", demo: false, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") }; }
  catch { return { ...WD.DEFAULTS, url: "", token: "", demo: false }; }
}
const S = loadSettings();
function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* private window */ } }
const connected = () => S.demo || (S.url && S.token);

// ------------------------------------------------------------------ state
const state = {
  date: WD.today(), visits: [], patients: new Map(), schedule: null, sel: null, plan: null,
  justDecked: null, print: {}, loading: false,
};
const todays = () => state.visits.filter(v => v.visit_date === WD.iso(state.date)).sort((a, b) => (+a.seq || 0) - (+b.seq || 0));
const selected = () => state.visits.find(v => v.id === state.sel) || null;
const fmtDay = d => WD.fmt(d, "med");

// ------------------------------------------------------------------ small UI helpers
function toast(msg, kind = "", ms = 5000) {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function setStatus(text) { $("#status").textContent = text; }
const dlg = $("#dlg");
function openDialog(html, onReady) {
  dlg.innerHTML = `<div class="dlg">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  onReady && onReady(dlg);
}
const closeDialog = () => dlg.open && dlg.close();
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg, "ok", 7000); }
  catch { toast("The browser didn't allow copying. Click on the page first, then try again.", "bad"); }
}

// ------------------------------------------------------------------ backend
async function api(action, payload = {}) {
  let js;
  if (S.demo) js = await Demo.call(action, payload);
  else {
    if (!S.url || !S.token) throw new Error("Not connected - open Settings (⚙) and enter the Web app URL and key.");
    let r;
    try {
      r = await fetch(S.url, { method: "POST", body: JSON.stringify({ token: S.token, action, ...payload }) });
    } catch {
      throw new Error("Couldn't reach Google. Check the internet connection.");
    }
    try { js = await r.json(); } catch { throw new Error("Unexpected reply from Google - check the Web app URL in Settings."); }
  }
  if (!js.ok && js.error !== "date_mismatch") throw new Error(js.error === "bad token" ? "The key in Settings is wrong." : (js.error || "Google said no"));
  return js;
}

const VISIT_FIELDS = ["id", "visit_date", "seq", "hospital_no", "name", "age_sex", "cc", "dx", "other", "nor",
  "ref_dept", "resident", "consultant", "dispo", "followup", "decked", "log_sig"];
const PATIENT_FIELDS = ["hospital_no", "last", "first", "middle", "sex", "birthdate", "age", "religion", "address",
  "logged", "room", "adm_dx", "dx"];
const pick = (o, fields) => Object.fromEntries(fields.map(f => [f, o[f] === null || o[f] === undefined ? "" : String(o[f])]));

const saveTimers = {};
function saveVisit(v, now = false) {
  clearTimeout(saveTimers[v.id]);
  const go = async () => {
    try { await api("wd_save", { visit: pick(v, VISIT_FIELDS) }); setStatus(`Saved ${new Date().toLocaleTimeString()}`); }
    catch (e) { toast(`Not saved: ${e.message}`, "bad", 9000); }
    if (v.visit_date === WD.iso(state.date)) queueSync();
  };
  if (now) return go();
  saveTimers[v.id] = setTimeout(go, 600);
}

async function loadAll() {
  if (!connected()) { showSetup(); return; }
  state.loading = true;
  setStatus("Loading…");
  const [boot, sched] = await Promise.allSettled([api("wd_bootstrap"), api("schedule")]);
  if (boot.status === "fulfilled") {
    state.visits = boot.value.visits.map(v => ({ ...v }));
    state.patients = new Map(boot.value.patients.map(p => [p.hospital_no, { ...p, age: p.age === "" ? null : +p.age }]));
  } else toast(`Couldn't load patients: ${boot.reason.message}`, "bad", 10000);
  if (sched.status === "fulfilled") state.schedule = WD.parseSchedule(sched.value.values, { settings: S });
  else toast(`Couldn't load the schedule: ${sched.reason.message}`, "bad", 10000);
  state.loading = false;
  setStatus(boot.status === "fulfilled" ? `Loaded ${new Date().toLocaleTimeString()}` : "Not loaded");
  renderAll(true);
  if (boot.status === "fulfilled") syncDay();
}

async function reloadSchedule(quiet) {
  try {
    const js = await api("schedule");
    state.schedule = WD.parseSchedule(js.values, { settings: S });
    if (!quiet) toast(`Schedule read: ${state.schedule.days.length} Tuesdays.`, "ok");
  } catch (e) { toast(`Couldn't read the schedule: ${e.message}`, "bad"); }
  renderSchedule(); renderPlan();
}

// ------------------------------------------------------------------ patients and visits
function priorVisits(hno, name, before) {
  const k = WD.nameKey(name);
  return state.visits.filter(v => v.visit_date < before && ((hno && v.hospital_no === hno) || (k && WD.nameKey(v.name) === k)))
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date));
}

function addVisitFor(p, fromSearch) {
  const date = WD.iso(state.date), name = WD.logsheetName(p);
  const dup = todays().find(v => (p.hospital_no && v.hospital_no === p.hospital_no) || (!v.hospital_no && WD.nameKey(v.name) === WD.nameKey(name)));
  if (dup) { state.sel = dup.id; toast(`${dup.name} is already on this logsheet.`); renderAll(); return null; }
  const prior = priorVisits(p.hospital_no, name, date);
  const hasAge = (p.age !== null && p.age !== undefined && p.age !== "") || p.birthdate;
  const v = {
    id: (crypto.randomUUID ? crypto.randomUUID() : `v${Date.now()}${Math.random()}`), visit_date: date,
    seq: String(Math.max(0, ...todays().map(x => +x.seq || 0)) + 1), hospital_no: p.hospital_no || "", name,
    age_sex: hasAge ? WD.ageSex(p, state.date) : (prior[0] ? prior[0].age_sex : WD.ageSex(p, state.date)),
    cc: "", dx: p.dx || (prior[0] ? prior[0].dx : ""), other: prior[0] ? prior[0].other : "",
    nor: (prior.length || /FOLLOW/i.test(`${p.adm_dx || ""} ${p.room || ""}`)) ? "O" : "N", ref_dept: "",
    resident: S.resident, consultant: S.consultant, dispo: S.disposition, followup: S.followup, decked: "",
    log_sig: "new",                      // goes into the first empty row of the OPD Patients block
  };
  state.visits.push(v);
  state.sel = v.id; state.plan = null;
  toast(`Added ${v.name} (${v.age_sex || "?"}, ${v.nor === "O" ? "Old" : "New"}).`, "ok");
  renderAll();
  return v;
}

async function addFromBlock(text) {
  let p;
  try { p = WD.parsePatientBlock(text); } catch (e) { toast(e.message, "warn"); return; }
  const old = state.patients.get(p.hospital_no) || {};
  for (const k of PATIENT_FIELDS) if ((p[k] === "" || p[k] === null || p[k] === undefined) && old[k]) p[k] = old[k];
  state.patients.set(p.hospital_no, p);
  const v = addVisitFor(p);
  try { await api("wd_save", { patient: pick(p, PATIENT_FIELDS), visit: v ? pick(v, VISIT_FIELDS) : undefined }); setStatus(`Saved ${new Date().toLocaleTimeString()}`); }
  catch (e) { toast(`Not saved: ${e.message}`, "bad", 9000); }
  if (v) queueSync(300);
}

function patientForVisit(v) {
  if (v.hospital_no && state.patients.has(v.hospital_no)) return { patient: { ...state.patients.get(v.hospital_no) }, warn: "" };
  const [last, first] = v.name.split(",").map(s => (s || "").trim());
  const m = /(\d+)\s*\/\s*([MF])/.exec(v.age_sex || "");
  return { patient: { last, first, middle: "", hospital_no: v.hospital_no || "", age: m ? +m[1] : null,
    sex: m ? (m[2] === "M" ? "MALE" : "FEMALE") : "", birthdate: "", address: "", dx: v.dx },
    warn: "No WebHOMIS details saved for this patient, so hospital no., birthdate and address are blank. Copy their block from WebHOMIS once to fill them." };
}

// ------------------------------------------------------------------ rendering: logsheet
const COLS = [["name", "w-name"], ["age_sex", "w-s"], ["cc", "w-m"], ["dx", "w-dx"], ["other", "w-m"], ["nor", "w-s"],
  ["ref_dept", "w-m"], ["resident", "w-m"], ["consultant", "w-m"], ["dispo", "w-m"], ["followup", "w-s"]];

function renderLog() {
  const vs = todays();
  $("#log-title").textContent = `OPD logsheet · ${WD.fmt(state.date, "long")} · ${vs.length} patient(s)`;
  const newCount = vs.filter(v => v.nor === "N").length;
  $("#count").textContent = `${vs.length} today · ${newCount} new`;
  $("#log-empty").hidden = vs.length > 0;
  $("#log tbody").innerHTML = vs.map(v => `<tr data-id="${esc(v.id)}" class="${v.id === state.sel ? "sel" : ""}">
    ${linked(v) ? `<td class="num" title="Row ${esc(v.seq)} of this clinic's block in OPD Patients">${esc(v.seq)}</td>`
      : `<td class="num off" title="${v.log_sig === "new" ? "Not in OPD Patients yet" : "Only in WorkDash (from the old program) - not in OPD Patients"}">–</td>`}
    ${COLS.map(([f, cls]) => `<td class="${cls}"><textarea data-f="${f}" rows="1" spellcheck="false">${esc(v[f])}</textarea>${
      f === "followup" && v.decked ? `<div class="decked" title="Decked in the follow-up schedule">Decked ${esc(WD.fmt(WD.fromIso(v.decked), "short"))}</div>` : ""}</td>`).join("")}</tr>`).join("");
  fitCols(); growAll();
}
const growAll = () => $$("#log textarea").forEach(autoGrow);     // every cell shows its whole text

/* Column widths: the short columns get just enough for their usual words (DISCHARGE, DR AMPATI...),
   and name / complaint / diagnosis / other illness share the rest of the screen width. */
const COL_PX = [30, 0, 46, 0, 0, 0, 40, 66, 82, 82, 88, 74];
const COL_SHARE = { 1: .23, 3: .18, 4: .37, 5: .22 };
function fitCols() {
  const wrap = $(".table-wrap"), table = $("#log");
  if (!wrap || !wrap.clientWidth) return;
  const W = Math.max(wrap.clientWidth, 960), rest = W - COL_PX.reduce((a, b) => a + b, 0);
  table.style.width = `${W}px`;
  $$("#log col").forEach((c, i) => { c.style.width = `${COL_PX[i] || Math.floor(rest * COL_SHARE[i])}px`; });
}
const linked = v => String(v.log_sig || "").startsWith("[");
const editingLog = () => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#log tbody"));
function autoGrow(t) { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }

// ------------------------------------------------------------------ rendering: follow-up planner
function loadFollowupInputs() {
  const v = selected();
  $("#fu-title").textContent = v ? `Follow-up · ${v.name}` : "Follow-up";
  if (v) {
    const [m, w] = WD.parseFollowup(v.followup || "") || [0, 0];
    $("#fu-months").value = m; $("#fu-weeks").value = w;
  }
}

function renderPlan() {
  const v = selected(), plan = state.plan, el = $("#plan");
  if (!v) { el.innerHTML = '<div class="hint">Click a patient on the logsheet.</div>'; return; }
  if (!state.schedule) { el.innerHTML = '<div class="warn">No schedule loaded yet.</div>'; return; }
  let h = "";
  if (v.decked) h += `<div class="ok">Decked on ${esc(fmtDay(WD.fromIso(v.decked)))}.</div>`;
  if (plan && plan.name === v.name) {
    h += `<div>Target: ${esc(fmtDay(plan.target))}</div>`;
    h += plan.warnings.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
    if (plan.chosen) {
      const d = plan.chosen, again = !!(v.decked || plan.already.length);
      h += `<button class="deck primary ${again ? "again" : ""}" data-deck="${WD.iso(d.date)}">${again ? "Deck again" : "Deck"} on ${esc(fmtDay(d.date))} (${d.names.length} → ${d.names.length + 1})</button>`;
    }
    const others = plan.options.filter(d => d !== plan.chosen);
    if (others.length) {
      h += '<div class="hint">Or pick another:</div><div class="opts">' + others.map(d => {
        const tone = d.names.length < S.prefer_below ? "ok-c" : d.names.length < S.hard_cap ? "busy-c" : "full-c";
        return `<button class="opt ${tone}" data-deck="${WD.iso(d.date)}">${esc(WD.fmt(d.date, "short"))} · ${d.names.length}</button>`;
      }).join("") + "</div>";
    }
  }
  el.innerHTML = h;
}

function renderHistory() {
  const v = selected(), card = $("#card-hist");
  if (!v) { card.hidden = true; return; }
  const rows = priorVisits(v.hospital_no, v.name, WD.iso(state.date));
  card.hidden = false;
  card.innerHTML = `<h2>Past visits · ${rows.length}</h2>` + (rows.length
    ? rows.slice(0, 8).map(r => `<div class="hist">${esc(r.visit_date)} · ${esc(r.dx || "-")} · FU ${esc(r.followup || "-")}</div>`).join("")
    : '<div class="hint">First visit on record.</div>');
}

// ------------------------------------------------------------------ rendering: schedule list
function renderSchedule() {
  const card = $("#card-sched"), sch = state.schedule;
  if (!sch) { card.innerHTML = '<h2>Follow-up schedule</h2><div class="hint">No schedule loaded.</div>'; return; }
  const colors = { ok: "var(--bar-ok)", busy: "var(--bar-busy)", full: "var(--bar-full)" };
  const now = state.date, nowIso = WD.iso(now), [openIso, newName] = state.justDecked || [null, ""];
  let year = null, marked = false;
  const parts = [];
  for (const d of sch.days) {
    if (d.date.getFullYear() !== year) { year = d.date.getFullYear(); parts.push(`<div class="yr">${year}</div>`); }
    const n = d.names.length, tone = n < S.prefer_below ? "ok" : n < S.hard_cap ? "busy" : "full";
    const di = WD.iso(d.date), cls = d.date < now ? "past" : (di === nowIso ? "today" : "");
    let next = "";
    if (d.date >= now && !marked) { next = " data-next"; marked = true; }
    const body = n ? `<ul>${d.names.map(([r, nm]) => `<li class="${newName && di === openIso && nm === newName ? "new" : ""}"><span class="rw">row ${r}</span>${esc(nm)}</li>`).join("")}</ul>`
      : '<div class="none">No patients yet.</div>';
    parts.push(`<details class="${cls}"${next}${di === openIso ? " open" : ""}><summary><span class="chev">▶</span>` +
      `<span>${esc(WD.fmt(d.date, "short"))}</span><span class="bar"><i style="width:${Math.min(n / 12, 1) * 100}%;background:${colors[tone]}"></i></span>` +
      `<span class="n">${n}</span>${d.blocked ? `<span class="blk">⛔ ${esc(d.blocked)}</span>` : ""}</summary>${body}</details>`);
  }
  const probs = WD.scheduleProblems(sch, S, now);
  card.innerHTML = `<div class="row"><h2>Follow-up schedule</h2><span class="grow"></span><span class="hint">${sch.days.length} Tuesdays · click a date</span></div>
    <div class="sched" id="sched-list">${parts.join("")}</div>
    ${probs.length ? `<details class="problems"><summary>Schedule problems (${probs.length})</summary>${probs.map(p => `<div>${esc(p)}</div>`).join("")}</details>` : ""}`;
  requestAnimationFrame(() => {
    const c = $("#sched-list"), el = c && (c.querySelector("details[open]") || c.querySelector("[data-next]"));
    if (el) c.scrollTop = el.offsetTop - 26;
  });
}

function renderAll(withSchedule) {
  renderLog(); loadFollowupInputs(); renderPlan(); renderHistory();
  if (withSchedule) renderSchedule();
  $("#mode").hidden = !S.demo;
}

// ------------------------------------------------------------------ actions
function plan() {
  const v = selected();
  if (!v || !state.schedule) { renderPlan(); return; }
  const m = +$("#fu-months").value || 0, w = +$("#fu-weeks").value || 0;
  try { state.plan = WD.planFollowup(state.schedule, v.name, m, w, state.date, S); }
  catch (e) { toast(e.message, "warn"); state.plan = null; }
  const fu = WD.formatFollowup(m, w), cur = WD.parseFollowup(v.followup || "");
  if (fu && !(cur && cur[0] === m && cur[1] === w)) { v.followup = fu; saveVisit(v); renderLog(); }
  renderPlan();
}

async function deck(dayIso) {
  const v = selected(), day = state.schedule && state.schedule.days.find(d => WD.iso(d.date) === dayIso);
  if (!v || !day || !day.free_row) return;
  $$("#plan button").forEach(b => { b.disabled = true; });
  try {
    const res = await api("deck", { col: day.col, row: day.free_row, name: v.name, header: day.header });
    WD.addToSchedule(day, day.free_row, v.name, S);
    v.decked = dayIso;
    state.plan = null;
    state.justDecked = [dayIso, v.name];
    toast(`Decked ${v.name} on ${fmtDay(day.date)} (${res.cell}).`, "ok");
    saveVisit(v, true);
    renderAll(true);
  } catch (e) {
    toast(`Not decked: ${e.message}`, "bad", 9000);
    reloadSchedule(true);
  }
}

function removeSelected() {
  const v = selected();
  if (!v) { toast("Click a row first.", "warn"); return; }
  const inSheet = linked(v);
  if (!confirm(inSheet ? `Remove ${v.name} from this logsheet?\n\nRow ${v.seq} of this clinic's block in OPD Patients will be emptied too.`
                       : `Remove ${v.name} from this logsheet?`)) return;
  state.visits = state.visits.filter(x => x.id !== v.id);
  state.sel = null; state.plan = null;
  renderAll();
  if (inSheet) { sync.clears.push({ date: v.visit_date, seq: v.seq, name: v.name }); queueSync(200); }
  api("wd_delete", { id: v.id }).then(() => toast(`Removed ${v.name}.`)).catch(e => toast(`Not removed from WorkDash's records: ${e.message}`, "bad"));
}

function search(q) {
  const out = $("#search-results");
  q = WD.clean(q);
  if (q.length < 2) { out.innerHTML = ""; return; }
  let known = [], hist = [];
  if (/^\d+$/.test(q)) known = [...state.patients.values()].filter(p => p.hospital_no.startsWith(q)).slice(0, 12);
  else {
    const last = WD.nameKey(q.includes(",") ? q : q.replace(" ", ", ")).split("|")[0];
    known = [...state.patients.values()].filter(p => WD.nameKey(WD.logsheetName(p)).startsWith(last)).slice(0, 12);
    const seen = new Set(known.map(p => WD.nameKey(WD.logsheetName(p)))), byKey = new Map();
    for (const v of state.visits) {
      const k = WD.nameKey(v.name);
      if (!k.startsWith(last) || seen.has(k)) continue;
      const cur = byKey.get(k) || { name: v.name, n: 0, last: "" };
      cur.n++; if (v.visit_date > cur.last) cur.last = v.visit_date;
      byKey.set(k, cur);
    }
    hist = [...byKey.values()].slice(0, 12);
  }
  out.innerHTML = known.map(p => `<div class="hit"><span class="who">${esc(WD.logsheetName(p))} · ${esc(p.hospital_no)} · ${esc(p.dx || "")}</span>
      <button class="link" data-add-hno="${esc(p.hospital_no)}">Add</button><button class="link" data-raw-hno="${esc(p.hospital_no)}">RawData block</button></div>`).join("")
    + hist.map(h => `<div class="hit"><span class="who">${esc(h.name)} · ${h.n} visit(s), last ${esc(h.last)}</span>
      <button class="link" data-add-name="${esc(h.name)}">Add</button></div>`).join("")
    || '<div class="hint">No match. Copy their block from WebHOMIS.</div>';
}

// ------------------------------------------------------------------ print forms
function openPrint() {
  const v = selected();
  if (!v) { toast("Click a patient on the logsheet first.", "warn"); return; }
  const st = state.print[v.id] = state.print[v.id] || { lab: false, rx: true, s2: false, tests: new Set(), other: "", rx_meds: "", s2_meds: "", rx_alone: false };
  const { warn } = patientForVisit(v);
  const fu = v.followup ? `Prints the follow-up: ${esc(v.followup)}${v.decked ? ` (decked ${esc(WD.fmt(WD.fromIso(v.decked), "short"))})` : ""}` : "No follow-up set on the logsheet.";
  const testBoxes = Forms.LAB_SECTIONS.map(([skey, title]) => `<h5>${esc(title)}</h5>` + Forms.LAB_ITEMS.filter(i => i.skey === skey && !i.plain)
    .map(i => `<label><input type="checkbox" data-test="${i.key}" ${st.tests.has(i.key) ? "checked" : ""}>${esc(i.label)}</label>`).join("")).join("");
  openDialog(`
    <h3>Print forms · ${esc(v.name)}</h3>
    ${warn ? `<div class="warn">⚠ ${esc(warn)}</div>` : ""}
    <div class="checks">
      <label><input type="checkbox" id="p-lab" ${st.lab ? "checked" : ""}> Lab request</label>
      <label><input type="checkbox" id="p-rx" ${st.rx ? "checked" : ""}> Rx + Med Cert</label>
      <label><input type="checkbox" id="p-s2" ${st.s2 ? "checked" : ""}> S2 Rx (triplicate)</label>
    </div>
    <div class="box" id="box-lab">
      <h4>Lab request</h4>
      <div id="lab-sum" class="small"></div>
      <div class="panels">Panels: ${Object.keys(Forms.LAB_PANELS).map(n => `<button type="button" data-panel="${n}">${n}</button>`).join("")}
        <button type="button" class="link" id="lab-clear">Clear</button></div>
      <details><summary class="small">All tests</summary><div class="tests">${testBoxes}</div></details>
      <div class="row"><input type="text" id="p-other" placeholder="Other test/s" value="${esc(st.other)}">
        <select id="p-perpage" style="width:200px"><option value="1">1 per page</option><option value="2">2 per page (Legal only)</option></select></div>
    </div>
    <div class="box" id="box-rx">
      <h4>Rx + Request for Medical Certificate</h4>
      <textarea id="p-rxmeds" rows="4" placeholder="Rx - leave blank to write by hand">${esc(st.rx_meds)}</textarea>
      <div class="row"><label><input type="checkbox" id="p-rxalone" ${st.rx_alone ? "checked" : ""}> Second Rx instead of the Med Cert</label><span class="grow"></span><span class="hint">${fu}</span></div>
    </div>
    <div class="box" id="box-s2">
      <h4>S2 Rx - Original, Duplicate, Triplicate</h4>
      <textarea id="p-s2meds" rows="3" placeholder="S2 Rx - leave blank to write by hand">${esc(st.s2_meds)}</textarea>
      <div class="row"><select id="p-layout" style="width:280px"><option value="3 across">3 across (Official Triplicate)</option><option value="2x2">2x2, bigger (4th = regular Rx)</option></select>
        <span class="hint">Prints ${esc(S.prescriber)} · Lic. ${esc(S.license_no)} · S2 ${esc(S.s2_no)} - change in Settings.</span></div>
    </div>
    <div class="row"><select id="p-paper" style="width:180px">${Object.keys(Forms.PAPERS).map(p => `<option>${p}</option>`).join("")}</select>
      <span class="grow"></span><button type="button" data-close>Cancel</button><button type="button" class="primary" id="p-go">Print</button></div>`, d => {
    $("#p-perpage", d).value = String(S.lab_per_page); $("#p-layout", d).value = S.s2_layout; $("#p-paper", d).value = S.paper;
    const sync = () => {
      st.lab = $("#p-lab", d).checked; st.rx = $("#p-rx", d).checked; st.s2 = $("#p-s2", d).checked;
      $("#box-lab", d).hidden = !st.lab; $("#box-rx", d).hidden = !st.rx; $("#box-s2", d).hidden = !st.s2;
      const keys = [...st.tests].sort((a, b) => Forms.LAB_ITEMS.findIndex(i => i.key === a) - Forms.LAB_ITEMS.findIndex(i => i.key === b));
      $("#lab-sum", d).textContent = keys.length ? `${keys.length} ticked: ${keys.map(k => Forms.LAB_LABELS[k]).join(", ")}` : "Nothing ticked yet - pick a panel or open All tests.";
    };
    d.oninput = ev => {
      const t = ev.target;
      if (t.dataset.test) { t.checked ? st.tests.add(t.dataset.test) : st.tests.delete(t.dataset.test); }
      if (t.id === "p-other") st.other = t.value;
      if (t.id === "p-rxmeds") st.rx_meds = t.value;
      if (t.id === "p-s2meds") st.s2_meds = t.value;
      if (t.id === "p-rxalone") st.rx_alone = t.checked;
      if (t.id === "p-perpage") { S.lab_per_page = +t.value; saveSettings(); }
      if (t.id === "p-layout") { S.s2_layout = t.value; saveSettings(); }
      if (t.id === "p-paper") { S.paper = t.value; saveSettings(); }
      sync();
    };
    d.onclick = ev => {
      const t = ev.target;
      if (t.dataset.panel) { Forms.LAB_PANELS[t.dataset.panel].forEach(k => { st.tests.add(k); const cb = d.querySelector(`[data-test="${k}"]`); if (cb) cb.checked = true; }); sync(); }
      if (t.id === "lab-clear") { st.tests.clear(); $$("[data-test]", d).forEach(cb => { cb.checked = false; }); sync(); }
      if (t.id === "p-go") doPrint(v, st);
      if (t.hasAttribute("data-close")) closeDialog();
    };
    sync();
  });
}

function doPrint(v, st) {
  if (!st.lab && !st.rx && !st.s2) { toast("Tick at least one form.", "warn"); return; }
  if (st.lab && !st.tests.size && !st.other.trim()) toast("No lab tests ticked - the request will print blank.", "warn");
  if ((st.rx || st.s2) && !S.license_no) toast("Your prescriber details are blank - add them in Settings (⚙).", "warn", 8000);
  if (st.s2 && !S.s2_no) toast("Your S2 No. is blank - add it in Settings (⚙).", "warn", 8000);
  const { patient } = patientForVisit(v);
  const html = Forms.buildHtml(v, patient, S, { date: state.date, lab: st.lab, lab_tests: st.tests, lab_other: st.other,
    rx: st.rx, rx_meds: st.rx_meds, rx_alone: st.rx_alone, s2: st.s2, s2_meds: st.s2_meds, base: location.href });
  closeDialog();
  Forms.print(html);
  toast(`Print dialog opening - check the printer and ${S.paper.split(" ")[0]} paper, then press Print.`, "ok", 6000);
}

// ------------------------------------------------------------------ two-way sync with OPD Patients
/* The clinic's block in OPD Patients (found by its DATE row, wherever it has moved) and this
   logsheet are kept the same: typing in either place shows up in the other. See WD.planDaySync. */
const sync = { busy: false, again: false, loud: false, clears: [], last: 0, timer: null, renderLater: false };
function queueSync(ms = 1500) { clearTimeout(sync.timer); sync.timer = setTimeout(() => syncDay(), ms); }
function setSyncLine(html, kind = "") { const el = $("#sync-line"); el.className = `sync-line ${kind}`; el.innerHTML = html; }
const logObj = v => Object.fromEntries(WD.LOG_FIELDS.map(f => [f, WD.clean(v[f])]));

function guessHno(name) {
  const k = WD.nameKey(name), found = new Set();
  if (!k) return "";
  for (const p of state.patients.values()) if (WD.nameKey(WD.logsheetName(p)) === k) found.add(p.hospital_no);
  for (const v of state.visits) if (v.hospital_no && WD.nameKey(v.name) === k) found.add(v.hospital_no);
  return found.size === 1 ? [...found][0] : "";
}

async function syncDay(loud = false) {
  if (!connected() || state.loading) return;
  if (sync.busy) { sync.again = true; sync.loud = sync.loud || loud; return; }
  sync.busy = true;
  const dateIso = WD.iso(state.date), day = fmtDay(state.date);
  try {
    const blk = await api("log_get", { date_iso: dateIso });
    if (WD.iso(state.date) !== dateIso) return;              // the date was changed meanwhile
    if (!blk.found) {
      const msg = `Not linked to the Google Sheet: OPD Patients has no block dated ${esc(day)}` +
        (blk.latest_display ? ` (its newest block, C37, is ${esc(blk.latest_display)})` : "") +
        `. Add this clinic's block there and WorkDash fills it in.`;
      setSyncLine(msg, "warn");
      if (loud) toast(msg.replace(/<[^>]+>/g, ""), "warn", 10000);
      return;
    }
    const rows = `${blk.first_row}–${blk.first_row + 11}`;
    if (blk.copied) {
      const msg = `Waiting: the OPD Patients block for ${esc(day)} still has the last clinic's patients (copied from the block below). Clear A${blk.first_row}:L${blk.first_row + 12} in the sheet, then WorkDash fills it in.`;
      setSyncLine(msg, "warn");
      if (loud) toast(msg, "warn", 12000);
      return;
    }
    const vs = todays(), snap = new Map(vs.map(v => [v.id, logObj(v)]));
    const clears = sync.clears.filter(c => c.date === dateIso);
    const p = WD.planDaySync(vs, blk.values, clears);
    sync.clears = sync.clears.filter(c => c.date !== dateIso);

    // 1. the sheet
    let res = { written: [], conflicts: [], cells: 0 };
    if (p.push.length) {
      try { res = await api("log_put", { date_iso: dateIso, writes: p.push.map(w => ({ seq: w.seq, expect: w.expect, values: w.values })) }); }
      catch (e) { if (e.message === "no_block") { setSyncLine(`The block dated ${esc(day)} just moved or was removed in OPD Patients - syncing again.`, "warn"); sync.again = true; return; } throw e; }
    }
    const written = new Set(res.written || []);

    // 2. WorkDash (never undoing typing that happened while this sync was running)
    const toSave = new Set(), find = id => state.visits.find(x => x.id === id);
    for (const l of p.local) {
      const v = find(l.id); if (!v) continue;
      const before = snap.get(v.id) || {};
      for (const [f, val] of Object.entries(l.fields)) if (WD.clean(v[f]) === before[f]) v[f] = val;
      v.seq = l.seq;
      if (l.sig) v.log_sig = l.sig;
      toSave.add(v);
    }
    for (const w of p.push) {
      if (!w.id || !written.has(w.seq)) continue;
      const v = find(w.id); if (!v) continue;
      v.log_sig = w.sig; v.seq = String(w.seq); toSave.add(v);
    }
    for (const a of p.add) {
      const v = { id: crypto.randomUUID ? crypto.randomUUID() : `v${Date.now()}${Math.random()}`, visit_date: dateIso,
        seq: a.seq, hospital_no: guessHno(a.fields.name), ...a.fields, decked: "", log_sig: a.sig };
      state.visits.push(v); toSave.add(v);
    }
    const dropIds = new Set(p.drop.map(v => v.id));
    if (dropIds.size) {
      state.visits = state.visits.filter(v => !dropIds.has(v.id));
      if (dropIds.has(state.sel)) { state.sel = null; state.plan = null; }
    }
    if (toSave.size) await api("wd_save", { visits: [...toSave].map(v => pick(v, VISIT_FIELDS)) });
    for (const id of dropIds) await api("wd_delete", { id });

    // 3. tell
    const nWritten = p.push.filter(w => !w.clear && written.has(w.seq)).length, nCleared = p.push.filter(w => w.clear && written.has(w.seq)).length;
    const nIn = p.add.length + p.local.filter(l => Object.keys(l.fields).length).length;
    const bits = [];
    if (nWritten) bits.push(`${nWritten} row(s) written to the sheet`);
    if (nCleared) bits.push(`${nCleared} row(s) emptied in the sheet`);
    if (nIn) bits.push(`${nIn} change(s) brought in from the sheet`);
    if (p.drop.length) bits.push(`${p.drop.length} removed here (emptied in the sheet)`);
    const warn = [];
    if ((res.conflicts || []).length) warn.push(`${res.conflicts.length} row(s) changed in the sheet at the same moment - syncing again`);
    if (p.overflow.length) warn.push(`no empty row left for ${p.overflow.map(v => esc(v.name)).join(", ")} - add rows to the block or remove someone`);
    if (p.conflicts.length) warn.push(`${p.conflicts.map(v => esc(v.name)).join(", ")}: the same cell was edited in both places - kept WorkDash's`);
    const only = p.localOnly.length ? ` · ${p.localOnly.length} only in WorkDash (–)` : "";
    setSyncLine(`↔ Linked to OPD Patients rows ${rows} (${esc(blk.date_display || day)}) · synced ${new Date().toLocaleTimeString()}${only}` +
      (warn.length ? `<br>⚠ ${warn.join("<br>⚠ ")}` : ""), warn.length ? "warn" : "ok");
    if (loud || nCleared || p.add.length || p.drop.length || warn.length)          // routine writes show only in the line
      toast(bits.length || warn.length ? [...bits, ...warn].join(" · ").replace(/<[^>]+>/g, "") : "Already the same as the Google Sheet.", warn.length ? "warn" : "ok", 8000);
    if ((res.conflicts || []).length) sync.again = true;
    if (toSave.size || dropIds.size) { if (editingLog()) sync.renderLater = true; else renderAll(); }
  } catch (e) {
    setSyncLine(`Not synced with the Google Sheet: ${esc(e.message)}`, "bad");
    if (loud) toast(`Not synced: ${e.message}`, "bad", 9000);
  } finally {
    sync.busy = false; sync.last = Date.now();
    if (sync.again) { const l = sync.loud; sync.again = false; sync.loud = false; setTimeout(() => syncDay(l), 400); }
  }
}

// ------------------------------------------------------------------ settings / setup
function showSetup() {
  openDialog(`<h3>Connect WorkDash</h3>
    <div>WorkDash keeps your patients in your Google Sheet, through the <b>OPD Schedule Web App</b>.</div>
    <div class="hint"><b>Easiest:</b> open your private setup link in this browser - it fills in everything below. Otherwise enter the address and key once on this computer.</div>
    <label class="f">Web app URL (ends in /exec)<input type="url" id="c-url" value="${esc(S.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="f">Key<input type="password" id="c-token" value="${esc(S.token)}" autocomplete="off"></label>
    <div class="hint">Both are saved only in this browser. On a shared computer, use "Forget this computer" in Settings when you're done.</div>
    <div class="actions"><button id="c-demo">Try the demo (made-up patients)</button><button class="primary" id="c-go">Connect</button></div>`, d => {
    d.onclick = async ev => {
      if (ev.target.id === "c-demo") { S.demo = true; saveSettings(); closeDialog(); loadAll(); }
      if (ev.target.id === "c-go") {
        const url = $("#c-url", d).value.trim(), token = $("#c-token", d).value.trim();
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { toast("That URL doesn't look like an Apps Script Web app URL.", "warn"); return; }
        if (!token) { toast("The key is missing - open your setup link in this browser instead; it fills in both.", "warn", 8000); return; }
        S.url = url; S.token = token; S.demo = false;
        saveSettings(); closeDialog(); loadAll();
      }
    };
  });
}

function openSettings() {
  const num = (k, label) => `<label class="f">${label}<input type="number" data-s="${k}" value="${esc(S[k])}"></label>`;
  const txt = (k, label) => `<label class="f">${label}<input type="text" data-s="${k}" value="${esc(S[k])}"></label>`;
  openDialog(`<h3>Settings</h3>
    <div class="box"><h4>Connection</h4>
      <label class="f">Web app URL<input type="url" data-s="url" value="${esc(S.url)}"></label>
      <label class="f">Key<input type="password" data-s="token" value="${esc(S.token)}" autocomplete="off"></label>
      <label><input type="checkbox" data-s="demo" ${S.demo ? "checked" : ""}> Demo mode (made-up patients, nothing is sent to Google)</label>
    </div>
    <div class="box"><h4>Logsheet defaults</h4><div class="grid2">
      ${txt("resident", "Resident")}${txt("consultant", "Consultant")}${txt("disposition", "Disposition")}${txt("followup", "Default follow-up")}</div></div>
    <div class="box"><h4>Follow-up decking</h4><div class="grid2">
      ${num("prefer_below", "Deck when fewer than")}${num("hard_cap", "Never more than")}</div>
      <label><input type="checkbox" data-s="notes_block_date" ${S.notes_block_date ? "checked" : ""}> A note in row 2 (holiday/event) blocks that Tuesday</label>
      <label class="f">Extra dates to skip (yyyy-mm-dd, comma separated)<input type="text" data-s="extra_holidays" value="${esc((S.extra_holidays || []).join(", "))}"></label></div>
    <div class="box"><h4>Printed forms</h4><div class="grid2">
      ${txt("prescriber", "Prescriber (as printed)")}${txt("license_no", "License No.")}${txt("s2_no", "S2 No.")}${txt("ptr_no", "PTR No.")}
      ${txt("s2_issued", "S2 date issued")}${txt("s2_validity", "S2 validity date")}${txt("prescriber_address", "Prescriber address")}${txt("classification", "Classification")}</div></div>
    <div class="actions"><button id="st-forget" class="link danger">Forget this computer</button><span class="grow"></span>
      <button data-close>Cancel</button><button class="primary" id="st-save">Save</button></div>`, d => {
    d.onclick = ev => {
      const t = ev.target;
      if (t.hasAttribute("data-close")) closeDialog();
      if (t.id === "st-forget") {
        if (!confirm("Remove the Web app key and settings from this browser? Patient data in the Google Sheet is not touched.")) return;
        try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
        location.reload();
      }
      if (t.id === "st-save") {
        for (const el of $$("[data-s]", d)) {
          const k = el.dataset.s;
          if (el.type === "checkbox") S[k] = el.checked;
          else if (el.type === "number") S[k] = +el.value || WD.DEFAULTS[k];
          else if (k === "extra_holidays") S[k] = el.value.split(",").map(x => x.trim()).filter(Boolean);
          else S[k] = el.value.trim();
        }
        saveSettings(); closeDialog(); toast("Saved.", "ok"); loadAll();
      }
    };
  });
}

const PRESCRIBER_KEYS = ["prescriber", "license_no", "s2_no", "s2_issued", "s2_validity", "ptr_no", "prescriber_address"];

/** One-time setup link: …/workdash/#setup=<base64 of {"url":…,"token":…,"forms":{prescriber details}}>.
    The part after # never leaves the browser. */
function readSetupLink() {
  const m = /setup=([A-Za-z0-9_\-+/=]+)/.exec(location.hash);
  if (!m) return;
  try {
    const js = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (js.url && js.token) {
      S.url = js.url; S.token = js.token; S.demo = false;
      for (const k of PRESCRIBER_KEYS) if (typeof js.forms?.[k] === "string" && js.forms[k]) S[k] = js.forms[k];
      saveSettings(); toast("This computer is now connected to your Google Sheet.", "ok");
    }
  } catch { toast("That setup link is incomplete.", "bad"); }
  history.replaceState(null, "", location.pathname + location.search);
}

// ------------------------------------------------------------------ events
function wire() {
  const dateIn = $("#clinic-date");
  dateIn.value = WD.iso(state.date);
  dateIn.onchange = () => {
    const d = WD.fromIso(dateIn.value);
    if (!d) return;
    state.date = d; state.sel = null; state.plan = null; state.justDecked = null;
    setSyncLine("Checking the Google Sheet…");
    renderAll(true);
    syncDay();
  };
  $("#btn-reload").onclick = () => loadAll();
  $("#btn-settings").onclick = openSettings;
  $("#btn-add").onclick = () => { const t = $("#paste").value; if (t.trim()) { addFromBlock(t); $("#paste").value = ""; } };
  $("#btn-copy").onclick = () => { const vs = todays(); vs.length ? copyText(WD.logsheetTsv(vs), `Copied ${vs.length} rows. In OPD Patients click the NAME cell (column B) of the first empty row and paste.`) : toast("No patients on this logsheet yet.", "warn"); };
  $("#btn-sync").onclick = () => syncDay(true);
  $("#btn-print").onclick = openPrint;
  $("#btn-remove").onclick = removeSelected;
  $("#btn-rawdata").onclick = () => {
    const v = selected();
    const p = v && v.hospital_no && state.patients.get(v.hospital_no);
    if (!p) { toast(v ? "No WebHOMIS details saved for this patient yet - paste their block once." : "Click a row first.", "warn"); return; }
    copyText(WD.rawdataBlock(p), "Copied. In the Google Sheet click RawData!A5 and paste - the Rx, Lab and Med Cert tabs fill in.");
  };
  $("#btn-plan").onclick = plan;
  $("#plan").onclick = ev => { const d = ev.target.closest("[data-deck]"); if (d) deck(d.dataset.deck); };

  let searchTimer;
  $("#search").oninput = ev => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(ev.target.value), 200); };
  $("#search-results").onclick = ev => {
    const t = ev.target;
    if (t.dataset.addHno) { const p = state.patients.get(t.dataset.addHno); const v = p && addVisitFor(p); if (v) saveVisit(v, true); $("#search").value = ""; search(""); }
    if (t.dataset.addName) { const [last, first] = t.dataset.addName.split(",").map(s => s.trim()); const v = addVisitFor({ last, first, hospital_no: "" }); if (v) saveVisit(v, true); $("#search").value = ""; search(""); }
    if (t.dataset.rawHno) { const p = state.patients.get(t.dataset.rawHno); if (p) copyText(WD.rawdataBlock(p), "Copied. In the Google Sheet click RawData!A5 and paste."); }
  };

  const tbody = $("#log tbody");
  tbody.addEventListener("focusin", ev => selectRow(ev.target.closest("tr")));
  tbody.addEventListener("focusout", () => setTimeout(() => { if (sync.renderLater && !editingLog()) { sync.renderLater = false; renderAll(); } }, 0));
  tbody.addEventListener("click", ev => selectRow(ev.target.closest("tr")));
  tbody.addEventListener("keydown", ev => {          // Enter moves down a row, like the sheet (no line breaks in cells)
    const t = ev.target;
    if (ev.key !== "Enter" || ev.shiftKey || ev.altKey || !t.dataset.f) return;
    ev.preventDefault();
    const next = t.closest("tr").nextElementSibling;
    const cell = next && next.querySelector(`[data-f="${t.dataset.f}"]`);
    if (cell) cell.focus(); else t.blur();
  });
  tbody.addEventListener("input", ev => {
    const t = ev.target, tr = t.closest("tr"), v = tr && state.visits.find(x => x.id === tr.dataset.id);
    if (!v || !t.dataset.f) return;
    v[t.dataset.f] = t.value;
    if (t.tagName === "TEXTAREA") autoGrow(t);
    if (t.dataset.f === "followup") loadFollowupInputs();
    if (t.dataset.f === "nor") $("#count").textContent = `${todays().length} today · ${todays().filter(x => x.nor === "N").length} new`;
    saveVisit(v);
  });

  // Ctrl+V anywhere (outside a text box) adds the patient
  document.addEventListener("paste", ev => {
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && t.id !== "paste") return;
    const text = ev.clipboardData && ev.clipboardData.getData("text");
    if (text && WD.looksLikePatientBlock(text)) { ev.preventDefault(); addFromBlock(text); if (t && t.id === "paste") t.value = ""; }
  });
  dlg.addEventListener("close", () => { dlg.innerHTML = ""; });

  // re-fit row heights when the window changes size; keep the table header just under the top bar
  const fitTop = () => document.documentElement.style.setProperty("--top-h", `${$(".top").offsetHeight}px`);
  let fitTimer;
  const refit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitTop(); fitCols(); growAll(); }, 80); };
  window.addEventListener("resize", refit);
  if (window.ResizeObserver) {                        // also catches zoom and scrollbars appearing
    let lastW = 0;
    new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w !== lastW) { lastW = w; refit(); } }).observe($(".card-log"));
  }
  fitTop();

  // pick up what was typed in the Google Sheet: on coming back to this tab, and every 2 minutes
  window.addEventListener("focus", () => { if (Date.now() - sync.last > 10000) syncDay(); });
  setInterval(() => {
    if (document.visibilityState === "visible" && !dlg.open && !editingLog() && Date.now() - sync.last > 115000) syncDay();
  }, 30000);
}

function selectRow(tr) {
  if (!tr || tr.dataset.id === state.sel) return;
  state.sel = tr.dataset.id; state.plan = null;
  $$("#log tr.sel").forEach(r => r.classList.remove("sel"));
  tr.classList.add("sel");
  loadFollowupInputs(); renderPlan(); renderHistory();
}

// ------------------------------------------------------------------ start
wire();
readSetupLink();
renderAll(true);
loadAll();
