# Oriskin Branch Locator

Locator klinik responsif dengan peta interaktif OpenStreetMap, pencarian cabang,
hasil yang diurutkan berdasarkan jarak, tombol lokasi perangkat, petunjuk Google
Maps, WhatsApp, salin alamat, berbagi tautan, dan pilihan tema.

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
   | `keywords` | Tidak | Kata pencarian tambahan, pisahkan dengan koma |

   Nama header Indonesia seperti `Nama Klinik`, `Kota`, `Alamat`, `Jam
   Operasional`, `Telepon`, `WhatsApp`, `Google Maps`, `Latitude`, `Longitude`,
   dan `Kata Kunci` juga dikenali. `id`, `name`, `city`, `address`, `latitude`,
   dan `longitude` tetap wajib.
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
koordinat.
