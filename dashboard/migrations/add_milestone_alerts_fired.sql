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

-- RLS: engine writes via anon key; dashboard reads for debugging.
ALTER TABLE milestone_alerts_fired ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON milestone_alerts_fired FOR ALL USING (true) WITH CHECK (true);
