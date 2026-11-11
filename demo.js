/* WorkDash demo backend - made-up patients and a made-up schedule, kept in memory only.
   It answers the same requests as the Apps Script Web App, so every button can be tried
   without a Google Sheet. Nothing here is real patient data. */
"use strict";

const Demo = (() => {
  let rnd = 7;                                        // small seeded random, same demo every time
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const FIRST = ["ANA", "JUAN", "MARIA", "JOSE", "LIZA", "PEDRO", "ROSA", "BEN", "CARMEN", "LUIS", "NENA", "TONY"];
  const LAST = ["SANTOS", "DELA CRUZ", "REYES", "GARCIA", "MENDOZA", "BAUTISTA", "VILLANUEVA", "TORRES", "RAMOS", "AQUINO", "CASTRO", "FLORES"];
  const fakeName = () => `${LAST[Math.floor(rand() * LAST.length)]}, ${FIRST[Math.floor(rand() * FIRST.length)]}`;
  const T = WD.today();

  // ---- schedule grid: row 1 dates, row 2 notes, rows 3+ names (like "BACUS (Tues AM)")
  const grid = Array.from({ length: 37 }, () => [""]);
  grid[0][0] = "Els";
  let tue = WD.addDays(WD.nearestTuesday(T), -56);
  for (let c = 1; c <= 40; c++, tue = WD.addDays(tue, 7)) {
    const month = WD.fmt(tue, "monY");
    grid[0][c] = c > 20 && tue.getMonth() <= 2 ? `${month}, ${tue.getFullYear()}` : month;
    grid[1][c] = c === 12 ? "Hospital event" : "";      // a note in row 2 blocks that Tuesday
    const n = c === 9 ? 0 : Math.floor(rand() * (tue < T ? 12 : 10));
    for (let r = 2; r < 37; r++) grid[r][c] = r - 2 < n ? (rand() < .15 ? "%" : "") + fakeName() : "";
  }

  // ---- patients and past visits (made up)
  const patients = [];
  const visits = [];
  const dxs = ["CHRONIC CVD INFARCT, MRS 1", "EPILEPSY, FOCAL", "MIGRAINE WITHOUT AURA", "PARKINSON DISEASE", "CHRONIC ICH, MRS 2", "ESSENTIAL TREMOR"];
  for (let i = 0; i < 10; i++) {
    const [last, first] = [LAST[i], FIRST[i]];
    const by = 1950 + Math.floor(rand() * 45);
    patients.push({ hospital_no: String(9000001 + i), last, first, middle: "DEMO", sex: i % 2 ? "MALE" : "FEMALE",
      birthdate: `${by}-0${1 + (i % 9)}-1${i % 9}`, age: String(T.getFullYear() - by), religion: "CATHOLIC",
      address: `${10 + i} SAMPLE ST., QUEZON CITY`, logged: "", room: "OUTPATIENT DEPARTMENT - NEUROLOGY-N",
      adm_dx: "", dx: dxs[i % dxs.length] });
    if (i < 7) {
      const d = WD.addDays(WD.nearestTuesday(T), -7 * (3 + i));
      visits.push({ id: `demo-past-${i}`, visit_date: WD.iso(d), seq: "1", hospital_no: String(9000001 + i),
        name: `${last}, ${first}`, age_sex: `${T.getFullYear() - by}/${i % 2 ? "M" : "F"}`, cc: "", dx: dxs[i % dxs.length],
        other: i % 3 ? "" : "HYPERTENSION", nor: "O", ref_dept: "", resident: "DR BACUS", consultant: "DR AMPATI",
        dispo: "DISCHARGE", followup: "3MOS", decked: "" });
    }
  }

  // ---- the newest logsheet block in "OPD Patients": DATE in C37, patients from row 39
  const logDate = WD.today();
  const logRows = Array.from({ length: 30 }, (_, i) => i < 12 ? [String(i + 1), ...Array(11).fill("")] : Array(12).fill(""));
  // two patients "typed straight into the sheet", to show the two-way sync bringing them in
  logRows[0] = ["1", "MENDOZA, CARMEN", "61/F", "", "CHRONIC CVD INFARCT, MRS 1", "HYPERTENSION", "O", "", "DR BACUS", "DR AMPATI", "DISCHARGE", "3MOS"];
  logRows[1] = ["2", "VILLANUEVA, NENA", "38/F", "HEADACHE", "MIGRAINE WITHOUT AURA", "", "N", "", "DR BACUS", "DR AMPATI", "DISCHARGE", "1MO"];

  const ok = x => ({ ok: true, ...x });
  const copy = x => JSON.parse(JSON.stringify(x));

  function call(action, b) {
    const reply = (() => {
      switch (action) {
        case "schedule": return ok({ tab: "BACUS (Tues AM) - demo", values: copy(grid) });
        case "deck": {
          const col = +b.col, row = +b.row, c = col - 1;      // sheet column B = grid index 1
          if (String(grid[0][c] || "").trim() !== String(b.header || "").trim()) return { ok: false, error: "the date in that column changed, reload the schedule" };
          if (row < 5 || row > 12) return { ok: false, error: "row outside 5-12" };
          if (String(grid[row - 1][c] || "").trim()) return { ok: false, error: "that cell was just filled, reload the schedule" };
          grid[row - 1][c] = b.name;
          return ok({ cell: `${WD.colLetter(col)}${row}`, header: grid[0][c] });
        }
        case "logsheet_read": return ok({ tab: "OPD Patients - demo", date_cell: "C37", date_iso: WD.iso(logDate),
          date_display: WD.fmt(logDate, "full"), first_row: 39, values: copy(logRows) });
        case "logsheet_write": {
          if (b.date_iso !== WD.iso(logDate)) return { ok: false, error: "date_mismatch", date_iso: WD.iso(logDate), date_display: WD.fmt(logDate, "full") };
          const written = [], conflicts = [];
          for (const w of b.writes || []) {
            const i = w.row - 39;
            if (i < 0 || i >= logRows.length) { conflicts.push({ row: w.row, now: "row out of range" }); continue; }
            if (String(logRows[i][1]).trim() !== String(w.expect || "").trim()) { conflicts.push({ row: w.row, now: logRows[i][1] }); continue; }
            logRows[i] = w.values.map(String);
            written.push(w.row);
          }
          return ok({ written, conflicts, date_display: WD.fmt(logDate, "full") });
        }
        case "log_get": {
          if (b.date_iso !== WD.iso(logDate)) return ok({ found: false, latest_iso: WD.iso(logDate), latest_display: WD.fmt(logDate, "long") });
          return ok({ found: true, date_row: 37, first_row: 39, date_display: WD.fmt(logDate, "long"), copied: false,
            latest_iso: WD.iso(logDate), latest_display: WD.fmt(logDate, "long"), values: copy(logRows.slice(0, 12)) });
        }
        case "log_put": {
          if (b.date_iso !== WD.iso(logDate)) return { ok: false, error: "no_block" };
          const written = [], conflicts = [];
          let cells = 0;
          for (const w of b.writes || []) {
            const i = +w.seq - 1;
            if (!(i >= 0 && i < 12)) { conflicts.push({ seq: w.seq, now: "row out of range" }); continue; }
            if (String(logRows[i][1]).trim() !== String(w.expect || "").trim()) { conflicts.push({ seq: w.seq, now: logRows[i][1] }); continue; }
            const vals = [String(i + 1), ...w.values.slice(1).map(String)];
            vals.forEach((x, j) => { if (x.trim() !== String(logRows[i][j]).trim()) { logRows[i][j] = x; cells++; } });
            written.push(+w.seq);
          }
          return ok({ written, conflicts, cells, first_row: 39 });
        }
        case "wd_bootstrap": return ok({ visits: copy(visits), patients: copy(patients) });
        case "wd_save": {
          if (b.patient) { const i = patients.findIndex(p => p.hospital_no === b.patient.hospital_no); i >= 0 ? patients[i] = copy(b.patient) : patients.push(copy(b.patient)); }
          for (const x of [b.visit, ...(b.visits || [])].filter(Boolean)) { const i = visits.findIndex(v => v.id === x.id); i >= 0 ? visits[i] = copy(x) : visits.push(copy(x)); }
          return ok();
        }
        case "wd_delete": { const i = visits.findIndex(v => v.id === b.id); if (i >= 0) visits.splice(i, 1); return ok({ deleted: i >= 0 ? 1 : 0 }); }
        case "ping": return ok({ tab: "demo" });
        default: return { ok: false, error: "unknown action" };
      }
    })();
    return new Promise(res => setTimeout(() => res(reply), 120 + Math.random() * 150));   // feels like the network
  }

  return { call, sheetRows: () => copy(logRows.slice(0, 12)) };   // sheetRows: for tests
})();
