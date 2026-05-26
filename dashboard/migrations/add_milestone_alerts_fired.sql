-- Tracks which milestone view thresholds have already fired for each post,
-- so the engine only alerts once per post per threshold crossing.
CREATE TABLE IF NOT EXISTS milestone_alerts_fired (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    text NOT NULL,
  threshold  integer NOT NULL,
  views_at_fire integer NOT NULL DEFAULT 0,
  fired_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, threshold)
);

-- RLS: engine writes via anon key (append-only); dashboard reads for debugging.
ALTER TABLE milestone_alerts_fired ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON milestone_alerts_fired FOR SELECT USING (true);
CREATE POLICY "anon_insert" ON milestone_alerts_fired FOR INSERT WITH CHECK (true);
