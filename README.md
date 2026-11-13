# Eczane Pusula — Veri Servisi

81 ilin nöbetçi eczane listesini **ücretsiz** olarak toplar ve statik JSON dosyaları olarak yayınlar.
Uygulama sadece bu dosyaları okur: API anahtarı uygulamada durmaz, kullanıcı sayısı ne olursa olsun maliyet sıfırdır.

## Nasıl çalışır

GitHub Actions günde 3 kez (08:47, 09:12, 19:37 Türkiye saati) çalışır:

| Sıra | Kaynak | Ne için |
|---|---|---|
| 1 | **e-Devlet — TİTCK Nöbetçi Eczane Sorgulama** | 81 il, bugün + yarın (resmî kaynak, TEB bildirir) |
| 2 | **İzmir BB Açık Veri** (CC BY 4.0) | İzmir, koordinatlı |
| 3 | **NosyAPI** (isteğe bağlı, ayda 500 ücretsiz kredi) | e-Devlet'te boş kalan iller için yedek |
| — | **OpenStreetMap** (haftalık) | "Tüm Eczaneler" listesi + nöbetçilerin harita konumu |
| — | **Nominatim** (sınırlı) | Konumu bulunamayan nöbetçiler için adres arama; sonuç kalıcı önbelleğe alınır |

- e-Devlet'e her çalışmada il başına 2 sorgu gider (bugün + yarın), aralarında 1,5 sn beklenir. Toplam yük bir kişinin siteye bakmasından hafiftir.
- Bir kaynak boş ya da hatalı dönerse **eski dolu liste silinmez**.
- e-Devlet'ten hiç veri alınamazsa iş "başarısız" görünür ve GitHub sana e-posta atar.

Yayınlanan dosyalar:

```
https://KULLANICI.github.io/eczane-pusula-veri/
  index.html          Durum sayfası (hangi ilde kaç nöbetçi var)
  v1/index.json       İl listesi, ilçeler, sınırlar
  v1/il/34.json       İl başına nöbetçi listesi (dün, bugün, yarın)
  v1/osm/34.json      İl başına tüm eczaneler (haftalık)
  v1/rapor.json       Son çalışmanın raporu
```

## Kurulum (10 dakika)

1. **GitHub'da yeni bir depo aç:** adı `eczane-pusula-veri`, **Public** olsun (Pages ve Actions ücretsiz olsun diye). README ekleme, boş kalsın.

2. **Bu klasörü yükle** (bilgisayarında, `veri-servisi` klasörünün içinde):
   ```bash
   git init
   git add .
   git commit -m "Veri servisi"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADIN/eczane-pusula-veri.git
   git push -u origin main
   ```

3. **İlk çalıştırma:** depoda **Actions** sekmesi → soldan "Nöbetçi eczane verisini güncelle" → **Run workflow**. 5–10 dakika sürer.
   - Kırmızı çarpı çıkarsa: tıkla, "Veriyi topla" adımındaki çıktıyı kopyalayıp bana gönder.

4. **Yayını aç:** **Settings → Pages** → *Source: Deploy from a branch* → Branch: **gh-pages**, klasör **/ (root)** → Save.
   1–2 dakika sonra `https://KULLANICI_ADIN.github.io/eczane-pusula-veri/` adresinde durum sayfası açılır.

5. **Uygulamaya bağla:** uygulamanın `.env` dosyasına:
   ```
   EXPO_PUBLIC_DATA_URL=https://KULLANICI_ADIN.github.io/eczane-pusula-veri/
   ```

### İsteğe bağlı ayarlar (Settings → Secrets and variables → Actions)

| Ad | Tür | Ne işe yarar |
|---|---|---|
| `NOSY_API_KEY` | Secret | e-Devlet'te boş kalan iller için NosyAPI yedeği (çalışma başına en fazla 12 kredi; ayda ~300) |
| `CONTACT_EMAIL` | Variable | Nominatim kullanım kuralı gereği iletişim e-postası (önerilir) |

## Bilmen gerekenler

- **İlk günler:** OpenStreetMap dosyaları her çalışmada 12 il olmak üzere 2–3 günde tamamlanır. Bu sürede uygulama "Tüm Eczaneler" için canlı OpenStreetMap'i kullanır. Nöbetçilerin harita konumları da birkaç gün içinde önbellekte birikir; konumu bilinmeyenler listede mesafesiz görünür, yol tarifi adrese göre açılır.
- **e-Devlet'te boş iller:** Bazı eczacı odaları veriyi sisteme girmiyor (bir açık kaynak projenin Ekim 2026 raporunda Artvin, Aydın, Elazığ, Eskişehir, Hakkari, Kayseri, Kırşehir, Malatya, Muş, Kilis). Bu iller için `NOSY_API_KEY` ekle; yoksa uygulama o ilde "e-Devlet'te kontrol et" butonu gösterir.
- **Bozulursa:** e-Devlet sayfa yapısını değiştirirse okuyucu bozulur ve GitHub e-posta atar. Uygulama son dolu listeyi göstermeye devam eder (36 saate kadar). Hata çıktısını bana gönder, düzeltiriz. Gerekirse ücretli bir API'ye geçmek sadece bu klasördeki kaynak dosyasını değiştirmek demek, uygulamaya güncelleme gerekmez.
- **60 gün kuralı:** GitHub, 60 gün hiç etkinlik olmayan açık depolarda zamanlanmış işleri durdurur. Bu servis her çalışmada yayın dalına yazdığı için normalde sorun olmaz; durursa Actions sekmesinden yeniden etkinleştir.
- **Yerelde deneme:** `node test/run-tests.mjs` (ağ gerekmez) · `node src/run.mjs --out public --only 34,6` (İstanbul ve Ankara'yı çeker; Node 22 gerekir).

## Hukuki not

Veriler kamuya açık sayfalardan düşük sıklıkta okunur ve kaynak belirtilerek yayınlanır. İzmir verisi CC BY 4.0, OpenStreetMap verisi ODbL lisanslıdır; uygulamada atıf gösterilir. Uygulamada eczanelerden ücret alıp sıralamayı değiştirme (sponsorlu nöbetçi) gibi özellikler ekleme. Bu servis resmî bir kurum hizmeti değildir; kendi sorumluluğunda kullan.
