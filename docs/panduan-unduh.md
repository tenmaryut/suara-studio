# Panduan Unduh dan Pasang Suara Studio

Suara Studio adalah aplikasi gratis untuk merekam dan mengedit audio di Windows, macOS, dan Linux.
Panduan ini menjelaskan cara mengunduh, memasang, memperbarui, dan menghapusnya.

> *English instructions are in the [README](../README.md#install).*

**Isi panduan**

1. [Persyaratan sistem](#persyaratan-sistem)
2. [Cara 1: Pasang dengan satu perintah (disarankan)](#cara-1-pasang-dengan-satu-perintah-disarankan)
3. [Cara 2: Unduh installer secara manual](#cara-2-unduh-installer-secara-manual)
4. [Memeriksa keaslian file](#memeriksa-keaslian-file)
5. [Izin mikrofon](#izin-mikrofon)
6. [Memperbarui Suara Studio](#memperbarui-suara-studio)
7. [Menghapus Suara Studio](#menghapus-suara-studio)
8. [Mengatasi masalah](#mengatasi-masalah)

Nama menu dan tombol sistem di panduan ini ditulis dalam bahasa Inggris. Jika Windows atau macOS
Anda berbahasa Indonesia, nama-nama itu muncul dalam bahasa Indonesia.

## Persyaratan sistem

| Sistem | Versi | Prosesor |
| --- | --- | --- |
| Windows | Windows 10 atau 11, 64-bit | Intel atau AMD (x64). Windows 11 di prosesor ARM juga bisa menjalankannya. |
| macOS | macOS 12 Monterey atau lebih baru | Apple Silicon (M1 dan sesudahnya) maupun Intel |
| Linux | Distribusi 64-bit yang masih didukung, misalnya Ubuntu 22.04 atau lebih baru, Debian 12, atau Fedora | x86_64 |

Siapkan ruang disk sekitar 300 MB. Mikrofon hanya diperlukan untuk merekam. Untuk mengedit file
audio, mikrofon tidak diperlukan.

## Cara 1: Pasang dengan satu perintah (disarankan)

Cara ini paling mudah. Satu perintah akan memilih file yang cocok untuk komputer Anda, memeriksa
keasliannya, lalu memasang Suara Studio. Peringatan SmartScreen di Windows dan Gatekeeper di macOS
juga tidak muncul dengan cara ini. Pengecualiannya adalah Smart App Control di Windows 11, yang
dijelaskan di bagian [Mengatasi masalah](#mengatasi-masalah).

Pesan selama pemasangan berbahasa Inggris. Itu normal.

### Windows

1. Klik **Start**, ketik `PowerShell`, lalu buka **Windows PowerShell**. Tidak perlu dibuka sebagai
   administrator.
2. Salin perintah di bawah, tempel di jendela PowerShell (<kbd>Ctrl</kbd> + <kbd>V</kbd> atau klik
   kanan), lalu tekan **Enter**:

   ```powershell
   irm https://github.com/tenmaryut/suara-studio/releases/latest/download/install.ps1 | iex
   ```

3. Tunggu sampai muncul tulisan `Suara Studio is installed. Start it from the Start menu.`
4. Buka **Suara Studio** dari menu Start.

Suara Studio dipasang khusus untuk akun Windows Anda, jadi tidak memerlukan izin administrator.

### macOS

1. Buka **Terminal**: tekan <kbd>⌘</kbd> + <kbd>Spasi</kbd>, ketik `Terminal`, lalu tekan
   **Enter**.
2. Salin perintah di bawah, tempel di Terminal (<kbd>⌘</kbd> + <kbd>V</kbd>), lalu tekan
   **Enter**:

   ```sh
   curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh
   ```

3. Tunggu sampai muncul tulisan `Suara Studio is installed in /Applications`. Jika akun Mac Anda
   bukan administrator, aplikasinya dipasang di folder **Applications** di dalam folder pribadi Anda.
4. Buka **Suara Studio** dari Launchpad atau dari folder **Applications**.

Perintah ini otomatis memilih versi yang cocok untuk Mac Apple Silicon maupun Intel.

### Linux

1. Buka **Terminal**. Di Ubuntu, tekan <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd>.
2. Salin perintah di bawah, tempel di Terminal (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd>),
   lalu tekan **Enter**:

   ```sh
   curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh
   ```

3. Di Ubuntu, Debian, Linux Mint, Fedora, dan openSUSE, perintah ini memasang paket `.deb` atau
   `.rpm`, jadi Anda akan diminta memasukkan kata sandi. Kata sandi tidak terlihat saat diketik.
   Ketik saja, lalu tekan **Enter**.
4. Buka **Suara Studio** dari menu aplikasi, atau ketik `suara-studio` di Terminal.

Jika Anda tidak punya akses `sudo`, pasang Suara Studio hanya untuk akun Anda sendiri. Cara ini
tidak meminta kata sandi:

```sh
curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh -s -- --method tarball
```

### Pilihan tambahan

| Keperluan | macOS dan Linux (tambahkan setelah `sh -s --`) | Windows (jalankan sebelum perintah instalasi) |
| --- | --- | --- |
| Memasang versi tertentu | `--version v0.1.0` | `$env:SUARA_VERSION = 'v0.1.0'` |
| Hanya mengunduh dan memeriksa, tanpa memasang | `--dry-run` | `$env:SUARA_DRY_RUN = '1'` |
| Menghapus Suara Studio | `--uninstall` | `$env:SUARA_UNINSTALL = '1'` |

Contoh di macOS atau Linux:

```sh
curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh -s -- --version v0.1.0
```

Di Windows, pengaturan `$env:` berlaku sampai jendela PowerShell ditutup. Jika ingin memakai
perintah instalasi biasa lagi, buka jendela PowerShell baru.

## Cara 2: Unduh installer secara manual

1. Buka halaman rilis terbaru:
   <https://github.com/tenmaryut/suara-studio/releases/latest>
2. Di bagian **Assets**, unduh file yang sesuai dengan komputer Anda. Bagian `0.1.0` di nama file
   adalah nomor versi, jadi bisa berbeda.

   | Komputer Anda | File yang diunduh |
   | --- | --- |
   | Windows | `suara-studio-0.1.0-win-x64-setup.exe` |
   | Mac dengan Apple Silicon (M1 dan sesudahnya) | `suara-studio-0.1.0-mac-arm64.dmg` |
   | Mac dengan prosesor Intel | `suara-studio-0.1.0-mac-x64.dmg` |
   | Ubuntu, Debian, Linux Mint | `suara-studio_0.1.0_amd64.deb` |
   | Fedora, openSUSE | `suara-studio-0.1.0.x86_64.rpm` |
   | Distribusi Linux lain | `suara-studio-0.1.0-linux-x86_64.AppImage` |

   Tidak tahu jenis Mac Anda? Klik logo Apple di pojok kiri atas layar, lalu pilih
   **About This Mac**. Jika ada baris **Chip** bertuliskan Apple M1, M2, dan seterusnya, pilih
   Apple Silicon. Jika ada baris **Processor** bertuliskan Intel, pilih Intel.

   File lain di halaman itu (`.zip`, `.tar.gz`, `install.sh`, `install.ps1`, dan `SHA256SUMS.txt`)
   dipakai oleh perintah instalasi. Anda tidak perlu mengunduhnya, kecuali `SHA256SUMS.txt` untuk
   [memeriksa keaslian file](#memeriksa-keaslian-file).

3. Pasang sesuai sistem Anda dengan langkah di bawah.

### Windows (.exe)

1. Klik dua kali file `.exe` yang sudah diunduh.
2. Jika muncul **Windows protected your PC**, klik **More info**, lalu **Run anyway**. Peringatan ini
   muncul karena installer Suara Studio belum ditandatangani dengan sertifikat dari Microsoft.
3. Suara Studio terpasang otomatis dan bisa dibuka dari menu Start.

### macOS (.dmg)

1. Klik dua kali file `.dmg`, lalu seret ikon **Suara Studio** ke folder **Applications**.
2. Buka Suara Studio dari folder **Applications**.
3. Pada pembukaan pertama, macOS akan memblokirnya karena aplikasi ini belum ditandatangani dengan
   sertifikat dari Apple. Klik **Done** (atau **OK**).
4. Buka **System Settings** → **Privacy & Security**, lalu gulir ke bawah sampai bagian
   **Security**. Di sana ada pesan bahwa Suara Studio diblokir. Klik **Open Anyway**, lalu
   masukkan kata sandi Mac Anda atau gunakan Touch ID. Di macOS 12 Monterey, menu ini ada di
   **System Preferences** → **Security & Privacy** → tab **General**.
5. Buka Suara Studio lagi. Jika macOS bertanya sekali lagi, pilih **Open Anyway** atau **Open**.

Langkah 3 sampai 5 hanya perlu dilakukan sekali.

Jika macOS mengatakan Suara Studio **"is damaged and can't be opened"**, aplikasinya sebenarnya
tidak rusak. macOS memberi tanda khusus pada aplikasi yang diunduh lewat browser. Hapus tanda itu
dengan perintah berikut di Terminal, lalu buka aplikasinya lagi:

```sh
xattr -dr com.apple.quarantine "/Applications/Suara Studio.app"
```

### Ubuntu, Debian, Linux Mint (.deb)

Buka Terminal, lalu jalankan:

```sh
cd ~/Downloads
sudo apt install ./suara-studio_0.1.0_amd64.deb
```

Pesan `Download is performed unsandboxed as root` yang mungkin muncul aman diabaikan.

### Fedora, openSUSE (.rpm)

Di Fedora:

```sh
cd ~/Downloads
sudo dnf install ./suara-studio-0.1.0.x86_64.rpm
```

Di openSUSE:

```sh
cd ~/Downloads
sudo zypper install --allow-unsigned-rpm ./suara-studio-0.1.0.x86_64.rpm
```

### Linux lainnya (.AppImage)

AppImage bisa langsung dijalankan tanpa dipasang:

```sh
cd ~/Downloads
chmod +x suara-studio-0.1.0-linux-x86_64.AppImage
./suara-studio-0.1.0-linux-x86_64.AppImage
```

AppImage memerlukan FUSE versi 2 (paket `libfuse2`). Jika AppImage tidak mau berjalan, pakai
perintah dari [Cara 1](#linux) dengan `--method tarball`. Cara itu bisa dipakai di hampir semua
distribusi.

## Memeriksa keaslian file

Setiap rilis menyertakan file `SHA256SUMS.txt` berisi sidik jari (*checksum*) semua file. Dengan
mencocokkannya, Anda bisa memastikan file yang diunduh sama persis dengan yang diterbitkan. Perintah
instalasi di [Cara 1](#cara-1-pasang-dengan-satu-perintah-disarankan) sudah melakukan pemeriksaan
ini secara otomatis.

Untuk unduhan manual, unduh juga `SHA256SUMS.txt` ke folder yang sama, lalu jalankan perintah ini
di folder itu:

- **Windows** (PowerShell):

  ```powershell
  cd ~\Downloads
  (Get-FileHash .\suara-studio-0.1.0-win-x64-setup.exe -Algorithm SHA256).Hash
  ```

  Bandingkan hasilnya dengan baris berisi nama file yang sama di `SHA256SUMS.txt`. Perbedaan huruf
  besar dan kecil tidak berpengaruh.

- **macOS:**

  ```sh
  cd ~/Downloads
  shasum -a 256 suara-studio-0.1.0-mac-arm64.dmg
  ```

  Bandingkan hasilnya dengan baris berisi nama file yang sama di `SHA256SUMS.txt`.

- **Linux:** perintah ini langsung mencocokkan semua file rilis yang ada di folder:

  ```sh
  cd ~/Downloads
  sha256sum --check --ignore-missing SHA256SUMS.txt
  ```

  Tulisan `OK` di samping nama file berarti file tersebut asli.

Jika hasilnya tidak cocok, jangan pasang file itu. Hapus filenya, lalu unduh ulang.

## Izin mikrofon

Saat pertama kali menekan tombol **Rekam** (*Record*), sistem mungkin meminta izin memakai mikrofon.
Tampilan Suara Studio otomatis berbahasa Indonesia jika sistem Anda berbahasa Indonesia, dan
berbahasa Inggris jika tidak.

- **macOS:** pilih **Allow** atau **OK** saat macOS meminta akses mikrofon. Jika terlanjur menolak,
  buka **System Settings** → **Privacy & Security** → **Microphone**, lalu aktifkan
  **Suara Studio**.
- **Windows 11:** jika rekaman tidak bisa dimulai, buka **Settings** → **Privacy & security** →
  **Microphone**. Aktifkan **Microphone access** dan **Let desktop apps access your microphone**.
  Di Windows 10, menu ini ada di **Settings** → **Privacy** → **Microphone**.
- **Linux:** biasanya langsung bisa dipakai tanpa pengaturan tambahan.

Jika ada lebih dari satu mikrofon, pilih yang ingin dipakai dari daftar di ujung kanan toolbar
(yang berikon mikrofon).

## Memperbarui Suara Studio

Saat versi baru terbit, Suara Studio menampilkan pesan *"Suara Studio x.y.z sudah tersedia."*
dengan tombol **Lihat rilis**. Anda juga bisa memeriksanya sendiri lewat menu
**Bantuan** → **Periksa Pembaruan…** (di macOS: menu **Suara Studio** → **Periksa Pembaruan…**).

Untuk memperbarui, jalankan lagi perintah instalasi dari
[Cara 1](#cara-1-pasang-dengan-satu-perintah-disarankan), atau unduh installer versi baru dari
halaman rilis. Rekaman Anda tidak terpengaruh.

## Menghapus Suara Studio

- **Windows:** buka **Settings** → **Apps** → **Installed apps** (di Windows 10:
  **Apps & features**), cari **Suara Studio**, lalu pilih **Uninstall**. Bisa juga lewat
  PowerShell:

  ```powershell
  $env:SUARA_UNINSTALL = '1'; irm https://github.com/tenmaryut/suara-studio/releases/latest/download/install.ps1 | iex
  ```

- **macOS dan Linux:**

  ```sh
  curl -fsSL https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh -s -- --uninstall
  ```

  Di macOS, Anda juga bisa menyeret **Suara Studio** dari folder **Applications** ke Trash.

File rekaman yang sudah Anda simpan tidak ikut terhapus.

## Mengatasi masalah

**Muncul pesan `could not find a published release of Suara Studio`.**
Belum ada versi yang diterbitkan. Cek
[halaman rilis](https://github.com/tenmaryut/suara-studio/releases), lalu coba lagi setelah rilis
tersedia.

**Muncul pesan `checksum mismatch`.**
File yang terunduh tidak sama dengan yang diterbitkan, dan pemasangan dibatalkan demi keamanan.
Biasanya penyebabnya koneksi yang terputus atau proxy jaringan. Jalankan lagi perintahnya. Jika
tetap gagal, coba dari jaringan lain.

**Di Linux muncul `curl: command not found`.**
Pasang `curl` terlebih dahulu (`sudo apt install curl`), atau gunakan `wget`:

```sh
wget -qO- https://github.com/tenmaryut/suara-studio/releases/latest/download/install.sh | sh
```

**Di Windows muncul `Could not create SSL/TLS secure channel`.**
Ini terjadi di Windows lama yang belum diperbarui. Jalankan baris berikut, lalu ulangi perintah
instalasi di jendela PowerShell yang sama:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```

**Windows 11 memblokir Suara Studio dengan pesan dari Smart App Control.**
Smart App Control memblokir aplikasi yang belum ditandatangani secara digital, termasuk Suara Studio
saat ini, dan tidak bisa memberi pengecualian untuk satu aplikasi saja. Jika ingin tetap memakai
Suara Studio, matikan fitur ini di **Windows Security** → **App & browser control** →
**Smart App Control settings**. Sejak pembaruan Windows 11 bulan April 2026, fitur ini bisa
dinyalakan lagi kapan saja. Di Windows yang belum mendapat pembaruan itu, Smart App Control yang
sudah dimatikan hanya bisa dinyalakan lagi dengan memasang ulang Windows.

**Rekaman tidak bisa dimulai atau mikrofon tidak terdeteksi.**
Periksa [izin mikrofon](#izin-mikrofon), pastikan mikrofon sudah tersambung, lalu pilih mikrofon
yang benar dari daftar di toolbar. Jika mikrofon baru saja dicolokkan, tutup dan buka lagi
Suara Studio.

**macOS mengatakan aplikasinya rusak (*damaged*).**
Lihat perintah `xattr` di bagian [macOS (.dmg)](#macos-dmg).

**Masih bermasalah?**
Cari laporan serupa atau buat laporan baru di
[halaman Issues](https://github.com/tenmaryut/suara-studio/issues). Sebutkan sistem operasi, versi
Suara Studio, dan pesan error yang muncul. Untuk masalah keamanan, ikuti
[kebijakan keamanan](../SECURITY.md).
