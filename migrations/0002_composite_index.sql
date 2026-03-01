-- Composite index for the primary fetch query pattern
CREATE INDEX idx_bullets_active_score ON bullets(deprecated, global_score DESC);
