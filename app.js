// app.js
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const LS_THEME = "fv_theme_v3";
const LS_FAV = "fv_fav_v3";
const LS_OVERRIDES = "fv_overrides_v3";

const state = {
  data: null,
  view: null,
  query: "",
  workflow: "",
  sort: "name",
  chips: new Set(),
  fuse: null,
  editor: false,
  theme: localStorage.getItem(LS_THEME) || "dark",
  favorites: new Set(JSON.parse(localStorage.getItem(LS_FAV) || "[]")),
  overrides: new Map(Object.entries(JSON.parse(localStorage.getItem(LS_OVERRIDES) || "{}"))),
  editingToolId: null,
};

function normalize(s){ return String(s || "").toLowerCase().trim(); }
function uniq(arr){ return [...new Set((arr || []).filter(Boolean))]; }

function domainFromUrl(url){
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function setTheme(theme){
  state.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  document.documentElement.classList.toggle("light", theme === "light");
}

function saveFav(){
  localStorage.setItem(LS_FAV, JSON.stringify([...state.favorites]));
}
function saveOverrides(){
  localStorage.setItem(LS_OVERRIDES, JSON.stringify(Object.fromEntries(state.overrides)));
}

function inferWorkflow(tool){
  const hay = normalize(`${tool.name} ${tool.keywords||""} ${tool.url} ${tool.description||""}`);
  const hit = (words) => words.some(w => hay.includes(w));
  const wf = [];
  if (hit(["whois","dns","domain","ssl","cert","mx","http","website","subdomain"])) wf.push("domain");
  if (hit(["ip","asn","bgp","cidr","abuse","blacklist","port","shodan","censys"])) wf.push("ip");
  if (hit(["email","smtp","breach","pwn"])) wf.push("email");
  if (hit(["username","handle","reddit","social"])) wf.push("username");
  if (hit(["people","identity","phone","whitepages","voicemail","registry"])) wf.push("people");
  if (hit(["company","corporate","registry","sec","edgar","bankruptcy","payroll"])) wf.push("company");
  if (hit(["archive","wayback","cached","snapshot"])) wf.push("archives");
  if (hit(["malware","sandbox","threat","intel","ioc","virus","yara"])) wf.push("malware");
  if (hit(["image","video","pdf","metadata","forensic","exif"])) wf.push("media");
  return uniq(wf);
}

function inferTags(tool){
  const tags = new Set(tool.tags || []);
  const url = normalize(tool.url);
  const hay = normalize(`${tool.name} ${tool.keywords||""} ${tool.description||""}`);
  if (url.includes(".gov") || hay.includes("government")) tags.add("gov");
  if (hay.includes("api") || url.includes("/api") || hay.includes("developer")) tags.add("api");
  if (hay.includes("no signup") || hay.includes("no sign up") || hay.includes("no account")) tags.add("noaccount");
  if (hay.includes("free")) tags.add("free");
  return [...tags];
}

function inferApi(tool){
  if (tool.api === true) return true;
  const hay = normalize(`${tool.name} ${tool.keywords||""} ${tool.description||""} ${tool.url}`);
  return hay.includes(" api") || hay.includes("/api") || hay.includes("developer");
}

function inferNoAccount(tool){
  if (tool.requiresAccount === false) return true;
  const tags = new Set(tool.tags || []);
  if (tags.has("noaccount")) return true;
  const hay = normalize(`${tool.name} ${tool.keywords||""} ${tool.description||""}`);
  return hay.includes("no signup") || hay.includes("no sign up") || hay.includes("no account");
}

function inferFree(tool){
  if (tool.cost === "free") return true;
  const tags = new Set(tool.tags || []);
  if (tags.has("free")) return true;
  const hay = normalize(`${tool.name} ${tool.keywords||""} ${tool.description||""}`);
  return hay.includes("free");
}

function enrichTool(tool){
  const out = { ...tool };
  out.domain = out.domain || domainFromUrl(out.url);
  if (!out.description) out.description = (out.keywords || "").replace(/\s+https?:\/\/\S+/g, "").trim().slice(0, 80);
  if (!Array.isArray(out.workflow) || out.workflow.length === 0) out.workflow = inferWorkflow(out);
  out.tags = inferTags(out);
  return out;
}

function mergeView(){
  const tools = state.data.tools
    .map(t => ({ ...t, ...(state.overrides.get(t.id) || {}) }))
    .filter(t => !t.__deleted)
    .map(enrichTool);

  const categories = state.data.categories.map(c => ({ ...c }));

  state.view = { meta: state.data.meta, categories, tools };

  state.fuse = new Fuse(state.view.tools, {
    threshold: 0.35,
    ignoreLocation: true,
    keys: ["name", "keywords", "description", "url", "tags", "workflow"],
  });
}

function toolMatchesWorkflow(tool){
  if (!state.workflow) return true;
  const wf = tool.workflow || [];
  return wf.includes(state.workflow);
}

function toolMatchesChips(tool){
  for (const chip of state.chips){
    if (chip === "favorites" && !state.favorites.has(tool.id)) return false;
    if (chip === "gov" && !(tool.tags||[]).includes("gov") && !normalize(tool.url).includes(".gov")) return false;
    if (chip === "api" && !inferApi(tool)) return false;
    if (chip === "noaccount" && !inferNoAccount(tool)) return false;
    if (chip === "free" && !inferFree(tool)) return false;
  }
  return true;
}

function getFilteredTools(){
  let list = state.view.tools;

  const q = normalize(state.query);
  if (q) list = state.fuse.search(q, { limit: 5000 }).map(r => r.item);

  list = list.filter(toolMatchesWorkflow).filter(toolMatchesChips);

  if (state.sort === "name") list = [...list].sort((a,b)=>a.name.localeCompare(b.name));
  if (state.sort === "category") list = [...list].sort((a,b)=>(a.categoryId||"").localeCompare(b.categoryId||"") || a.name.localeCompare(b.name));
  if (state.sort === "fav") list = [...list].sort((a,b)=> (state.favorites.has(b.id)-state.favorites.has(a.id)) || a.name.localeCompare(b.name));

  return list;
}

function updateProgress(){
  const h = document.body.scrollHeight - window.innerHeight;
  const p = h <= 0 ? 0 : (window.scrollY / h) * 100;
  $("#progress").style.width = `${Math.max(0, Math.min(100, p))}%`;
}

function downloadText(filename, text, type="text/plain"){
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function exportToolsJsonMerged(){
  const payload = {
    meta: { ...(state.view.meta||{}), exportedAt: new Date().toISOString() },
    categories: state.view.categories,
    tools: state.view.tools.map(t => {
      const x = { ...t };
      delete x.domain;
      return x;
    }),
  };
  downloadText("tools.json", JSON.stringify(payload, null, 2), "application/json");
}

function exportJSONFiltered(tools){
  downloadText("fireview-export.json", JSON.stringify({ meta:{exportedAt:new Date().toISOString(), count:tools.length}, tools }, null, 2), "application/json");
}

function exportCSVFiltered(tools){
  const header = ["id","name","url","categoryId","description","keywords","workflow","tags","cost","api","requiresAccount"];
  const rows = tools.map(t => [
    t.id, t.name, t.url, t.categoryId||"", t.description||"", t.keywords||"",
    (t.workflow||[]).join("|"), (t.tags||[]).join("|"), t.cost||"", t.api??"", t.requiresAccount??""
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
  downloadText("fireview-export.csv", csv, "text/csv");
}

function exportMDFiltered(tools){
  const byCat = new Map();
  for (const t of tools){
    if (!byCat.has(t.categoryId)) byCat.set(t.categoryId, []);
    byCat.get(t.categoryId).push(t);
  }
  const catName = new Map(state.view.categories.map(c => [c.id, c.name]));
  let md = `# Fireview Export\n\nExported: ${new Date().toISOString()}\nCount: ${tools.length}\n\n`;
  for (const [cid, list] of [...byCat.entries()].sort((a,b)=>(catName.get(a[0])||a[0]).localeCompare(catName.get(b[0])||b[0]))){
    md += `## ${catName.get(cid) || cid}\n\n`;
    for (const t of list.sort((a,b)=>a.name.localeCompare(b.name))){
      md += `- **${t.name}** — ${t.url}\n`;
    }
    md += "\n";
  }
  downloadText("fireview-export.md", md, "text/markdown");
}

function render(){
  const main = $("#main");
  main.innerHTML = "";

  const tools = getFilteredTools();
  $("#status").textContent = `${tools.length} shown • ${state.view.tools.length} total`;

  // category counts for nav
  const countByCat = new Map();
  for (const t of tools) countByCat.set(t.categoryId, (countByCat.get(t.categoryId)||0)+1);

  const nav = $("#catnav");
  nav.innerHTML = "";
  for (const c of state.view.categories){
    const count = countByCat.get(c.id) || 0;
    const a = document.createElement("a");
    a.href = `#${c.id}`;
    a.textContent = `${c.name} (${count})`;
    nav.appendChild(a);
  }

  const byCat = new Map();
  for (const t of tools){
    if (!byCat.has(t.categoryId)) byCat.set(t.categoryId, []);
    byCat.get(t.categoryId).push(t);
  }

  const categoriesById = new Map(state.view.categories.map(c => [c.id, c]));

  for (const c of state.view.categories){
    const list = byCat.get(c.id) || [];
    if (!list.length) continue;

    const section = document.createElement("section");
    section.className = "category";
    section.id = c.id;

    const head = document.createElement("div");
    head.className = "cathead";
    const h2 = document.createElement("h2");
    h2.textContent = c.name;
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = `${list.length} tools`;
    head.append(h2, meta);

    const ul = document.createElement("ul");
    ul.className = "grid";

    for (const t of list){
      ul.appendChild(renderCard(t, categoriesById));
    }

    section.append(head, ul);
    main.appendChild(section);
  }

  if (!main.children.length){
    const empty = document.createElement("section");
    empty.className = "category";
    empty.innerHTML = `<h2>No results</h2><div class="muted">Try clearing filters.</div>`;
    main.appendChild(empty);
  }
}

function renderCard(t){
  const li = document.createElement("li");
  li.className = "card";

  const top = document.createElement("div");
  top.className = "card-top";

  const left = document.createElement("div");
  left.style.flex = "1";

  const name = document.createElement("p");
  name.className = "name";
  name.textContent = t.name;

  const desc = document.createElement("p");
  desc.className = "desc";
  desc.textContent = t.description || "";

  const url = document.createElement("a");
  url.className = "url";
  url.href = t.url;
  url.target = "_blank";
  url.rel = "noopener noreferrer";
  url.textContent = t.url;

  left.append(name, desc, url);

  const fav = document.createElement("button");
  fav.className = `iconbtn ${state.favorites.has(t.id) ? "primary" : ""}`;
  fav.textContent = state.favorites.has(t.id) ? "★" : "☆";
  fav.title = "Favorite";
  fav.onclick = () => {
    if (state.favorites.has(t.id)) state.favorites.delete(t.id);
    else state.favorites.add(t.id);
    saveFav();
    render();
  };

  const edit = document.createElement("button");
  edit.className = `iconbtn ${state.editor ? "" : "hidden"}`;
  edit.textContent = "Edit";
  edit.onclick = () => openEditor(t.id);

  top.append(left, fav, edit);

  const pills = document.createElement("div");
  pills.className = "pills";
  (t.workflow || []).slice(0,3).forEach(w => {
    const s = document.createElement("span");
    s.className = "pill";
    s.textContent = w;
    pills.appendChild(s);
  });
  (t.tags || []).slice(0,3).forEach(tag => {
    const s = document.createElement("span");
    s.className = "pill";
    s.textContent = tag;
    pills.appendChild(s);
  });

  const actions = document.createElement("div");
  actions.className = "actions";

  const open = document.createElement("button");
  open.className = "iconbtn";
  open.textContent = "Open";
  open.onclick = () => window.open(t.url, "_blank", "noopener,noreferrer");

  actions.append(open);

  li.append(top, pills, actions);
  return li;
}

function openEditor(toolId){
  const tool = state.view.tools.find(x => x.id === toolId);
  if (!tool) return;

  state.editingToolId = toolId;
  $("#editorTitle").textContent = `Edit Tool: ${tool.name}`;

  $("#f_name").value = tool.name || "";
  $("#f_url").value = tool.url || "";
  $("#f_description").value = tool.description || "";
  $("#f_workflow").value = (tool.workflow || []).join(", ");
  $("#f_tags").value = (tool.tags || []).join(", ");
  $("#f_cost").value = tool.cost || "";
  $("#f_api").value = (tool.api === true ? "true" : tool.api === false ? "false" : "");
  $("#f_requiresAccount").value = (tool.requiresAccount === true ? "true" : tool.requiresAccount === false ? "false" : "");
  $("#f_keywords").value = tool.keywords || "";

  const catSel = $("#f_categoryId");
  catSel.innerHTML = "";
  for (const c of state.view.categories){
    const opt = document.createElement("option");
    opt.value = c.id; opt.textContent = c.name;
    catSel.appendChild(opt);
  }
  catSel.value = tool.categoryId || "";

  $("#editorDialog").showModal();
}

function parseList(s){
  return uniq((s||"").split(",").map(x => x.trim()).filter(Boolean));
}
function triBool(v){
  if (v === "true") return true;
  if (v === "false") return false;
  return "";
}

function initUI(){
  // theme + help
  $("#btnTheme").onclick = () => setTheme(state.theme === "light" ? "dark" : "light");
  $("#btnHelp").onclick = () => $("#helpDialog").showModal();

  // editor toggle
  $("#btnEditorToggle").onclick = () => {
    state.editor = !state.editor;
    render();
  };

  // search + filters
  $("#q").addEventListener("input", e => { state.query = e.target.value; render(); });
  $("#btnClear").onclick = () => { $("#q").value=""; state.query=""; render(); $("#q").focus(); };

  $("#workflow").addEventListener("change", e => { state.workflow = e.target.value; render(); });
  $("#sort").addEventListener("change", e => { state.sort = e.target.value; render(); });

  $$(".chip").forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.filter;
      if (state.chips.has(k)) state.chips.delete(k);
      else state.chips.add(k);
      btn.classList.toggle("active", state.chips.has(k));
      render();
    };
  });

  // exports
  $("#btnExportJson").onclick = () => exportJSONFiltered(getFilteredTools());
  $("#btnExportCsv").onclick = () => exportCSVFiltered(getFilteredTools());
  $("#btnExportMd").onclick = () => exportMDFiltered(getFilteredTools());
  $("#btnExportToolsJson").onclick = exportToolsJsonMerged;

  // enrich (writes enrichment into overrides for missing fields)
  $("#btnEnrich").onclick = () => {
    for (const t of state.view.tools){
      // commit inferred fields into overrides only if base lacks them
      const base = state.data.tools.find(x => x.id === t.id);
      const patch = {};
      const maybe = (k) => {
        const vBase = base?.[k];
        if (vBase == null || vBase === "" || (Array.isArray(vBase) && vBase.length === 0)) patch[k] = t[k];
      };
      maybe("description"); maybe("workflow"); maybe("tags");
      if (Object.keys(patch).length){
        state.overrides.set(t.id, { ...(state.overrides.get(t.id)||{}), ...patch });
      }
    }
    saveOverrides();
    mergeView();
    render();
    alert("Enrichment applied locally. Export tools.json to download the merged file.");
  };

  // editor form
  $("#editorForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = state.editingToolId;
    if (!id) return;

    const patch = {
      name: $("#f_name").value.trim(),
      url: $("#f_url").value.trim(),
      categoryId: $("#f_categoryId").value,
      description: $("#f_description").value.trim(),
      workflow: parseList($("#f_workflow").value),
      tags: parseList($("#f_tags").value),
      cost: $("#f_cost").value || "",
      api: triBool($("#f_api").value),
      requiresAccount: triBool($("#f_requiresAccount").value),
      keywords: $("#f_keywords").value.trim(),
    };

    state.overrides.set(id, { ...(state.overrides.get(id)||{}), ...patch });
    saveOverrides();
    mergeView();
    render();
    $("#editorDialog").close();
  });

  $("#btnDeleteTool").onclick = () => {
    const id = state.editingToolId;
    if (!id) return;
    if (!confirm("Delete this tool locally? (You can export tools.json after)")) return;
    state.overrides.set(id, { ...(state.overrides.get(id)||{}), __deleted: true });
    saveOverrides();
    mergeView();
    render();
    $("#editorDialog").close();
  };

  $("#btnResetOverrides").onclick = () => {
    if (!confirm("Reset ALL local overrides?")) return;
    state.overrides = new Map();
    saveOverrides();
    mergeView();
    render();
  };

  // keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.key === "/"){ e.preventDefault(); $("#q").focus(); }
    if (e.key === "Escape"){ $("#q").value=""; state.query=""; render(); }
    if (e.key.toLowerCase() === "t") $("#btnTheme").click();
    if (e.key === "?") $("#helpDialog").showModal();
    if (e.key.toLowerCase() === "e") $("#btnEditorToggle").click();
    if (e.key.toLowerCase() === "f"){
      const btn = document.querySelector('.chip[data-filter="favorites"]');
      btn?.click();
    }
  });

  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();
}

async function init(){
  setTheme(state.theme);

  const res = await fetch("./tools.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load tools.json (${res.status})`);
  state.data = await res.json();

  mergeView();
  initUI();
  render();
}

init().catch(err => {
  console.error(err);
  $("#status").textContent = `Error: ${err.message}`;
});
