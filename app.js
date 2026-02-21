(() => {
  'use strict';

  // ========= Storage keys =========
  const LS_FAV = 'fireview:favorites:v1';
  const LS_TOOL_NOTES = 'fireview:toolNotes:v1';
  const LS_GLOBAL_NOTES = 'fireview:globalNotes:v1';
  const LS_OVERRIDE = 'fireview:overrideLines:v1';

  // ========= DOM =========
  const header = document.getElementById('siteHeader');
  const main = document.getElementById('mainContent');

  const q = document.getElementById('q');
  const resultsMeta = document.getElementById('resultsMeta');

  const alphaMenu = document.getElementById('alphaMenu');

  const btnFavToggle = document.getElementById('btnFavToggle');
  const btnNotes = document.getElementById('btnNotes');
  const btnEditor = document.getElementById('btnEditor');

  const notesDrawer = document.getElementById('notesDrawer');
  const btnNotesClose = document.getElementById('btnNotesClose');
  const globalNotes = document.getElementById('globalNotes');
  const favList = document.getElementById('favList');

  const editorDrawer = document.getElementById('editorDrawer');
  const btnEditorClose = document.getElementById('btnEditorClose');
  const editorText = document.getElementById('editorText');
  const btnLoadCurrent = document.getElementById('btnLoadCurrent');
  const btnLoadSaved = document.getElementById('btnLoadSaved');
  const btnSaveOverride = document.getElementById('btnSaveOverride');
  const btnApplyOverride = document.getElementById('btnApplyOverride');
  const btnClearOverride = document.getElementById('btnClearOverride');

  const toolNoteModal = document.getElementById('toolNoteModal');
  const toolNoteTitle = document.getElementById('toolNoteTitle');
  const toolNoteText = document.getElementById('toolNoteText');
  const btnToolNoteClose = document.getElementById('btnToolNoteClose');
  const btnToolNoteSave = document.getElementById('btnToolNoteSave');
  const btnToolNoteDelete = document.getElementById('btnToolNoteDelete');

  // ========= Helpers =========
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const tools = () => $all('li.tool', document);
  const sections = () => $all('section', document);

  const readJSON = (k, fallback) => {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return (v ?? fallback);
    } catch {
      return fallback;
    }
  };
  const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const toolKey = (toolEl) => {
    const name = (toolEl.querySelector('.link')?.textContent || '').trim();
    const url = toolEl.querySelector('.url-link')?.getAttribute('href') || '';
    return `${name}||${url}`.toLowerCase();
  };

  const normalize = (s) => (s || '').trim().toLowerCase();

  const debounce = (fn, ms = 150) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // ========= Focus trap / ESC close =========
  let lastFocus = null;
  let activeOverlay = null;

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function trapFocus(container) {
    const focusables = $all(focusableSelector, container).filter(el => el.offsetParent !== null);
    if (focusables.length === 0) return () => {};
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }

  let untrap = null;

  function openOverlay(el) {
    if (!el) return;
    lastFocus = document.activeElement;
    activeOverlay = el;

    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');

    // Focus first focusable inside
    requestAnimationFrame(() => {
      const first = el.querySelector(focusableSelector);
      first?.focus?.();
    });

    untrap?.();
    untrap = trapFocus(el);
  }

  function closeOverlay(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');

    if (activeOverlay === el) activeOverlay = null;

    untrap?.();
    untrap = null;

    if (lastFocus && typeof lastFocus.focus === 'function') {
      requestAnimationFrame(() => lastFocus.focus());
    }
    lastFocus = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (activeOverlay === toolNoteModal) closeToolNote();
    else if (activeOverlay === notesDrawer) closeDrawer(notesDrawer);
    else if (activeOverlay === editorDrawer) closeDrawer(editorDrawer);
  });

  // ========= Header hide on scroll =========
  (function initHeaderHideOnScroll() {
    if (!header) return;

    let lastY = window.scrollY || 0;
    let ticking = false;

    const onScroll = () => {
      const y = window.scrollY || 0;
      const down = y > lastY;
      lastY = y;

      // Avoid hiding at the very top
      if (y < 40) {
        header.classList.remove('hide');
        return;
      }

      header.classList.toggle('hide', down);
    };

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    }, { passive: true });
  })();

  // ========= Tool actions injection (star + note) =========
  function ensureToolActionsInjected() {
    tools().forEach(t => {
      if (t.querySelector('.tool-actions')) return;

      const actions = document.createElement('div');
      actions.className = 'tool-actions';

      const star = document.createElement('div');
      star.className = 'star';
      star.textContent = '★';
      star.title = 'Favorite';

      const noteBtn = document.createElement('button');
      noteBtn.className = 'mini';
      noteBtn.type = 'button';
      noteBtn.textContent = 'Note';

      actions.appendChild(star);
      actions.appendChild(noteBtn);

      const meta = t.querySelector('.meta');
      if (meta) meta.appendChild(actions);
      else t.appendChild(actions);
    });
  }

  // ========= Favorites =========
  let favOnly = false;
  let favCache = new Set(readJSON(LS_FAV, []));

  function syncFavCache() {
    favCache = new Set(readJSON(LS_FAV, []));
  }
  function persistFavCache() {
    writeJSON(LS_FAV, Array.from(favCache));
  }

  function renderFavStars() {
    tools().forEach(t => {
      const star = t.querySelector('.star');
      if (!star) return;
      const on = favCache.has(toolKey(t));
      star.classList.toggle('on', on);
      star.title = on ? 'Unfavorite' : 'Favorite';
    });
  }

  function toggleFavorite(toolEl) {
    const k = toolKey(toolEl);
    if (favCache.has(k)) favCache.delete(k);
    else favCache.add(k);

    persistFavCache();
    renderFavStars();
    renderFavList();
    applyFilters();
  }

  function renderFavList() {
    if (!favList) return;
    favList.innerHTML = '';

    const favTools = tools()
      .map(t => ({
        key: toolKey(t),
        name: (t.querySelector('.link')?.textContent || '').trim(),
        url: t.querySelector('.url-link')?.getAttribute('href') || ''
      }))
      .filter(x => x.url && favCache.has(x.key))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    if (favTools.length === 0) {
      const d = document.createElement('div');
      d.className = 'note';
      d.textContent = 'No favorites yet.';
      favList.appendChild(d);
      return;
    }

    for (const x of favTools) {
      const a = document.createElement('a');
      a.href = x.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = x.name;
      favList.appendChild(a);
    }
  }

  // ========= Search/filter (debounced) =========
  function applyFilters() {
    const term = normalize(q?.value);
    let visibleTools = 0;
    let totalTools = 0;

    for (const el of tools()) {
      totalTools++;
      const hay = normalize(el.getAttribute('data-title'));
      const matchesTerm = term === '' || hay.includes(term);
      const matchesFav = !favOnly || favCache.has(toolKey(el));
      const show = matchesTerm && matchesFav;

      el.classList.toggle('hidden', !show);
      if (show) visibleTools++;
    }

    for (const sec of sections()) {
      const anyVisible = sec.querySelectorAll('li.tool:not(.hidden)').length > 0;
      sec.classList.toggle('hidden', !anyVisible);
    }

    if (resultsMeta) {
      resultsMeta.textContent = `${visibleTools} / ${totalTools} tools shown`;
    }
  }

  const applyFiltersDebounced = debounce(applyFilters, 150);

  // ========= Notes drawer =========
  function openDrawer(drawer) { openOverlay(drawer); }
  function closeDrawer(drawer) { closeOverlay(drawer); }

  function renderGlobalNotes() {
    if (!globalNotes) return;
    globalNotes.value = localStorage.getItem(LS_GLOBAL_NOTES) || '';
  }

  // ========= Tool note modal =========
  let activeToolKey = null;

  function openToolNote(toolEl) {
    const name = (toolEl.querySelector('.link')?.textContent || '').trim();
    const url = toolEl.querySelector('.url-link')?.getAttribute('href') || '';
    activeToolKey = toolKey(toolEl);

    const notes = readJSON(LS_TOOL_NOTES, {});
    toolNoteTitle.textContent = name || url || 'Tool note';
    toolNoteText.value = notes[activeToolKey] || '';

    openOverlay(toolNoteModal);
  }

  function closeToolNote() {
    closeOverlay(toolNoteModal);
    activeToolKey = null;
  }

  // Close modal on backdrop click
  toolNoteModal?.addEventListener('click', (e) => {
    if (e.target === toolNoteModal) closeToolNote();
  });

  // ========= Editor override =========
  function currentLinesFromDOM() {
    const lines = [];
    for (const sec of sections()) {
      const cat = (sec.querySelector('h2')?.textContent || '').trim();
      if (!cat) continue;

      for (const t of $all('li.tool', sec)) {
        const name = (t.querySelector('.link')?.textContent || '').trim();
        const url = t.querySelector('.url-link')?.getAttribute('href') || '';
        const desc = (t.getAttribute('data-title') || '').trim();
        if (cat && name && url) lines.push(`${cat} | ${name} | ${url} | ${desc}`);
      }
    }
    return lines.join('\n');
  }

  function parseOverrideLines(raw) {
    const out = [];
    const lines = (raw || '').split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 3) continue;

      const category = parts[0] || '';
      const name = parts[1] || '';
      const url = parts[2] || '';
      const desc = parts.slice(3).join(' | ') || `${name} ${url}`;

      if (!category || !name || !url) continue;
      out.push({ category, name, url, desc });
    }
    return out;
  }

  function slugify(s) {
    return normalize(s)
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function rebuildDOMFromOverride(items) {
    if (!main) return;

    // Group by category
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category).push(it);
    }

    // Clear main
    main.innerHTML = '';

    // Deterministic category order (A–Z)
    const cats = Array.from(map.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    for (const cat of cats) {
      const sec = document.createElement('section');
      const id = slugify(cat);
      sec.id = id || `cat-${Math.random().toString(16).slice(2)}`;
      sec.dataset.category = cat;

      const h2 = document.createElement('h2');
      h2.textContent = cat;
      sec.appendChild(h2);

      const ul = document.createElement('ul');

      // Tools sorted A–Z
      const toolsSorted = map.get(cat).slice().sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );

      for (const t of toolsSorted) {
        const li = document.createElement('li');
        li.className = 'tool';
        li.setAttribute('data-title', t.desc || `${t.name} ${t.url}`);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'link';
        nameDiv.textContent = t.name;

        const meta = document.createElement('div');
        meta.className = 'meta';

        const a = document.createElement('a');
        a.className = 'url-link';
        a.href = t.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = t.url;

        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = '';

        meta.appendChild(a);
        meta.appendChild(pill);

        li.appendChild(nameDiv);
        li.appendChild(meta);

        ul.appendChild(li);
      }

      sec.appendChild(ul);
      main.appendChild(sec);
    }

    // Re-inject actions, refresh UI, rebuild menus
    ensureToolActionsInjected();
    renderFavStars();
    buildAlphaMenu();
    applyFilters();
  }

  // ========= Alpha menu =========
  function buildAlphaMenu() {
    if (!alphaMenu) return;

    // Keep first option
    const keep = alphaMenu.querySelector('option[value=""]');
    alphaMenu.innerHTML = '';
    if (keep) alphaMenu.appendChild(keep);

    const entries = tools()
      .map(t => {
        const name = (t.querySelector('.link')?.textContent || '').trim();
        const url = t.querySelector('.url-link')?.getAttribute('href') || '';
        return { name, url };
      })
      .filter(x => x.name && x.url)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    for (const e of entries) {
      const opt = document.createElement('option');
      opt.value = e.url;
      opt.textContent = e.name;
      alphaMenu.appendChild(opt);
    }
  }

  // ========= Event delegation =========
  function onMainClick(e) {
    const star = e.target.closest('.star');
    if (star) {
      const tool = star.closest('li.tool');
      if (tool) toggleFavorite(tool);
      return;
    }

    const noteBtn = e.target.closest('button.mini');
    if (noteBtn && noteBtn.textContent.trim().toLowerCase() === 'note') {
      const tool = noteBtn.closest('li.tool');
      if (tool) openToolNote(tool);
      return;
    }
  }

  // ========= Hotkeys =========
  function initHotkeys() {
    document.addEventListener('keydown', (e) => {
      // Ignore typing inside inputs/textarea (except Escape handled globally)
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (!typing && e.key === '/') {
        e.preventDefault();
        q?.focus();
        return;
      }

      if (typing) return;

      const k = e.key.toLowerCase();
      if (k === 'f') btnFavToggle?.click();
      if (k === 'n') btnNotes?.click();
      if (k === 'e') btnEditor?.click();
    });
  }

  // ========= Wire up =========
  function init() {
    syncFavCache();
    ensureToolActionsInjected();
    renderFavStars();
    buildAlphaMenu();
    applyFilters();

    // Search
    q?.addEventListener('input', applyFiltersDebounced);

    // Favorites toggle
    btnFavToggle?.addEventListener('click', () => {
      favOnly = !favOnly;
      btnFavToggle.classList.toggle('ghost', !favOnly);
      btnFavToggle.classList.toggle('on', favOnly);
      btnFavToggle.textContent = favOnly ? '★ Favorites (on)' : '★ Favorites';
      applyFilters();
    });

    // Notes drawer
    btnNotes?.addEventListener('click', () => {
      renderGlobalNotes();
      renderFavList();
      openDrawer(notesDrawer);
    });
    btnNotesClose?.addEventListener('click', () => closeDrawer(notesDrawer));
    globalNotes?.addEventListener('input', () => {
      localStorage.setItem(LS_GLOBAL_NOTES, globalNotes.value || '');
    });

    // Tool note modal
    btnToolNoteClose?.addEventListener('click', closeToolNote);
    btnToolNoteSave?.addEventListener('click', () => {
      if (!activeToolKey) return;
      const notes = readJSON(LS_TOOL_NOTES, {});
      const v = (toolNoteText.value || '').trim();
      if (v) notes[activeToolKey] = v;
      else delete notes[activeToolKey];
      writeJSON(LS_TOOL_NOTES, notes);
      closeToolNote();
    });
    btnToolNoteDelete?.addEventListener('click', () => {
      if (!activeToolKey) return;
      const notes = readJSON(LS_TOOL_NOTES, {});
      delete notes[activeToolKey];
      writeJSON(LS_TOOL_NOTES, notes);
      toolNoteText.value = '';
      closeToolNote();
    });

    // Editor drawer
    btnEditor?.addEventListener('click', () => {
      // default load saved override if present
      const saved = localStorage.getItem(LS_OVERRIDE) || '';
      if (editorText && !editorText.value.trim()) editorText.value = saved;
      openDrawer(editorDrawer);
    });
    btnEditorClose?.addEventListener('click', () => closeDrawer(editorDrawer));

    btnLoadCurrent?.addEventListener('click', () => {
      if (!editorText) return;
      editorText.value = currentLinesFromDOM();
    });

    btnLoadSaved?.addEventListener('click', () => {
      if (!editorText) return;
      editorText.value = localStorage.getItem(LS_OVERRIDE) || '';
    });

    btnSaveOverride?.addEventListener('click', () => {
      localStorage.setItem(LS_OVERRIDE, editorText?.value || '');
    });

    btnApplyOverride?.addEventListener('click', () => {
      const raw = editorText?.value || '';
      const items = parseOverrideLines(raw);
      if (items.length === 0) {
        alert('No valid lines found. Use: Category | Name | URL | Description');
        return;
      }
      localStorage.setItem(LS_OVERRIDE, raw);
      rebuildDOMFromOverride(items);
      closeDrawer(editorDrawer);
    });

    btnClearOverride?.addEventListener('click', () => {
      localStorage.removeItem(LS_OVERRIDE);
      if (editorText) editorText.value = '';
      alert('Saved override cleared. Reload the page to return to the original HTML content.');
    });

    // Alpha menu open
    alphaMenu?.addEventListener('change', () => {
      const url = alphaMenu.value;
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
      alphaMenu.value = '';
    });

    // Delegated tool actions
    main?.addEventListener('click', onMainClick);

    // Hotkeys
    initHotkeys();

    // Apply saved override on load (if any)
    const savedOverride = localStorage.getItem(LS_OVERRIDE);
    if (savedOverride && savedOverride.trim()) {
      const items = parseOverrideLines(savedOverride);
      if (items.length > 0) rebuildDOMFromOverride(items);
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
