"use strict";

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = "heartcheck.history.v2";
const CHOL_FACTOR = 38.67; // 1 mmol/L = 38.67 mg/dL

// ---- Form steps & field definitions (ranges mirror PatientRequest.java) ----
const STEPS = [
  {
    title: "Basics & symptoms",
    subtitle: "Required",
    intro: "Start with basic details and any chest discomfort you experience.",
    fields: [
      { name: "age", label: "Age", type: "number", required: true, min: 1, max: 120, step: 1, unit: "years", defaultVal: 52,
        help: "Age in years (1–120)." },
      { name: "sex", label: "Biological sex", type: "seg", required: true,
        options: [[1, "Male"], [0, "Female"]],
        help: "Biological sex at birth, as recorded in the clinical dataset." },
      { name: "cp", label: "Chest pain type", type: "cards", required: true,
        options: [
          [1, "Typical angina", "Chest pressure/tightness triggered by exertion, eased by rest"],
          [2, "Atypical angina", "Chest discomfort that doesn't match classic angina"],
          [3, "Non-anginal pain", "Sharp or localized pain unlikely to be cardiac"],
          [4, "No chest pain", "No chest discomfort (asymptomatic)"],
        ],
        help: "Choose the option that best matches your usual symptoms." },
    ],
  },
  {
    title: "Blood pressure & cholesterol",
    subtitle: "Required",
    intro: "Enter your resting blood pressure and total cholesterol.",
    fields: [
      { name: "trestbps", label: "Resting blood pressure", type: "number", required: true, min: 50, max: 300, step: 1, unit: "mm Hg", defaultVal: 125,
        help: "Top number (systolic blood pressure) measured while seated and resting.",
        chip: (v) => v < 120 ? ["good", "Normal"] : v < 130 ? ["warn", "Elevated"] : ["bad", "High"] },
      { name: "chol", label: "Total cholesterol", type: "number", required: true, min: 50, max: 700, step: 1, unit: "mg/dL", defaultVal: 210,
        cholUnitToggle: true,
        help: "Total cholesterol from a blood test. Toggle mg/dL or mmol/L above.",
        chip: (v) => v < 200 ? ["good", "Desirable"] : v < 240 ? ["warn", "Borderline"] : ["bad", "High"] },
      { name: "fbs", label: "Fasting blood sugar > 120 mg/dL (6.7 mmol/L)?", type: "seg", required: false,
        options: [[0, "No"], [1, "Yes"]],
        help: "Optional. Measured after fasting for at least 8 hours." },
    ],
  },
  {
    title: "Heart & stress tests",
    subtitle: "Optional",
    intro: "If you haven't had an ECG or stress test, leave these as \"Not sure\" or skip this step.",
    note: "Missing test values are filled in with typical baselines by the model. Providing them improves accuracy.",
    fields: [
      { name: "restecg", label: "Resting ECG", type: "seg", required: false,
        options: [[0, "Normal"], [1, "ST-T abnormality"], [2, "LV hypertrophy"]],
        help: "Result from a resting 12-lead electrocardiogram." },
      { name: "thalach", label: "Max heart rate achieved", type: "number", required: false, min: 30, max: 250, step: 1, unit: "bpm",
        help: "Highest heart rate reached during an exercise stress test." },
      { name: "exang", label: "Exercise-induced angina?", type: "seg", required: false,
        options: [[0, "No"], [1, "Yes"]],
        help: "Did chest pain occur during exercise?" },
      { name: "oldpeak", label: "ST depression (oldpeak)", type: "number", required: false, min: 0, max: 10, step: 0.1, unit: "mm",
        help: "ST segment depression induced by exercise relative to rest (0–10 mm)." },
      { name: "slope", label: "Slope of peak exercise ST segment", type: "seg", required: false,
        options: [[1, "Upsloping"], [2, "Flat"], [3, "Downsloping"]],
        help: "Shape of the ST segment at peak exercise." },
      { name: "ca", label: "Major vessels colored by fluoroscopy", type: "seg", required: false,
        options: [[0, "0"], [1, "1"], [2, "2"], [3, "3"]],
        help: "Number of major coronary vessels (0–3) seen on fluoroscopy." },
      { name: "thal", label: "Thalassemia stress test", type: "seg", required: false,
        options: [[3, "Normal"], [6, "Fixed defect"], [7, "Reversible defect"]],
        help: "Nuclear imaging / thallium perfusion scan result." },
    ],
  },
  {
    title: "Review & estimate",
    subtitle: "Summary",
    intro: "Check your answers below, then click See my result.",
    review: true,
    fields: [],
  },
];

const ALL_FIELDS = STEPS.flatMap((s) => s.fields);

const EXAMPLES = {
  low: { age: 41, sex: 0, cp: 2, trestbps: 118, chol: 190, fbs: 0, restecg: 0, thalach: 172, exang: 0, oldpeak: 0, slope: 1, ca: 0, thal: 3 },
  high: { age: 63, sex: 1, cp: 4, trestbps: 145, chol: 233, fbs: 1, restecg: 2, thalach: 150, exang: 1, oldpeak: 2.3, slope: 3, ca: 2, thal: 7 },
  minimal: { age: 54, sex: 1, cp: 3, trestbps: 132, chol: 225 },
};

const EXPLAIN = {
  LOW: "The model sees a low probability of heart disease based on these values.",
  MEDIUM: "The model sees a moderate probability. Some values point toward elevated risk.",
  HIGH: "The model sees a high probability of heart disease for these values.",
};

let currentStep = 0;
let cholUnit = "mg"; // "mg" or "mmol"
let lastSubmission = null;
let lastResult = null;

// ---- Theme toggle ----
$("theme-toggle").addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("heartcheck.theme", next); } catch {}
});

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---- Render stepper & steps ----
function renderWizard() {
  const stepper = $("stepper");
  const stepsRoot = $("steps");
  stepper.replaceChildren();
  stepsRoot.replaceChildren();

  STEPS.forEach((step, idx) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span class="num">${idx + 1}</span><span class="txt">${step.title}<small>${step.subtitle}</small></span>`;
    btn.addEventListener("click", () => goToStep(idx));
    li.append(btn);
    stepper.append(li);

    const panel = document.createElement("div");
    panel.className = "step";
    panel.id = `step-${idx}`;
    panel.hidden = idx !== 0;

    const intro = document.createElement("p");
    intro.className = "step-intro";
    intro.textContent = step.intro;
    panel.append(intro);

    if (step.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = step.note;
      panel.append(note);
    }

    if (step.review) {
      const dl = document.createElement("dl");
      dl.className = "review";
      dl.id = "review-list";
      panel.append(dl);
    } else {
      step.fields.forEach((f) => panel.append(renderField(f)));
    }

    stepsRoot.append(panel);
  });

  updateStepUI();
}

function renderField(f) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.id = `field-${f.name}`;

  const top = document.createElement("div");
  top.className = "field-top";

  const label = document.createElement("label");
  label.className = "field-label";
  label.htmlFor = f.name;
  label.innerHTML = `${f.label}${f.required ? ' <span class="req">*</span>' : ""}`;
  top.append(label);

  if (f.help) {
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "help-btn";
    helpBtn.textContent = "?";
    helpBtn.setAttribute("aria-expanded", "false");
    helpBtn.setAttribute("aria-label", `More info about ${f.label}`);
    const helpBox = document.createElement("div");
    helpBox.className = "help";
    helpBox.hidden = true;
    helpBox.textContent = f.help;
    helpBtn.addEventListener("click", () => {
      const open = helpBtn.getAttribute("aria-expanded") === "true";
      helpBtn.setAttribute("aria-expanded", String(!open));
      helpBox.hidden = open;
    });
    top.append(helpBtn);
    wrap.append(top, helpBox);
  } else {
    wrap.append(top);
  }

  if (f.cholUnitToggle) {
    const sw = document.createElement("div");
    sw.className = "unit-switch";
    sw.innerHTML = `<button type="button" data-u="mg" aria-pressed="true">mg/dL</button><button type="button" data-u="mmol" aria-pressed="false">mmol/L</button>`;
    sw.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-u]");
      if (!b || b.dataset.u === cholUnit) return;
      switchCholUnit(b.dataset.u, sw);
    });
    top.append(sw);
  }

  if (f.chip) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.id = `chip-${f.name}`;
    chip.hidden = true;
    top.append(chip);
  }

  if (f.type === "number") {
    const row = document.createElement("div");
    row.className = "num-row";

    const box = document.createElement("div");
    box.className = "num-input";
    const input = document.createElement("input");
    input.type = "number";
    input.id = f.name;
    input.name = f.name;
    input.min = f.min;
    input.max = f.max;
    input.step = f.step;
    input.inputMode = "decimal";
    if (f.defaultVal !== undefined) input.value = String(f.defaultVal);
    if (!f.required) input.placeholder = "Optional";

    const unit = document.createElement("span");
    unit.className = "unit";
    unit.id = `unit-${f.name}`;
    unit.textContent = f.unit || "";
    box.append(input, unit);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = `range-${f.name}`;
    slider.min = f.min;
    slider.max = f.max;
    slider.step = f.step;
    slider.value = f.defaultVal ?? Math.round((f.min + f.max) / 2);
    slider.setAttribute("aria-label", `${f.label} slider`);

    const syncFromInput = () => {
      clearFieldError(f.name);
      if (input.value !== "") slider.value = input.value;
      updateChip(f);
    };
    const syncFromSlider = () => {
      clearFieldError(f.name);
      input.value = slider.value;
      updateChip(f);
    };
    input.addEventListener("input", syncFromInput);
    slider.addEventListener("input", syncFromSlider);

    row.append(box, slider);
    wrap.append(row);
    if (f.defaultVal !== undefined) queueMicrotask(() => updateChip(f));

    const hint = document.createElement("div");
    hint.className = "field-hint";
    hint.id = `hint-${f.name}`;
    hint.textContent = f.required ? `Range: ${f.min}–${f.max} ${f.unit}` : `Optional · Range: ${f.min}–${f.max} ${f.unit}`;
    wrap.append(hint);
  } else if (f.type === "seg" || f.type === "cards") {
    const group = document.createElement("fieldset");
    group.className = f.type;
    const legend = document.createElement("legend");
    legend.className = "sr-only";
    legend.textContent = f.label;
    group.append(legend);

    f.options.forEach(([val, text, desc]) => {
      const lbl = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio";
      r.name = f.name;
      r.value = String(val);
      r.addEventListener("change", () => clearFieldError(f.name));
      lbl.append(r);
      if (f.type === "cards") {
        const card = document.createElement("span");
        card.className = "opt";
        card.innerHTML = `<strong>${text}</strong><small>${desc}</small>`;
        lbl.append(card);
      } else {
        const sp = document.createElement("span");
        sp.textContent = text;
        lbl.append(sp);
      }
      group.append(lbl);
    });

    if (!f.required) {
      const lbl = document.createElement("label");
      lbl.className = "unsure";
      const r = document.createElement("input");
      r.type = "radio";
      r.name = f.name;
      r.value = "";
      r.checked = true;
      r.addEventListener("change", () => clearFieldError(f.name));
      const sp = document.createElement("span");
      sp.textContent = "Not sure";
      lbl.append(r, sp);
      group.append(lbl);
    }
    wrap.append(group);
  }

  const err = document.createElement("div");
  err.className = "error";
  err.id = `error-${f.name}`;
  wrap.append(err);
  return wrap;
}

function switchCholUnit(nextUnit, sw) {
  const input = $("chol");
  const slider = $("range-chol");
  const unitEl = $("unit-chol");
  const hint = $("hint-chol");
  const cur = input.value === "" ? null : Number(input.value);

  cholUnit = nextUnit;
  sw.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.u === cholUnit)));

  if (cholUnit === "mmol") {
    input.min = "1.3"; input.max = "18.1"; input.step = "0.1";
    slider.min = "1.3"; slider.max = "18.1"; slider.step = "0.1";
    unitEl.textContent = "mmol/L";
    hint.textContent = "Range: 1.3–18.1 mmol/L";
    if (cur !== null && !Number.isNaN(cur)) {
      const v = (cur / CHOL_FACTOR).toFixed(1);
      input.value = v; slider.value = v;
    }
  } else {
    input.min = "50"; input.max = "700"; input.step = "1";
    slider.min = "50"; slider.max = "700"; slider.step = "1";
    unitEl.textContent = "mg/dL";
    hint.textContent = "Range: 50–700 mg/dL";
    if (cur !== null && !Number.isNaN(cur)) {
      const v = String(Math.round(cur * CHOL_FACTOR));
      input.value = v; slider.value = v;
    }
  }
  updateChip(ALL_FIELDS.find((f) => f.name === "chol"));
}

function getNumericMgValue(f) {
  const raw = $(f.name).value;
  if (raw === "") return null;
  let val = Number(raw);
  if (Number.isNaN(val)) return NaN;
  if (f.name === "chol" && cholUnit === "mmol") val = Math.round(val * CHOL_FACTOR);
  return val;
}

function updateChip(f) {
  if (!f.chip) return;
  const chip = $(`chip-${f.name}`);
  const val = getNumericMgValue(f);
  if (val === null || Number.isNaN(val)) { chip.hidden = true; return; }
  const [cls, text] = f.chip(val);
  chip.className = `chip ${cls}`;
  chip.textContent = text;
  chip.hidden = false;
}

// ---- Errors & validation ----
function setFieldError(name, msg) {
  const wrap = $(`field-${name}`);
  if (!wrap) return false;
  wrap.classList.add("invalid");
  $(`error-${name}`).textContent = msg;
  return true;
}
function clearFieldError(name) {
  const wrap = $(`field-${name}`);
  if (wrap) wrap.classList.remove("invalid");
  const err = $(`error-${name}`);
  if (err) err.textContent = "";
}
function showBanner(msg) {
  const b = $("banner");
  b.textContent = msg;
  b.hidden = !msg;
}

function readField(f) {
  if (f.type === "number") {
    const raw = $(f.name).value.trim();
    if (raw === "") return f.required ? { error: "Required" } : { value: null };
    const uiVal = Number(raw);
    const min = Number($(f.name).min);
    const max = Number($(f.name).max);
    if (Number.isNaN(uiVal) || uiVal < min || uiVal > max) {
      return { error: `Enter a value between ${min} and ${max}` };
    }
    return { value: f.name === "chol" && cholUnit === "mmol" ? Math.round(uiVal * CHOL_FACTOR) : uiVal };
  }
  const checked = document.querySelector(`input[name="${f.name}"]:checked`);
  if (!checked || checked.value === "") return f.required ? { error: "Please choose an option" } : { value: null };
  return { value: Number(checked.value) };
}

function validateStep(idx) {
  showBanner("");
  let firstBad = null;
  for (const f of STEPS[idx].fields) {
    clearFieldError(f.name);
    const res = readField(f);
    if (res.error) {
      setFieldError(f.name, res.error);
      firstBad ??= f.name;
    }
  }
  if (firstBad) {
    const target = $(firstBad) || document.querySelector(`input[name="${firstBad}"]`);
    target?.focus();
    return false;
  }
  return true;
}

function collectAll() {
  const payload = {};
  for (const f of ALL_FIELDS) {
    const res = readField(f);
    if (res.error) return { errorStep: STEPS.findIndex((s) => s.fields.includes(f)), field: f.name };
    if (res.value !== null) payload[f.name] = res.value;
  }
  return { payload };
}

// ---- Navigation ----
function goToStep(idx) {
  if (idx > currentStep) {
    for (let i = currentStep; i < idx; i++) {
      if (!validateStep(i)) return;
    }
  }
  currentStep = idx;
  if (STEPS[currentStep].review) renderReview();
  updateStepUI();
}

function updateStepUI() {
  STEPS.forEach((_, idx) => {
    $(`step-${idx}`).hidden = idx !== currentStep;
    const li = $("stepper").children[idx];
    li.classList.toggle("active", idx === currentStep);
    li.classList.toggle("done", idx < currentStep);
  });
  $("back").hidden = currentStep === 0;
  $("skip").hidden = currentStep !== 2;
  $("next").hidden = currentStep === STEPS.length - 1;
  $("submit").hidden = currentStep !== STEPS.length - 1;
}

function formatAnswer(f, val) {
  if (val === null || val === undefined) return null;
  if (f.type === "number") return `${val} ${f.unit}`;
  const opt = f.options.find(([v]) => v === val);
  return opt ? opt[1] : String(val);
}

function renderReview() {
  const dl = $("review-list");
  dl.replaceChildren();
  for (const f of ALL_FIELDS) {
    const res = readField(f);
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = f.label;
    const dd = document.createElement("dd");
    const formatted = res.error ? null : formatAnswer(f, res.value);
    if (formatted === null) {
      dd.className = "missing";
      dd.textContent = "Not provided";
    } else {
      dd.textContent = formatted;
    }
    div.append(dt, dd);
    dl.append(div);
  }
}

// ---- Fill examples ----
function fillExample(key) {
  const vals = EXAMPLES[key];
  if (!vals) return;
  showBanner("");
  for (const f of ALL_FIELDS) {
    clearFieldError(f.name);
    const v = vals[f.name];
    if (f.type === "number") {
      let displayVal = v ?? "";
      if (f.name === "chol" && cholUnit === "mmol" && displayVal !== "") {
        displayVal = (displayVal / CHOL_FACTOR).toFixed(1);
      }
      $(f.name).value = displayVal;
      if (displayVal !== "") $(`range-${f.name}`).value = displayVal;
      updateChip(f);
    } else {
      const targetVal = v === undefined ? "" : String(v);
      const radio = document.querySelector(`input[name="${f.name}"][value="${targetVal}"]`);
      if (radio) radio.checked = true;
    }
  }
  goToStep(STEPS.length - 1);
}

// ---- Result rendering ----
function showResult(res, submittedData) {
  lastResult = res;
  lastSubmission = submittedData;
  const pct = Math.round(res.probability * 100);

  $("placeholder").hidden = true;
  $("output").hidden = false;
  $("result-actions").hidden = false;
  $("percent").textContent = `${pct}%`;
  $("explain").textContent = EXPLAIN[res.riskLevel] ?? "";
  $("model-version").textContent = res.modelVersion ?? "–";
  $("result-time").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const badge = $("badge");
  badge.textContent = `${res.riskLevel} RISK`;
  badge.className = `badge ${res.riskLevel}`;

  const fill = $("gauge-fill");
  const needle = $("needle");
  fill.style.strokeDashoffset = "100";
  needle.style.transform = "rotate(-90deg)";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.strokeDashoffset = String(100 - Math.max(2, pct));
    needle.style.transform = `rotate(${-90 + (pct * 1.8)}deg)`;
  }));

  const provided = 13 - (res.missingFields?.length || 0);
  $("completeness-text").textContent = `${provided} / 13 values`;
  $("completeness-bar").style.width = `${Math.round((res.completeness ?? provided / 13) * 100)}%`;
  $("completeness-note").textContent = provided === 13
    ? "All clinical values provided."
    : `${13 - provided} optional test(s) were imputed using typical values.`;

  renderFactors(res.factors || []);
  renderInsights(res.insights || []);
  renderTips(res.riskLevel, res.missingFields || []);
  renderPrintReport(res, submittedData);
}

function renderFactors(factors) {
  const ul = $("factors");
  ul.replaceChildren();
  const top = factors.slice(0, 6);
  const maxAbs = Math.max(0.05, ...top.map((f) => Math.abs(f.impact)));
  for (const f of top) {
    const li = document.createElement("li");
    const up = f.impact >= 0;
    const pts = Math.round(f.impact * 100);
    const widthPct = Math.min(50, Math.round((Math.abs(f.impact) / maxAbs) * 50));
    li.innerHTML = `
      <div class="factor-top">
        <span>${f.label} <span class="val">(${f.value})</span></span>
        <span class="imp ${up ? "up" : "down"}">${pts > 0 ? `+${pts}` : pts} pts</span>
      </div>
      <div class="factor-bar"><span class="${up ? "up" : "down"}" style="width:${widthPct}%"></span></div>`;
    ul.append(li);
  }
}

function renderInsights(insights) {
  const ul = $("insights");
  ul.replaceChildren();
  const clsMap = { GOOD: "good", WARN: "warn", ALERT: "bad" };
  for (const ins of insights) {
    const li = document.createElement("li");
    li.className = clsMap[ins.status] || "warn";
    li.innerHTML = `<span class="ic" aria-hidden="true"></span><span><strong>${ins.label}:</strong> ${ins.message}</span>`;
    ul.append(li);
  }
}

function renderTips(riskLevel, missing) {
  const ul = $("tips");
  ul.replaceChildren();
  const tips = [];
  if (riskLevel === "HIGH") tips.push("Discuss these numbers with a doctor or cardiologist soon.");
  else if (riskLevel === "MEDIUM") tips.push("Consider reviewing your blood pressure and cholesterol with a healthcare provider.");
  else tips.push("Keep up regular checkups, balanced nutrition, and physical activity.");
  if (missing.length > 0) tips.push("Adding stress-test or ECG results (when available) makes the estimate more specific.");
  tips.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.append(li);
  });
}

function renderPrintReport(res, data) {
  const rows = ALL_FIELDS.map((f) => {
    const val = formatAnswer(f, data[f.name]) || "Not provided";
    return `<tr><td>${f.label}</td><td><strong>${val}</strong></td></tr>`;
  }).join("");
  $("print-report").innerHTML = `
    <h1>HeartCheck Risk Summary</h1>
    <p>Generated ${new Date().toLocaleString()} · Model v${res.modelVersion}</p>
    <table>${rows}</table>`;
}

// ---- History (localStorage) ----
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {}
}
function addHistory(data, res) {
  const list = loadHistory();
  list.unshift({ data, res, time: Date.now() });
  saveHistory(list.slice(0, 6));
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  $("history-card").hidden = list.length === 0;
  const ul = $("history");
  ul.replaceChildren();
  for (const item of list) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const pct = Math.round(item.res.probability * 100);
    btn.innerHTML = `
      <span>
        <strong>${item.data.sex === 1 ? "Male" : "Female"}, ${item.data.age} · ${pct}%</strong>
        <span class="when" style="display:block">${new Date(item.time).toLocaleString()}</span>
      </span>
      <span class="pill ${item.res.riskLevel}">${item.res.riskLevel}</span>`;
    btn.addEventListener("click", () => {
      showResult(item.res, item.data);
      $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    li.append(btn);
    ul.append(li);
  }
}

// ---- Model info ----
async function loadModelInfo() {
  try {
    const resp = await fetch("/api/model-info");
    if (!resp.ok) return;
    const info = await resp.json();
    if (info.dataset?.synthetic) $("synthetic-warning").hidden = false;

    $("stat-auc").textContent = info.test?.auc ? `${(info.test.auc * 100).toFixed(1)}%` : "–";
    $("stat-acc").textContent = info.test?.accuracy ? `${(info.test.accuracy * 100).toFixed(1)}%` : "–";
    $("stat-rows").textContent = info.dataset?.rows ?? "–";
    $("stat-algo").textContent = info.algorithm ?? "–";

    $("model-summary").textContent =
      `Trained on ${info.dataset?.rows ?? "?"} records (${info.dataset?.source ?? "UCI Cleveland"}) using ${info.algorithm}.`;

    const metricsEl = $("metrics");
    metricsEl.replaceChildren();
    const metricPairs = [
      ["ROC-AUC", info.test?.auc],
      ["Accuracy", info.test?.accuracy],
      ["Recall", info.test?.recall],
      ["Precision", info.test?.precision],
      ["F1 score", info.test?.f1],
      ["Brier", info.test?.brier],
    ];
    metricPairs.forEach(([lbl, val]) => {
      if (val === undefined) return;
      const d = document.createElement("div");
      d.className = "metric";
      d.innerHTML = `<b>${(val * 100).toFixed(1)}%</b><span>${lbl}</span>`;
      metricsEl.append(d);
    });

    const cvUl = $("cv-bars");
    cvUl.replaceChildren();
    Object.entries(info.cv || {}).sort((a, b) => b[1].auc - a[1].auc).forEach(([name, v]) => {
      const li = document.createElement("li");
      if (name === info.algorithm) li.className = "best";
      li.innerHTML = `<span>${name}</span><span class="track"><span style="width:${Math.round(v.auc * 100)}%"></span></span><span class="v">${(v.auc * 100).toFixed(1)}%</span>`;
      cvUl.append(li);
    });

    const impUl = $("importance-bars");
    impUl.replaceChildren();
    const imps = (info.featureImportance || []).slice(0, 7);
    const maxImp = Math.max(0.01, ...imps.map((i) => i.importance));
    imps.forEach((i) => {
      const li = document.createElement("li");
      const w = Math.max(4, Math.round((Math.max(0, i.importance) / maxImp) * 100));
      li.innerHTML = `<span>${i.label}</span><span class="track"><span style="width:${w}%"></span></span><span class="v">${i.importance.toFixed(3)}</span>`;
      impUl.append(li);
    });
  } catch { /* ignore when backend is offline */ }
}

// ---- Submit ----
async function onSubmit(event) {
  event.preventDefault();
  showBanner("");
  const collected = collectAll();
  if (collected.errorStep !== undefined) {
    goToStep(collected.errorStep);
    validateStep(collected.errorStep);
    return;
  }

  const btn = $("submit");
  btn.disabled = true;
  btn.classList.add("loading");
  try {
    const resp = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collected.payload),
    });
    if (resp.ok) {
      const result = await resp.json();
      showResult(result, collected.payload);
      addHistory(collected.payload, result);
      $("result").focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 960px)").matches) {
        $("result").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (resp.status === 400) {
      const problem = await resp.json().catch(() => ({}));
      const errors = problem.errors || {};
      let firstStep = null;
      for (const [field, msg] of Object.entries(errors)) {
        setFieldError(field, msg);
        const sIdx = STEPS.findIndex((s) => s.fields.some((f) => f.name === field));
        if (sIdx !== -1 && (firstStep === null || sIdx < firstStep)) firstStep = sIdx;
      }
      if (firstStep !== null) goToStep(firstStep);
      showBanner(problem.detail || "Please correct the highlighted fields.");
    } else if (resp.status === 503) {
      showBanner("The ML prediction service is not reachable. Make sure uvicorn is running on port 8000.");
    } else {
      showBanner(`Unexpected error (HTTP ${resp.status}).`);
    }
  } catch {
    showBanner("Could not reach the Spring Boot backend.");
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

// ---- Init ----
renderWizard();
renderHistory();
loadModelInfo();

$("back").addEventListener("click", () => goToStep(currentStep - 1));
$("next").addEventListener("click", () => goToStep(currentStep + 1));
$("skip").addEventListener("click", () => { currentStep = STEPS.length - 1; renderReview(); updateStepUI(); });
$("example").addEventListener("change", (e) => { if (e.target.value) fillExample(e.target.value); e.target.value = ""; });
$("form").addEventListener("submit", onSubmit);
$("clear-history").addEventListener("click", () => { saveHistory([]); renderHistory(); });
$("print").addEventListener("click", () => window.print());
$("copy").addEventListener("click", async () => {
  if (!lastResult) return;
  const txt = `HeartCheck Result: ${Math.round(lastResult.probability * 100)}% (${lastResult.riskLevel} RISK) — Model v${lastResult.modelVersion}`;
  try { await navigator.clipboard.writeText(txt); toast("Summary copied to clipboard"); } catch { toast(txt); }
});
