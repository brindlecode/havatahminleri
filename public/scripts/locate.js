/*
 * "Konumumu kullan" on the home page. Asks the browser for the visitor's
 * position, finds the nearest district or province page from
 * /konumlar.json and opens it. The position is only used here, in the
 * browser; nothing is sent to a server.
 */
(function () {
  var btn = document.querySelector('[data-locate]');
  if (!btn) return;
  if (!('geolocation' in navigator)) { btn.hidden = true; return; }
  var label = btn.querySelector('[data-locate-label]');
  var msg = document.querySelector('[data-locate-msg]');
  var idle = label ? label.textContent : '';

  function say(text) {
    if (msg) { msg.textContent = text; msg.hidden = !text; }
  }
  function reset() {
    btn.disabled = false;
    if (label) label.textContent = idle;
  }

  btn.addEventListener('click', function () {
    btn.disabled = true;
    say('');
    if (label) label.textContent = 'Konum alınıyor…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;
      fetch('/konumlar.json').then(function (r) { return r.json(); }).then(function (rows) {
        var best = null;
        var bestD = Infinity;
        var k = Math.cos(lat * Math.PI / 180);
        for (var i = 0; i < rows.length; i++) {
          var dy = rows[i][2] - lat;
          var dx = (rows[i][3] - lon) * k;
          var d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = rows[i]; }
        }
        // ~1.5 degrees: farther than that the visitor is not in Turkey.
        if (!best || bestD > 2.25) {
          reset();
          say('Türkiye dışında görünüyorsun. Şehrini arama kutusuna yazabilirsin.');
          return;
        }
        try {
          if (typeof window.gtag === 'function') window.gtag('event', 'locate', { item_id: best[1] });
        } catch (e) {}
        if (label) label.textContent = best[0] + ' açılıyor…';
        window.location.href = best[1];
      }).catch(function () {
        reset();
        say('Konum listesi yüklenemedi. Şehrini arama kutusuna yazabilirsin.');
      });
    }, function (err) {
      reset();
      say(err && err.code === 1
        ? 'Konum izni verilmedi. Şehrini arama kutusuna yazabilirsin.'
        : 'Konumun alınamadı. Şehrini arama kutusuna yazabilirsin.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
})();
