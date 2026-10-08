/*
 * "Konumlarım" - saved and recently viewed locations, kept only in this
 * browser (localStorage), no account and nothing sent anywhere.
 *
 *   - [data-save-place] (the star button in the forecast hero) toggles the
 *     page's location in the saved list; every forecast page visit is also
 *     recorded as a recent location.
 *   - [data-places="saved" | "recent"] containers are filled with links; the
 *     nearest [data-places-wrap] (or the container itself) is hidden while
 *     its list is empty. data-chip-class sets the link classes.
 *
 * Purely an enhancement: without storage or JavaScript nothing renders.
 */
(function () {
  var SAVED = 'yh_places_v1';
  var RECENT = 'yh_recent_v1';

  function read(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v.filter(valid) : [];
    } catch (e) {
      return [];
    }
  }
  function write(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
  }
  // Only site-internal location paths are ever stored or rendered.
  function valid(p) {
    return !!p && typeof p.n === 'string' && p.n.length < 80 &&
      typeof p.u === 'string' && /^\/[a-z0-9-]+(\/[a-z0-9-]+)?\/$/.test(p.u);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function has(list, u) {
    for (var i = 0; i < list.length; i++) if (list[i].u === u) return true;
    return false;
  }

  var saved = read(SAVED);

  function render() {
    var recent = read(RECENT).filter(function (p) { return !has(saved, p.u); });
    var boxes = document.querySelectorAll('[data-places]');
    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b];
      var list = box.getAttribute('data-places') === 'recent' ? recent : saved;
      list = list.slice(0, Number(box.getAttribute('data-max') || 8));
      var wrap = box.closest('[data-places-wrap]') || box;
      if (!list.length) {
        box.innerHTML = '';
        wrap.hidden = true;
        continue;
      }
      var cls = box.getAttribute('data-chip-class') || '';
      box.innerHTML = list.map(function (p) {
        var here = location.pathname.indexOf(p.u) === 0;
        return '<a href="' + esc(p.u) + '" class="' + esc(cls) + '"' + (here ? ' aria-current="page"' : '') + '>' + esc(p.n) + '</a>';
      }).join('');
      wrap.hidden = false;
    }
  }

  var btn = document.querySelector('[data-save-place]');
  if (btn) {
    var me = { n: btn.getAttribute('data-place-name'), u: btn.getAttribute('data-place-href') };
    if (valid(me)) {
      var recent = read(RECENT).filter(function (p) { return p.u !== me.u; });
      recent.unshift(me);
      write(RECENT, recent.slice(0, 8));

      var sync = function () {
        var on = has(saved, me.u);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = btn.querySelector('[data-save-label]');
        if (label) label.textContent = on ? 'Konumlarımda' : 'Konumlarıma ekle';
        var star = btn.querySelector('[data-star]');
        if (star) star.setAttribute('fill', on ? '#FFD166' : 'currentColor');
      };
      btn.addEventListener('click', function () {
        var on = has(saved, me.u);
        saved = on ? saved.filter(function (p) { return p.u !== me.u; }) : [me].concat(saved).slice(0, 8);
        write(SAVED, saved);
        sync();
        render();
        try {
          if (typeof window.gtag === 'function') window.gtag('event', on ? 'place_remove' : 'place_save', { item_id: me.u });
        } catch (e) {}
      });
      sync();
    }
  }

  render();
})();
