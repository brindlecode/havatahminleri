/*
 * Client-side refresh of the "current conditions" numbers.
 *
 * The page is statically generated twice a day, so the current temperature in
 * the HTML can be up to ~12 hours old. This script patches the handful of
 * live values in place from Open-Meteo.
 *
 * It is an enhancement only: every forecast value that matters for search -
 * the daily table, the hourly strip, all summary prose - is in the static
 * HTML and never depends on this running.
 *
 * It used to be inlined verbatim in three page templates (~4.5 KB of
 * unminified JS repeated on all ~7,300 pages). As an external file it is
 * fetched once and cached.
 *
 * Coordinates come from data attributes on <body data-lat data-lon>.
 */
(function () {
  var body = document.body;
  var lat = body && body.getAttribute('data-lat');
  var lon = body && body.getAttribute('data-lon');
  if (!lat || !lon) return;

  var CACHE_KEY = 'weather_' + lat + '_' + lon;
  var CACHE_MS = 30 * 60 * 1000;
  var WIND_DIRS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  var WMO = {
    0: 'Açık', 1: 'Çoğunlukla Açık', 2: 'Parçalı Bulutlu', 3: 'Bulutlu',
    45: 'Sisli', 48: 'Kırağılı Sis', 51: 'Hafif Çisenti', 53: 'Orta Çisenti',
    55: 'Yoğun Çisenti', 56: 'Dondurucu Hafif Çisenti', 57: 'Dondurucu Yoğun Çisenti',
    61: 'Hafif Yağmur', 63: 'Orta Yağmur', 65: 'Şiddetli Yağmur',
    66: 'Dondurucu Hafif Yağmur', 67: 'Dondurucu Şiddetli Yağmur',
    71: 'Hafif Kar', 73: 'Orta Kar', 75: 'Yoğun Kar', 77: 'Kar Taneleri',
    80: 'Hafif Sağanak', 81: 'Orta Sağanak', 82: 'Şiddetli Sağanak',
    85: 'Hafif Kar Sağanağı', 86: 'Yoğun Kar Sağanağı',
    95: 'Gök Gürültülü Fırtına', 96: 'Hafif Dolu ile Fırtına', 99: 'Şiddetli Dolu ile Fırtına'
  };

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = value;
  }

  function getCached() {
    try {
      var c = localStorage.getItem(CACHE_KEY);
      if (!c) return null;
      var p = JSON.parse(c);
      if (Date.now() - p.ts > CACHE_MS) return null;
      return p.d;
    } catch (e) {
      return null;
    }
  }

  function updateDOM(d) {
    try {
      setText('weather-temp', Math.round(d.current.temperature_2m) + '°');
      setText('weather-desc', WMO[d.current.weather_code] || '');
      setText('weather-feels', Math.round(d.current.apparent_temperature));
      setText('weather-humidity', d.current.relative_humidity_2m);
      setText('weather-wind', Math.round(d.current.wind_speed_10m));
      setText('weather-winddir', WIND_DIRS[Math.round(d.current.wind_direction_10m / 45) % 8]);
      setText('weather-high', Math.round(d.daily.temperature_2m_max[0]));
      setText('weather-low', Math.round(d.daily.temperature_2m_min[0]));
      setText('weather-uv', Math.round(d.daily.uv_index_max[0]));
      setText('weather-precip', d.daily.precipitation_sum[0]);
    } catch (e) {
      /* leave the statically rendered values in place */
    }
  }

  function refresh() {
    var cached = getCached();
    if (cached) {
      updateDOM(cached);
      return;
    }
    var p = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max',
      timezone: 'Europe/Istanbul',
      forecast_days: '1'
    });
    fetch('https://api.open-meteo.com/v1/forecast?' + p)
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ d: d, ts: Date.now() }));
        } catch (e) {}
        updateDOM(d);
      })
      .catch(function () {});
  }

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(refresh, { timeout: 2500 });
  } else {
    setTimeout(refresh, 300);
  }
})();
