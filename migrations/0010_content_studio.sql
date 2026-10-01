-- Studio Konten: avatar → produk → storyboard → hasil video (ChatGPT/Sora atau Grok Imagine).
-- Tiap tahap disimpan sebagai JSON terstruktur yang divalidasi & disetujui sebelum lanjut (pola Archify).
CREATE TABLE content_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brief TEXT,                         -- permintaan awal pemilik
  stage TEXT NOT NULL DEFAULT 'avatar', -- avatar | produk | storyboard | hasil
  avatar TEXT,                        -- JSON {customer, character}
  product TEXT,                       -- JSON {input, angle, hooks, …}
  storyboard TEXT,                    -- JSON {duration, scenes, caption, …}
  approved TEXT,                      -- JSON {avatar?: iso, produk?: iso, storyboard?: iso}
  provider TEXT,                      -- chatgpt | grok
  source_ad_id TEXT,                  -- iklan kompetitor acuan (opsional)
  busy TEXT,                          -- tahap yang sedang dikerjakan AI; NULL = siap
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Satu klip video per adegan storyboard.
CREATE TABLE content_clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  scene_no INTEGER NOT NULL,
  provider TEXT NOT NULL,             -- chatgpt | grok
  seconds INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prompt', -- prompt | rendering | done | failed | uploaded
  job_id TEXT,                        -- id pekerjaan di OpenAI/xAI (mode API)
  media_key TEXT,                     -- video hasil di KV MEDIA
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, scene_no, provider)
);
CREATE INDEX content_clips_project ON content_clips (project_id);
