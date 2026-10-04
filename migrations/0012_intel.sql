-- Intelijen Kreatif: iklan kompetitor + iklan sendiri + suara pelanggan → brief mingguan.
-- Taksonomi (angle, hook, format, offer) disamakan lintas sumber agar bisa dibandingkan langsung.

-- Produk yang dilayani + kata kunci pencocokan (dipakai untuk memetakan iklan/VOC ke produk).
CREATE TABLE intel_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  keywords TEXT NOT NULL,             -- dipisah koma, huruf kecil
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO intel_products (name, keywords) VALUES ('Erojan', 'erojan'), ('Coffiy', 'coffiy'), ('DVN', 'dvn');

-- Tag AI per iklan kompetitor (di-cache per ad_id; iklan dengan copy identik memakai ulang tag via content_hash).
CREATE TABLE ad_tags (
  ad_id TEXT PRIMARY KEY,
  product TEXT,
  angle TEXT,
  hook_type TEXT,
  format TEXT,
  offer TEXT,
  emotion TEXT,
  claim_risk TEXT,
  winner INTEGER NOT NULL DEFAULT 0,
  winner_at TEXT,
  content_hash TEXT,
  tagged_by TEXT NOT NULL,            -- ai | salin | kosong
  tagged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ad_tags_hash ON ad_tags (content_hash);
CREATE INDEX ad_tags_angle ON ad_tags (product, angle);

-- Iklan sendiri (diimpor dari Meta Ads API / Motion lewat endpoint ingest atau halaman).
CREATE TABLE own_ads (
  ad_id TEXT PRIMARY KEY,
  name TEXT,
  product TEXT,
  angle TEXT,
  hook_id INTEGER,
  status TEXT,                        -- active | paused | rejected | ...
  spend REAL,
  impressions INTEGER,
  ctr REAL,                           -- persen
  cpa REAL,
  roas REAL,
  frequency REAL,
  prev_ctr REAL,
  prev_frequency REAL,
  prev_at TEXT,                       -- kapan snapshot prev_* diambil (dirotasi tiap ±6 hari)
  verdict TEXT,                       -- menang | kalah | netral (hasil feedback loop)
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX own_ads_product ON own_ads (product, status);

-- Suara pelanggan (chat closing, CRM, review). Teks sudah dianonimkan sebelum disimpan.
CREATE TABLE voc_snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,               -- chat | crm | review
  product TEXT,
  quote TEXT NOT NULL,
  category TEXT,                      -- keberatan | alasan_beli | bahasa_pelanggan
  angle TEXT,
  quote_hash TEXT NOT NULL UNIQUE,
  occurred_on TEXT,
  classified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX voc_product ON voc_snippets (product, angle);

-- Status angle per produk: belum | teruji | gagal (diisi feedback loop dari hasil tes iklan sendiri).
CREATE TABLE intel_angles (
  product TEXT NOT NULL,
  angle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'belum',
  evidence TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (product, angle)
);

CREATE TABLE hook_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  angle TEXT,
  product TEXT,
  source TEXT NOT NULL,               -- kompetitor | voc | ai | manual
  status TEXT NOT NULL DEFAULT 'baru', -- baru | dipakai | menang | kalah
  own_ad_id TEXT,                     -- iklan sendiri yang memakai hook ini
  result TEXT,                        -- JSON ringkasan hasil tes
  brief_id INTEGER,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX hook_bank_filter ON hook_bank (product, angle, status);

CREATE TABLE intel_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL,                 -- tanggal pembuatan (lokal)
  product TEXT NOT NULL,
  data TEXT NOT NULL,                 -- JSON brief
  done TEXT NOT NULL DEFAULT '[]',    -- JSON daftar kunci item yang sudah dieksekusi tim
  sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE policy_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT,
  creative TEXT NOT NULL,
  decision TEXT NOT NULL,             -- lolos | revisi | tolak
  risk TEXT NOT NULL,                 -- rendah | sedang | tinggi
  reasons TEXT,                       -- JSON array
  suggestion TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE intel_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL UNIQUE,     -- dedup: jenis + objek + tanggal
  kind TEXT NOT NULL,                 -- winner | burst | offer | fatigue | policy
  title TEXT NOT NULL,
  detail TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Log biaya token per modul (estimasi karakter/4) untuk menghitung biaya token per insight.
CREATE TABLE intel_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  model TEXT,
  tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX intel_costs_module ON intel_costs (module, created_at);
