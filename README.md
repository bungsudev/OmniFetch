# ⚡ OmniFetch Pro

🌍 **Language Options / Pilihan Bahasa:** 
- [🇬🇧 English](#english)
- [🇮🇩 Bahasa Indonesia](#bahasa-indonesia)

---

<br>

<h1 id="english">🇬🇧 English</h1>

OmniFetch Pro (formerly HTTP Tracker Pro) is a powerful, developer-focused Chrome Extension and Node.js Backend system designed to intercept, log, and visualize **ALL HTTP requests and redirect chains** directly from your browser.

Unlike standard DevTools, OmniFetch captures low-level navigation redirects, JavaScript-based redirects (`location.assign()`), and hidden `fetch`/`XHR` payloads, automatically syncing them to a persistent PostgreSQL database for analysis.

![Dashoard Overview](server/public/icons/dashboard_preview.png) *(UI preview concept)*

## 🔥 Key Features

### 📡 Advanced Network Interception
- **Full Scope Tracking:** Captures `GET`, `POST`, `PUT`, `DELETE` requests.
- **Deep Payload Extraction:** Inspects Request Bodies, Headers, Response Bodies, and Status Codes.
- **Bypass Limitations:** Patches the `fetch` and `XMLHttpRequest` globals securely in the page context to log data without breaking target sites.

### 🔗 Ultimate Redirect Tracer
- Tracks standard HTTP Server Redirects (301, 302, 307, 308).
- Tracks stealthy JavaScript Redirects (`window.location` changes, `history.pushState`).
- Tracks HTML Meta Refresh Redirects.
- Visualizes the entire chain from the initial click to the final destination URL.

### 🏢 Powerful Admin Backend
- **Data Persistence:** Automatically groups requests by website/domain into a PostgreSQL database.
- **Premium Dashboard:** Secure, JWT-authenticated dark-themed UI to browse, filter, and inspect your captured data.
- **Bulk Export:** Export filtered network logs as **Postman Collections**, RAW **JSON**, or executable **cURL** shell scripts.

## 🏗️ Architecture

1. **`/extension` (Manifest V3):** Uses a Background Service Worker to capture raw `chrome.webRequest` events, alongside an injected script to monkey-patch `fetch`/`XHR` in the DOM. Batches and pushes data to the backend every 2 seconds.
2. **`/server` (Node.js + Express + PostgreSQL):** Handles auth, ingests extension data, manages the relational database, and serves the Admin Dashboard SPA.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL running locally on port 5432
- Google Chrome

### 1. Start the Backend Server

```bash
cd server
npm install
node server.js
```
*The server will create a default database named `http_tracker` and apply the schema automatically.*

### 2. Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right corner).
3. Click **"Load unpacked"**.
4. Select the `/extension` folder from this repository.
5. The OmniFetch extension (⚡ icon) will appear in your browser toolbar.

## 💡 How to Use

- **Capturing Traffic:** Click the extension icon and ensure tracking is ON. Browse any website.
- **Analyzing Data:** Open **http://localhost:3847**. Login with `admin@tracker.local` / `admin123`.
- **Exporting Data:** Go to **All Requests** in the dashboard to export your data as Postman Collections, RAW JSON, or cURL shell scripts.

## 🔐 Environment Variables (`server/.env`)

Copy the provided `server/.env.example` file to create your own `server/.env` file:

```ini
PORT=3847
DATABASE_URL=postgresql://USERNAME:PASSWORD@localhost:5432/http_tracker
API_KEY=your_secure_api_key_here
JWT_SECRET=your_super_secret_jwt_string
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure_password_123
```
> **Note:** If you change the `API_KEY`, ensure you also update it in `extension/background.js`.

---

<br><br><br>

<h1 id="bahasa-indonesia">🇮🇩 Bahasa Indonesia</h1>

OmniFetch Pro (sebelumnya HTTP Tracker Pro) adalah Chrome Extension dan Node.js Backend yang ditujukan bagi developer untuk meng-*intercept*, mencatat, dan memvisualisasikan **SEMUA request HTTP beserta rantai *redirect*** langsung dari browser.

Di luar batasan DevTools Chrome standar, OmniFetch mampu menangkap *redirect* navigasi tingkat rendah, *redirect* dari eksekusi JavaScript (`location.assign()`), serta *payload* tersembunyi dari `fetch`/`XHR`, dan secara otomatis melakukan sinkronisasi dengan database PostgreSQL secara permanen.

## 🔥 Fitur Utama

### 📡 Intersepsi Jaringan Tingkat Lanjut
- **Pelacakan Menyeluruh:** Menangkap request `GET`, `POST`, `PUT`, `DELETE`.
- **Ekstraksi Payload Mendalam:** Memeriksa Request Body, Header, Response Body, dan Kode Status.
- **Bypass Keterbatasan:** Me-patch global object `fetch` dan `XMLHttpRequest` secara aman langsung dari *page context* tanpa merusak website target.

### 🔗 Pelacak URL Redirect Tangguh
- Melacak standar Server HTTP Redirect (301, 302, 307, 308).
- Melacak JavaScript Redirect yang tersembunyi (perubahan `window.location`, `history.pushState`).
- Melacak HTML Meta Refresh Redirect.
- Visualisasi rantai utuh dari klik pertama hingga URL tujuan akhir.

### 🏢 Admin Backend Bertenaga
- **Penyimpanan Permanen:** Secara otomatis mengelompokkan *request* berdasarkan domain website di PostgreSQL.
- **Dashboard Premium:** Aman dengan otentikasi JWT, antarmuka bernuansa gelap (dark-mode) untuk browsing, *filtering*, dan inspeksi data tangkapan.
- **Bulk Export:** Export log *network* menjadi **Postman Collection**, RAW **JSON**, atau eksekusi *script* shell **cURL**.

## 🏗️ Arsitektur

1. **`/extension` (Manifest V3):** Menggunakan Background Service Worker untuk menangkap *event* mental dari `chrome.webRequest`, serta menyuntikkan script untuk monkey-patch `fetch`/`XHR` murni dari sisi DOM. Melakukan batch dan *push* data ke backend setiap 2 detik.
2. **`/server` (Node.js + Express + PostgreSQL):** Mengatur auth, menyimpan data yang dilempar dari extension, mengelola database relasional, dan menyajikan SPA Admin Dashboard.

## 🚀 Cara Menjalankan

### Kebutuhan Awal
- Node.js (v18+)
- PostgreSQL berjalan (running) secara lokal pada port 5432
- Google Chrome Browser

### 1. Jalankan Backend Server

```bash
cd server
npm install
node server.js
```
*Server akan membuat database default bernama `http_tracker` dan menginisialisasi tabel-tabelnya secara otomatis.*

### 2. Install Chrome Extension

1. Buka Chrome lalu ketik `chrome://extensions/`
2. Aktifkan fitur **Developer mode** (di sudut kanan atas).
3. Klik tombol **"Load unpacked"**.
4. Pilih folder `/extension` dari repositori proyek ini.
5. Extension OmniFetch (icon ⚡) akan muncul di toolbar browsermu.

## 💡 Cara Penggunaan

- **Menangkap Traffic:** Klik icon extension dan pastikan status *tracking* bernilai ON. Lakukan *browsing* di website manapun.
- **Analisis Data:** Akses dashboard di **http://localhost:3847**. Login menggunakan `admin@tracker.local` / `admin123`.
- **Mengekspor Data:** Masuk ke halaman **All Requests** di dashboard untuk meng-export data sebagai Postman Collection, RAW JSON, maupun *shell script* cURL.

## 🔐 Environment Variables (`server/.env`)

Salin file `server/.env.example` yang disediakan untuk membuat konfigurasi aslimu:

```ini
PORT=3847
DATABASE_URL=postgresql://USERNAME:PASSWORD@localhost:5432/http_tracker
API_KEY=your_secure_api_key_here
JWT_SECRET=your_super_secret_jwt_string
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure_password_123
```
> **Catatan:** Jika mengubah `API_KEY`, pastikan juga memperbaruinya pada `extension/background.js`.

---
## 📜 License
MIT License - Free to use and modify.
