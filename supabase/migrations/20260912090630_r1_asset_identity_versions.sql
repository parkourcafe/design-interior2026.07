begin;
set local search_path = pg_catalog, projectceo_foundation, extensions;

create table projectceo_foundation.external_assets (
  organization_id uuid not null, project_id uuid not null, package_id uuid not null,
  asset_id uuid not null default extensions.gen_random_uuid(), source_kind text not null check (source_kind in ('skp','dwg','pdf','image','dae','glb')),
  created_at timestamptz not null default statement_timestamp(), created_by_user_id uuid,
  primary key (organization_id, project_id, package_id, asset_id),
  foreign key (organization_id, project_id, package_id) references projectceo_foundation.project_packages (organization_id, project_id, id) on delete restrict
);
create table projectceo_foundation.external_asset_versions (
  organization_id uuid not null, project_id uuid not null, package_id uuid not null, asset_id uuid not null,
  asset_version_id uuid not null default extensions.gen_random_uuid(), revision_no integer not null check (revision_no > 0),
  server_sha256 bytea not null check (octet_length(server_sha256)=32), byte_length bigint not null check (byte_length>0), validated_format text not null,
  private_storage_locator text not null check (char_length(private_storage_locator) between 1 and 2048), origin_intake_generation text not null,
  created_at timestamptz not null default statement_timestamp(), created_by_user_id uuid,
  primary key (organization_id, project_id, package_id, asset_version_id), unique (organization_id, project_id, package_id, asset_id, revision_no),
  foreign key (organization_id, project_id, package_id, asset_id) references projectceo_foundation.external_assets on delete restrict
);
create table projectceo_foundation.external_representation_versions (
  organization_id uuid not null, project_id uuid not null, package_id uuid not null, asset_version_id uuid not null,
  representation_version_id uuid not null default extensions.gen_random_uuid(), server_sha256 bytea not null check (octet_length(server_sha256)=32), byte_length bigint not null check(byte_length>0),
  validated_format text not null, private_storage_locator text not null check(char_length(private_storage_locator) between 1 and 2048), producer_kind text not null, producer_version text not null,
  units text not null, axes text not null, transform jsonb not null check(jsonb_typeof(transform)='object'), manifest_schema_version text not null, provenance jsonb not null check(jsonb_typeof(provenance)='object'), resource_manifest jsonb not null check(jsonb_typeof(resource_manifest)='object'),
  created_at timestamptz not null default statement_timestamp(), created_by_user_id uuid,
  primary key (organization_id, project_id, package_id, representation_version_id),
  foreign key (organization_id, project_id, package_id, asset_version_id) references projectceo_foundation.external_asset_versions on delete restrict
);
create table projectceo_foundation.external_representation_attestations (
  organization_id uuid not null, project_id uuid not null, package_id uuid not null, attestation_id uuid not null default extensions.gen_random_uuid(),
  asset_version_id uuid not null, representation_version_id uuid not null, source_sha256 bytea not null check(octet_length(source_sha256)=32), representation_sha256 bytea not null check(octet_length(representation_sha256)=32), confirmed_units text not null, confirmed_axes text not null, architect_user_id uuid not null, causation_id text not null, request_id text not null, attested_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, attestation_id), unique (organization_id, project_id, package_id, asset_version_id, representation_version_id, source_sha256, representation_sha256),
  foreign key (organization_id, project_id, package_id, asset_version_id) references projectceo_foundation.external_asset_versions on delete restrict,
  foreign key (organization_id, project_id, package_id, representation_version_id) references projectceo_foundation.external_representation_versions on delete restrict
);
alter table projectceo_foundation.external_representation_versions add constraint external_representation_asset_pair_key unique (organization_id, project_id, package_id, asset_version_id, representation_version_id);
alter table projectceo_foundation.external_assets add foreign key (organization_id, created_by_user_id) references project_intelligence.organization_members (organization_id, user_id) on delete restrict;
alter table projectceo_foundation.external_asset_versions add foreign key (organization_id, created_by_user_id) references project_intelligence.organization_members (organization_id, user_id) on delete restrict;
alter table projectceo_foundation.external_representation_versions add foreign key (organization_id, created_by_user_id) references project_intelligence.organization_members (organization_id, user_id) on delete restrict;
alter table projectceo_foundation.external_representation_attestations add foreign key (organization_id, architect_user_id) references project_intelligence.organization_members (organization_id, user_id) on delete restrict;
create function projectceo_foundation.assert_external_attestation_pair() returns trigger language plpgsql set search_path = '' as $$ declare v_asset_sha bytea; v_rep_sha bytea; v_units text; v_axes text; begin select a.server_sha256, r.server_sha256, r.units, r.axes into v_asset_sha,v_rep_sha,v_units,v_axes from projectceo_foundation.external_asset_versions a join projectceo_foundation.external_representation_versions r on r.organization_id=a.organization_id and r.project_id=a.project_id and r.package_id=a.package_id and r.asset_version_id=a.asset_version_id where a.organization_id=new.organization_id and a.project_id=new.project_id and a.package_id=new.package_id and a.asset_version_id=new.asset_version_id and r.representation_version_id=new.representation_version_id; if not found or v_asset_sha is distinct from new.source_sha256 or v_rep_sha is distinct from new.representation_sha256 or v_units is distinct from new.confirmed_units or v_axes is distinct from new.confirmed_axes then raise exception 'R1_ATTESTATION_PAIR_MISMATCH'; end if; return new; end $$;
create trigger external_representation_attestations_pair before insert on projectceo_foundation.external_representation_attestations for each row execute function projectceo_foundation.assert_external_attestation_pair();
create table projectceo_foundation.external_asset_events (
  organization_id uuid not null, project_id uuid not null, package_id uuid not null, asset_id uuid not null, event_id uuid not null default extensions.gen_random_uuid(), sequence_no bigint not null check(sequence_no>0), event_type text not null, actor_type text not null check(actor_type in ('human','system')), actor_id text not null, actor_user_id uuid, causation_id text not null, request_id text not null, sanitized_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(sanitized_payload)='object'), occurred_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, event_id), unique (organization_id, project_id, package_id, asset_id, sequence_no),
  foreign key (organization_id, project_id, package_id, asset_id) references projectceo_foundation.external_assets on delete restrict
);
do $$ declare t text; begin foreach t in array array['external_assets','external_asset_versions','external_representation_versions','external_representation_attestations','external_asset_events'] loop execute format('create trigger %I before update or delete on projectceo_foundation.%I for each row execute function projectceo_foundation.reject_append_only_mutation()',t||'_append_only',t); execute format('alter table projectceo_foundation.%I owner to pi_table_owner',t); execute format('alter table projectceo_foundation.%I enable row level security',t); execute format('alter table projectceo_foundation.%I force row level security',t); execute format('revoke all on table projectceo_foundation.%I from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor',t); execute format('create policy %I on projectceo_foundation.%I for all to pi_table_owner using (true) with check (true)',t||'_owner_only',t); end loop; end $$;
commit;
