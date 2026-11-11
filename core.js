/* WorkDash core - WebHOMIS parsing, dates, follow-up planning, logsheet sync planning.
   A JavaScript port of opd_core.py (the Mac/Windows program), so both behave the same.
   Nothing here talks to the network or stores anything. */
"use strict";

const WD = (() => {
  // ---------------------------------------------------------------- defaults
  const DEFAULTS = {
    resident: "DR BACUS", consultant: "DR AMPATI", disposition: "DISCHARGE", followup: "6MOS",
    prefer_below: 6, hard_cap: 8, before_days: 30, after_months: 6,
    count_first_row: 3, count_last_row: 37, placement_first_row: 5, placement_last_row: 12,
    notes_block_date: true, extra_holidays: [],
    // printed forms
    paper: "Legal 8.5x14", s2_layout: "3 across", lab_per_page: 1,
    classification: "Charity", ward: "OPD", service: "CNS",
    // the prescriber's details come from the private setup link or Settings, never from this public code
    prescriber: "", license_no: "", s2_no: "", s2_issued: "", s2_validity: "", ptr_no: "", prescriber_address: "",
  };

  const FIXED_HOLIDAYS = {
    "1-1": "New Year's Day", "2-25": "EDSA Anniversary", "4-9": "Araw ng Kagitingan", "5-1": "Labor Day",
    "6-12": "Independence Day", "8-21": "Ninoy Aquino Day", "11-1": "All Saints' Day", "11-2": "All Souls' Day",
    "11-30": "Bonifacio Day", "12-8": "Feast of the Immaculate Conception", "12-24": "Christmas Eve",
    "12-25": "Christmas Day", "12-30": "Rizal Day", "12-31": "New Year's Eve",
  };

  const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
    october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December"];
  const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const TUESDAY = 2;

  // ---------------------------------------------------------------- text
  function clean(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" && Number.isInteger(v)) v = String(v);
    return String(v).replace(/\t/g, " ").replace(/\s+/g, " ").trim();
  }
  const stripMarks = name => clean(name).replace(/^[^A-Za-zÀ-ÿ]+/, "");
  const asciiUpper = s => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);

  function nameKey(name) {
    const s = asciiUpper(stripMarks(name));
    if (!s) return "";
    let last, rest;
    if (s.includes(",")) { const i = s.indexOf(","); last = s.slice(0, i); rest = s.slice(i + 1); }
    else { const parts = s.split(" "); last = parts[0]; rest = parts.slice(1).join(" "); }
    last = last.replace(/[^A-Z\- ]/g, "").trim();
    const toks = rest.split(/[\s,.]+/).filter(t => t && !SUFFIXES.has(t));
    return `${last}|${toks[0] || ""}`;
  }

  function samePerson(a, b) {
    const ka = nameKey(a), kb = nameKey(b);
    if (!ka || !kb) return false;
    const [la, fa] = ka.split("|"), [lb, fb] = kb.split("|");
    if (la !== lb) return false;
    return !fa || !fb || fa === fb || fa.startsWith(fb) || fb.startsWith(fa);
  }

  // ---------------------------------------------------------------- dates (local, no time zones)
  const pad = n => String(n).padStart(2, "0");
  const mkDate = (y, m, d) => { const x = new Date(y, m - 1, d); return (x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d) ? x : null; };
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? mkDate(+m[1], +m[2], +m[3]) : null; };
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  function addMonths(d, n) {
    const total = d.getMonth() + n, y = d.getFullYear() + Math.floor(total / 12), m = ((total % 12) + 12) % 12;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  }
  function nearestTuesday(d) {
    let delta = (TUESDAY - d.getDay() + 7) % 7;
    if (delta > 3) delta -= 7;
    return addDays(d, delta);
  }
  function ageOn(birth, on) {
    if (!birth) return null;
    let a = on.getFullYear() - birth.getFullYear();
    if (on.getMonth() < birth.getMonth() || (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate())) a--;
    return a;
  }
  /** fmt(d, "short") Nov 5 | "med" Tue Nov 5, 2026 | "long" Tuesday, November 5, 2026 | "full" November 5, 2026
      | "mdY" 11/05/2026 | "mdy" 11/5/26 | "dowShort" Tue Nov 5 | "monY" November 5 */
  function fmt(d, style) {
    if (!d) return "";
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate(), w = d.getDay();
    switch (style) {
      case "short": return `${MON3[m]} ${day}`;
      case "dowShort": return `${DOW3[w]} ${MON3[m]} ${day}`;
      case "long": return `${DOW[w]}, ${MONTH[m]} ${day}, ${y}`;
      case "full": return `${MONTH[m]} ${day}, ${y}`;
      case "monY": return `${MONTH[m]} ${day}`;
      case "mdY": return `${pad(m + 1)}/${pad(day)}/${y}`;
      case "mdy": return `${m + 1}/${day}/${String(y).slice(2)}`;
      default: return `${DOW3[w]} ${MON3[m]} ${day}, ${y}`;
    }
  }

  function parseDate(v) {
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
    let s = clean(v);
    if (!s) return null;
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return mkDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/.exec(s))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return mkDate(y, +m[1], +m[2]);
    }
    if ((m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)) && MONTHS[m[1].toLowerCase()])
      return mkDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    if ((m = /^(\d{1,2})[\s-]([A-Za-z]+)[\s-](\d{4})/.exec(s)) && MONTHS[m[2].toLowerCase()])
      return mkDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    return null;
  }
  /** "11/10/2026 08:15:00 AM", "2026-10-29 16:17:36" -> "YYYY-MM-DD HH:MM:SS" or "" */
  function parseDateTime(v) {
    const s = clean(v), d = parseDate(s);
    if (!d) return "";
    const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(s.slice(s.indexOf(" ") + 1));
    let hh = 0, mm = 0, ss = 0;
    if (s.includes(" ") && t) {
      hh = +t[1]; mm = +t[2]; ss = +(t[3] || 0);
      if (t[4]) { const pm = t[4].toUpperCase() === "PM"; if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; }
    }
    return `${iso(d)} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }

  // ---------------------------------------------------------------- follow-up text
  function parseFollowup(text) {
    let months = 0, weeks = 0, found = false;
    const re = /(\d+)\s*(years?|yrs?|y|months?|mos?|m|weeks?|wks?|w)(?![a-z])/gi;
    let m;
    while ((m = re.exec(clean(text)))) {
      const n = +m[1], u = m[2].toLowerCase();
      found = true;
      if (u.startsWith("y")) months += 12 * n; else if (u.startsWith("m")) months += n; else weeks += n;
    }
    return found && (months || weeks) ? [months, weeks] : null;
  }
  function formatFollowup(months, weeks) {
    const p = [];
    if (months) p.push(months === 1 ? "1MO" : `${months}MOS`);
    if (weeks) p.push(weeks === 1 ? "1WK" : `${weeks}WKS`);
    return p.join(" ");
  }
  function followupWords(months, weeks) {
    const p = [];
    if (months) p.push(`${months} MONTH${months === 1 ? "" : "S"}`);
    if (weeks) p.push(`${weeks} WEEK${weeks === 1 ? "" : "S"}`);
    return p.join(" ");
  }

  // ---------------------------------------------------------------- WebHOMIS block
  const LABELS = [
    ["location", "location"], ["hospital_no", "hospital\\s*no\\.?|hospital\\s*number"],
    ["last", "last\\s*name|surname"], ["first", "first\\s*name"], ["middle", "middle\\s*name"],
    ["sex", "gender|sex"], ["birthdate", "birth\\s*date|birthday|date\\s*of\\s*birth"], ["age", "age"],
    ["religion", "religion"], ["address", "address"], ["logged", "date\\s*/?\\s*time\\s*logged"],
    ["room", "room\\s*/?\\s*section"], ["adm_dx", "admitting\\s*diagnosis"], ["dx", "working\\s*diagnosis|diagnosis"],
  ];
  const LABEL_RE = new RegExp("^\\s*(?:" + LABELS.map(([k, p]) => `(?<${k}>${p})`).join("|") + ")\\s*:\\s*(?<rest>.*)$", "i");
  const labelOf = m => LABELS.find(([k]) => m.groups[k] !== undefined)[0];

  function looksLikePatientBlock(text) {
    if (!text || text.length > 20000) return false;
    const keys = new Set();
    for (const line of text.split(/\r?\n|\r/)) {
      const m = LABEL_RE.exec(line.replace(/\t/g, " "));
      if (m) keys.add(labelOf(m));
    }
    return keys.has("hospital_no") && keys.has("last") && keys.size >= 4;
  }

  function parsePatientBlock(text) {
    const found = {};
    let current = null;
    for (const raw of String(text).replace(/\r/g, "\n").split("\n")) {
      const line = raw.replace(/\t/g, " ").trim();
      const m = LABEL_RE.exec(line);
      if (m) {
        current = labelOf(m);
        found[current] = found[current] || [];
        if (m.groups.rest.trim()) found[current].push(clean(m.groups.rest));
      } else if (current && line && line.toLowerCase() !== "patient information") {
        found[current].push(clean(line));
      }
    }
    const one = k => (found[k] || []).join(" ").trim();
    const p = {};
    p.hospital_no = one("hospital_no").split(".")[0].replace(/\D/g, "");
    p.last = one("last"); p.first = one("first"); p.middle = one("middle");
    const sex = one("sex").toUpperCase();
    p.sex = sex.startsWith("M") ? "MALE" : sex.startsWith("F") ? "FEMALE" : sex;
    const b = parseDate(one("birthdate"));
    p.birthdate = b ? iso(b) : one("birthdate");
    const age = /\d+/.exec(one("age"));
    p.age = age ? +age[0] : (b ? ageOn(b, today()) : null);
    p.religion = one("religion"); p.address = one("address"); p.room = one("room");
    p.logged = parseDateTime(one("logged")) || one("logged");
    const dx = found.dx || [];
    p.adm_dx = one("adm_dx") || (dx.length > 1 ? dx[0] : "");
    p.dx = (dx.length > 1 ? dx.slice(1) : dx).join(" ");
    if (!p.hospital_no || !p.last) throw new Error("That doesn't look like a WebHOMIS Patient Information block (no Hospital No. or Last Name found).");
    return p;
  }

  const logsheetName = p => `${p.last || ""}, ${p.first || ""}`.replace(/^[, ]+|[, ]+$/g, "");
  const sexLetter = p => ({ MALE: "M", FEMALE: "F" }[(p.sex || "").toUpperCase()] || (p.sex || "").slice(0, 1).toUpperCase());
  function ageSex(p, on) {
    let age = p.age === "" || p.age === undefined ? null : p.age;
    const b = parseDate(p.birthdate);
    if (b && on) age = ageOn(b, on);
    if (age === null && !sexLetter(p)) return "";
    return `${age === null ? "" : age}/${sexLetter(p)}`;
  }

  function rawdataBlock(p) {
    const b = parseDate(p.birthdate);
    let logged = p.logged || "";
    const lm = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(logged);
    if (lm) {
      let h = +lm[4]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
      logged = `${lm[2]}/${lm[3]}/${lm[1]} ${pad(h)}:${lm[5]}:${lm[6]} ${ap}`;
    }
    return ["Location:", "Patient Information", "Hospital No. :", p.hospital_no || "", "Last Name :", p.last || "",
      "First Name :", p.first || "", "Middle Name :", p.middle || "", "Gender :", p.sex || "",
      "Birthdate :", b ? fmt(b, "mdY") : (p.birthdate || ""), "Age :", p.age === null || p.age === undefined ? "" : String(p.age),
      "Religion :", p.religion || "", "Address :", p.address || "", "Date / Time Logged :", logged,
      "Room / Section :", p.room || "", "Diagnosis :", p.adm_dx || "", "", p.dx || ""].join("\n");
  }

  const LOG_FIELDS = ["name", "age_sex", "cc", "dx", "other", "nor", "ref_dept", "resident", "consultant", "dispo", "followup"];
  const logsheetTsv = visits => visits.map(v => LOG_FIELDS.map(f => clean(v[f])).join("\t")).join("\n");

  // ---------------------------------------------------------------- schedule
  function holidayName(d, extra) {
    if ((extra || []).includes(iso(d))) return "Holiday (your list)";
    return FIXED_HOLIDAYS[`${d.getMonth() + 1}-${d.getDate()}`] || "";
  }
  const colLetter = col => { let s = ""; while (col > 0) { const r = (col - 1) % 26; s = String.fromCharCode(65 + r) + s; col = Math.floor((col - 1) / 26); } return s; };

  function parseHeader(v) {
    const s = clean(v);
    let m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/.exec(s);
    if (m && MONTHS[m[1].toLowerCase()]) return [MONTHS[m[1].toLowerCase()], +m[2], m[3] ? +m[3] : null];
    m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
    if (m) { let y = m[3] ? +m[3] : null; if (y !== null && y < 100) y += 2000; return [+m[1], +m[2], y]; }
    return null;
  }

  /** grid = rows of cells from the schedule tab (row 1 dates, row 2 notes, rows 3+ names). */
  function parseSchedule(grid, opt = {}) {
    const s = { ...DEFAULTS, ...(opt.settings || {}) };
    const firstCol = opt.firstCol ?? 1, headerRow = opt.headerRow ?? 0, noteRow = opt.noteRow ?? 1;
    const firstNameRow = opt.firstNameRow ?? 2, row0 = opt.sheetRowOfGridRow0 ?? 1, col0 = opt.sheetColOfGridCol0 ?? 1;
    const now = opt.today || today();
    const width = Math.max(0, ...grid.map(r => r.length));
    const cell = (r, c) => (r < grid.length && c < grid[r].length) ? grid[r][c] : null;
    const parsed = [], bad = [], anchors = [];
    let pendingYear = null;
    for (let c = firstCol; c < width; c++) {
      const h = cell(headerRow, c);
      let note = noteRow === null ? "" : clean(cell(noteRow, c));
      if (/^(19|20)\d\d$/.test(note)) { pendingYear = +note; note = ""; }
      const ph = parseHeader(h);
      if (!ph) { if (clean(h)) bad.push(`${colLetter(c + col0)}: '${clean(h)}'`); continue; }
      parsed.push({ c, m: ph[0], d: ph[1], y: ph[2], note });
      if (ph[2]) anchors.push([parsed.length - 1, ph[2]]);
      else if (pendingYear) anchors.push([parsed.length - 1, pendingYear]);
      pendingYear = null;
    }
    const rel = []; let off = 0, prev = null;
    for (const p of parsed) { const o = p.m * 31 + p.d; if (prev !== null && o < prev - 45) off++; rel.push(off); prev = o; }
    let base = now.getFullYear();
    if (anchors.length) {
      const bases = anchors.map(([i, y]) => y - rel[i]), counts = {};
      bases.forEach(b => { counts[b] = (counts[b] || 0) + 1; });
      base = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    } else if (parsed.length) {
      const last = parsed[parsed.length - 1], aim = addDays(now, 150);
      let best = null, bestDiff = Infinity;
      for (let y = now.getFullYear() - 4; y < now.getFullYear() + 3; y++) {
        const diff = Math.abs(daysBetween(aim, new Date(y + rel[rel.length - 1], last.m - 1, Math.min(last.d, 28))));
        if (diff < bestDiff) { bestDiff = diff; best = y; }
      }
      base = best;
    }
    const days = [];
    const cr0 = s.count_first_row - row0, cr1 = s.count_last_row - row0;
    const pr0 = s.placement_first_row - row0, pr1 = s.placement_last_row - row0;
    parsed.forEach((p, i) => {
      const date = mkDate(base + rel[i], p.m, p.d);
      if (!date) { bad.push(`${colLetter(p.c + col0)}: '${clean(cell(headerRow, p.c))}'`); return; }
      const day = { date, header: clean(cell(headerRow, p.c)) || fmt(date, "monY"), col: p.c + col0, note: p.note,
        names: [], free_row: null, blocked: "" };
      for (let r = Math.max(cr0, firstNameRow); r <= cr1; r++) {
        const v = cell(r, p.c);
        if (stripMarks(v)) day.names.push([r + row0, clean(v)]);
      }
      for (let r = Math.max(pr0, firstNameRow); r <= pr1; r++) {
        if (!clean(cell(r, p.c))) { day.free_row = r + row0; break; }
      }
      day.blocked = (p.note && s.notes_block_date ? p.note : "") || holidayName(date, s.extra_holidays);
      days.push(day);
    });
    days.sort((a, b) => a.date - b.date);
    return { days, badHeaders: bad, fetched: new Date() };
  }

  const dayOn = (sch, d) => sch.days.find(x => iso(x.date) === iso(d)) || null;
  function findInSchedule(sch, name, after) {
    const out = [];
    for (const day of sch.days) {
      if (after && day.date <= after) continue;
      for (const [row, n] of day.names) if (samePerson(n, name)) out.push([day, row, n]);
    }
    return out;
  }
  function addToSchedule(day, row, name, settings) {
    const s = { ...DEFAULTS, ...(settings || {}) };
    day.names = [...day.names, [row, name]].sort((a, b) => a[0] - b[0]);
    const used = new Set(day.names.map(x => x[0]));
    day.free_row = null;
    for (let r = s.placement_first_row; r <= s.placement_last_row; r++) if (!used.has(r)) { day.free_row = r; break; }
  }

  /** The decking rule from the sheet's script, with the fixes made in opd_core.plan_followup. */
  function planFollowup(sch, name, months, weeks, base, settings) {
    const s = { ...DEFAULTS, ...(settings || {}) };
    base = base || today();
    if (months <= 0 && weeks <= 0) throw new Error("Give a follow-up interval (months and/or weeks).");
    const target = addDays(addMonths(base, months), 7 * weeks);
    const span = daysBetween(base, target);
    const earliest = new Date(Math.max(addDays(base, 1), addDays(target, -Math.min(s.before_days, Math.floor(span / 2)))));
    const latest = addMonths(target, s.after_months);
    const warnings = [];
    const pool = sch.days.filter(d => d.date >= earliest && d.date <= latest);
    const usable = pool.filter(d => !d.blocked && d.free_row);
    const key = d => [Math.abs(daysBetween(target, d.date)), d.date.getTime()];
    const byKey = (a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; };
    const preferred = usable.filter(d => d.names.length < s.prefer_below).sort(byKey);
    const capped = usable.filter(d => d.names.length < s.hard_cap).sort(byKey);
    let chosen = null, over = false;
    if (preferred.length) chosen = preferred[0]; else if (capped.length) { chosen = capped[0]; over = true; }
    const near = dayOn(sch, nearestTuesday(target));
    if (near && near.blocked && chosen !== near) warnings.push(`${fmt(near.date, "short")} is blocked (${near.blocked}).`);
    if (over && chosen) warnings.push(`Every open Tuesday near the target already has ${s.prefer_below}+ patients; ${fmt(chosen.date, "short")} is the nearest under ${s.hard_cap}.`);
    if (!chosen) {
      const last = sch.days.length ? sch.days[sch.days.length - 1].date : null;
      if (!sch.days.length) warnings.push("No schedule loaded.");
      else if (last < target) warnings.push(`The schedule ends on ${fmt(last, "full")}; add Tuesday columns up to ${fmt(nearestTuesday(target), "full")} first.`);
      else warnings.push(`No Tuesday between ${fmt(earliest, "short")} and ${fmt(latest, "full")} has room under ${s.hard_cap} patients.`);
    }
    if (chosen && Math.abs(daysBetween(target, chosen.date)) > 21) {
      const wk = Math.floor(Math.abs(daysBetween(target, chosen.date)) / 7);
      warnings.push(`That is ${wk} weeks ${chosen.date > target ? "after" : "before"} the target.`);
    }
    const already = findInSchedule(sch, name, base);
    if (already.length) warnings.push("Already decked on " + already.map(([d]) => fmt(d.date, "short")).join(", ") + " - check before decking again.");
    return { name, base, target, chosen, row: chosen ? chosen.free_row : null, over_preferred: over,
      options: usable.slice().sort(byKey).slice(0, 6), already, warnings };
  }

  function scheduleProblems(sch, settings, now) {
    const s = { ...DEFAULTS, ...(settings || {}) };
    now = now || today();
    const out = [], future = sch.days.filter(d => d.date >= now);
    for (const d of future) {
      if (d.blocked && d.names.length) out.push(`${fmt(d.date, "dowShort")}: ${d.names.length} patient(s) decked on a blocked day (${d.blocked}) - move them.`);
      if (d.names.length > s.hard_cap) out.push(`${fmt(d.date, "dowShort")}: ${d.names.length} patients (cap is ${s.hard_cap}).`);
      if (d.date.getDay() !== TUESDAY) out.push(`${d.header}: is a ${DOW[d.date.getDay()]}, not a Tuesday.`);
    }
    const seen = new Map();
    for (const d of future) for (const [, n] of d.names) {
      const k = nameKey(n);
      if (k && k !== "|") { if (!seen.has(k)) seen.set(k, []); seen.get(k).push(d); }
    }
    for (const [k, ds] of seen) if (ds.length > 1) out.push(`${k.replace("|", ", ")}: decked ${ds.length} times (${ds.map(d => fmt(d.date, "short")).join(", ")}).`);
    if (sch.badHeaders.length) out.push("Columns with no readable date: " + sch.badHeaders.join("; "));
    return out;
  }

  // ---------------------------------------------------------------- logsheet sync (OPD Patients, rows 39+)
  function planLogsheetSync(visits, values, firstRow = 39) {
    const isNum = v => /^\d+(\.0+)?$/.test(clean(v));
    let numbered = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] && isNum(values[i][0])) numbered.push(i);
      else if (numbered.length) break;
    }
    if (!numbered.length) numbered = [...Array(Math.min(12, values.length)).keys()];
    const current = {};
    numbered.forEach(i => { current[i] = values[i] && values[i].length > 1 ? clean(values[i][1]) : ""; });
    const used = new Set(), writes = [], overflow = [];
    for (const v of visits) {
      let i = numbered.find(i => !used.has(i) && current[i] && samePerson(current[i], v.name));
      if (i === undefined) i = numbered.find(i => !used.has(i) && !current[i]);
      if (i === undefined) { overflow.push(v); continue; }
      used.add(i);
      const a = values[i] ? clean(values[i][0]) : "";
      const number = isNum(a) ? Math.round(parseFloat(a)) : i + 1;
      writes.push({ row: firstRow + i, expect: current[i], update: !!current[i], name: v.name,
        values: [number, ...LOG_FIELDS.map(f => clean(v[f]))] });
    }
    return { writes, overflow };
  }

  // ---------------------------------------------------------------- two-way sync with an OPD Patients block
  /* visits: this date's WorkDash visits. rows: the block's 12 patient rows (A..L, shown values).
     clears: [{seq, name}] rows WorkDash removed and wants emptied in the sheet.
     Each visit's log_sig remembers the row (B..L) as both sides last agreed:
       JSON array -> synced: a three-way merge per field (a field changed on one side wins; when both
                     sides changed the same field, WorkDash wins because that's the screen being used);
       "new"      -> added in WorkDash, never in the sheet yet: goes into the first empty row;
       ""         -> older data (imported history): the sheet wins, nothing is written to the sheet.
     Returns what to write to the sheet, what to change in WorkDash, and what to report. */
  const rowFields = r => LOG_FIELDS.map((_, i) => clean(r && r[i + 1]));
  const visitFields = v => LOG_FIELDS.map(f => clean(v[f]));
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const parseSig = s => { try { const a = JSON.parse(s); return Array.isArray(a) && a.length === LOG_FIELDS.length ? a.map(clean) : null; } catch { return null; } };

  function planDaySync(visits, rows, clears = []) {
    const n = rows.length;
    const S = rows.map(rowFields);
    const filled = S.map(r => r.some(Boolean));
    const used = new Set(), clearRows = new Set();
    const out = { push: [], local: [], add: [], drop: [], conflicts: [], overflow: [], localOnly: [] };

    for (const c of clears) {                    // only if that row still holds the same person
      const i = +c.seq - 1;
      if (i >= 0 && i < n && filled[i] && samePerson(S[i][0], c.name)) {
        clearRows.add(i); used.add(i);
        out.push.push({ seq: i + 1, expect: S[i][0], values: [i + 1, ...LOG_FIELDS.map(() => "")], clear: true, name: c.name });
      }
    }
    const findRow = (names, prefer) => {
      const ok = i => i >= 0 && i < n && !used.has(i) && filled[i] && names.some(nm => nm && samePerson(S[i][0], nm));
      if (ok(prefer)) return prefer;
      for (let i = 0; i < n; i++) if (ok(i)) return i;
      return -1;
    };
    const synced = [], fresh = [], legacy = [];
    for (const v of visits) {
      const G = parseSig(v.log_sig);
      if (G) synced.push([v, G]); else if (v.log_sig === "new") fresh.push(v); else legacy.push(v);
    }
    const settle = (v, i, M, L, why) => {        // M = the merged row both sides should end up with
      used.add(i);
      const seq = String(i + 1), sig = JSON.stringify(M);
      const push = !sameArr(M, S[i]);
      if (push) out.push.push({ seq: i + 1, expect: S[i][0], values: [i + 1, ...M], id: v.id, sig });
      const fields = {};
      LOG_FIELDS.forEach((f, k) => { if (M[k] !== L[k]) fields[f] = M[k]; });
      if (Object.keys(fields).length || String(v.seq) !== seq || (!push && v.log_sig !== sig) || why)
        out.local.push({ id: v.id, seq, fields, sig: push ? null : sig, why });
    };

    for (const [v, G] of synced) {
      const L = visitFields(v);
      const i = findRow([v.name, G[0]], +v.seq - 1);
      if (i < 0) {
        if (sameArr(L, G)) out.drop.push(v);     // emptied in the sheet, untouched here -> remove here too
        else fresh.push(v);                       // emptied in the sheet but edited here -> put it back
        continue;
      }
      let clash = false;
      const M = L.map((l, k) => {
        const s = S[i][k], g = G[k];
        if (s === g) return l;                    // the sheet didn't change it: WorkDash's value
        if (l === g) return s;                    // WorkDash didn't change it: the sheet's value
        if (l !== s) clash = true;
        return l;
      });
      if (clash) out.conflicts.push(v);
      settle(v, i, M, L);
    }
    for (const v of legacy) {
      const L = visitFields(v);
      const i = findRow([v.name], +v.seq - 1);
      if (i < 0) { out.localOnly.push(v); continue; }
      settle(v, i, S[i].slice(), L);
    }
    for (const v of fresh) {
      const L = visitFields(v);
      let i = findRow([v.name], -1);              // typed into the sheet too: keep the sheet's values, fill its blanks
      if (i >= 0) { settle(v, i, S[i].map((s, k) => s || L[k]), L); continue; }
      i = [...Array(n).keys()].find(k => !used.has(k) && !filled[k] && !clearRows.has(k));
      if (i === undefined) { out.overflow.push(v); continue; }
      used.add(i);
      out.push.push({ seq: i + 1, expect: "", values: [i + 1, ...L], id: v.id, sig: JSON.stringify(L) });
      out.local.push({ id: v.id, seq: String(i + 1), fields: {}, sig: null });
    }
    for (let i = 0; i < n; i++) {
      if (filled[i] && !used.has(i) && !clearRows.has(i)) out.add.push({ seq: String(i + 1), fields: Object.fromEntries(LOG_FIELDS.map((f, k) => [f, S[i][k]])), sig: JSON.stringify(S[i]) });
    }
    return out;
  }

  return { DEFAULTS, LOG_FIELDS, TUESDAY, clean, stripMarks, nameKey, samePerson, iso, fromIso, today, addDays,
    addMonths, nearestTuesday, ageOn, fmt, parseDate, parseDateTime, parseFollowup, formatFollowup, followupWords,
    looksLikePatientBlock, parsePatientBlock, logsheetName, sexLetter, ageSex, rawdataBlock, logsheetTsv,
    holidayName, colLetter, parseSchedule, dayOn, findInSchedule, addToSchedule, planFollowup, scheduleProblems,
    planLogsheetSync, planDaySync };
})();
