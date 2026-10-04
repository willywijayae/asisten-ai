-- Optimasi pembacaan baris (D1 row read limit fix)
-- 1. competitor_ads: percepat query media & scoring, hilangkan full table scan
CREATE INDEX IF NOT EXISTS idx_competitor_ads_media_saved ON competitor_ads (media_saved, id);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_unscored ON competitor_ads (scored_at, first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_active_seen ON competitor_ads (active, first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_page_seen ON competitor_ads (page_id, first_seen DESC);

-- 2. ad_tags: percepat deteksi pemenang & filter angle
CREATE INDEX IF NOT EXISTS idx_ad_tags_winner ON ad_tags (winner, winner_at);

-- 3. tasks: percepat pengecekan pengingat per 5 menit
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks (status, reminded, remind_at, due_at);

-- 4. voc_snippets: percepat klasifikasi suara pelanggan
CREATE INDEX IF NOT EXISTS idx_voc_snippets_classified ON voc_snippets (classified_at, id);
