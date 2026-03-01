/* Fireview directory logic (refactored) */
(() => {
  'use strict';

  const CFG = {
    pillMaxLen: 48,
    headerScrollThreshold: 10,
    // LocalStorage keys
    LS_FAV: 'fireview:favorites:v1',
    LS_TOOL_NOTES: 'fireview:toolNotes:v1',
    LS_GLOBAL_NOTES: 'fireview:globalNotes:v1',
    LS_OVERRIDE: 'fireview:overrideLines:v1',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const q = $('#q');
  const resultsBar = $('#resultsBar');
  const emptyState = $('#emptyState');

  const readJSON = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k) || '') ?? fallback; }
    catch { return fallback; }
  };
  const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // Normalization helps reduce "misses" due to punctuation, URL fragments, etc.
  const normalize = (s) => (s || '')
    .toLowerCase()
    .replace(/\s+https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  /* ===== Pills ===== */
  function rebuildPills() {
    $$('.tool').forEach(tool => {
      const title = tool.getAttribute('data-title') || '';
      const pill = $('.pill', tool);
      if (!pill) return;

      let desc = title
        .replace(/\s+https?:\/\/\S+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1);

      if (desc.length > CFG.pillMaxLen) {
        desc = desc.slice(0, CFG.pillMaxLen - 1) + '…';
      }

      pill.textContent = desc || 'Reference tool';
    });
  }

  /* ===== Alpha menu ===== */
  function buildAlphaMenu() {
    const menu = $('#alphaMenu');
    if (!menu) return;

    const items = $$('.tool')
      .map(tool => ({
        name: ($('.link', tool)?.textContent || '').trim(),
        url: $('.url-link', tool)?.getAttribute('href') || ''
      }))
      .filter(x => x.name && x.url)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const groups = new Map();
    const getKey = (s) => {
      const ch = (s || '').trim().charAt(0).toUpperCase();
      return (ch >= 'A' && ch <= 'Z') ? ch : '#';
    };

    for (const it of items) {
      const k = getKey(it.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }

    menu.querySelectorAll('optgroup, option:not(:first-child)').forEach(n => n.remove());

    const keys = Array.from(groups.keys())
      .sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b));

    for (const k of keys) {
      const og = document.createElement('optgroup');
      og.label = k;
      for (const it of groups.get(k)) {
        const opt = document.createElement('option');
        opt.value = it.url;
        opt.textContent = it.name;
        og.appendChild(opt);
      }
      menu.appendChild(og);
    }

    if (!menu.dataset.bound) {
      menu.addEventListener('change', () => {
        const url = menu.value;
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
        menu.value = '';
      });
      menu.dataset.bound = '1';
    }
  }
  // expose for editor override rebuild
  window.buildAlphaMenu = buildAlphaMenu;

  /* ===== Header auto-hide on scroll ===== */
  function initHeaderHide() {
    const header = $('header');
    if (!header) return;

    let lastY = window.scrollY || 0;

    window.addEventListener('scroll', () => {
      const y = window.scrollY || 0;

      if (y <= 0) {
        header.classList.remove('hide');
        lastY = 0;
        return;
      }

      if (y > lastY + CFG.headerScrollThreshold) header.classList.add('hide');
      else if (y < lastY - CFG.headerScrollThreshold) header.classList.remove('hide');

      lastY = y;
    }, { passive: true });
  }

  /* ===== Favorites + Notes + Editor ===== */
  function initToolsEnhancements() {
    let favOnly = false;

    const tools = () => $$('li.tool');
    const sections = () => $$('section');

    // Stable-ish key: URL is the best identifier
    const toolKey = (toolEl) => ($('.url-link', toolEl)?.getAttribute('href') || '').trim();

    const getFavSet = () => new Set(readJSON(CFG.LS_FAV, []));
    const setFavSet = (set) => writeJSON(CFG.LS_FAV, Array.from(set));

    // Precompute searchable haystacks for speed; rebuild when DOM changes (override editor)
    let toolIndex = [];
    function rebuildSearchIndex() {
      toolIndex = tools().map(el => {
        const title = el.getAttribute('data-title') || '';
        const name = ($('.link', el)?.textContent || '').trim();
        const url = toolKey(el);
        // include multiple fields for better match quality
        const hay = normalize(`${title} ${name} ${url}`);
        return { el, key: url, hay };
      });
    }

    /* ----- Tool actions (star + note) ----- */
    function injectToolActions() {
      tools().forEach(toolEl => {
        let actions = $('.actions', toolEl);
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'actions';

          const star = document.createElement('button');
          star.className = 'icon-btn star';
          star.type = 'button';
          star.title = 'Favorite';
          star.textContent = '★';

          const note = document.createElement('button');
          note.className = 'icon-btn note';
          note.type = 'button';
          note.title = 'Tool note';
          note.textContent = '✎';

          actions.appendChild(star);
          actions.appendChild(note);

          // Insert actions before meta so it sits nicely in card
          toolEl.insertBefore(actions, $('.meta', toolEl) || null);

          star.addEventListener('click', () => toggleFavorite(toolEl));
          note.addEventListener('click', () => openToolNote(toolEl));
        }
      });
    }

    function renderFavStars() {
      const favs = getFavSet();
      tools().forEach(toolEl => {
        const k = toolKey(toolEl);
        toolEl.classList.toggle('is-fav', favs.has(k));
      });
    }

    function toggleFavorite(toolEl) {
      const favs = getFavSet();
      const k = toolKey(toolEl);
      if (!k) return;

      if (favs.has(k)) favs.delete(k);
      else favs.add(k);

      setFavSet(favs);
      renderFavStars();
      applyFilters();
    }

    function updateResultsUI(visibleTools, visibleSections) {
      if (resultsBar) {
        const s = visibleSections === 1 ? 'section' : 'sections';
        const t = visibleTools === 1 ? 'tool' : 'tools';
        resultsBar.textContent = `Showing ${visibleTools} ${t} in ${visibleSections} ${s}.`;
      }
      if (emptyState) {
        emptyState.classList.toggle('hidden', visibleTools !== 0);
      }
    }

    function applyFilters() {
      const term = normalize(q?.value || '');
      const favs = getFavSet();

      let visibleCount = 0;

      for (const it of toolIndex) {
        const matchesTerm = term === '' || it.hay.includes(term);
        const matchesFav = !favOnly || favs.has(it.key);
        const show = matchesTerm && matchesFav;

        it.el.classList.toggle('hidden', !show);
        if (show) visibleCount++;
      }

      let visibleSections = 0;
      for (const sec of sections()) {
        const anyVisible = sec.querySelectorAll('.tool:not(.hidden)').length > 0;
        sec.classList.toggle('hidden', !anyVisible);
        if (anyVisible) visibleSections++;
      }

      updateResultsUI(visibleCount, visibleSections);
    }

    /* ----- Notes drawer ----- */
    const notesDrawer = $('#notesDrawer');
    const btnNotes = $('#btnNotes');
    const btnNotesClose = $('#btnNotesClose');
    const globalNotesText = $('#globalNotesText');
    const btnSaveGlobalNotes = $('#btnSaveGlobalNotes');

    // Tool note modal/drawer
    const toolNoteModal = $('#toolNoteModal');
    const toolNoteTitle = $('#toolNoteTitle');
    const toolNoteText = $('#toolNoteText');
    const btnToolNoteSave = $('#btnToolNoteSave');
    const btnToolNoteClose = $('#btnToolNoteClose');
    const btnToolNoteDelete = $('#btnToolNoteDelete');

    let activeToolKey = '';

    // CSS uses .hidden { display:none }. Use that for showing/hiding.
    function openDrawer(drawer) { drawer?.classList.remove('hidden'); }
    function closeDrawer(drawer) { drawer?.classList.add('hidden'); }

    btnNotes?.addEventListener('click', () => openDrawer(notesDrawer));
    btnNotesClose?.addEventListener('click', () => closeDrawer(notesDrawer));

    if (globalNotesText) {
      globalNotesText.value = localStorage.getItem(CFG.LS_GLOBAL_NOTES) || '';
    }
    btnSaveGlobalNotes?.addEventListener('click', () => {
      localStorage.setItem(CFG.LS_GLOBAL_NOTES, globalNotesText?.value || '');
    });

    function openToolNote(toolEl) {
      const k = toolKey(toolEl);
      if (!k) return;
      activeToolKey = k;

      const name = ($('.link', toolEl)?.textContent || '').trim();
      if (toolNoteTitle) toolNoteTitle.textContent = name || 'Tool note';

      const notes = readJSON(CFG.LS_TOOL_NOTES, {});
      if (toolNoteText) toolNoteText.value = (notes[k] || '');
      toolNoteModal?.classList.remove('hidden');
    }

    function closeToolNote() {
      toolNoteModal?.classList.add('hidden');
      activeToolKey = '';
    }

    btnToolNoteClose?.addEventListener('click', closeToolNote);
    btnToolNoteSave?.addEventListener('click', () => {
      if (!activeToolKey) return;
      const notes = readJSON(CFG.LS_TOOL_NOTES, {});
      notes[activeToolKey] = toolNoteText?.value || '';
      writeJSON(CFG.LS_TOOL_NOTES, notes);
      closeToolNote();
    });

    btnToolNoteDelete?.addEventListener('click', () => {
      if (!activeToolKey) return;
      const notes = readJSON(CFG.LS_TOOL_NOTES, {});
      delete notes[activeToolKey];
      writeJSON(CFG.LS_TOOL_NOTES, notes);
      if (toolNoteText) toolNoteText.value = '';
      closeToolNote();
    });

    /* ----- Favorites toggle button ----- */
    const btnFavToggle = $('#btnFavToggle');
    btnFavToggle?.addEventListener('click', () => {
      favOnly = !favOnly;
      btnFavToggle.classList.toggle('ghost', !favOnly);
      btnFavToggle.classList.toggle('on', favOnly);
      btnFavToggle.textContent = favOnly ? '★ Favorites (on)' : '★ Favorites';
      applyFilters();
    });

    /* ----- Editor drawer (override lines) ----- */
    const editorDrawer = $('#editorDrawer');
    const btnEditor = $('#btnEditor');
    const btnEditorClose = $('#btnEditorClose');
    const editorText = $('#editorText');
    const btnLoadCurrent = $('#btnLoadCurrent');
    const btnLoadSaved = $('#btnLoadSaved');
    const btnSaveOverride = $('#btnSaveOverride');
    const btnApplyOverride = $('#btnApplyOverride');
    const btnClearOverride = $('#btnClearOverride');

    function currentLines() {
      const lines = [];
      sections().forEach(sec => {
        const cat = ($('h2', sec)?.textContent || '').trim();
        $$('li.tool', sec).forEach(t => {
          const name = ($('.link', t)?.textContent || '').trim();
          const url = $('.url-link', t)?.getAttribute('href') || '';
          const desc = (t.getAttribute('data-title') || '').trim();
          if (cat && name && url) lines.push(`${cat} | ${name} | ${url} | ${desc}`);
        });
      });
      return lines.join('\n');
    }

    function parseLines(raw) {
      return (raw || '')
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|').map(p => p.trim());
          const [cat, name, url, desc] = parts;
          return { cat, name, url, desc: desc || '' };
        })
        .filter(x => x.cat && x.name && x.url);
    }

    function applyOverride(raw) {
      const rows = parseLines(raw);
      if (rows.length === 0) return;

      const secMap = new Map();
      sections().forEach(sec => {
        const h = ($('h2', sec)?.textContent || '').trim();
        if (h) secMap.set(h.toLowerCase(), sec);
      });

      sections().forEach(sec => {
        const ul = $('ul', sec);
        if (ul) ul.innerHTML = '';
      });

      function mkToolLi({ name, url, desc }) {
        const li = document.createElement('li');
        li.className = 'tool';
        li.setAttribute('data-title', desc || `${name} ${url}`);

        const link = document.createElement('div');
        link.className = 'link';
        link.textContent = name;

        const meta = document.createElement('div');
        meta.className = 'meta';

        const a = document.createElement('a');
        a.className = 'url-link';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = url;

        const pill = document.createElement('span');
        pill.className = 'pill';

        meta.appendChild(a);
        meta.appendChild(pill);

        li.appendChild(link);
        li.appendChild(meta);

        return li;
      }

      rows.forEach(r => {
        const sec = secMap.get(r.cat.toLowerCase());
        if (!sec) return;
        const ul = $('ul', sec);
        if (!ul) return;
        ul.appendChild(mkToolLi(r));
      });

      injectToolActions();
      rebuildPills();
      buildAlphaMenu();
      rebuildSearchIndex();
      renderFavStars();
      applyFilters();
    }

    btnEditor?.addEventListener('click', () => openDrawer(editorDrawer));
    btnEditorClose?.addEventListener('click', () => closeDrawer(editorDrawer));

    btnLoadCurrent?.addEventListener('click', () => { if (editorText) editorText.value = currentLines(); });
    btnLoadSaved?.addEventListener('click', () => { if (editorText) editorText.value = localStorage.getItem(CFG.LS_OVERRIDE) || ''; });
    btnSaveOverride?.addEventListener('click', () => { localStorage.setItem(CFG.LS_OVERRIDE, editorText?.value || ''); });
    btnApplyOverride?.addEventListener('click', () => applyOverride(editorText?.value || ''));
    btnClearOverride?.addEventListener('click', () => { localStorage.removeItem(CFG.LS_OVERRIDE); });

    /* ----- Hotkeys ----- */
    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea') return;

      if (e.key === '/' && document.activeElement !== q) {
        e.preventDefault();
        q?.focus();
        return;
      }

      if (e.key === 'Escape' && document.activeElement === q) {
        e.preventDefault();
        if (q) q.value = '';
        q?.blur();
        applyFilters();
        return;
      }

      if (e.key === 'f') { e.preventDefault(); $('#btnFavToggle')?.click(); }
      if (e.key === 'n') { e.preventDefault(); $('#btnNotes')?.click(); }
      if (e.key === 'e') { e.preventDefault(); $('#btnEditor')?.click(); }
    });

    q?.addEventListener('input', applyFilters);

    /* Init */
    injectToolActions();
    rebuildSearchIndex();
    renderFavStars();
    applyFilters();

    const saved = localStorage.getItem(CFG.LS_OVERRIDE);
    if (saved && saved.trim().length > 0) {
      applyOverride(saved);
    }
  }

  /* ===== Boot ===== */
  function init() {
    rebuildPills();
    buildAlphaMenu();
    initHeaderHide();
    initToolsEnhancements();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


/* ===== Embedded IP Whois (ipapi.co) ===== */
(() => {
  'use strict';

  const input = document.getElementById('ipInput');
  const btnLookup = document.getElementById('btnIpLookup');
  const btnClear = document.getElementById('btnIpClear');
  const btnExport = document.getElementById('btnIpExport');
  const tbody = document.getElementById('ipTbody');
  const status = document.getElementById('ipStatus');

  // Only run on pages that include the widget
  if (!input || !btnLookup || !btnClear || !btnExport || !tbody || !status) return;

  const endpoint = (ip) => `https://ipapi.co/${encodeURIComponent(ip)}/json/`;

  const looksLikeIp = (s) => {
    const x = (s || '').trim();
    if (!x) return false;
    if (x.includes(':')) return /^[0-9a-fA-F:]+$/.test(x) && x.length >= 3;  // IPv6-ish
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(x); // IPv4-ish
  };

  const uniq = (arr) => Array.from(new Set(arr));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function mapPool(items, limit, fn) {
    const ret = [];
    let i = 0;
    const workers = Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        ret[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return ret;
  }

  const setStatus = (msg) => { status.textContent = msg || ''; };

  function clearTable() {
    tbody.innerHTML = '';
    btnExport.disabled = true;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function rowHtml(r) {
    return `
      <tr>
        <td><code>${escapeHtml(r.ip || '')}</code></td>
        <td>${escapeHtml(r.isp || '')}</td>
        <td>${escapeHtml(r.company || '')}</td>
        <td>${escapeHtml(r.asn || '')}</td>
        <td>${escapeHtml(r.geo || '')}</td>
        <td>${escapeHtml(r.country || '')}</td>
      </tr>
    `;
  }

  function normalizeRows(ip, data) {
    const region = data?.region || '';
    const regionCode = data?.region_code || '';
    const countryName = data?.country_name || '';
    const countryCode = data?.country_code || '';
    const org = data?.org || data?.organization || '';
    const asn = data?.asn || '';

    const geo =
      (region && (countryCode === 'US' || countryName === 'United States'))
        ? `${region}${regionCode ? ` (${regionCode})` : ''}`
        : (countryName || region || '');

    return {
      ip,
      isp: org || '',
      company: org || '',
      asn: asn || '',
      geo: geo || '',
      country: countryName || ''
    };
  }

  function toCsv(rows) {
    const headers = ['ip', 'isp', 'company', 'asn', 'geo', 'country'];
    const esc = (v) => {
      const s = String(v ?? '');
      const needs = /[",\n]/.test(s);
      return needs ? `"${s.replaceAll('"', '""')}"` : s;
    };
    return [
      headers.join(','),
      ...rows.map(r => headers.map(h => esc(r[h])).join(','))
    ].join('\n');
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  let lastRows = [];

  async function lookupOne(ip) {
    await sleep(80);
    const res = await fetch(endpoint(ip), { method: 'GET' });
    if (!res.ok) return { ip, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.error) return { ip, error: String(data?.reason || data?.error) };
    return normalizeRows(ip, data);
  }

  btnLookup.addEventListener('click', async () => {
    clearTable();
    lastRows = [];

    const raw = (input.value || '').split('\n').map(x => x.trim()).filter(Boolean);
    const ips = uniq(raw).filter(looksLikeIp);

    if (ips.length === 0) {
      setStatus('No valid IPs found.');
      return;
    }

    setStatus(`Looking up ${ips.length} IP(s)…`);

    const results = await mapPool(ips, 4, async (ip) => {
      try { return await lookupOne(ip); }
      catch (e) { return { ip, error: (e && e.message) ? e.message : 'Request failed' }; }
    });

    const good = results.filter(r => !r.error);
    const bad = results.filter(r => r.error);

    tbody.innerHTML = [
      ...good.map(rowHtml),
      ...bad.map(b => `
        <tr>
          <td><code>${escapeHtml(b.ip)}</code></td>
          <td colspan="5">Error: ${escapeHtml(b.error)}</td>
        </tr>
      `)
    ].join('');

    lastRows = good;
    btnExport.disabled = good.length === 0;

    setStatus(`Done. ${good.length} success, ${bad.length} failed.`);
  });

  btnClear.addEventListener('click', () => {
    input.value = '';
    clearTable();
    setStatus('');
  });

  btnExport.addEventListener('click', () => {
    if (!lastRows.length) return;
    download(`ip-whois-${new Date().toISOString().slice(0,10)}.csv`, toCsv(lastRows));
  });
})();
