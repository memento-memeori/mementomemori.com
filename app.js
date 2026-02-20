/* app.js - client-only Fireview directory with enrichment + editor mode 🔨🤖🔧 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const LS_THEME = "fv_theme_v2";
const LS_FAVORITES = "fv_favorites_v2";
const LS_NOTES = "fv_notes_v2";                 // toolId -> note
const LS_OVERRIDES = "fv_overrides_v2";         // toolId -> partial tool overrides
const LS_CAT_OVERRIDES = "fv_category_overrides_v2"; // categoryId -> partial category overrides

const state = {
  data: null,          // base tools.json loaded from repo
  view: null,          // merged (base + overrides + enrichment)
  query: "",
  workflow: "",
  sort: "name",
  chips: new Set(),
  fuse: null,
  editor: false,
  theme: localStorage.getItem(LS_THEME) || "dark",
  favorites: new Set(JSON.parse(localStorage.getItem(LS_FAVORITES) || "[]")),
  notes: new Map(Object.entries(JSON.parse(localStorage.getItem(LS_NOTES) || "{}"))),
  overrides: new Map(Object.entries(JSON.parse(localStorage.getItem(LS_OVERRIDES) || "{}"))),
  categoryOverrides: new Map(Object.entries(JSON.parse(localStorage.getItem(LS_CAT_OVERRIDES) || "{}"))),
  editingToolId: null,
};

function normalize(s) {
  return (s || "").toString().trim().toLowerCase();
}
function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}
function domainFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function safeIdFromName(name) {
  return normalize(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `tool-${Math.random().toString(16).slice(2)}`;
}

function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  document.documentElement.classList.toggle("light", theme === "light");
}
function toggleTheme() {
  setTheme(state.theme === "light" ? "dark" : "light");
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

function toCSV(rows) {
  const esc = (v) => {
    const s = (v ?? "").toString();
    if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

function exportFilteredJSON(tools) {
  const payload = {
    meta: { exportedAt: new Date().toISOString(), count: tools.length },
    tools,
  };
  downloadText("fireview-export.json", JSON.stringify(payload, null, 2), "application/json");
}

function exportFilteredCSV(tools) {
  const rows = [
    ["id", "name", "url", "categoryId", "description", "keywords", "workflow", "tags", "cost", "api", "requiresAccount"],
    ...tools.map(t => [
      t.id, t.name, t.url, t.categoryId,
      t.description || "",
      t.keywords || "",
      (t.workflow || []).join("|"),
      (t.tags || []).join("|"),
      t.cost || "",
      (t.api ?? "").toString(),
      (t.requiresAccount ?? "").toString(),
    ])
  ];
  downloadText("fireview-export.csv", toCSV(rows), "text/csv");
}

function exportFilteredMD(tools, categoriesById) {
  const byCat = new Map();
  for (const t of tools) {
    const c = categoriesById.get(t.categoryId)?.name || t.categoryId || "Uncategorized";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(t);
  }
  const parts = [];
  parts.push(`# Fireview Export\n`);
  for (const [cat, list] of [...byCat.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
    parts.push(`## ${cat}\n`);
    for (const t of list.sort((a,b) => a.name.localeCompare(b.name))) {
      const meta = [
        t.cost ? `cost: ${t.cost}` : null,
        t.api === true ? `api` : null,
        t.requiresAccount === false ? `no-account` : null,
        (t.tags || []).includes("gov") ? "gov" : null,
      ].filter(Boolean).join(", ");
      parts.push(`- [${t.name}](${t.url})${meta ? ` — _${meta}_` : ""}`);
    }
    parts.push("");
  }
  downloadText("fireview-export.md", parts.join("\n"), "text/markdown");
}

function updateProgressBar() {
  const scroll = window.scrollY;
  const height = document.body.scrollHeight - window.innerHeight;
  const p = height <= 0 ? 0 : (scroll / height) * 100;
  $("#progress").style.width = `${Math.min(100, Math.max(0, p))}%`;
}

/* ---------------- Enrichment ---------------- */

function inferWorkflow(tool) {
  const hay = normalize(`${tool.name} ${tool.keywords || ""} ${tool.url} ${tool.description || ""}`);
  const hit = (words) => words.some(w => hay.includes(w));
  const wf = [];

  if (hit(["whois","dns","domain","ssl","cert","mx","http","website","subdomain","headers"])) wf.push("domain");
  if (hit(["ip","asn","bgp","cidr","abuse","blacklist","port","shodan","censys","netblock","traceroute"])) wf.push("ip");
  if (hit(["email","smtp","mx","breach","pwn","pwned"])) wf.push("email");
  if (hit(["username","handle","reddit","social","instagram","tiktok","twitter","mastodon"])) wf.push("username");
  if (hit(["people","identity","phone","whitepages","voicemail","registry","address","name"])) wf.push("people");
  if (hit(["company","corporate","registry","sec","edgar","bankruptcy","payroll","vendor","supplier","inc","llc"])) wf.push("company");
  if (hit(["archive","wayback","cached","cache","snapshot"])) wf.push("archives");
  if (hit(["malware","sandbox","threat","intel","ioc","virus","yara"])) wf.push("malware");
  if (hit(["image","video","pdf","metadata","forensic","exif","document","file"])) wf.push("media");

  // fallback: basic url-based hints
  const dom = normalize(domainFromUrl(tool.url));
  if (dom.endsWith(".gov") && !wf.length) wf.push("domain");

  return uniq(wf);
}

function inferTags(tool) {
  const tags = new Set(tool.tags || []);
  const url = normalize(tool.url);
  const hay = normalize(`${tool.name} ${tool.keywords || ""} ${tool.description || ""}`);

  if (url.includes(".gov") || hay.includes("government")) tags.add("gov");
  if (hay.includes("api") || url.includes("/api") || hay.includes("developer")) tags.add("api");

  // ethical bucket tag if it’s link tracking/logging
  if (hay.includes("ip logger") || hay.includes("grabify") || hay.includes("tracking")) tags.add("sensitive");

  return [...tags];
}

function inferCost(tool) {
  const hay = normalize(`${tool.name} ${tool.keywords || ""} ${tool.description || ""}`);
  if (tool.cost) return tool.cost;
  if (hay.includes("free") || hay.includes("no signup") || hay.includes("no account")) return "free";
  if (hay.includes("paid") || hay.includes("subscription") || hay.includes("pricing")) return "paid";
  return "";
}

function inferApi(tool) {
  if (tool.api === true || tool.api === false) return tool.api;
  const hay = normalize(`${tool.name} ${tool.keywords || ""} ${tool.description || ""} ${tool.url}`);
  if (hay.includes(" api ") || hay.includes("api tools") || hay.includes("developer api") || hay.includes("/api")) return true;
  return "";
}

function inferRequiresAccount(tool) {
  if (tool.requiresAccount === true || tool.requiresAccount === false) return tool.requiresAccount;
  const hay = normalize(`${tool.name} ${tool.keywords || ""} ${tool.description || ""}`);
  if (hay.includes("no account") || hay.includes("no signup") || hay.includes("no sign up")) return false;
  return "";
}

function deriveDescription(tool) {
  const raw = tool.description || tool.keywords || tool.name || "";
  const cleaned = raw
    .replace(/\s+https?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) return "";
  const s = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return s.length > 64 ? s.slice(0, 63) + "…" : s;
}

function enrichTool(tool) {
  const out = { ...tool };

  // Always keep a domain field (non-breaking addition)
  out.domain = out.domain || domainFromUrl(out.url);

  // Only fill missing fields (do not overwrite user-provided values)
  if (!out.description) out.description = deriveDescription(out);
  if (!Array.isArray(out.workflow) || out.workflow.length === 0) out.workflow = inferWorkflow(out);
  if (!Array.isArray(out.tags) || out.tags.length === 0) out.tags = inferTags(out);
  if (!out.cost) out.cost = inferCost(out);
  if (out.api == null || out.api === "") out.api = inferApi(out);
  if (out.requiresAccount == null || out.requiresAccount === "") out.requiresAccount = inferRequiresAccount(out);

  return out;
}

function mergeView() {
  if (!state.data) return;

  // apply category overrides
  const categories = state.data.categories.map(c => {
    const ov = state.categoryOverrides.get(c.id);
    return ov ? { ...c, ...ov } : { ...c };
  });

  // apply tool overrides then enrich
  const tools = state.data.tools.map(t => {
    const ov = state.overrides.get(t.id);
    const merged = ov ? { ...t, ...ov } : { ...t };
    return enrichTool(merged);
  });

  state.view = {
    meta: state.data.meta,
    categories,
    tools,
  };

  state.fuse = new Fuse(state.view.tools, {
    includeScore: true,
    threshold: 0.35,
    keys: [
      { name: "name", weight: 0.5 },
      { name: "keywords", weight: 0.25 },
      { name: "description", weight: 0.15 },
      { name: "url", weight: 0.1 },
      { name: "tags", weight: 0.1 },
    ],
  });
}

/* ---------------- Filtering ---------------- */

function toolMatchesWorkflow(tool, wf) {
  if (!wf) return true;
  const arr = Array.isArray(tool.workflow) ? tool.workflow : [];
  return arr.includes(wf);
}

function toolMatchesChips(tool) {
  for (const chip of state.chips) {
    if (chip === "favorites" && !state.favorites.has(tool.id)) return false;
    if (chip === "free" && tool.cost && tool.cost !== "free") return false;
    if (chip === "api" && tool.api !== true) return false;
    if (chip === "account" && tool.requiresAccount !== false) return false;
    if (chip === "gov") {
      const isGov = (tool.tags || []).includes("gov") || normalize(tool.url).includes(".gov");
      if (!isGov) return false;
    }
  }
  return true;
}

function getFilteredTools() {
  const tools = state.view.tools;

  let results = tools;

  // fuzzy search
  const q = normalize(state.query);
  if (q) {
    results = state.fuse.search(q, { limit: 5000 }).map(r => r.item);
  }

  results = results.filter(t => toolMatchesWorkflow(t, state.workflow)).filter(toolMatchesChips);

  if (state.sort === "name") {
    results = [...results].sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.sort === "category") {
    results = [...results].sort((a, b) => (a.categoryId || "").localeCompare(b.categoryId || "") || a.name.localeCompare(b.name));
  } else if (state.sort === "fav") {
    results = [...results].sort((a, b) => {
      const af = state.favorites.has(a.id) ? 1 : 0;
      const bf = state.favorites.has(b.id) ? 1 : 0;
      return bf - af || a.name.localeCompare(b.name);
    });
  }
  return results;
}

/* ---------------- Rendering ---------------- */

function buildCategoryNav(categories, tools) {
  const catnav = $("#catnav");
  catnav.innerHTML = "";

  const counts = new Map();
  for (const t of tools) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);

  for (const c of categories) {
    const a = document.createElement("a");
    a.href = `#cat-${c.id}`;
    a.textContent = `${c.name} (${counts.get(c.id) || 0})`;
    catnav.appendChild(a);
  }
}

function renderAlphaMenu(tools) {
  const menu = $("#alphaMenu");
  menu.querySelectorAll("optgroup, option:not(:first-child)").forEach(n => n.remove());

  const items = tools
    .map(t => ({ name: (t.name || "").trim(), url: t.url || "" }))
    .filter(x => x.name && x.url)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const groups = new Map();
  const getKey = (s) => {
    const ch = (s || "").trim().charAt(0).toUpperCase();
    return (ch >= "A" && ch <= "Z") ? ch : "#";
  };

  for (const it of items) {
    const k = getKey(it.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const keys = [...groups.keys()].sort((a,b) => (a === "#") - (b === "#") || a.localeCompare(b));
  for (const k of keys) {
    const og = document.createElement("optgroup");
    og.label = k;
    for (const it of groups.get(k)) {
      const opt = document.createElement("option");
      opt.value = it.url;
      opt.textContent = it.name;
      og.appendChild(opt);
    }
    menu.appendChild(og);
  }

  menu.addEventListener("change", () => {
    const url = menu.value;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    menu.value = "";
  }, { once: true });
}

function pill(text, cls = "") {
  const s = document.createElement("span");
  s.className = `pill ${cls}`.trim();
  s.textContent = text;
  return s;
}

function renderToolCard(tool, categoriesById) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = tool.id;

  const top = document.createElement("div");
  top.className = "card-top";

  const title = document.createElement("div");
  const h = document.createElement("div");
  h.className = "card-title";
  const a = document.createElement("a");
  a.href = tool.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = tool.name;
  h.appendChild(a);

  const u = document.createElement("a");
  u.className = "card-url";
  u.href = tool.url;
  u.target = "_blank";
  u.rel = "noopener noreferrer";
  u.textContent = tool.domain || tool.url;

  title.appendChild(h);
  title.appendChild(u);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "8px";
  right.style.alignItems = "center";

  const favBtn = document.createElement("button");
  favBtn.className = `iconbtn ${state.favorites.has(tool.id) ? "primary" : ""}`;
  favBtn.textContent = state.favorites.has(tool.id) ? "★" : "☆";
  favBtn.title = "Favorite";
  favBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (state.favorites.has(tool.id)) state.favorites.delete(tool.id);
    else state.favorites.add(tool.id);
    localStorage.setItem(LS_FAVORITES, JSON.stringify([...state.favorites]));
    render();
  });

  const editBtn = document.createElement("button");
  editBtn.className = `iconbtn ${state.editor ? "" : "hidden"}`;
  editBtn.textContent = "Edit";
  editBtn.title = "Edit metadata";
  editBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openEditor(tool.id);
  });

  right.appendChild(favBtn);
  right.appendChild(editBtn);

  top.appendChild(title);
  top.appendChild(right);

  const badges = document.createElement("div");
  badges.className = "badge-row";

  const catName = categoriesById.get(tool.categoryId)?.name || tool.categoryId || "Uncategorized";
  badges.appendChild(pill(catName));

  if (tool.description) badges.appendChild(pill(tool.description));
  if (tool.cost === "free") badges.appendChild(pill("Free", "good"));
  if (tool.cost === "paid") badges.appendChild(pill("Paid", "warn"));
  if (tool.api === true) badges.appendChild(pill("API", "good"));
  if (tool.requiresAccount === false) badges.appendChild(pill("No account", "good"));
  if ((tool.tags || []).includes("gov")) badges.appendChild(pill("Gov", "good"));
  if ((tool.tags || []).includes("sensitive")) badges.appendChild(pill("Sensitive", "warn"));

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const note = document.createElement("input");
  note.placeholder = "Add a note (local)…";
  note.value = state.notes.get(tool.id) || "";
  note.style.flex = "1";
  note.style.padding = "8px 10px";
  note.style.borderRadius = "10px";
  note.style.border = "1px solid var(--line)";
  note.style.background = "transparent";
  note.style.color = "var(--text)";
  note.addEventListener("change", () => {
    const v = note.value.trim();
    if (v) state.notes.set(tool.id, v);
    else state.notes.delete(tool.id);
    localStorage.setItem(LS_NOTES, JSON.stringify(Object.fromEntries(state.notes)));
  });

  const openBtn = document.createElement("button");
  openBtn.className = "iconbtn";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    window.open(tool.url, "_blank", "noopener,noreferrer");
  });

  actions.appendChild(note);
  actions.appendChild(openBtn);

  card.appendChild(top);
  card.appendChild(badges);
  card.appendChild(actions);

  return card;
}

function render() {
  if (!state.view) return;

  const categoriesById = new Map(state.view.categories.map(c => [c.id, c]));
  const tools = getFilteredTools();

  $("#statusText").textContent = `${tools.length} / ${state.view.tools.length} tools`;
  $("#dataMeta").textContent = state.view.meta?.generatedAt ? `Data: ${state.view.meta.generatedAt}` : "";

  buildCategoryNav(state.view.categories, state.view.tools);
  renderAlphaMenu(state.view.tools);

  // group results by category for display
  const byCat = new Map();
  for (const t of tools) {
    if (!byCat.has(t.categoryId)) byCat.set(t.categoryId, []);
    byCat.get(t.categoryId).push(t);
  }

  const grid = $("#toolGrid");
  grid.innerHTML = "";

  // Render category headings + cards
  for (const c of state.view.categories) {
    const list = byCat.get(c.id) || [];
    if (!list.length) continue;

    const anchor = document.createElement("div");
    anchor.id = `cat-${c.id}`;
    anchor.style.gridColumn = "1 / -1";
    anchor.style.marginTop = "6px";
    anchor.style.paddingTop = "6px";

    const h = document.createElement("div");
    h.style.display = "flex";
    h.style.justifyContent = "space-between";
    h.style.alignItems = "baseline";
    h.style.gap = "12px";
    h.style.flexWrap = "wrap";

    const title = document.createElement("div");
    title.style.fontWeight = "800";
    title.textContent = c.name;

    const count = document.createElement("div");
    count.className = "muted";
    count.textContent = `${list.length} tools`;

    h.appendChild(title);
    h.appendChild(count);
    anchor.appendChild(h);

    grid.appendChild(anchor);

    for (const t of list) {
      grid.appendChild(renderToolCard(t, categoriesById));
    }
  }

  // toggle edit buttons visibility
  $$(".card .iconbtn").forEach(btn => {
    if (btn.textContent === "Edit") btn.classList.toggle("hidden", !state.editor);
  });
}

/* ---------------- Editor mode ---------------- */

function persistOverrides() {
  localStorage.setItem(LS_OVERRIDES, JSON.stringify(Object.fromEntries(state.overrides)));
  localStorage.setItem(LS_CAT_OVERRIDES, JSON.stringify(Object.fromEntries(state.categoryOverrides)));
}

function setEditorMode(on) {
  state.editor = !!on;
  $("#btnEditor").classList.toggle("primary", state.editor);
  render();
}

function openEditor(toolId) {
  const t = state.view.tools.find(x => x.id === toolId);
  if (!t) return;

  state.editingToolId = toolId;

  $("#editorTitle").textContent = `Edit Tool: ${t.name}`;
  $("#f_name").value = t.name || "";
  $("#f_url").value = t.url || "";
  $("#f_keywords").value = t.keywords || "";
  $("#f_description").value = t.description || "";
  $("#f_workflow").value = (t.workflow || []).join(", ");
  $("#f_tags").value = (t.tags || []).join(", ");
  $("#f_cost").value = t.cost || "";
  $("#f_api").value = (t.api === true ? "true" : t.api === false ? "false" : "");
  $("#f_requiresAccount").value = (t.requiresAccount === true ? "true" : t.requiresAccount === false ? "false" : "");

  // categories select
  const sel = $("#f_categoryId");
  sel.innerHTML = "";
  for (const c of state.view.categories) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = t.categoryId || "";

  $("#btnDeleteTool").classList.toggle("hidden", !toolId);
  $("#editorDialog").showModal();
}

function parseCsvList(s) {
  return uniq((s || "")
    .split(",")
    .map(x => normalize(x))
    .map(x => x.trim())
    .filter(Boolean));
}

function coerceTriBool(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  return "";
}

function saveEditorForm() {
  const id = state.editingToolId;
  if (!id) return;

  const patch = {
    name: $("#f_name").value.trim(),
    url: $("#f_url").value.trim(),
    categoryId: $("#f_categoryId").value,
    keywords: $("#f_keywords").value.trim(),
    description: $("#f_description").value.trim(),
    workflow: parseCsvList($("#f_workflow").value),
    tags: parseCsvList($("#f_tags").value),
    cost: $("#f_cost").value || "",
    api: coerceTriBool($("#f_api").value),
    requiresAccount: coerceTriBool($("#f_requiresAccount").value),
  };

  // keep keys minimal: don't store empty strings unless explicitly intended
  // (but do store empty arrays if user cleared them)
  state.overrides.set(id, patch);
  persistOverrides();
  mergeView();
  render();
}

function deleteTool(toolId) {
  // Mark tool as deleted in overrides
  state.overrides.set(toolId, { __deleted: true });
  persistOverrides();
  mergeView();
  // filter deleted out
  state.view.tools = state.view.tools.filter(t => !state.overrides.get(t.id)?.__deleted);
  state.favorites.delete(toolId);
  localStorage.setItem(LS_FAVORITES, JSON.stringify([...state.favorites]));
  render();
}

function exportMergedToolsJson() {
  // Build merged payload while stripping helper fields
  const payload = {
    meta: {
      ...(state.data.meta || {}),
      exportedAt: new Date().toISOString(),
      note: "Export includes local editor overrides + enrichment fields (domain/description/etc).",
    },
    categories: state.view.categories.map(c => {
      const { id, name, note } = c;
      return note ? { id, name, note } : { id, name };
    }),
    tools: state.view.tools
      .filter(t => !state.overrides.get(t.id)?.__deleted)
      .map(t => {
        const out = { ...t };
        delete out.domain; // optional helper; remove if you don’t want it in repo
        return out;
      }),
  };

  downloadText("tools.json", JSON.stringify(payload, null, 2), "application/json");
}

async function importToolsJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);

  // Soft validate
  if (!parsed || !Array.isArray(parsed.tools) || !Array.isArray(parsed.categories)) {
    alert("That file does not look like a tools.json (missing categories/tools arrays).");
    return;
  }

  // Replace base data in-memory (doesn't write to repo; but you can export)
  state.data = parsed;

  // Clear overrides (optional: keep them, but ids may mismatch)
  state.overrides = new Map();
  state.categoryOverrides = new Map();
  persistOverrides();

  mergeView();
  render();
}

function resetOverrides() {
  if (!confirm("Reset ALL editor overrides? This only affects your browser storage.")) return;
  state.overrides = new Map();
  state.categoryOverrides = new Map();
  persistOverrides();
  mergeView();
  render();
}

/* ---------------- Wiring ---------------- */

function setChipActive(chip, on) {
  const btn = $(`.chip[data-filter="${chip}"]`);
  if (btn) btn.classList.toggle("active", on);
}

function initChips() {
  $$(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.filter;
      if (state.chips.has(k)) state.chips.delete(k);
      else state.chips.add(k);
      btn.classList.toggle("active", state.chips.has(k));
      render();
    });
  });
}

function initHeaderHideOnScroll() {
  const header = $("#header");
  let lastY = window.scrollY || 0;
  const threshold = 10;
  window.addEventListener("scroll", () => {
    const y = window.scrollY || 0;
    if (y <= 0) {
      header.classList.remove("hide");
      lastY = 0;
      updateProgressBar();
      return;
    }
    if (y > lastY + threshold) header.classList.add("hide");
    else if (y < lastY - threshold) header.classList.remove("hide");
    lastY = y;
    updateProgressBar();
  }, { passive: true });
}

async function loadData() {
  const res = await fetch("./tools.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load tools.json (${res.status})`);
  const data = await res.json();
  state.data = data;

  // filter deleted in overrides during merge
  mergeView();
  state.view.tools = state.view.tools.filter(t => !state.overrides.get(t.id)?.__deleted);

  render();
}

function enrichAll() {
  // Enrichment is already applied in mergeView(), but this lets you “commit” enrichment into overrides
  // for fields that were missing in the base data.
  for (const t of state.data.tools) {
    const merged = enrichTool({ ...t, ...(state.overrides.get(t.id) || {}) });
    const base = t;
    const patch = {};

    // Only persist fields that were missing in base (so enrichment becomes explicit)
    const maybe = (k) => {
      if (base[k] == null || base[k] === "" || (Array.isArray(base[k]) && base[k].length === 0)) {
        if (merged[k] != null && merged[k] !== "" && (!Array.isArray(merged[k]) || merged[k].length)) patch[k] = merged[k];
      }
    };

    maybe("description");
    maybe("workflow");
    maybe("tags");
    maybe("cost");
    maybe("api");
    maybe("requiresAccount");

    if (Object.keys(patch).length) {
      state.overrides.set(t.id, { ...(state.overrides.get(t.id) || {}), ...patch });
    }
  }

  persistOverrides();
  mergeView();
  render();
  alert("Enrichment applied (saved as local overrides). Use Editor → Export tools.json to download.");
}

function init() {
  setTheme(state.theme);
  initChips();
  initHeaderHideOnScroll();

  $("#btnTheme").addEventListener("click", toggleTheme);
  $("#btnHelp").addEventListener("click", () => $("#helpDialog").showModal());
  $("#btnEditor").addEventListener("click", () => setEditorMode(!state.editor));
  $("#btnEnrich").addEventListener("click", enrichAll);

  $("#btnClear").addEventListener("click", () => {
    state.query = "";
    $("#q").value = "";
    render();
    $("#q").focus();
  });

  $("#q").addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });

  $("#workflow").addEventListener("change", (e) => {
    state.workflow = e.target.value;
    render();
  });

  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });

  $("#btnExportJson").addEventListener("click", () => exportFilteredJSON(getFilteredTools()));
  $("#btnExportCsv").addEventListener("click", () => exportFilteredCSV(getFilteredTools()));
  $("#btnExportMd").addEventListener("click", () => {
    const categoriesById = new Map(state.view.categories.map(c => [c.id, c]));
    exportFilteredMD(getFilteredTools(), categoriesById);
  });

  // Editor dialog wiring
  $("#editorForm").addEventListener("submit", (e) => {
    e.preventDefault();
    saveEditorForm();
    $("#editorDialog").close();
  });

  $("#btnDeleteTool").addEventListener("click", () => {
    if (!state.editingToolId) return;
    if (!confirm("Delete this tool (locally)? You can export after.")) return;
    deleteTool(state.editingToolId);
    $("#editorDialog").close();
  });

  $("#btnExportToolsJson").addEventListener("click", exportMergedToolsJson);
  $("#btnResetOverrides").addEventListener("click", resetOverrides);

  $("#fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importToolsJson(file);
      alert("Imported into this session. Use Export tools.json to download the merged file.");
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  });

  // keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const q = $("#q");
    if (e.key === "/" && document.activeElement !== q) {
      e.preventDefault();
      q.focus();
    }
    if (e.key === "Escape") {
      if (document.activeElement === q) {
        q.value = "";
        state.query = "";
        q.blur();
        render();
      }
    }
    if (e.key === "t") toggleTheme();
    if (e.key === "?") $("#helpDialog").showModal();
    if (e.key === "e") setEditorMode(!state.editor);
    if (e.key === "f") {
      const k = "favorites";
      if (state.chips.has(k)) state.chips.delete(k);
      else state.chips.add(k);
      setChipActive(k, state.chips.has(k));
      render();
    }
  });

  loadData().catch(err => {
    $("#statusText").textContent = `Failed to load tools.json: ${err.message}`;
  });
}

init();