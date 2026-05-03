// Shared search script for header and hero inputs.
// Reads /search-index.json on first focus, normalizes Turkish characters
// properly, ranks prefix matches first, supports keyboard navigation.
(function () {
  function normalize(value) {
    return (value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/â/g, 'a')
      .replace(/î/g, 'i')
      .replace(/û/g, 'u')
      .trim();
  }

  let cache = null;
  let inflight = null;
  function loadIndex() {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = fetch('/search-index.json')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) { cache = Array.isArray(data) ? data : []; return cache; })
      .catch(function () { cache = []; return cache; });
    return inflight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderResults(dropdown, matches, theme) {
    if (matches.length === 0) {
      dropdown.innerHTML =
        '<div class="px-4 py-3 text-sm ' +
        (theme === 'hero' ? 'text-slate-400' : 'text-[var(--color-text-secondary)]') +
        '">Sonuç bulunamadı</div>';
      return;
    }
    const isHero = theme === 'hero';
    const itemClass = isHero
      ? 'flex items-center gap-3 px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none transition-colors text-slate-700 dark:text-slate-200'
      : 'flex items-center gap-3 px-4 py-3 hover:bg-primary-50 dark:hover:bg-primary-900/30 focus:bg-primary-50 dark:focus:bg-primary-900/30 outline-none transition-colors border-b border-[var(--color-border)] last:border-0';
    const subClass = isHero
      ? 'text-xs text-slate-400 ml-1'
      : 'text-xs text-[var(--color-text-secondary)] ml-1';
    const iconColor = isHero ? 'text-slate-400' : 'text-[var(--color-text-secondary)]';

    dropdown.innerHTML = matches
      .map(function (c, i) {
        return (
          '<a href="' + escapeHtml(c.u) + '" class="' + itemClass + '" data-search-result-index="' + i + '">' +
          '<svg class="w-4 h-4 ' + iconColor + ' shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>' +
          (isHero ? '' : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>') +
          '</svg>' +
          '<div><span class="text-sm font-medium">' + escapeHtml(c.n) + '</span>' +
          '<span class="' + subClass + '">' + (c.t === 'ilce' ? '(İlçe)' : '(İl)') + '</span></div>' +
          '</a>'
        );
      })
      .join('');
  }

  function rankAndFilter(items, q) {
    const filtered = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const norm = normalize(item.n);
      if (norm.indexOf(q) !== -1) {
        filtered.push({ item: item, norm: norm });
      }
    }
    filtered.sort(function (a, b) {
      const aStart = a.norm.indexOf(q) === 0 ? 0 : 1;
      const bStart = b.norm.indexOf(q) === 0 ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      const aIl = a.item.t === 'il' ? 0 : 1;
      const bIl = b.item.t === 'il' ? 0 : 1;
      if (aIl !== bIl) return aIl - bIl;
      return a.norm.localeCompare(b.norm, 'tr');
    });
    return filtered.slice(0, 10).map(function (x) { return x.item; });
  }

  function attach(input) {
    const targetId = input.getAttribute('data-search-target');
    const dropdown = targetId ? document.getElementById(targetId) : null;
    if (!dropdown) return;
    const theme = input.getAttribute('data-search-theme') || 'header';
    let activeIndex = -1;

    function show() { dropdown.classList.remove('hidden'); }
    function hide() { dropdown.classList.add('hidden'); activeIndex = -1; }

    function update() {
      const q = normalize(input.value);
      if (q.length < 2) { hide(); return; }
      loadIndex().then(function (items) {
        if (normalize(input.value) !== q) return;
        const matches = rankAndFilter(items, q);
        renderResults(dropdown, matches, theme);
        activeIndex = -1;
        show();
      });
    }

    function getResultLinks() {
      return dropdown.querySelectorAll('[data-search-result-index]');
    }

    function highlight(index) {
      const links = getResultLinks();
      if (links.length === 0) return;
      activeIndex = ((index % links.length) + links.length) % links.length;
      links.forEach(function (el, i) {
        if (i === activeIndex) {
          el.setAttribute('data-active', 'true');
          el.classList.add('bg-slate-100', 'dark:bg-slate-700');
          if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
          }
        } else {
          el.removeAttribute('data-active');
          el.classList.remove('bg-slate-100', 'dark:bg-slate-700');
        }
      });
    }

    input.addEventListener('focus', function () {
      loadIndex();
      if (input.value.trim().length >= 2) update();
    });
    input.addEventListener('input', update);
    input.addEventListener('keydown', function (e) {
      const links = getResultLinks();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (links.length > 0) highlight(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (links.length > 0) highlight(activeIndex - 1);
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && links[activeIndex]) {
          e.preventDefault();
          window.location.href = links[activeIndex].getAttribute('href');
        }
      } else if (e.key === 'Escape') {
        hide();
        input.blur();
      }
    });

    document.addEventListener('click', function (e) {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) hide();
    });
  }

  function init() {
    document.querySelectorAll('[data-search-input]').forEach(attach);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
