-- Ensure Supabase PostgREST sees the governed M1 workflow RPCs after the
-- additive Sprint 1 runtime migration. Preview branches can apply PostgreSQL
-- objects before PostgREST refreshes its schema cache, which surfaces as
-- PGRST202 for otherwise-created functions.

do $$
begin
  if to_regprocedure('public.reserve_initial_brief_ai_call(uuid,text,text)') is null then
    raise exception 'missing public.reserve_initial_brief_ai_call(uuid,text,text)';
  end if;

  if to_regprocedure('public.record_initial_brief_ai_usage(uuid,uuid,uuid,uuid,text,text,integer,integer,integer,numeric,text,text)') is null then
    raise exception 'missing public.record_initial_brief_ai_usage(uuid,uuid,uuid,uuid,text,text,integer,integer,integer,numeric,text,text)';
  end if;

  if to_regprocedure('public.close_initial_brief_ai_call(uuid,uuid,uuid,uuid,text)') is null then
    raise exception 'missing public.close_initial_brief_ai_call(uuid,uuid,uuid,uuid,text)';
  end if;

  if to_regprocedure('public.finalize_initial_brief(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb)') is null then
    raise exception 'missing public.finalize_initial_brief(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb)';
  end if;
end;
$$;

notify pgrst, 'reload schema';
