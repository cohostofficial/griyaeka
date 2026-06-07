# Absensi App

Aplikasi absensi karyawan berbasis web dengan GPS dan selfie, dibangun dengan Next.js + Supabase.

## Fitur

- **Karyawan**: Absen masuk/pulang dengan validasi GPS + foto selfie via mobile browser
- **Admin**: Dashboard real-time, kelola karyawan & lokasi, laporan absensi, hitung gaji otomatis
- **Export**: Laporan Excel untuk absensi dan penggajian
- **PWA**: Bisa diinstall di HP seperti aplikasi native

---

## Struktur Project

```
absensi-app/
├── src/
│   ├── app/
│   │   ├── login/                  # Halaman login
│   │   ├── employee/
│   │   │   └── dashboard/          # Halaman absen karyawan
│   │   ├── admin/
│   │   │   ├── layout.tsx          # Layout sidebar admin
│   │   │   ├── dashboard/          # Dashboard admin
│   │   │   ├── employees/          # Kelola karyawan
│   │   │   ├── locations/          # Kelola lokasi GPS
│   │   │   ├── reports/            # Laporan absensi + export
│   │   │   └── payroll/            # Penggajian + export
│   │   └── api/
│   │       ├── users/              # API buat user baru
│   │       └── auth/callback/      # Auth callback Supabase
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Supabase browser client
│   │   │   └── server.ts           # Supabase server client
│   │   └── gps.ts                  # Utilitas GPS (Haversine)
│   └── middleware.ts               # Auth middleware
├── public/
│   └── manifest.json               # PWA manifest
└── supabase-schema.sql             # SQL schema lengkap
```

---

## Setup Step-by-Step

### 1. Supabase

1. Buka [supabase.com](https://supabase.com) → New Project
2. Buka **SQL Editor** → paste seluruh isi `supabase-schema.sql` → Run
3. Buka **Project Settings → API** → catat:
   - `Project URL`
   - `anon public` key
   - `service_role` key (jangan share ini!)
4. Buka **Authentication → Settings**:
   - Matikan "Email confirmation" jika ingin login langsung tanpa verifikasi email
   - Atau biarkan aktif dan konfirmasi email saat membuat akun

### 2. Buat Akun Admin Pertama

Di Supabase **SQL Editor**, jalankan perintah ini setelah setup schema:

```sql
-- Ganti dengan email dan password yang Anda inginkan
-- Pertama buat user lewat Authentication > Users > Add User
-- Lalu insert ke tabel users:
INSERT INTO public.users (id, name, email, role)
VALUES (
  '<user_id_dari_supabase_auth>',
  'Admin Utama',
  'admin@email.com',
  'admin'
);
```

Cara mudah: Buka **Authentication → Users → Add User**, buat user admin, copy UUID-nya, lalu jalankan INSERT di atas.

### 3. Install & Konfigurasi

```bash
# Clone atau extract project
cd absensi-app

# Install dependencies
npm install

# Copy file env
cp .env.local.example .env.local

# Edit .env.local dengan nilai dari Supabase
nano .env.local
```

Isi `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

### 4. Jalankan Lokal

```bash
npm run dev
```

Buka http://localhost:3000 — login dengan akun admin yang sudah dibuat.

### 5. Deploy ke Vercel

```bash
# Install Vercel CLI (opsional)
npm i -g vercel

# Deploy
vercel
```

**Atau via GitHub:**
1. Push project ke GitHub
2. Buka [vercel.com](https://vercel.com) → New Project → Import repo
3. Tambah Environment Variables (sama seperti .env.local)
4. Deploy!

### 6. Setup Supabase untuk Production

Di Supabase **Authentication → URL Configuration**:
- Site URL: `https://nama-project.vercel.app`
- Redirect URLs: `https://nama-project.vercel.app/**`

---

## Cara Penggunaan

### Admin
1. Login di desktop atau mobile
2. **Karyawan** → Tambah karyawan baru (masukkan nama, email, password, tarif/jam)
3. **Lokasi** → Tambah lokasi kantor (klik "Gunakan Lokasi Saya" untuk auto-isi koordinat GPS)
4. **Laporan** → Pilih bulan & karyawan → Tampilkan → Export Excel
5. **Penggajian** → Pilih bulan → Hitung Gaji → Finalisasi → Export Excel

### Karyawan
1. Buka URL aplikasi di HP (bisa add to homescreen)
2. Login dengan akun yang diberikan admin
3. Klik **Absen Masuk** → izinkan GPS → izinkan kamera → foto selfie → kirim
4. Klik **Absen Pulang** saat selesai bekerja

---

## Catatan Teknis

- GPS menggunakan Haversine formula untuk hitung jarak ke lokasi kantor
- Foto selfie disimpan di Supabase Storage bucket `selfies`
- Total jam dihitung otomatis via database trigger PostgreSQL
- Status `late` jika check-in setelah jam 09:00 (bisa diubah di `employee/dashboard/page.tsx`)
- Row Level Security (RLS) aktif — karyawan hanya bisa lihat data sendiri

---

## Kustomisasi

| Yang ingin diubah | File |
|---|---|
| Jam batas terlambat | `src/app/employee/dashboard/page.tsx` → cari `getHours() >= 9` |
| Warna tema | `tailwind.config.js` |
| Kolom laporan Excel | `src/app/admin/reports/page.tsx` → fungsi `exportExcel()` |
| Logika hitung gaji | `src/app/admin/payroll/page.tsx` → fungsi `generatePayroll()` |
