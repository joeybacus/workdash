/* WorkDash printed forms - Laboratory Request, Rx + Request for Medical Certificate, S2 Rx.
   A port of opd_forms.py: the same layouts, sized with CSS @page so the browser's print
   dialog lays them out exactly (Legal 8.5x14 or A4, 0.25 in margins). */
"use strict";

const Forms = (() => {
  const PAPERS = { "Legal 8.5x14": [8.5, 14.0], "A4": [8.27, 11.69] };
  const MARGIN_IN = 0.25, DESIGN_W_IN = 8.0;

  const esc = s => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const e = v => esc(WD.clean(v));

  // ---- Laboratory Request Form layout ("Label*" = free for seniors, ">x" indented, "#x" plain text)
  const LAB_SECTIONS = [
    ["chem", "CLINICAL CHEMISTRY", [
      ["FBS*", "RBS", "OGTT", "OGCT", "2 hr. PPBS", "HBA1C", "Total Lipid Profile", "Triglycerides", "Cholesterol", "BUA", "BUN", "Creatinine*"],
      ["CRP", "SGOT", "SGPT", "Alk. Phos.", "Bilirubin Profile", "Sodium", "Potassium", "Chloride", "Calcium", "Magnesium", "Phosphorus"],
      ["TPAG", "Albumin", "LDH", "Amylase", "Lipase", "CKMB", "CKMM", "Total CK", "Serum Iron", "dTIBC", "Ionized Calcium"]]],
    ["immuno", "IMMUNOLOGY & SEROLOGY", [
      ["Troponin I", "NT-proBNP", "TSH", "T3", "T4", "FT3", "FT4", "AFP", "Beta-HCG", "CEA", "PSA", "CA-125"],
      ["CA19-9", "C3", "ASO", "Procalcitonin", "Serum Ferritin", "SERO 1", "Syphilis (Quanti) Rapid Test", "Leptospira", "Dengue", "Salmonella Typhi", "H.Pylori"],
      ["D-Dimer", "Hepatitis Profile", "ASO", ">HBsAg", ">Anti-HBs", ">Anti-HCV", ">HBeAg", ">Anti-HBe", ">Anti-HBcIgm", ">Anti-HAVIgm"]]],
    ["hema", "HEMATOLOGY & COAGULATION", [
      ["CBC w/ Platelet*", "Protime", "APTT", "Clotting / Bleeding Time", "ESR", "Malarial Smear", "Rapid Test Malaria", "Filaria Smear", "Fibrinogen Assay", "PT Mixing Studies", "APTT Mixing Studies"],
      ["Peripheral Blood Smear", "Reticulocyte count", "CD4 count", "Cell count and Diff. count", "#Specimen: ________"]]],
    ["micro", "MICROBIOLOGY", [
      ["#Specimen: ________", "Culture & Sens", "Gram Stain", "Sputum AFB X ____*", "AFB", "Fungal Culture", "Wet Mount", "KOH", "India Ink", "CALAS", "Rapid Antigen Test"],
      ["Gene Xpert", ">TB", ">Viral Load", ">HPV", ">GBS", ">CT/NG", ">Trichomonas vag/TV", ">Others", "Microbiology Panel", ">Meningitis Encephalitis", ">Gastro-Intestinal", ">Respiratory", ">Pneumonia"]]],
    ["urine", "URINE", [["24°Creatinine", "24°Protein", "Creatinine Clearance", "Random Protein"],
      ["Random Creatinine", "Sodium", "Potassium", "Chloride", "UPCR"]]],
    ["fluids", "BODY FLUIDS", [["CSF", "Pleural", "Peritoneal", "Ascitic", "Others: _____"]]],
    ["bank", "BLOOD BANK", [["ABO Blood Typing w/ RH*", "Coomb's Test", "Crossmatching"]]],
    ["cm", "CLINICAL MICROSCOPY", [["Urinalysis*", "Urine Albumin", "Urine Ketone", "Urine Micral Test", "Urine Micral Test"],
      ["Fecalysis*", "FOBT", "Sperm Analysis", "Pregnancy Test"], ["Scotch Tape swab"]]],
    ["molec", "MOLECULAR LABORATORY", [["#<b>SARS-COV 2</b>", "Reverse Transcription Polymerase Chain Reaction (RT-PCR)"]]],
  ];
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const LAB_ITEMS = (() => {
    const out = [], seen = {};
    for (const [skey, , cols] of LAB_SECTIONS) for (const col of cols) for (const raw of col) {
      const plain = raw.startsWith("#"), indented = raw.startsWith(">");
      let label = raw.replace(/^[#>]/, "");
      const senior = label.endsWith("*");
      label = label.replace(/\*$/, "");
      let key = `${skey}.${slug(label)}`;
      if (!plain) { seen[key] = (seen[key] || 0) + 1; if (seen[key] > 1) key += `.${seen[key]}`; }
      out.push({ key, skey, label, senior, indented, plain });
    }
    return out;
  })();
  const LAB_LABELS = Object.fromEntries(LAB_ITEMS.filter(i => !i.plain).map(i => [i.key, i.label]));
  const LAB_PANELS = {
    Fasting: ["chem.fbs", "chem.total-lipid-profile"],
    Routine: ["hema.cbc-w-platelet", "chem.sodium", "chem.potassium", "chem.magnesium", "chem.bun", "chem.creatinine"],
    Respi: ["micro.culture-sens", "micro.gram-stain"],
    UTI: ["cm.urinalysis"],
    Anemia: ["hema.peripheral-blood-smear", "hema.reticulocyte-count", "immuno.serum-ferritin", "chem.serum-iron", "chem.dtibc", "hema.fibrinogen-assay"],
    Septic: ["hema.cbc-w-platelet", "immuno.procalcitonin"],
  };

  const CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
.sheet { padding: var(--margin); page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.page { width: 8in; zoom: var(--zoom); }
.cb { display: inline-block; position: relative; width: 8px; height: 8px; border: 0.8px solid #000; margin-right: 3px; vertical-align: -1px; text-indent: 0; }
.cb.on::after { content: "✓"; position: absolute; left: 0px; top: -4px; font-size: 10px; font-weight: bold; line-height: 1; }
.b { font-weight: bold; } .c { text-align: center; } .r { text-align: right; } .i { font-style: italic; }
.small { font-size: 0.8em; }
img.logo { display: block; }
.cut { border-top: 1px dashed #000; margin: 10px 0; height: 0; }
.lab { border: 1px solid #000; font-size: 8.4px; width: 8in; }
.lab table { border-collapse: collapse; width: 100%; }
.lab td { border: 1px solid #000; padding: 1px 4px; vertical-align: top; }
.lab .hdr td { border: none; }
.lab .big { font-size: 15px; text-align: center; padding: 4px; height: 26px; vertical-align: middle; }
.lab .lbl { font-weight: bold; text-align: center; font-size: 8.4px; }
.lab .sec { font-weight: bold; text-align: center; border-bottom: 1px solid #000; padding: 1px 0; }
.lab .cols { display: flex; gap: 4px; padding: 2px 3px; }
.lab .col { flex: 1 1 0; min-width: 0; }
.lab .it { line-height: 10.6px; padding: 0.7px 0 0.7px 11px; text-indent: -11px; }
.lab .it.ind { padding-left: 22px; }
.lab .it.on { font-weight: bold; }
.lab .grid { display: grid; border-top: 1px solid #000; }
.lab .grid > div { border-right: 1px solid #000; }
.lab .grid > div:last-child { border-right: none; }
.lab .sig { font-size: 7px; }
.lab .line { display: inline-block; border-bottom: 1px solid #000; min-width: 120px; height: 9px; }
.rx { border: 1.2px solid #000; font-size: var(--fs); display: flex; flex-direction: column; }
.rx .head { display: flex; align-items: center; border-bottom: 1px solid #000; padding: 3px 4px; gap: 4px; }
.rx .head .t { flex: 1; text-align: center; line-height: 1.25; font-size: 0.95em; }
.rx .copyban { text-align: right; font-weight: bold; font-size: 1.25em; padding: 1px 4px; border-bottom: 1px solid #000; }
.rx table.info { border-collapse: collapse; width: 100%; margin-top: 4px; }
.rx table.info td { padding: 1.5px 4px; vertical-align: bottom; }
.rx table.info td:nth-child(odd) { white-space: nowrap; }
.rx .tiny { font-size: 0.78em; }
.rx .body { flex: 1; display: flex; border-top: 1px solid #000; min-height: 0; }
.rx .main { flex: 1; display: flex; flex-direction: column; padding: 2px 4px; min-width: 0; }
.rx .amt { width: 24%; border-left: 1px solid #000; display: flex; flex-direction: column; justify-content: space-between; padding: 2px 3px; font-size: 0.82em; }
.rx .rxsym { font-size: 3.1em; font-family: Arial; line-height: 1; }
.rx .addr { font-size: 0.8em; padding-top: 2px; }
.rx .meds { white-space: pre-wrap; font-size: 1.12em; line-height: 1.45; margin-top: 6px; flex: 1; overflow: hidden; }
.rx .fu { font-size: 0.95em; margin-top: 4px; }
.rx .pres { display: flex; justify-content: space-between; align-items: flex-end; font-size: 0.86em; line-height: 1.25; }
.rx .sigline { border-top: 1px solid #000; width: 62%; margin-top: 18px; }
.rx .norefill { font-weight: bold; font-size: 1.3em; text-align: center; border-bottom: 1px solid #000; margin: 0 -3px; padding-bottom: 2px; }
.rx .copylbl { text-align: center; }
.mc { border: 1.2px solid #000; font-size: 9px; }
.mc table { border-collapse: collapse; width: 100%; }
.mc td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; }
.mc .h { height: 46px; }
.mc .ck { white-space: nowrap; display: inline-block; margin-right: 6px; line-height: 13px; }
`;

  const box = on => on ? '<span class="cb on"></span>' : '<span class="cb"></span>';
  const logoImg = (logo, px) => logo ? `<img class="logo" src="${logo}" style="width:${px}px">` : "";

  function common(p, date) {
    const b = WD.parseDate(p.birthdate);
    const age = b ? WD.ageOn(b, date) : p.age;
    return {
      full: e(`${p.last || ""}, ${p.first || ""} ${p.middle || ""}`.replace(/^[, ]+|[, ]+$/g, "")),
      last: e(p.last), first: e(p.first), middle: e(p.middle),
      age: age === null || age === undefined || age === "" ? "" : String(age), sex: e(WD.sexLetter(p)),
      hno: e(p.hospital_no), dob: b ? WD.fmt(b, "mdY") : "", addr: e(p.address), dx: e(p.dx),
      date_long: WD.fmt(date, "mdY"), date_short: WD.fmt(date, "mdy"),
    };
  }

  function rxBlock(c, fs, o) {
    const fontPx = o.font_px || 11, h = o.height_px || 590;
    let pres = "";
    if (o.s2) {
      const lines = [e(fs.prescriber), `Lic. No.: ${e(fs.license_no)}`, `S2 No.: ${e(fs.s2_no)}`, `Date Issued: ${e(fs.s2_issued)}`,
        `Validity Date: ${e(fs.s2_validity)}`, `PTR No. ${e(fs.ptr_no)}`, `Address: ${e(fs.prescriber_address)}`];
      pres = `<div class="sigline"></div><div class="pres"><div>${lines.join("<br>")}</div><div class="copylbl">${(o.copy_label || "").split(" ").map(esc).join("<br>")}</div></div>`;
    }
    const fu = o.followup ? `<div class="fu"><b>Follow up:</b> ${e(o.followup)}</div>` : "";
    return `
<div class="rx" style="--fs:${fontPx}px; height:${h}px">
  <div class="head">${logoImg(o.logo, fontPx * 4.1)}
    <div class="t">Department of Health<br><b>QUIRINO MEMORIAL MEDICAL CENTER</b><br>
    <span class="tiny">JP Rizal cor. P. Tuazon St., Project 4, Quezon City, 1109</span></div></div>
  ${o.banner ? `<div class="copyban">${esc(o.banner)}</div>` : ""}
  <table class="info">
    <tr><td style="width:27%">Name of Patient:</td><td class="tiny">${c.full}</td><td style="width:15%">Date:</td><td style="width:20%" class="c">${c.date_long}</td></tr>
    <tr><td>Hospital No:</td><td>${c.hno}</td><td>Ward:</td><td class="c">${e(fs.ward)}</td></tr>
    <tr><td>Classification:</td><td>${e(fs.classification)}</td><td>Age/Sex:</td><td class="c">${c.age} &nbsp;|&nbsp; ${c.sex}</td></tr>
    <tr><td class="tiny">Clinical Impression:</td><td colspan="3" class="tiny">${c.dx}</td></tr>
    <tr><td colspan="4">Prescribe in Generics</td></tr>
  </table>
  <div class="body">
    <div class="main">
      <div style="display:flex; gap:6px"><div class="rxsym">Rx</div><div class="addr">ADDRESS: ${c.addr}</div></div>
      <div class="meds">${esc(o.meds || "")}</div>
      ${fu}${pres}
    </div>
    <div class="amt"><div>Amount (to be filled up by Pharmacist On Duty)</div>
      <div><div class="norefill">NO REFILL</div><div style="margin:2px 0 6px">OR No.:_______</div><div>QMMC-Rx<br>Rev 0 03 Mar 2014</div></div></div>
  </div>
</div>`;
  }

  function medcertBlock(p, c, fs, logo) {
    const sx = WD.sexLetter(p);
    const svc = ["Med", "Pedia", "Surgery", "OB-Gyn", "ENT", "Optha", "Rehab", "Derma"].map(s => `<span class="ck">${box(false)}${s}</span>`).join("");
    const where = ["OPD", "In-Patient", "ER"].map(s => `<span class="ck">${box(s === "OPD")}${s}</span><br>`).join("");
    const disp = [["Sent home w/meds", "Fit to work", "For observation"], ["Discharged", "Resume school", "Bed rest for ____ days"], ["Recovered", "Fit to travel"]]
      .map(col => `<div style="flex:1">${col.map(d => `<span class="ck">${box(false)}${d}</span><br>`).join("")}</div>`).join("");
    return `
<div class="mc"><table>
  <tr><td colspan="4" style="border:none; border-bottom:1px solid #000"><div style="display:flex; align-items:center; gap:8px">${logoImg(logo, 44)}
    <div class="b c" style="flex:1; font-size:11px">QUIRINO MEMORIAL MEDICAL CENTER<br>REQUEST FOR MEDICAL CERTIFICATE</div></div></td></tr>
  <tr><td style="width:18%; vertical-align:middle">NAME</td>
    <td class="c" style="vertical-align:middle"><span style="display:inline-block; width:38%">${c.last}</span><span style="display:inline-block; width:34%">${c.first}</span><span style="display:inline-block; width:24%">${c.middle}</span><br>
      <span class="small"><span style="display:inline-block; width:38%">SURNAME</span><span style="display:inline-block; width:34%">FIRST</span><span style="display:inline-block; width:24%">M.I</span></span></td>
    <td colspan="2" class="c" style="width:22%">HealthRecNo.<br><b>${c.hno}</b></td></tr>
  <tr><td colspan="2">ADDRESS: ${c.addr}</td><td class="c">AGE<br>${c.age}</td><td class="c">SEX<br>${box(sx === "M")}M &nbsp;${box(sx === "F")}F</td></tr>
  <tr><td colspan="2">SERVICE: <b style="margin-left:30px">${e(fs.service)}</b><br>${svc}</td><td colspan="2">${where}</td></tr>
  <tr><td colspan="2" class="h">DATE ADMITTED/ TREATMENT<br><div class="c" style="font-size:14px; margin-top:4px">${c.date_short}</div></td><td colspan="2" class="h">ATTENDING PHYSICIAN</td></tr>
  <tr><td colspan="4" style="height:70px">DIAGNOSIS (use back if necessary)<br>${c.dx}</td></tr>
  <tr><td colspan="4" style="height:38px">OPERATION</td></tr>
  <tr><td colspan="4" style="height:38px">BRIEF CLINICAL HISTORY</td></tr>
  <tr><td colspan="4">DISPOSITION<div style="display:flex; margin-top:3px">${disp}</div>Others: _____________________________________________
    <div style="display:flex; justify-content:flex-end; margin-top:8px"><div class="c small" style="border:1px solid #000; padding:2px 10px">Reqs for Medical Cert<br>Rev 0 17 Sept 2012</div></div></td></tr>
</table></div>`;
  }

  function labBlock(c, fs, checked, other, logo) {
    const sections = {};
    for (const [skey, title, cols] of LAB_SECTIONS) {
      const items = LAB_ITEMS.filter(i => i.skey === skey);
      let k = 0;
      const rendered = cols.map(col => {
        const parts = col.map(() => {
          const it = items[k++];
          const cls = "it" + (it.indented ? " ind" : "");
          if (it.plain) return `<div class="${cls}">${it.label}</div>`;       // trusted markup from LAB_SECTIONS
          const on = checked.has(it.key);
          return `<div class="${cls}${on ? " on" : ""}">${box(on)}${esc(it.label)}${it.senior ? " ☸" : ""}</div>`;
        });
        return `<div class="col">${parts.join("")}</div>`;
      });
      sections[skey] = `<div><div class="sec">${esc(title)}</div><div class="cols">${rendered.join("")}</div></div>`;
    }
    return `
<div class="lab">
  <table class="hdr"><tr><td style="width:60px; border-right:1px solid #000">${logoImg(logo, 46)}</td>
    <td class="c b" style="font-size:11px; padding:0"><div style="border-bottom:1px solid #000; padding:3px">QUIRINO MEMORIAL MEDICAL CENTER</div><div style="padding:3px">LABORATORY REQUEST FORM</div></td></tr></table>
  <table>
    <tr><td class="lbl i" style="width:53%">NAME <span style="font-weight:normal">(LAST/FIRST/MIDDLE NAME)</span></td><td class="lbl" style="width:7%">AGE</td><td class="lbl" style="width:7%">SEX</td><td class="lbl" style="width:18%">HOSPITAL NO.</td><td class="lbl">REFERENCE NO.</td></tr>
    <tr><td class="big">${c.full}</td><td class="big">${c.age}</td><td class="big">${c.sex}</td><td class="big">${c.hno}</td><td class="big"></td></tr>
  </table>
  <table>
    <tr><td class="lbl" style="width:28%">DATE OF BIRTH <i>(mm/dd/yyyy)</i></td><td class="lbl" style="width:28%">CONTACT NO.</td><td class="lbl" style="width:21%">DATE <i>(mm/dd/yy)</i></td><td class="lbl">UNIT/ WARD</td></tr>
    <tr><td class="big">${c.dob}</td><td class="big"></td><td class="big">${c.date_short}</td><td class="big">${e(fs.ward)}</td></tr>
    <tr><td colspan="4"><b>CLINICAL IMPRESSION:</b> &nbsp; ${c.dx}</td></tr>
  </table>
  <div class="grid" style="grid-template-columns: 25.5% 31.5% 21% 22%">${sections.chem}${sections.immuno}${sections.hema}${sections.micro}</div>
  <div class="grid" style="grid-template-columns: 19.5% 7.5% 12.5% 38.5% 22%">${sections.urine}${sections.fluids}${sections.bank}${sections.cm}${sections.molec}</div>
  <table>
    <tr><td style="border-left:none; border-right:none"><b>OTHER TEST/S:</b> ${e(other)}</td></tr>
    <tr><td style="border-left:none; border-right:none" class="i b">☸ These test are FREE for SENIOR CITIZENS; all other tests are subjects to 20% discount
      <span style="float:right; font-weight:normal; font-style:normal">Senior Control No./OR No.: ______________________</span></td></tr>
  </table>
  <table class="sig"><tr>
    <td style="width:34%; border-left:none"><b>Requesting Physician:</b><div style="margin:4px 0 0 60px"><b>${e(fs.prescriber)}</b><br><u>License No: ${e(fs.license_no)}</u></div><div style="margin-left:60px">Signature over Printed Name (Name Stamp)</div></td>
    <td style="width:33%"><b>Extracted by:</b><br><br><span class="line"></span><br>Signature over Printed Name (Name Stamp)<br>MM/DD/YY / Time: <span class="line" style="min-width:80px"></span></td>
    <td style="border-right:none"><b>Specimen Received by:</b><br><br><span class="line"></span><br>Signature over Printed Name (Name Stamp)<br>MM/DD/YY / Time: <span class="line" style="min-width:80px"></span></td>
  </tr></table>
</div>
<div class="cut"></div>
<div class="lab" style="border:1px solid #000"><table class="sig"><tr>
  <td style="width:17%; border:none; border-right:1px solid #000"><div style="display:flex; align-items:center; gap:4px">${logoImg(logo, 30)}<b>LABORATORY<br>TRANSACTION<br>RECEIPT</b></div></td>
  <td style="border:none; padding:0"><table>
    <tr><td style="height:24px; border-top:none; border-left:none"><b>Name:</b> ${c.full}</td><td style="border-top:none"><b>Date &amp; Time of Reciept of Request</b></td><td style="border-top:none; border-right:none"><b>Reference No.:</b></td></tr>
    <tr><td style="height:24px; border-bottom:none; border-left:none"><b>Claim your result <i>(mm/dd/yy)</i>:</b></td><td style="border-bottom:none"><b>Date Released <i>(mm/dd/yy)</i>:</b></td><td style="border-bottom:none; border-right:none"><b>Laboratory personnel in charge and signature:</b></td></tr>
  </table></td></tr></table></div>`;
  }

  /** One HTML document with the chosen forms, each on its own page. */
  function buildHtml(visit, patient, settings, o) {
    const fs = { ...WD.DEFAULTS, ...settings };
    const [pw, ph] = PAPERS[fs.paper] || PAPERS["Legal 8.5x14"];
    const availW = pw - 2 * MARGIN_IN, availH = ph - 2 * MARGIN_IN;
    const zoom = availW / DESIGN_W_IN, pageHpx = availH / zoom * 96;
    const logo = o.logo || "logo.png";
    const p = { ...patient, dx: visit.dx || patient.dx || "" };   // today's diagnosis from the logsheet wins
    const date = o.date, c = common(p, date), pages = [];
    let fu = "";
    const iv = WD.parseFollowup(visit.followup || "");
    if (iv) {
      fu = WD.followupWords(iv[0], iv[1]);
      const decked = WD.fromIso(visit.decked);
      if (decked) fu += " — " + WD.fmt(decked, "med").replace(/^(\w+) /, "$1, ");
    }
    if (o.lab) {
      const one = labBlock(c, fs, o.lab_tests || new Set(), o.lab_other || "", logo);
      const per = (+fs.lab_per_page === 2 && pageHpx > 1180) ? 2 : 1;
      pages.push(`<div class="sheet"><div class="page">${Array(per).fill(one).join('<div style="height:14px"></div>')}</div></div>`);
    }
    if (o.rx) {
      const h = Math.min(760, pageHpx - 10);
      const left = rxBlock(c, fs, { meds: o.rx_meds, followup: fu, height_px: h, logo });
      const right = o.rx_alone ? rxBlock(c, fs, { meds: o.rx_meds, followup: fu, height_px: h, logo }) : medcertBlock(p, c, fs, logo);
      pages.push(`<div class="sheet"><div class="page"><div style="display:flex; gap:8px; align-items:flex-start"><div style="flex:1">${left}</div><div style="flex:1">${right}</div></div></div></div>`);
    }
    if (o.s2) {
      const labels = ["ORIGINAL COPY", "DUPLICATE COPY", "TRIPLICATE COPY"];
      if (fs.s2_layout === "2x2" && pageHpx > 1000) {
        const h = Math.min(590, (pageHpx - 30) / 2);
        const cell = x => `<div style="flex:1">${rxBlock(c, fs, { height_px: h, logo, ...x })}</div>`;
        const row1 = cell({ meds: o.s2_meds, s2: true, copy_label: labels[0] }) + cell({ meds: o.s2_meds, s2: true, copy_label: labels[2] });
        const row2 = cell({ meds: o.s2_meds, s2: true, copy_label: labels[1], banner: "DUPLICATE COPY" }) + cell({ meds: o.rx_meds, followup: fu });
        pages.push(`<div class="sheet"><div class="page"><div style="display:flex; gap:8px">${row1}</div><div style="height:24px"></div><div style="display:flex; gap:8px">${row2}</div></div></div>`);
      } else {
        const blocks = labels.map(l => `<div style="flex:1; min-width:0">${rxBlock(c, fs, { meds: o.s2_meds, s2: true, copy_label: l, font_px: 8.4, height_px: 590, logo })}</div>`).join("");
        pages.push(`<div class="sheet"><div class="page"><div style="display:flex; gap:5px">${blocks}</div></div></div>`);
      }
    }
    const pageCss = `@page { size: ${pw}in ${ph}in; margin: 0; }\n:root { --zoom: ${zoom.toFixed(4)}; --margin: ${MARGIN_IN}in; }`;
    return `<!doctype html><html><head><meta charset="utf-8"><base href="${esc(o.base || "")}"><title>${esc("OPD forms - " + (visit.name || ""))}</title>` +
      `<style>${CSS}\n${pageCss}</style></head><body>${pages.join("")}</body></html>`;
  }

  /** Loads the document into a hidden frame and opens the browser's print dialog. */
  function print(html) {
    const old = document.getElementById("wd-print-frame");
    if (old) old.remove();
    const f = document.createElement("iframe");
    f.id = "wd-print-frame";
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed; left:-10000px; top:0; width:9in; height:15in; border:0;";
    f.onload = () => setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250);
    f.srcdoc = html;
    document.body.appendChild(f);
  }

  return { PAPERS, LAB_SECTIONS, LAB_ITEMS, LAB_LABELS, LAB_PANELS, buildHtml, print, esc };
})();
