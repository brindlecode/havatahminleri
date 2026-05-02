# AdSense Onay Sonrası Uygulama Planı

## 1. Mevcut Durum

| Alan | Durum | Detay |
|------|-------|-------|
| `public/ads.txt` | ✅ Yayında | `google.com, pub-9110547384071189, DIRECT, f08c47fec0942fa0` |
| AdSense doğrulama | ⏳ Bekliyor | Google AdsBot crawler henüz çekmedi |
| "Reklamlar aktif" toggle | 🔴 Kapalı | `site-config.json → ads.enabled: false` |
| `ads.adsensePublisherId` | 🔴 Boş | Onay sonrası `ca-pub-9110547384071189` girilecek |
| AdSense script (BaseLayout) | ✅ Hazır | `ads.enabled && ads.adsensePublisherId` koşuluna bağlı, async + crossorigin |
| AdSlot component | ⚠️ Eksik | Boş `<div>` render ediyor; `<ins class="adsbygoogle">` yok |
| Cookie consent banner | ❌ Yok | Gizlilik politikasında metin var ama UI banner yok |
| robots.txt | ✅ Temiz | AdsBot-Google ve Mediapartners-Google açık; `/ads.txt` Disallow'da değil |
| Politika sayfaları | ✅ Tam | KVKK, çerez türleri, Google AdSense/Ezoic belirtilmiş |
| Cache (ads.txt) | ✅ Yeterli | `/*` → `max-age=1800` (30 dk); doğrulama için yeterli |

### Mevcut AdSlot pozisyonları

**`src/pages/index.astro` (Ana sayfa):**
```
<AdSlot id="home-top" />   → Popüler şehirler listesinin üstü
<AdSlot id="home-mid" />   → İller listesi ortası
<AdSlot id="home-bottom" /> → Sayfa sonu
```

**`src/layouts/ForecastLayout.astro` (Şehir/ilçe hava durumu sayfaları):**
```
<AdSlot id="city-top" />     → CurrentWeather komponenti altı
<AdSlot id="city-mid" />     → Saatlik/günlük tahmin altı
<AdSlot id="city-details" /> → WeatherDetails komponenti altı
<AdSlot id="city-bottom" />  → Sayfa sonu, WeatherSummary altı
```

**Admin paneldeki 4 slot kategorisi (`site-config.json → ads.adsenseSlots`):**
```json
{
  "header":    "",  ← Sayfa üst banner (728×90 veya responsive)
  "sidebar":   "",  ← Yan panel (şu an hiçbir sayfada kullanılmıyor)
  "inContent": "",  ← İçerik arası (300×250 veya responsive)
  "footer":    ""   ← Sayfa alt banner
}
```

---

## 2. Onay Sonrası Yapılacaklar

### Önkoşul: Admin panelinden yapılacak
1. Admin panel → Site Settings → Reklamlar → "Reklamlar aktif" toggle'ı aç
2. AdSense Publisher ID alanına `ca-pub-9110547384071189` gir
3. AdSense'den her pozisyon için alınan **slot numaralarını** (örn. `1234567890`) ilgili alanlara gir:
   - Header Slot → banner reklamlar için oluşturulan slot
   - İçerik İçi Slot → in-article/in-feed reklamlar için oluşturulan slot
   - Footer Slot → banner reklamlar için oluşturulan slot
4. "Kaydet & Build Tetikle"

> **Not:** Sidebar Slot şu an hiçbir sayfada kullanılmıyor; boş bırakılabilir.

### A — AdSlot.astro Yeniden Yapısı

### B — CLS Önlemi (min-height)

### C — Cookie Consent Banner

---

## 3. AdSlot.astro Yeni Tasarımı

### Slot ID → Kategori Eşleşmesi

`id` prop'u (HTML konumsal ad) ile admin paneldeki `adsenseSlots` kategorisi arasındaki mapping:

```
home-top      → header
home-mid      → inContent
home-bottom   → footer

city-top      → header
city-mid      → inContent
city-details  → inContent
city-bottom   → footer

(sidebar) → mevcut sayfaların hiçbirinde kullanılmıyor
```

### Yeni `AdSlot.astro` Kodu

```astro
---
import siteConfig from '../data/site-config.json';

interface Props {
  id: string;
  className?: string;
}

const { id, className = '' } = Astro.props;
const { ads } = siteConfig;

// Konumsal ID → slot kategorisi
const SLOT_MAP: Record<string, keyof typeof ads.adsenseSlots> = {
  'home-top':      'header',
  'home-mid':      'inContent',
  'home-bottom':   'footer',
  'city-top':      'header',
  'city-mid':      'inContent',
  'city-details':  'inContent',
  'city-bottom':   'footer',
};

// Konuma göre min-height (CLS önlemi)
const MIN_HEIGHT_MAP: Record<string, string> = {
  'home-top':      '90px',
  'home-mid':      '250px',
  'home-bottom':   '90px',
  'city-top':      '90px',
  'city-mid':      '250px',
  'city-details':  '250px',
  'city-bottom':   '90px',
};

const slotCategory = SLOT_MAP[id];
const adSenseSlotId = slotCategory ? ads.adsenseSlots[slotCategory] : '';
const minHeight = MIN_HEIGHT_MAP[id] ?? '90px';

// Reklamlar aktif VE publisher ID dolu VE bu konum için slot ID girilmiş
const showAd = ads.enabled && !!ads.adsensePublisherId && !!adSenseSlotId;
---

<div
  id={`ad-${id}`}
  class:list={['my-4', className]}
  style={`min-height:${minHeight};`}
>
  {showAd ? (
    <>
      <ins
        class="adsbygoogle"
        style="display:block"
        data-ad-client={ads.adsensePublisherId}
        data-ad-slot={adSenseSlotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <script is:inline>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </>
  ) : null}
</div>
```

### Neden `is:inline` ve neden her `<ins>` altında?

AdSense standart implementasyonu, her reklam birimi için ayrı bir `adsbygoogle.push({})` çağrısı gerektirir. Bu çağrı `<ins>` elementinden hemen sonra gelmelidir. Astro SSG'de `<script is:inline>` kullanmak, bu scripti build anında doğrudan HTML'ye yazdırır ve her reklam slotu için tekrar çalıştırılır.

`<script>` (is:inline olmadan) kullanılsaydı Astro bunu bir kez bundle ederdi — birden fazla ad unit için çalışmazdı.

### Çalışma akışı

```
Build zamanı (Astro SSG):
  site-config.json → ads.enabled: true, adsensePublisherId: "ca-pub-...", adsenseSlots.header: "1234567890"
  ↓
  AdSlot id="city-top" → slotCategory="header" → adSenseSlotId="1234567890" → showAd=true
  ↓
  HTML'e <ins class="adsbygoogle" data-ad-client="ca-pub-..." data-ad-slot="1234567890"> yazılır

Tarayıcı zamanı:
  BaseLayout'tan adsbygoogle.js yüklenir (bir kez, async)
  ↓
  Her <ins> için hemen altındaki <script> çalışır: adsbygoogle.push({})
  ↓
  Google reklam içeriğini fetch eder ve <ins> elementini doldurur
```

### Dikkat edilmesi gerekenler

- `data-ad-slot` değeri **sayısal AdSense slot ID**'si olmalı (örn. `"1234567890"`), konumsal isim değil.
- Admin panelinde slot ID alanlarına AdSense dashboard'undan kopyalanan **sayısal** değer girilmeli.
- `ads.enabled: false` iken `<ins>` elementi render edilmez → adsbygoogle.js de yüklenmiyor (BaseLayout koşulu) → siteye sıfır yük.
- Slot ID boş bırakılırsa (`adSenseSlotId === ''`) o pozisyona reklam çıkmaz ama `min-height` placeholder kalır.

---

## 4. CLS Önlemi — min-height Değerleri

AdSense reklamları yüklenirken sayfa içeriği kaymaması için (Cumulative Layout Shift), her slot konteyneri önceden boyutlandırılmalı.

| Slot ID | Boyut | min-height | Sebep |
|---------|-------|-----------|-------|
| `home-top` | Leaderboard (728×90) / Responsive | `90px` | Sayfa üst banner |
| `home-mid` | Medium Rectangle (300×250) / Responsive | `250px` | Liste ortası |
| `home-bottom` | Leaderboard / Responsive | `90px` | Sayfa altı |
| `city-top` | Leaderboard / Responsive | `90px` | İçerik üstü |
| `city-mid` | Medium Rectangle / Responsive | `250px` | Tahmin sonrası |
| `city-details` | Medium Rectangle / Responsive | `250px` | Detaylar sonrası |
| `city-bottom` | Leaderboard / Responsive | `90px` | Sayfa altı |

`data-ad-format="auto"` ve `data-full-width-responsive="true"` kullanıldığında Google en uygun boyutu kendisi seçer. `min-height` değerleri maksimum expected boyutu verir.

> **Not:** `min-height` sadece `showAd=false` (reklamlar kapalı/slot boş) durumunda da ayrı bir boş placeholder render etmek yerine, konteynerin kendisine inline style olarak uygulanıyor. Reklam aktif olduğunda `<ins>` bu alanı dolduracak, kapalı olduğunda boş alan olarak rezerve edilmiş olacak.

---

## 5. Cookie Consent Banner Tasarımı

### Gereksinimler

- İlk ziyarette gösterilmeli
- `localStorage.getItem('cookie_consent')` değeri `'accepted'` veya `'rejected'` ise gösterilmemeli
- "Kabul Et" → `localStorage.setItem('cookie_consent', 'accepted')`
- "Yalnızca Zorunlu" → `localStorage.setItem('cookie_consent', 'rejected')`
- Google Consent Mode v2 sinyali gönderilmeli (Analytics ve Ads için)
- Türkçe, mobil uyumlu, erişilebilir

### Bileşen yapısı

**Yeni dosya:** `src/components/CookieConsent.astro`

```astro
---
// CookieConsent.astro — render at build time, JS handles show/hide
---

<div
  id="cookie-banner"
  role="dialog"
  aria-label="Çerez tercihleri"
  aria-live="polite"
  style="display:none"
  class="fixed bottom-0 left-0 right-0 z-50 p-4 bg-[var(--color-surface)]
         border-t border-[var(--color-border)] shadow-lg"
>
  <div class="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center
              gap-4 text-sm text-[var(--color-text-secondary)]">
    <p class="flex-1 leading-relaxed">
      Bu site analitik ve reklam amaçlı çerezler kullanmaktadır.
      Daha fazla bilgi için
      <a href="/gizlilik-politikasi"
         class="underline text-[var(--color-text)]">
        Gizlilik Politikası
      </a>'nı inceleyin.
    </p>
    <div class="flex gap-2 flex-shrink-0">
      <button
        id="cookie-reject"
        class="px-4 py-2 rounded-lg border border-[var(--color-border)]
               text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]
               transition-colors text-sm font-medium"
      >
        Yalnızca Zorunlu
      </button>
      <button
        id="cookie-accept"
        class="px-4 py-2 rounded-lg bg-blue-500 text-white
               hover:bg-blue-600 transition-colors text-sm font-medium"
      >
        Kabul Et
      </button>
    </div>
  </div>
</div>

<script is:inline>
  (function () {
    var PREF_KEY = 'cookie_consent';
    var banner = document.getElementById('cookie-banner');

    // Daha önce tercih yapılmışsa gösterme
    if (localStorage.getItem(PREF_KEY)) return;

    // Banner'ı göster
    banner.style.display = 'block';

    function sendConsentSignal(granted) {
      // Google Consent Mode v2
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          analytics_storage: granted ? 'granted' : 'denied',
          ad_storage: granted ? 'granted' : 'denied',
          ad_user_data: granted ? 'granted' : 'denied',
          ad_personalization: granted ? 'granted' : 'denied',
        });
      }
    }

    document.getElementById('cookie-accept').addEventListener('click', function () {
      localStorage.setItem(PREF_KEY, 'accepted');
      sendConsentSignal(true);
      banner.style.display = 'none';
    });

    document.getElementById('cookie-reject').addEventListener('click', function () {
      localStorage.setItem(PREF_KEY, 'rejected');
      sendConsentSignal(false);
      banner.style.display = 'none';
    });
  })();
</script>
```

### BaseLayout.astro entegrasyonu

`BaseLayout.astro`'ya iki değişiklik:

**1. `<head>` içine Consent Mode v2 default sinyali** (gtag'den önce):
```astro
<!-- Google Consent Mode v2 — default denied until user chooses -->
<script is:inline>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });
</script>
```

**2. `<body>` sonuna banner import:**
```astro
import CookieConsent from '../components/CookieConsent.astro';

// <body> içinde, <Footer> sonrası:
<CookieConsent />
```

### Davranış özeti

```
İlk ziyaret:
  localStorage → boş
  → Banner gösterilir
  → Consent Mode v2: analytics_storage=denied (GA veri toplamaz)

"Kabul Et":
  localStorage → 'accepted'
  → Banner kapanır
  → gtag consent update: analytics_storage=granted (GA veri toplar)
  → Reklamlar normal çalışır
  → Sonraki ziyarette banner çıkmaz

"Yalnızca Zorunlu":
  localStorage → 'rejected'
  → Banner kapanır
  → gtag consent update: denied (GA anonim mod)
  → AdSense non-personalized ads moduna geçer (Google bunu kendisi handle eder)
  → Sonraki ziyarette banner çıkmaz
```

> **Not:** Consent Mode v2 ile AdSense/GA scriptleri DOM'da mevcuttur ama veri toplama kısıtlıdır. Bu yaklaşım Google'ın önerdiği standarttır ve TCF v2.2 gereksinimini basit siteler için karşılar.

---

## Uygulama Sırası (Onay Sonrası)

```
1. Admin panelden Publisher ID + slot ID'leri gir → "Kaydet & Build Tetikle"
   (Bu adım siteyi kırmaz; ads.enabled=true olduğunda devreye girer)

2. Kod değişiklikleri (tek PR):
   a. src/components/AdSlot.astro — yeni implementasyon
   b. src/layouts/BaseLayout.astro — Consent Mode default + CookieConsent import
   c. src/components/CookieConsent.astro — yeni dosya

3. Build + deploy → test:
   - Reklam slotları görünüyor mu? (browser dev tools → Elements)
   - adsbygoogle.push({}) çağrısı her ins için çalışıyor mu?
   - Cookie banner ilk ziyarette çıkıyor mu?
   - "Kabul Et" / "Yalnızca Zorunlu" sonrası banner kayboluyor mu?
   - localStorage'da preference kaydedildi mi?
   - Consent Mode v2 sinyalleri GA dashboard'da görünüyor mu?
```

---

*Oluşturulma tarihi: 2026-05-02*
*Durum: Onay bekleniyor — hiçbir kod uygulanmadı*
