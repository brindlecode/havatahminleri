/*
 * Share buttons (src/components/ShareButtons.astro).
 *
 * The WhatsApp / X / Facebook / Telegram buttons are plain links and work
 * without this script. It adds:
 *   - a "Paylaş" button that opens the phone's native share sheet (Instagram,
 *     Messenger, SMS ...) or, where that is unavailable, copies the message
 *     and link to the clipboard;
 *   - a GA4 `share` event per click, to measure which content gets shared.
 */
(function () {
  var canNative = typeof navigator.share === 'function';
  var canCopy = !!(navigator.clipboard && navigator.clipboard.writeText);
  if (!canNative && !canCopy) return;

  var buttons = document.querySelectorAll('[data-share-method="native"]');
  for (var i = 0; i < buttons.length; i++) {
    if (!canNative) {
      var lbl = buttons[i].querySelector('[data-share-label]');
      if (lbl) lbl.textContent = 'Kopyala';
    }
    buttons[i].hidden = false;
  }

  function track(method, box) {
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'share', {
          method: method,
          content_type: box.getAttribute('data-share-type') || 'page',
          item_id: box.getAttribute('data-share-id') || '',
        });
      }
    } catch (e) {}
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-share-method]') : null;
    if (!el) return;
    var box = el.closest('[data-share]');
    if (!box) return;
    var method = el.getAttribute('data-share-method');
    if (method !== 'native') {
      track(method, box);
      return;
    }

    e.preventDefault();
    var text = box.getAttribute('data-share-text') || '';
    var url = box.getAttribute('data-share-url') || location.href;
    var title = box.getAttribute('data-share-title') || document.title;

    if (canNative) {
      navigator.share({ title: title, text: text, url: url }).then(function () {
        track('native', box);
      }).catch(function () {});
      return;
    }

    navigator.clipboard.writeText(text + '\n👉 ' + url).then(function () {
      track('copy', box);
      var label = el.querySelector('[data-share-label]');
      if (!label) return;
      label.textContent = 'Kopyalandı ✓';
      setTimeout(function () { label.textContent = 'Kopyala'; }, 2000);
    }).catch(function () {});
  });
})();
