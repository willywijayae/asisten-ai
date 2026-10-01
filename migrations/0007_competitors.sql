-- Riset kompetitor dari Meta Ad Library (dipindai lewat konektor Meta di Claude).

-- Daftar pantauan: kata kunci atau halaman kompetitor yang rutin dipindai.
CREATE TABLE competitor_watch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                -- keyword | page
  value TEXT NOT NULL,               -- kata kunci, atau page_id
  label TEXT,                        -- nama halaman (untuk page)
  country TEXT NOT NULL DEFAULT 'ID',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, value, country)
);

CREATE TABLE competitor_ads (
  id TEXT PRIMARY KEY,               -- id iklan di Ad Library
  page_id TEXT,
  page_name TEXT,
  title TEXT,
  body TEXT,
  caption TEXT,
  snapshot_url TEXT,
  platforms TEXT,
  country TEXT,
  currency TEXT,
  query TEXT,                        -- kata kunci yang menemukannya
  started_at TEXT,                   -- mulai tayang
  stopped_at TEXT,                   -- berhenti tayang (kalau sudah)
  active INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Penilaian (Jev AI, atau tim AI sendiri kalau kredit Jev habis)
  angle TEXT,
  hook INTEGER,                      -- 0 lemah · 1 biasa · 2 kuat · 3 sangat kuat
  promo INTEGER,                     -- ada penawaran jelas (diskon/ongkir/COD/bonus)
  risky INTEGER,                     -- klaim berlebihan, rawan ditolak Meta
  confidence REAL,
  scored_by TEXT,                    -- jev | ai
  scored_at TEXT
);
CREATE INDEX competitor_ads_page ON competitor_ads (page_id);
CREATE INDEX competitor_ads_seen ON competitor_ads (last_seen);
CREATE INDEX competitor_ads_unscored ON competitor_ads (scored_at);

CREATE TABLE competitor_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,              -- claude | jadwal | manual
  query TEXT,
  country TEXT,
  found INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
