-- ============================================================================
-- HTTP Tracker Pro - Database Schema
-- ============================================================================

-- Drop existing tables (for clean setup)
DROP TABLE IF EXISTS redirect_steps CASCADE;
DROP TABLE IF EXISTS redirect_chains CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS websites CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;

-- ============================================================================
-- ADMIN USERS
-- ============================================================================
CREATE TABLE admin_users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) DEFAULT 'Admin',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- WEBSITES (auto-created from captured requests)
-- ============================================================================
CREATE TABLE websites (
  id            SERIAL PRIMARY KEY,
  domain        VARCHAR(512) UNIQUE NOT NULL,
  display_name  VARCHAR(512),
  first_seen    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  request_count INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_websites_domain ON websites(domain);
CREATE INDEX idx_websites_last_seen ON websites(last_seen DESC);

-- ============================================================================
-- REQUESTS
-- ============================================================================
CREATE TABLE requests (
  id                SERIAL PRIMARY KEY,
  ext_request_id    VARCHAR(255),            -- ID from the extension
  website_id        INTEGER REFERENCES websites(id) ON DELETE CASCADE,
  tab_id            INTEGER,
  url               TEXT NOT NULL,
  method            VARCHAR(20) NOT NULL DEFAULT 'GET',
  status_code       INTEGER,
  status_line       VARCHAR(255),
  request_type      VARCHAR(50),             -- xmlhttprequest, fetch, document, etc.
  initiator         TEXT,
  
  -- Headers (stored as JSONB for flexible querying)
  request_headers   JSONB DEFAULT '{}',
  response_headers  JSONB DEFAULT '{}',
  
  -- Body
  request_body      TEXT,
  response_body     TEXT,
  
  -- Timing
  duration_ms       REAL,
  from_cache        BOOLEAN DEFAULT FALSE,
  response_size     INTEGER,
  
  -- Redirect info
  redirect_chain_id VARCHAR(255),
  redirect_from     TEXT,
  redirect_to       TEXT,
  
  -- Meta
  source            VARCHAR(50) DEFAULT 'webRequest',  -- webRequest, injected, devtools
  phase             VARCHAR(50),
  error             TEXT,
  
  -- Timestamps
  captured_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  request_time      TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_requests_website ON requests(website_id);
CREATE INDEX idx_requests_method ON requests(method);
CREATE INDEX idx_requests_status ON requests(status_code);
CREATE INDEX idx_requests_captured ON requests(captured_at DESC);
CREATE INDEX idx_requests_url ON requests USING gin(to_tsvector('english', url));
CREATE INDEX idx_requests_type ON requests(request_type);

-- ============================================================================
-- REDIRECT CHAINS
-- ============================================================================
CREATE TABLE redirect_chains (
  id            SERIAL PRIMARY KEY,
  chain_ext_id  VARCHAR(255),
  website_id    INTEGER REFERENCES websites(id) ON DELETE CASCADE,
  tab_id        INTEGER,
  step_count    INTEGER DEFAULT 0,
  final_url     TEXT,
  captured_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chains_website ON redirect_chains(website_id);

-- ============================================================================
-- REDIRECT STEPS
-- ============================================================================
CREATE TABLE redirect_steps (
  id              SERIAL PRIMARY KEY,
  chain_id        INTEGER REFERENCES redirect_chains(id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  redirect_type   VARCHAR(20) NOT NULL,      -- http, js, meta
  status_code     INTEGER,
  method          VARCHAR(50),               -- location.href, location.assign, etc.
  from_url        TEXT,
  to_url          TEXT,
  delay_seconds   REAL,                      -- for meta refresh
  captured_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_steps_chain ON redirect_steps(chain_id);

-- ============================================================================
-- RECORDINGS (automation recorder)
-- ============================================================================
CREATE TABLE IF NOT EXISTS recordings (
  id            SERIAL PRIMARY KEY,
  ext_id        VARCHAR(255) UNIQUE,
  name          VARCHAR(512) NOT NULL,
  actions       JSONB DEFAULT '[]',
  start_url     TEXT,
  action_count  INTEGER DEFAULT 0,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Website summary with counts
CREATE OR REPLACE VIEW website_summary AS
SELECT 
  w.id,
  w.domain,
  w.display_name,
  w.first_seen,
  w.last_seen,
  w.notes,
  w.is_active,
  COUNT(r.id) as total_requests,
  COUNT(CASE WHEN r.method = 'GET' THEN 1 END) as get_count,
  COUNT(CASE WHEN r.method = 'POST' THEN 1 END) as post_count,
  COUNT(CASE WHEN r.status_code >= 400 THEN 1 END) as error_count,
  COUNT(DISTINCT r.redirect_chain_id) as redirect_count
FROM websites w
LEFT JOIN requests r ON r.website_id = w.id
GROUP BY w.id
ORDER BY w.last_seen DESC;
