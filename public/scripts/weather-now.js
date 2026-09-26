/*
 * Keeps a once-a-day static page truthful for the whole day, without any API
 * call from the browser.
 *
 * The site is rebuilt once a day just after midnight (Turkey time). The HTML
 * therefore contains today's full hourly series starting at 00:00, the daily
 * rows, and "current" values for noon. This script, using only data already on
 * the page:
 *
 *   1. shows the forecast for the visitor's current hour in the "current" card
 *      (from the compact table in <script id="hourly-data">);
 *   2. dims hourly cells that are already in the past, marks the current hour
 *      as "Şimdi" and scrolls the strip to it; re-tints the hero sky for the
 *      current hour's weather and day/night;
 *   3. if the page is viewed on a later day than it was built (e.g. between
 *      midnight and the next deploy), hides past day rows and re-labels
 *      "Bugün" / "Yarın" so a past date is never presented as today.
 *
 * Everything that matters for search is in the static HTML; this is display
 * correction only and fails silently.
 */
(function () {
  var TZ = 'Europe/Istanbul';
  var WIND_DIRS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];

  function nowInTurkey() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date());
      var get = function (t) {
        for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
        return '';
      };
      return { day: get('year') + '-' + get('month') + '-' + get('day'), hour: get('hour') };
    } catch (e) {
      return null;
    }
  }

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function weekday(iso) {
    try {
      return new Date(iso + 'T00:00:00Z').toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'UTC' });
    } catch (e) {
      return '';
    }
  }

  // Mirrors src/lib/sky.ts getSkyClass - keep the two in sync.
  function skyClass(code, isDay) {
    var t = isDay ? 'day' : 'night';
    if (code === 0 || code === 1) return 'sky-clear-' + t;
    if (code === 2) return 'sky-partly-' + t;
    if (code === 3) return 'sky-cloudy-' + t;
    if (code === 45 || code === 48) return 'sky-fog-' + t;
    if (code >= 95) return 'sky-storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'sky-snow-' + t;
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'sky-rain-' + t;
    return 'sky-partly-' + t;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = value;
    return el;
  }

  var now = nowInTurkey();
  if (!now) return;
  var nowStamp = now.day + 'T' + now.hour + ':00';
  var tomorrow = addDays(now.day, 1);

  // 1. current card -> the visitor's hour
  try {
    var node = document.getElementById('hourly-data');
    if (node) {
      var d = JSON.parse(node.textContent);
      var i = d.t.indexOf(nowStamp);
      if (i > -1) {
        setText('weather-temp', d.v[i] + '°');
        var hero = document.getElementById('current-weather');
        if (hero && d.i && typeof d.c[i] === 'number') {
          var next = skyClass(d.c[i], d.i[i] === 1);
          var prev = hero.getAttribute('data-sky');
          if (prev && prev !== next) {
            hero.classList.remove(prev);
            hero.classList.add(next);
            hero.setAttribute('data-sky', next);
          }
        }
        setText('weather-desc', d.n[d.c[i]]);
        if (d.a[i] !== null && d.a[i] !== undefined) setText('weather-feels', d.a[i]);
        setText('weather-humidity', d.h[i]);
        setText('weather-wind', d.w[i]);
        if (typeof d.d[i] === 'number') setText('weather-winddir', WIND_DIRS[Math.round(d.d[i] / 45) % 8]);
        setText('weather-asof', 'Saat ' + now.hour + ':00 tahmini');
      }
    }
  } catch (e) {
    /* keep the static noon values */
  }

  // 2. hourly strip: dim the past, mark the current hour, scroll it into view.
  //    Cells are dimmed rather than removed so the temperature line drawn
  //    under them stays aligned.
  var cells = document.querySelectorAll('[data-time]');
  var nowCell = null;
  for (var c = 0; c < cells.length; c++) {
    var t = cells[c].getAttribute('data-time');
    if (t < nowStamp) {
      cells[c].setAttribute('data-past', 'true');
      var idx = cells[c].getAttribute('data-hour-index');
      var pt = document.querySelector('[data-hour-point="' + idx + '"]');
      if (pt) pt.setAttribute('data-past', 'true');
    } else if (t === nowStamp) {
      nowCell = cells[c];
      var label = cells[c].querySelector('[data-hour-label]');
      if (label) {
        label.textContent = 'Şimdi';
        label.style.color = 'var(--color-text)';
        label.style.fontWeight = '700';
      }
    }
  }
  var scroller = document.querySelector('[data-hourly-scroller]');
  if (scroller && nowCell) scroller.scrollLeft = Math.max(0, nowCell.offsetLeft - 8);

  // 3. daily rows: never present a past date as "Bugün"
  var rows = document.querySelectorAll('[data-date]');
  for (var r = 0; r < rows.length; r++) {
    var date = rows[r].getAttribute('data-date');
    if (date < now.day) {
      rows[r].style.display = 'none';
      continue;
    }
    var dayLabel = rows[r].querySelector('[data-day-label]');
    if (!dayLabel) continue;
    if (date === now.day) dayLabel.textContent = 'Bugün';
    else if (date === tomorrow) dayLabel.textContent = 'Yarın';
    else dayLabel.textContent = weekday(date) || dayLabel.textContent;
  }
})();
