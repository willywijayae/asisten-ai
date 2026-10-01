-- Detail kreatif dari halaman Ad Library (lewat browser): media, CTA, landing page, duplikat, urutan impresi.
ALTER TABLE competitor_ads ADD COLUMN media TEXT;            -- JSON [{type, url, poster, key, poster_key, w, h}]
ALTER TABLE competitor_ads ADD COLUMN media_type TEXT;       -- video | image | carousel | text
ALTER TABLE competitor_ads ADD COLUMN media_saved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitor_ads ADD COLUMN link_url TEXT;
ALTER TABLE competitor_ads ADD COLUMN cta TEXT;
ALTER TABLE competitor_ads ADD COLUMN duplicates INTEGER;    -- jumlah iklan yang memakai kreatif & teks ini
ALTER TABLE competitor_ads ADD COLUMN impression_rank INTEGER; -- urutan di hasil pencarian (impresi terbanyak = 1)
ALTER TABLE competitor_ads ADD COLUMN video_duration TEXT;
ALTER TABLE competitor_ads ADD COLUMN page_avatar TEXT;

-- Laporan "bedah iklan kompetitor" (dibuat agen Riset atau dikirim Claude).
CREATE TABLE competitor_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  query TEXT,
  data TEXT NOT NULL,              -- JSON terstruktur (ringkasan, topik, pemenang, pola, peringatan, rencana)
  author TEXT NOT NULL,            -- riset | claude
  note_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
