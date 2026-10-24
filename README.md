# Oriskin Branch Locator

Locator klinik responsif dengan peta interaktif OpenStreetMap, pencarian cabang,
hasil yang diurutkan berdasarkan jarak, tombol lokasi perangkat, petunjuk Google
Maps, WhatsApp, salin alamat, filter kota, log perubahan bersama, berbagi tautan,
dan pilihan tema.

## Menjalankan

Jalankan website dari server lokal (contohnya ekstensi Live Server di VS Code)
atau hosting. Server diperlukan agar browser dapat mengambil CSV spreadsheet.
Peta memerlukan koneksi internet untuk memuat Leaflet dan tile OpenStreetMap.

## Mengelola daftar klinik melalui Google Spreadsheet

Daftar klinik dimuat dari Google Spreadsheet yang ditautkan di `clinics.js`.
Klinik tidak lagi disimpan di file lokal: tambah, ubah, atau hapus baris data
di spreadsheet, lalu muat ulang locator untuk melihat perubahannya.

1. Buka spreadsheet yang dipakai sebagai sumber data.
2. Pilih **File → Bagikan → Publikasikan ke web**, pilih tab klinik dan format
   **Comma-separated values (.csv)**, lalu publikasikan. Alternatifnya, berikan
   akses **Siapa saja yang memiliki link — Pelihat**.
3. Pastikan baris pertama adalah header dan gunakan kolom berikut:

   | Header | Wajib | Keterangan |
   | --- | --- | --- |
   | `id` | Ya | ID unik, misalnya `oriskin-bandung` |
   | `name` | Ya | Nama klinik |
   | `city` | Ya | Kota atau kabupaten |
   | `address` | Ya | Alamat lengkap |
   | `latitude` | Ya | Koordinat lintang, angka desimal |
   | `longitude` | Ya | Koordinat bujur, angka desimal |
   | `hours` | Tidak | Jam operasional |
   | `phone` | Tidak | Nomor telepon |
   | `whatsapp` | Tidak | Nomor WhatsApp format internasional, tanpa `+` |
   | `google_maps` | Tidak | Link Google Maps klinik; boleh dikosongkan |
   | `status` | Tidak | `ya` = berjalan, `tidak` = tidak ikut program (merah), `stop` = berhenti |
   | `keywords` | Tidak | Kata pencarian tambahan, pisahkan dengan koma |

   Nama header Indonesia seperti `Nama Klinik`, `Kota`, `Alamat`, `Jam
   Operasional`, `Telepon`, `WhatsApp`, `Google Maps`, `Latitude`, `Longitude`,
   `Status`, dan `Kata Kunci` juga dikenali. `id`, `name`, `city`, `address`,
   `latitude`, dan `longitude` tetap wajib. Kolom `status` boleh dikosongkan
   (dianggap `ya`); isinya tidak peka huruf besar/kecil.
4. Nilai `spreadsheetId` dan `gid` di `clinics.js` harus sesuai dengan URL
   spreadsheet. Untuk tautan yang diberikan, ID dan `gid` sudah diisi.
5. Buka locator melalui server lokal atau hosting, lalu muat ulang halaman.

Website hanya membaca spreadsheet. Pengelolaan data dilakukan oleh tim di
Google Sheets; spreadsheet harus dapat dibaca publik agar website statis dapat
memuat CSV tanpa kredensial. Jika spreadsheet belum publik, locator akan
menampilkan alasan data gagal dimuat. Pastikan koordinat berada pada rentang
latitude `-90` sampai `90` dan longitude `-180` sampai `180`.
Tombol Google Maps menggunakan link pada kolom `google_maps` jika diisi; jika
kosong, locator mencari berdasarkan nama klinik, alamat, dan kota, bukan
koordinat. Status tampil pada kartu dan marker peta; klinik dengan status apa
pun tetap ditampilkan dan bisa diklik.

Saat tidak mencari, peta dan daftar menampilkan semua klinik. Pencarian atau
fitur lokasi menampilkan klinik dalam radius 100 km. Jika lokasi hasil pencarian
tidak memiliki klinik dalam 100 km, locator menampilkan tiga klinik terdekat
beserta jarak garis lurusnya (bukan jarak rute jalan). Kota yang belum ada dalam
daftar klinik, seperti Batam, tetap bisa dicari. Nama klinik/kata kunci yang
cocok dengan data tetap diprioritaskan.
Filter **Semua kota** memilih kota dari nilai pada kolom `city`.

Pencarian nama tempat menggunakan layanan geocoding Nominatim OpenStreetMap
hanya setelah tidak ada klinik yang cocok. Permintaan dilakukan saat pengguna
menekan tombol cari (bukan autocomplete), dibatasi maksimal satu permintaan per
detik pada tab tersebut, dan memerlukan koneksi internet. Hasil peta menggunakan
data OpenStreetMap; atribusi ditampilkan pada peta.

## Log pengumuman perubahan

Log berupa kalimat pengumuman yang ditulis manual oleh administrator, bukan
rekaman otomatis setiap edit sel. Contoh: `Klinik Kartini sudah tidak beroperasi
dikarenakan sudah tutup.` Semua pengunjung dapat melihat pengumuman, sedangkan
penambahan melalui website membutuhkan login administrator.

### Siapkan sheet

1. Buka **Extensions → Apps Script** dari spreadsheet klinik.
2. Ganti isi file `Code.gs` dengan `apps-script/announcement-log.gs`, lalu
   tambahkan file HTML bernama `admin` dan salin isi
   `apps-script/admin.html` ke dalamnya.
3. Pilih fungsi `setupAnnouncementLog`, klik **Run**, dan setujui izin. Fungsi
   ini membuat sheet `Log Perubahan` dengan kolom `Waktu`, `Pengumuman`, `Admin`
   serta menyimpan ID spreadsheet untuk dipakai aplikasi.
4. Atur **Project Settings → Script Properties** berikut. Gunakan username dan
   password sesuai pilihan; tidak ada batas minimal panjang. Jangan menyimpan
   kredensial di website atau membagikannya ke publik:
   - `ADMIN_USERNAME` — username administrator.
   - `ADMIN_PASSWORD` — password administrator.
5. Di Google Sheets, admin juga boleh menambahkan pengumuman langsung: satu
   baris per pengumuman; isi kolom `Waktu`, `Pengumuman`, dan `Admin`. Batasi
   akses editor spreadsheet hanya untuk administrator tepercaya; jangan
   memberikan akses edit publik.

### Aktifkan login di website

1. Di Apps Script pilih **Deploy → New deployment → Web app**.
2. Pilih **Execute as: Me** agar web app menulis ke spreadsheet pemilik script.
   Atur akses web app ke **Anyone** supaya pengunjung website dapat membuka
   halaman login. Halaman bisa dibuka publik, tetapi setiap penambahan tetap
   memerlukan verifikasi username/password di server.
3. Deploy dan salin URL Web App yang berakhiran `/exec`.
4. Di Google Sheets, publikasikan tab `Log Perubahan` sebagai CSV.
5. Isi `logGid` dengan gid tab log dan `adminWebAppUrl` dengan URL Web App di
   `clinics.js`.

Tombol **Log Perubahan** menampilkan hingga 100 pengumuman terbaru. Tombol
**Login administrator** membuka form login; pengumuman disimpan bersama nama
admin ke sheet. Form membatasi pengumuman hingga 1000 karakter dan membatasi
percobaan login. Pastikan sheet log hanya memuat pengumuman yang memang boleh
dilihat publik.

## Placeholder logo

Header memakai dua gambar dengan ukuran tampilan sama: `assets/logo-1.png` dan
`assets/logo-2.png`. Ganti kedua file itu dengan PNG milikmu (gunakan nama file
yang sama) untuk memperbarui logo; tidak perlu mengubah kode halaman.
