# yarinhava.com: Google için otomasyon planı (Ekim 2026)

Amaç: Google'ın ödüllendirdiği sinyalleri (tazelik, benzersiz bilgi,
hız, temiz indeks, iyi tıklama oranı) **insan emeği olmadan** sürekli
üreten ve ölçen bir sistem kurmak. Sahibin işi yalnızca tek seferlik
kurulum (aşağıda §10) ve PR onayı olur.

---

## 1. Bugünkü durum: zaten otomatik olanlar

Bunlar çalışıyor, plana yeniden eklenmiyor:

| Alan | Mevcut otomasyon |
|---|---|
| Tazelik | Günde 2 build (00:07 ve 12:13 TR), bayat veri yayınlanmıyor (`fetch-weather.mjs` + `validate-build.mjs`) |
| Gözcü | 6 saatte bir canlı site testi, sorun olursa GitHub issue açılıyor (`health-check.yml`) |
| Sitemap | Gerçek `lastmod` (tahminin alındığı saat), statik sayfalarda `lastmod` yok |
| Bing/Yandex | Her deploy sonrası IndexNow |
| Yapılandırılmış veri | WebPage + `dateModified` + Place/Geo + BreadcrumbList; uygun olmayan FAQ/Speakable bilinçli olarak çıkarıldı |
| Sayfa farklılaştırma | Dönem sayfalarına özel veri bazlı metin (`periodSummary.ts`) |
| Sosyal/Discover görseli | Her sayfaya özel 1200x630 OG görseli |
| AI arama | `llms.txt`, AI botlarına açık `robots.txt` |
| Kalıcılık | Haftalık keep-alive, cron'un GitHub tarafından kapatılmasını önlüyor |

**Eksik olan:** Google'ın siteyi nasıl gördüğüne dair hiçbir veri otomatik
okunmuyor. Search Console verisi elle bakılınca var, yoksa yok. Kararlar
(Migration A, başlık testleri, budama) bu veri olmadan alınamıyor. Plan bu
boşlukla başlıyor.

---

## 2. Dürüst çerçeve: Google'da neyin işe yaradığı

- **"İstanbul hava durumu" gibi ana sorgularda Google kendi hava kutusunu
  gösterir**, tıklama azdır. Kazanılacak alan uzun kuyruktur: "15 günlük",
  "yarın", "hafta sonu", ilçe adları, "kasım ayında Antalya", "kar ne zaman
  yağacak", ve Google Discover.
- **Hava durumu için rich result yoktur.** Şema işaretlemesi sıralamayı
  doğrudan artırmaz; doğru anlaşılmayı ve Dataset Search gibi yan
  kanalları sağlar.
- **Ölçeklenmiş içerik politikası (Mart 2024):** Binlerce şablon sayfayı
  çoğaltmak cezalandırılır. Site Ağustos 2026'da tam da bu tür bir kalite
  yeniden değerlendirmesi yaşadı. Bu yüzden plan **sayfa sayısını değil,
  sayfa başına benzersiz veriyi** artırır; yeni URL yalnızca kalıcı ve
  veriyle dolu bir hub ise açılır.
- **Google IndexNow'u desteklemez.** Indexing API yalnızca iş ilanı ve canlı
  yayın içindir; hava sayfaları için kullanmak politika ihlalidir. Sitemap
  ping uç noktası 2023'te kaldırıldı. Google'a doğru kanal: doğru `lastmod`
  + Search Console Sitemaps API + iyi iç linkleme.

---

## 3. Faz 0: Ölçüm altyapısı (her şeyi besleyen döngü)

Tüm sonraki fazlar bu verilerle karar verir. Veriler deploy tetiklememek
için ayrı bir `seo-data` dalına yazılır.

### 0.1 `gsc-sync` iş akışı (günlük)
- Search Console **Search Analytics API**: tarih × sayfa × sorgu × cihaz,
  günlük çekim, 16 aylık kayan arşiv (`seo-data` dalında sıkıştırılmış JSON).
- Sayfalar otomatik olarak şablon tipine ayrılır: il/ilçe × base, bugün,
  yarın, hafta sonu, saatlik, 7/10/15 gün, iklim, statik.

### 0.2 Haftalık SEO raporu (otomatik GitHub issue, `seo-report` etiketi)
- Şablon tipi başına tıklama, gösterim, ortalama sıra, CTR; geçen haftaya
  ve geçen aya göre değişim.
- Yükselen ve düşen 20 sayfa ve sorgu; 1.000+ gösterimli sorgu sayısı
  (çöküşte 23'ten 5'e düşen metrik).
- **Anomali alarmı:** bir şablon tipinde haftalık %25+ tıklama düşüşü veya
  sıra kaybı olursa ayrı `seo-alert` issue'su açılır (sahibe e-posta gider).

### 0.3 İndeks kapsamı örneklemesi (günlük)
- **URL Inspection API** (günlük 2.000 kota): her gün şablon tiplerinden
  tabakalı ~300 URL denetlenir, bir ayda tüm şablon tipleri için güvenilir
  "indekste / tarandı ama indekslenmedi / keşfedildi" oranları çıkar.
- Bu, "ilçe 10 günlük sayfaları Google'da değersiz mi?" sorusuna tahmin
  değil veriyle cevap verir (Faz 3.3'ü besler).

### 0.4 Sitemap gönderimi ve kontrolü (her deploy sonrası)
- **Sitemaps API** ile `sitemap-index.xml` gönderilir, ardından Google'ın
  bildirdiği hata/uyarı sayısı okunur; hata varsa issue açılır.
- Kaldırılmış ping yerine geçen meşru yöntem budur.

### 0.5 Core Web Vitals izleme
- **CrUX API** (haftalık): gerçek kullanıcı LCP, INP, CLS; origin ve
  şablon başına örnek URL'ler. Eşik aşılırsa issue.
- **Lighthouse CI** `ci.yml` içinde: her PR'da 6 şablon sayfası için bütçe
  (LCP, CLS, toplam JS). Reklam kaynaklı CLS gerilemesi üretime çıkmadan
  yakalanır.

---

## 4. Faz 1: Hızlı teknik kazanımlar (tek PR, düşük risk)

| # | Değişiklik | Neden |
|---|---|---|
| 1.1 | `robots` meta'ya `max-image-preview:large` | Discover'da büyük görsel gösterimi için gerekli; şu an yok |
| 1.2 | Sitemap'i tiplere bölmek (`il-tahmin`, `ilce-tahmin`, `iklim`, `sabit`) | Search Console her sitemap için ayrı indeks oranı gösterir; Faz 0.3 ile birlikte hangi şablonun sorunlu olduğu otomatik görünür |
| 1.3 | İklim sayfalarına `Dataset` şeması (ERA5 2015-2024, CC BY 4.0, coğrafi kapsam) | Google Dataset Search'e girme hakkı; gerçek ve meşru bir veri seti |
| 1.4 | Validator'ı tüm siteye genişletmek: tekrar eden başlık/açıklama, şema zorunlu alanları, kırık iç link | Şu an 13 örnek konum kontrol ediliyor; tam tarama ucuz ve hatayı deploy öncesi yakalar |
| 1.5 | Bing Webmaster doğrulaması (`site-config.json` içinde boş) | Bing verisi de rapora girer (kod sahibin hesabından alınmalı) |

---

## 5. Faz 2: Benzersiz veri ("bilgi kazancı"), en büyük kaldıraç

Google, aynı Open-Meteo verisini gösteren yüzlerce siteden farklı bir şey
sunan sayfayı öne çıkarır. Aşağıdakilerin hepsi mevcut veriden otomatik
üretilir ve **yeni URL açmadan** mevcut 8.400 sayfayı zenginleştirir.

### 2.1 Mevsim normalleriyle karşılaştırma (sıfır ek API çağrısı)
- `climate.json` artık 81/81 il dolu. Her tahmin sayfasına:
  "Yarın 19°C, kasım normalinin (14°C) 5°C üzerinde" ve
  "Bu hafta normalden yağışlı/kurak".
- İl ve ilçe sayfalarının hepsine farklı, tarihe bağlı, doğrulanabilir
  cümleler ekler; şablon benzerliğini daha da düşürür.

### 2.2 Tahmin doğruluğu takibi (sıfır ek API çağrısı)
- Mevcut tahmin isteğine `past_days=1` eklenir; dünün gerçekleşen
  değerleri aynı çağrıyla gelir.
- Her build, dünkü tahminimizi (1, 3, 7 gün önceden yapılmış) arşivden alır
  ve gerçekleşenle karşılaştırır. 30 günlük kayan arşiv `seo-data` dalında.
- Sayfalarda: "Dün için tahminimiz 17°C idi, gerçekleşen 16°C." ve il
  başına "Son 30 günde 1 gün önceden ortalama sapma: 1,2°C".
- Yeni hub: `/tahmin-dogrulugu/` (81 il tablosu, kalıcı URL).
- **Neden önemli:** şeffaflık ve uzmanlık (E-E-A-T) sinyali; rakiplerde
  olmayan, kopyalanamayan içerik; "dün hava nasıldı" sorgularını da yakalar.

### 2.3 Olay odaklı kalıcı hub'lar
Tahmin verisi her build'de taranır, eşik aşan iller listelenir:

- `/kar-yagisi/`: önümüzdeki 15 günde kar beklenen iller, tarih ve miktar
- `/sicak-hava-dalgasi/`, `/don-uyarisi/`, `/firtina/`, `/kuvvetli-yagis/`

URL'ler **kalıcıdır**, içerik değişir (geçici URL üretilmez, indeks şişmez).
Olay yokken sayfa "şu an beklenen yok" ve mevsimsel bilgi gösterir. Olay
olduğunda ana sayfadan link alır. Hedef: "kar ne zaman yağacak", "İstanbul'a
kar yağacak mı" tipi haber benzeri sorgular ve Discover.

### 2.4 Takvim hub'ları (her yıl yeniden kullanılan URL'ler)
- `/bayram-hava-durumu/`, `/yilbasi-hava-durumu/`, `/okullar-acilirken-hava/`
- Tarihler bir takvim dosyasından gelir. Tarih 15 gün içindeyse gerçek
  tahmin, değilse o günlerin iklim normalleri gösterilir; yıl boyu geçerli.
- Yaklaşan dönemde ana sayfadan otomatik link.

### 2.5 Günlük hava bülteni (otomatik blog)
Genel "kışın nasıl giyinmeli" tipi yapay zeka yazıları **yazılmaz**: yüzlerce
sitede aynısı var, Google bunları ölçeklenmiş içerik sayar. Bunun yerine her
gün **o günün verisinden** bir haber bülteni üretilir; her yazı içerdiği
sayılar yüzünden benzersizdir.

- **URL:** `/bulten/2026-10-25-turkiye-hava-durumu/` (+ `/bulten/` arşivi).
- **İçerik, veriden:** yarının en sıcak/soğuk illeri, kar/yağış/fırtına
  beklenen iller ve saatleri, normalden sapan iller (2.1), dünkü tahmin
  doğruluğu (2.2), hafta sonu görünümü, büyük şehirler tablosu; her ilden
  ilgili il sayfasına iç link.
- **Görsel:** her bülten için verinden çizilen Türkiye sıcaklık/yağış
  haritası (mevcut `TurkeyMap` + resvg), 1200px+, Discover için.
- **Metin:** şablon cümleler; ücretli API yok, dış bağımlılık yok, her sayı
  doğrudan veriden geldiği için hata yapmaz. Kalıp hissini kırmak için:
  - her bölüm için birden çok cümle kalıbı, seçim tarih + veri ile
    deterministik (aynı gün hep aynı metin, ardışık günler farklı);
  - bölümler o günün olaylarına göre sıralanır (kar varsa kar başta) ve
    olayı olmayan bölüm hiç yazılmaz, böylece yazıların yapısı da değişir;
  - Türkçe ekler (`'da/'de/'ta/'te`, `'a/'e/'ya/'ye`) mevcut yardımcılarla
    doğru çekilir;
  - test: son 30 günün verisiyle üretilen bültenler arasında metin
    benzerliği ölçülür, eşik aşılırsa CI kırmızı olur.
- **Kalıcılık:** yazı build sırasında değil, ayrı bir iş akışında üretilip
  repoya commit edilir; eski bültenler yeni veriyle değişmez. Bu commit
  keep-alive'ın yerini de tutar.
- **Şema:** `NewsArticle` (yazar: kuruluş "Yarın Hava", sahte insan yazar
  yok), metinde "model verisinden otomatik derlenmiştir" açıklaması; son
  48 saatin yazıları için Google News sitemap'i.
- **Kalite kapısı:** kayda değer olay yoksa kısa bülten çıkar, dolgu metin
  yazılmaz; olay eşiklerini aşan günlerde (ilk kar, fırtına, sıcak hava
  dalgası) ek, olaya özel yazı açılır.
- **İzleme:** Faz 0 bültenlerin indekslenme oranını ve tıklamasını ayrı
  takip eder; 4-6 hafta sonra indekslenmeyen veya tıklanmayan bir desen
  varsa eski bültenler `noindex` yapılır ya da haftalığa geçilir.

---

## 6. Faz 3: İç linkleme ve tarama bütçesi (veriye dayalı)

### 3.1 "Gündemdeki hava" modülü (her build)
Ana sayfada en uç hava olayları olan iller ve Faz 0'da gösterimi yükselen
sayfalar. Link gücü talebin olduğu yere akar; her gün değişir.

### 3.2 "Vurucu mesafe" linkleri (haftalık)
Ortalama sırası 8-20 arasında olan sayfalar (`seo-data`'dan build sırasında
okunur) il hub'larından ve "ilgili tahminler" bloklarından ek iç link alır.

### 3.3 İndeks şişkinliği yönetimi (aylık rapor, onaylı uygulama)
- 90 gün sıfır gösterim + "tarandı ama indekslenmedi" olan şablon grupları
  için öneri raporu (örnek: "ilçe 10 günlük sayfalarının %80'i indekste
  değil, 15 günlüğe birleştirme önerilir").
- **Otomatik uygulanmaz.** URL birleştirme geri dönüşü zor bir değişiklik;
  rapor + hazır PR gelir, sahip onaylar. Bekleyen Migration A (`/yarin/`)
  kararı da bu veriyle verilir.

---

## 7. Faz 4: Tıklama oranı (CTR) deney döngüsü

- Başlık/açıklama şablonları için varyantlar. İller hash ile A/B gruplarına
  ayrılır (sayfa düzeyinde SEO split testi; herkes aynı içeriği görür, cloaking
  değildir).
- 4 hafta, aynı anda tek deney. Faz 0 verisiyle sıraya göre düzeltilmiş CTR
  karşılaştırılır; anlamlı kazanan varsa kazanan şablon PR olarak gelir.
- En az 4-6 haftalık Faz 0 verisi birikince başlar.

---

## 8. Faz 5: Haftalık bakım ajanı

Planlanmış bir Claude Code oturumu (haftalık Routine): haftalık raporu ve
açık `seo-alert` issue'larını okur, nedenini araştırır, düzeltmeyi PR olarak
açar. Sahibin işi PR'ı onaylamak.

---

## 9. Bilerek yapılmayacaklar (Google cezalandırır)

- Indexing API'yi hava sayfaları için kullanmak.
- Anahtar kelime başına yapay zeka metinli kapı sayfalar ("X hava durumu
  yarın sabah", "X'te şemsiye lazım mı" gibi binlerce yeni URL).
- Sahte `lastmod`/`dateModified`, sahte puan/yorum şeması, uygun olmayan
  FAQ şeması.
- Link satın alma, otomatik link değişimi.
- Search Console arayüzünde "indeksleme iste"yi bot ile tıklatmak (API'si
  yok, kullanım şartlarına aykırı).

---

## 10. Sahipten tek seferlik istenen (yaklaşık 15 dakika)

1. Google Cloud'da bir proje açıp şu API'leri etkinleştirmek: Search Console
   API, PageSpeed Insights API, Chrome UX Report API.
2. Bir **service account** oluşturup JSON anahtarını indirmek.
3. Search Console → Ayarlar → Kullanıcılar ve izinler → service account
   e-postasını eklemek ("Tam" yetki; Sitemaps API gönderimi için gerekli).
4. Aynı projede bir API anahtarı oluşturmak (CrUX/PSI için).
5. GitHub repo secret'ları: `GSC_SERVICE_ACCOUNT_JSON`, `GOOGLE_API_KEY`.
6. (İsteğe bağlı) Bing Webmaster doğrulama kodu.

Bunlar olmadan Faz 1 ve Faz 2 yine yapılabilir; Faz 0, 3.2, 3.3 ve 4 bu
erişime bağlıdır.

---

## 11. Sıralama

| Hafta | İş | Bağımlılık |
|---|---|---|
| 1 | Faz 1 (hızlı kazanımlar) + Faz 2.1 (normaller) | yok |
| 1-2 | Faz 0 (ölçüm), Lighthouse CI | §10 kurulumu |
| 2-3 | Faz 2.2 (tahmin doğruluğu) | 2.1 |
| 2-3 | Faz 2.5 (günlük bülten) | 2.1 |
| 3-4 | Faz 2.3 (olay hub'ları) + 3.1 (gündem modülü) | yok |
| 4+ | Faz 2.4 (takvim hub'ları) | yok |
| 6+ | Faz 3.2, 3.3, Faz 4 | 4-6 haftalık Faz 0 verisi |
| sürekli | Faz 5 bakım ajanı | Faz 0 |

Her adım ayrı PR olarak gelir: testler + build validator + tam site
kontrolü geçmeden birleştirilmez. URL ekleyen veya kaldıran değişiklikler
asla başka bir değişiklikle aynı deploy'a girmez.
