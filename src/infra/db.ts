import { Pool, PoolClient } from 'pg';

function validateDatabaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error('DATABASE_URL is required. Copy the PostgreSQL connection string from Supabase into .env.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection string.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://.');
  }
  const host = url.hostname.toLowerCase();
  const placeholders = new Set(['host', 'your-host', 'localhost-placeholder', 'example.com']);
  if (placeholders.has(host) || host.includes('your-host') || host.includes('your_host')) {
    throw new Error('DATABASE_URL still contains a placeholder host. Replace HOST with the real Supabase PostgreSQL host.');
  }
  if (!url.username || !url.password) {
    throw new Error('DATABASE_URL must include the PostgreSQL username and password.');
  }
  return raw;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
});

export async function withTransaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}

export async function migrate(){
  validateDatabaseUrl(process.env.DATABASE_URL);
  if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) throw new Error('JWT_SECRET must be at least 32 characters');
  if(!process.env.HORUS_BOOTSTRAP_TOKEN || process.env.HORUS_BOOTSTRAP_TOKEN.length<32) throw new Error('HORUS_BOOTSTRAP_TOKEN must be at least 32 characters');

  const sql=[export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
});

export async function withTransaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}

export async function migrate(){
  validateDatabaseUrl(process.env.DATABASE_URL);
  if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) throw new Error('JWT_SECRET must be at least 32 characters');
  if(!process.env.HORUS_BOOTSTRAP_TOKEN || process.env.HORUS_BOOTSTRAP_TOKEN.length<32) throw new Error('HORUS_BOOTSTRAP_TOKEN must be at least 32 characters');
  const sql=[
    "CREATE TABLE IF NOT EXISTS tenants(id text PRIMARY KEY,name text NOT NULL,status text NOT NULL DEFAULT 'active',created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text NOT NULL UNIQUE,name text,created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS memberships(tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,role text NOT NULL,permissions jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,user_id))",
    "CREATE TABLE IF NOT EXISTS entity_nodes(tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,id text NOT NULL,type text NOT NULL,label text,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,id))",
    "CREATE TABLE IF NOT EXISTS entity_relationships(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,from_entity_id text NOT NULL,to_entity_id text NOT NULL,relation_type text NOT NULL,strength double precision NOT NULL CHECK(strength>=0 AND strength<=1),valid_from timestamptz,valid_to timestamptz,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(from_entity_id<>to_entity_id))",
    "CREATE TABLE IF NOT EXISTS signals(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,type text NOT NULL,severity text NOT NULL,source text NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,entity_ids text[] NOT NULL DEFAULT '{}',lat double precision,lon double precision,occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS pattern_candidates(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,name text NOT NULL,sequence text[] NOT NULL,support double precision NOT NULL,occurrences integer NOT NULL,consistency double precision NOT NULL,candidate_score double precision NOT NULL,preferred_window_ms bigint NOT NULL,max_window_ms bigint NOT NULL,evidence jsonb NOT NULL DEFAULT '[]'::jsonb,status text NOT NULL DEFAULT 'pending',review_notes text,reviewed_by text,reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS predictive_signals(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,target_type text NOT NULL,target_value text NOT NULL,horizon_ms bigint NOT NULL,score double precision NOT NULL,confidence double precision NOT NULL,severity text NOT NULL,factors jsonb NOT NULL DEFAULT '[]'::jsonb,algorithm_version text NOT NULL,generated_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,target_type,target_value,horizon_ms,generated_at,algorithm_version))",
    "CREATE TABLE IF NOT EXISTS learning_anomalies(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,signal_type text NOT NULL,bucket_start timestamptz NOT NULL,observed_count integer NOT NULL,baseline_median double precision NOT NULL,baseline_mad double precision NOT NULL,anomaly_score double precision NOT NULL,severity text NOT NULL,reason text NOT NULL,algorithm_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,signal_type,bucket_start,algorithm_version))",
    "CREATE TABLE IF NOT EXISTS pattern_definitions(id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,name text NOT NULL,version integer NOT NULL,sequence text[] NOT NULL,min_window_ms bigint NOT NULL,preferred_window_ms bigint NOT NULL,max_window_ms bigint NOT NULL,weights jsonb NOT NULL DEFAULT '{}'::jsonb,geo jsonb NOT NULL DEFAULT '{}'::jsonb,min_confidence double precision NOT NULL DEFAULT 0,enabled boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id,version))",
    "CREATE TABLE IF NOT EXISTS correlations(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,score double precision NOT NULL,confidence double precision NOT NULL,severity text NOT NULL,signal_ids uuid[] NOT NULL,pattern_id text,pattern_version integer,algorithm_version text,reasons jsonb NOT NULL DEFAULT '[]'::jsonb,explanation jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS correlation_factors(id bigserial PRIMARY KEY,correlation_id uuid NOT NULL REFERENCES correlations(id) ON DELETE CASCADE,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,factor_type text NOT NULL,weight double precision NOT NULL,evidence text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS cases(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'open',severity text NOT NULL,correlation_id uuid REFERENCES correlations(id),title text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,version integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS rules(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,name text NOT NULL,enabled boolean NOT NULL DEFAULT true,definition jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS incident_risk_current(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,score double precision NOT NULL,severity text NOT NULL,reasons jsonb NOT NULL DEFAULT '[]'::jsonb,version integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,case_id))",
    "CREATE TABLE IF NOT EXISTS risk_assessments(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,resource_type text NOT NULL,resource_id text NOT NULL,score double precision NOT NULL,severity text NOT NULL,reasons jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS alerts(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,case_id uuid REFERENCES cases(id),channel text NOT NULL,status text NOT NULL DEFAULT 'pending',payload jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE UNIQUE INDEX IF NOT EXISTS alerts_tenant_case_channel_uq ON alerts(tenant_id,case_id,channel)",
    "CREATE TABLE IF NOT EXISTS outbox_events(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,aggregate_type text NOT NULL,aggregate_id uuid NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,status text NOT NULL DEFAULT 'pending',available_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,last_error text)",
    "CREATE TABLE IF NOT EXISTS alert_deliveries(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,channel text NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),provider_message_id text,last_error text,created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,UNIQUE(tenant_id,alert_id,channel))",
    "CREATE TABLE IF NOT EXISTS semantic_fingerprints(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,signal_id uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,signal_id))",
    "CREATE TABLE IF NOT EXISTS dead_letters(id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,source_type text NOT NULL,source_id uuid NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,reason text NOT NULL,attempts integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reprocessed_at timestamptz)",
    "CREATE TABLE IF NOT EXISTS idempotency_keys(tenant_id text NOT NULL,key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,key))",
    "CREATE TABLE IF NOT EXISTS audit_events(sequence bigserial PRIMARY KEY,tenant_id text NOT NULL,actor_id text,action text NOT NULL,resource_type text NOT NULL,resource_id text,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,previous_hash text,hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())"
  ];
  for(const statement of sql) await pool.query(statement);

  // Pattern learning is a governed lifecycle. Existing deployments are validated
  // before constraints are introduced; invalid legacy data fails loudly.
  const patternGovernance = [
    "CREATE UNIQUE INDEX IF NOT EXISTS pattern_candidates_tenant_id_uq ON pattern_candidates(tenant_id,id)",
    `ALTER TABLE pattern_definitions ADD COLUMN IF NOT EXISTS origin_candidate_id uuid`,
    `ALTER TABLE pattern_definitions ADD COLUMN IF NOT EXISTS activated_by text`,
    `ALTER TABLE pattern_definitions ADD COLUMN IF NOT EXISTS activated_at timestamptz`,
    `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pattern_candidates
          WHERE status NOT IN ('pending','review','approved','rejected','promoted')
        ) THEN
          RAISE EXCEPTION 'pattern_candidates contains invalid status values';
        END IF;
        ALTER TABLE pattern_candidates
          ADD CONSTRAINT pattern_candidates_status_check
          CHECK (status IN ('pending','review','approved','rejected','promoted'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pattern_candidates pc
          LEFT JOIN memberships m
            ON m.tenant_id=pc.tenant_id AND m.user_id=pc.reviewed_by
          WHERE pc.reviewed_by IS NOT NULL AND m.user_id IS NULL
        ) THEN
          RAISE EXCEPTION 'pattern_candidates contains reviewer references outside the tenant membership';
        END IF;
        ALTER TABLE pattern_candidates
          ADD CONSTRAINT pattern_candidates_reviewer_tenant_fk
          FOREIGN KEY (tenant_id,reviewed_by) REFERENCES memberships(tenant_id,user_id);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pattern_definitions
          GROUP BY tenant_id,name,version
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'pattern_definitions contains duplicate tenant/name/version rows';
        END IF;
        CREATE UNIQUE INDEX IF NOT EXISTS pattern_definitions_tenant_name_version_uq
          ON pattern_definitions(tenant_id,name,version);
      END $$`,
    `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pattern_definitions
          WHERE enabled=true
          GROUP BY tenant_id,name
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'pattern_definitions contains multiple active versions for the same tenant/name';
        END IF;
        CREATE UNIQUE INDEX IF NOT EXISTS pattern_definitions_one_active_name_uq
          ON pattern_definitions(tenant_id,name) WHERE enabled=true;
      END $$`,
  ];
  for(const statement of patternGovernance) await pool.query(statement);
  await pool.query('ALTER TABLE pattern_definitions ALTER COLUMN enabled SET DEFAULT false');
  const patternLineage = [
    `DO $$
      BEGIN
        ALTER TABLE pattern_definitions
          ADD CONSTRAINT pattern_definitions_origin_candidate_tenant_fk
          FOREIGN KEY (tenant_id,origin_candidate_id) REFERENCES pattern_candidates(tenant_id,id);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$
      BEGIN
        ALTER TABLE pattern_definitions
          ADD CONSTRAINT pattern_definitions_activated_by_tenant_fk
          FOREIGN KEY (tenant_id,activated_by) REFERENCES memberships(tenant_id,user_id);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];
  for(const statement of patternLineage) await pool.query(statement);
  // Operational immutability: once a pattern version is active, its semantic definition becomes an auditable artifact.
  const patternImmutability = [
    `CREATE OR REPLACE FUNCTION prevent_active_pattern_mutation()
      RETURNS trigger AS $func$
      BEGIN
        IF OLD.enabled = true AND (
          NEW.name IS DISTINCT FROM OLD.name OR NEW.version IS DISTINCT FROM OLD.version OR
          NEW.sequence IS DISTINCT FROM OLD.sequence OR NEW.min_window_ms IS DISTINCT FROM OLD.min_window_ms OR
          NEW.preferred_window_ms IS DISTINCT FROM OLD.preferred_window_ms OR NEW.max_window_ms IS DISTINCT FROM OLD.max_window_ms OR
          NEW.weights IS DISTINCT FROM OLD.weights OR NEW.geo IS DISTINCT FROM OLD.geo OR
          NEW.min_confidence IS DISTINCT FROM OLD.min_confidence OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
          NEW.origin_candidate_id IS DISTINCT FROM OLD.origin_candidate_id
        ) THEN
          RAISE EXCEPTION 'active pattern definitions are immutable; create a new version';
        END IF;
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql`,
    `CREATE OR REPLACE FUNCTION prevent_active_pattern_delete()
      RETURNS trigger AS $func$
      BEGIN
        IF OLD.enabled = true THEN
          RAISE EXCEPTION 'active pattern definitions cannot be deleted; activate a new version instead';
        END IF;
        RETURN OLD;
      END;
      $func$ LANGUAGE plpgsql`,
    `CREATE OR REPLACE FUNCTION prevent_direct_pattern_activation()
      RETURNS trigger AS $func$
      BEGIN
        IF NEW.enabled = true THEN
          RAISE EXCEPTION 'pattern definitions must be activated through the governed activation flow';
        END IF;
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql`,
    `CREATE OR REPLACE FUNCTION guard_pattern_activation()
      RETURNS trigger AS $func$
      BEGIN
        IF NEW.enabled = true AND OLD.enabled = false
          AND current_setting('sentinel.pattern_activation', true) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'pattern activation requires the governed activation transaction';
        END IF;
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS pattern_definitions_activation_guard_trg ON pattern_definitions`,
    `CREATE TRIGGER pattern_definitions_activation_guard_trg BEFORE UPDATE ON pattern_definitions FOR EACH ROW EXECUTE FUNCTION guard_pattern_activation()`,
    `DROP TRIGGER IF EXISTS pattern_definitions_active_immutability_trg ON pattern_definitions`,
    `CREATE TRIGGER pattern_definitions_active_immutability_trg BEFORE UPDATE ON pattern_definitions FOR EACH ROW EXECUTE FUNCTION prevent_active_pattern_mutation()`,
    `DROP TRIGGER IF EXISTS pattern_definitions_active_delete_trg ON pattern_definitions`,
    `CREATE TRIGGER pattern_definitions_active_delete_trg BEFORE DELETE ON pattern_definitions FOR EACH ROW EXECUTE FUNCTION prevent_active_pattern_delete()`,
    `DROP TRIGGER IF EXISTS pattern_definitions_direct_activation_trg ON pattern_definitions`,
    `CREATE TRIGGER pattern_definitions_direct_activation_trg BEFORE INSERT ON pattern_definitions FOR EACH ROW EXECUTE FUNCTION prevent_direct_pattern_activation()`,
  ];
  for(const statement of patternImmutability) await pool.query(statement);

  // Defense in depth: every cross-entity foreign key must carry the tenant boundary.
  // The original single-column FKs remain valid, while these composite FKs prevent
  // a row from tenant A from referencing a resource owned by tenant B.
  const tenantIsolation = [
    "CREATE UNIQUE INDEX IF NOT EXISTS entity_nodes_tenant_id_uq ON entity_nodes(tenant_id,id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS signals_tenant_id_uq ON signals(tenant_id,id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS correlations_tenant_id_uq ON correlations(tenant_id,id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS cases_tenant_id_uq ON cases(tenant_id,id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS alerts_tenant_id_uq ON alerts(tenant_id,id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS pattern_definitions_tenant_id_uq ON pattern_definitions(tenant_id,id,version)",
    "CREATE UNIQUE INDEX IF NOT EXISTS audit_events_tenant_sequence_uq ON audit_events(tenant_id,sequence)",
    `DO $$ BEGIN
      ALTER TABLE entity_relationships
        ADD CONSTRAINT entity_relationships_from_entity_tenant_fk
        FOREIGN KEY (tenant_id,from_entity_id) REFERENCES entity_nodes(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE entity_relationships
        ADD CONSTRAINT entity_relationships_to_entity_tenant_fk
        FOREIGN KEY (tenant_id,to_entity_id) REFERENCES entity_nodes(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE correlation_factors
        ADD CONSTRAINT correlation_factors_correlation_tenant_fk
        FOREIGN KEY (tenant_id,correlation_id) REFERENCES correlations(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE cases
        ADD CONSTRAINT cases_correlation_tenant_fk
        FOREIGN KEY (tenant_id,correlation_id) REFERENCES correlations(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE incident_risk_current
        ADD CONSTRAINT incident_risk_case_tenant_fk
        FOREIGN KEY (tenant_id,case_id) REFERENCES cases(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE alerts
        ADD CONSTRAINT alerts_case_tenant_fk
        FOREIGN KEY (tenant_id,case_id) REFERENCES cases(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE alert_deliveries
        ADD CONSTRAINT alert_deliveries_alert_tenant_fk
        FOREIGN KEY (tenant_id,alert_id) REFERENCES alerts(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE semantic_fingerprints
        ADD CONSTRAINT semantic_fingerprints_signal_tenant_fk
        FOREIGN KEY (tenant_id,signal_id) REFERENCES signals(tenant_id,id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN
      ALTER TABLE audit_events
        ADD CONSTRAINT audit_events_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];
  for(const statement of tenantIsolation) await pool.query(statement);
}
