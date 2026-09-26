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
 *   2. hides hourly cells that are already in the past and marks the current
 *      hour as "Şimdi";
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

  function tempClass(t) {
    if (t >= 35) return 'temp-hot';
    if (t >= 25) return 'temp-warm';
    if (t >= 15) return 'temp-mild';
    if (t >= 5) return 'temp-cool';
    if (t >= -5) return 'temp-cold';
    return 'temp-freezing';
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
        var temp = d.v[i];
        var el = setText('weather-temp', temp + '°');
        if (el && typeof temp === 'number') {
          el.className = el.className.replace(/\btemp-[a-z]+\b/g, '').trim() + ' ' + tempClass(temp);
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

  // 2. hourly strip: hide the past, mark the current hour
  var cells = document.querySelectorAll('[data-time]');
  for (var c = 0; c < cells.length; c++) {
    var t = cells[c].getAttribute('data-time');
    if (t < nowStamp) {
      cells[c].style.display = 'none';
    } else if (t === nowStamp) {
      var label = cells[c].querySelector('[data-hour-label]');
      if (label) label.textContent = 'Şimdi';
    }
  }

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
