-- Bullets table: stores atomic knowledge units
CREATE TABLE bullets (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT 'universal',
  helpful INTEGER NOT NULL DEFAULT 0,
  harmful INTEGER NOT NULL DEFAULT 0,
  verified_agents INTEGER NOT NULL DEFAULT 0,
  global_score REAL NOT NULL DEFAULT 0.0,
  source_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deprecated INTEGER NOT NULL DEFAULT 0
);

-- Per-agent vote tracking (prevent double-counting)
CREATE TABLE bullet_votes (
  bullet_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  helpful_total INTEGER NOT NULL DEFAULT 0,
  harmful_total INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bullet_id, agent_id),
  FOREIGN KEY (bullet_id) REFERENCES bullets(id) ON DELETE CASCADE
);

CREATE INDEX idx_bullets_scope ON bullets(scope);
CREATE INDEX idx_bullets_section ON bullets(section);
CREATE INDEX idx_bullets_global_score ON bullets(global_score DESC);
CREATE INDEX idx_bullets_deprecated ON bullets(deprecated);
