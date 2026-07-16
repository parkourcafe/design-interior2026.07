\set ON_ERROR_STOP on

create role anon nologin noinherit nobypassrls;
create role authenticated nologin noinherit nobypassrls;
create role service_role nologin noinherit bypassrls;

create schema auth;
revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

revoke all on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
revoke all on schema storage from public;
grant usage on schema storage to service_role;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

grant all on table storage.buckets to service_role;
