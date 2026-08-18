BEGIN;
CREATE SCHEMA IF NOT EXISTS forgeai;
CREATE TABLE IF NOT EXISTS forgeai.runs (
  run_id uuid PRIMARY KEY,
  task_id text NOT NULL,
  task_hash text NOT NULL CHECK (task_hash ~ '^[0-9a-f]{64}$'),
  base_commit text NOT NULL,
  final_commit text,
  orchestrator text NOT NULL,
  harness text NOT NULL,
  model text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('CONSULT','AUDIT','REVIEW','EXECUTE')),
  risk text NOT NULL CHECK (risk IN ('R0','R1','R2','R3')),
  verdict text NOT NULL CHECK (verdict IN ('PASS','BLOCKED','RUNNING')),
  cost_usd numeric(18,8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  evidence_hash text CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS forgeai.gates (
  run_id uuid NOT NULL REFERENCES forgeai.runs(run_id) ON DELETE CASCADE,
  gate_id text NOT NULL,
  category text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS','FAIL','SKIPPED','BLOCKED')),
  command_hash text,
  stdout_hash text,
  stderr_hash text,
  duration_ms bigint NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, gate_id)
);
CREATE TABLE IF NOT EXISTS forgeai.findings (
  run_id uuid NOT NULL REFERENCES forgeai.runs(run_id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  status text NOT NULL CHECK (status IN ('OPEN','RESOLVED','ACCEPTED_RISK','REJECTED')),
  code text NOT NULL,
  path text,
  evidence_hash text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, finding_id)
);
CREATE INDEX IF NOT EXISTS runs_task_time_idx ON forgeai.runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_model_harness_idx ON forgeai.runs(model, harness, started_at DESC);
CREATE INDEX IF NOT EXISTS findings_open_severity_idx ON forgeai.findings(severity, recorded_at DESC) WHERE status = 'OPEN';
COMMIT;
