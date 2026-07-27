SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
COMMENT ON SCHEMA "public" IS 'standard public schema';
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE OR REPLACE FUNCTION "public"."is_studio_member"("owner" "uuid", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select owner = uid
      or exists (
        select 1 from public.studio_members m
        where m.owner_id = owner and m.member_id = uid and m.status = 'active'
      );
$$;
ALTER FUNCTION "public"."is_studio_member"("owner" "uuid", "uid" "uuid") OWNER TO "postgres";
SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."answers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "question_id" "text" NOT NULL,
    "value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."answers" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."designers" (
    "id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "studio_name" "text" DEFAULT ''::"text" NOT NULL,
    "pricing" "jsonb",
    "proposal_defaults" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);
ALTER TABLE "public"."designers" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "designer_id" "uuid",
    "project_id" "uuid",
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."events" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."project_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "auth_user_id" "uuid",
    "access_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_participants_role_check" CHECK (("role" = ANY (ARRAY['designer'::"text", 'client'::"text", 'executor'::"text"])))
);
ALTER TABLE "public"."project_participants" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."project_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "scope_package" "text",
    "pricing_snapshot" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_rooms_scope_package_check" CHECK (("scope_package" = ANY (ARRAY['concept'::"text", 'full'::"text", 'full_plus_supervision'::"text"]))),
    CONSTRAINT "project_rooms_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);
ALTER TABLE "public"."project_rooms" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."project_task_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "actor_role" "text",
    "event_type" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_task_events_actor_role_check" CHECK (("actor_role" = ANY (ARRAY['designer'::"text", 'client'::"text", 'executor'::"text", 'system'::"text"]))),
    CONSTRAINT "project_task_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['room_created'::"text", 'task_created'::"text", 'task_status_changed'::"text"])))
);
ALTER TABLE "public"."project_task_events" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."project_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "owner_role" "text" NOT NULL,
    "assignee_participant_id" "uuid",
    "due_date" "date",
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "client_facing" boolean DEFAULT false NOT NULL,
    "related_scope_item" "text",
    "proposal_section" "text",
    "created_from" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "project_tasks_created_from_check" CHECK (("created_from" = ANY (ARRAY['proposal'::"text", 'accepted_risk'::"text", 'system'::"text", 'manual'::"text"]))),
    CONSTRAINT "project_tasks_owner_role_check" CHECK (("owner_role" = ANY (ARRAY['designer'::"text", 'client'::"text", 'executor'::"text"]))),
    CONSTRAINT "project_tasks_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'blocked'::"text", 'waiting_client'::"text", 'waiting_executor'::"text", 'done'::"text"])))
);
ALTER TABLE "public"."project_tasks" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "designer_id" "uuid",
    "client_name" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'created'::"text" NOT NULL,
    "intake_token" "text" NOT NULL,
    "passport" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "custom_questions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'brief_sent'::"text", 'brief_in_progress'::"text", 'brief_completed'::"text", 'proposal_draft'::"text", 'proposal_sent'::"text", 'proposal_accepted'::"text", 'active_project'::"text"])))
);
ALTER TABLE "public"."projects" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "sections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "public_token" "text" NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "proposals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text"])))
);
ALTER TABLE "public"."proposals" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
ALTER TABLE "public"."rate_limits" OWNER TO "postgres";
ALTER TABLE "public"."rate_limits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."rate_limits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE IF NOT EXISTS "public"."risk_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "risk_type" "text" NOT NULL,
    "evidence" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "impact" "text" DEFAULT ''::"text" NOT NULL,
    "confidence" "text" NOT NULL,
    "designer_action" "text" DEFAULT ''::"text" NOT NULL,
    "proposal_implication" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "source" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "risk_cards_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "risk_cards_risk_type_check" CHECK (("risk_type" = ANY (ARRAY['budget'::"text", 'timeline'::"text", 'function'::"text", 'style'::"text", 'technical'::"text"]))),
    CONSTRAINT "risk_cards_source_check" CHECK (("source" = ANY (ARRAY['rule'::"text", 'llm'::"text"]))),
    CONSTRAINT "risk_cards_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'accepted'::"text", 'rejected'::"text"])))
);
ALTER TABLE "public"."risk_cards" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."studio_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "member_id" "uuid",
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "joined_at" timestamp with time zone,
    "invite_token" "text",
    "token_expires_at" timestamp with time zone,
    CONSTRAINT "studio_members_role_check" CHECK (("role" = 'member'::"text")),
    CONSTRAINT "studio_members_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text"])))
);
ALTER TABLE "public"."studio_members" OWNER TO "postgres";
ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_project_id_question_id_key" UNIQUE ("project_id", "question_id");
ALTER TABLE ONLY "public"."designers"
    ADD CONSTRAINT "designers_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."project_participants"
    ADD CONSTRAINT "project_participants_access_token_key" UNIQUE ("access_token");
ALTER TABLE ONLY "public"."project_participants"
    ADD CONSTRAINT "project_participants_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."project_participants"
    ADD CONSTRAINT "project_participants_room_id_role_key" UNIQUE ("room_id", "role");
ALTER TABLE ONLY "public"."project_rooms"
    ADD CONSTRAINT "project_rooms_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."project_rooms"
    ADD CONSTRAINT "project_rooms_project_id_key" UNIQUE ("project_id");
ALTER TABLE ONLY "public"."project_rooms"
    ADD CONSTRAINT "project_rooms_proposal_id_key" UNIQUE ("proposal_id");
ALTER TABLE ONLY "public"."project_task_events"
    ADD CONSTRAINT "project_task_events_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_intake_token_key" UNIQUE ("intake_token");
ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_public_token_key" UNIQUE ("public_token");
ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."risk_cards"
    ADD CONSTRAINT "risk_cards_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."studio_members"
    ADD CONSTRAINT "studio_members_owner_id_email_key" UNIQUE ("owner_id", "email");
ALTER TABLE ONLY "public"."studio_members"
    ADD CONSTRAINT "studio_members_pkey" PRIMARY KEY ("id");
CREATE INDEX "answers_project_id_idx" ON "public"."answers" USING "btree" ("project_id");
CREATE INDEX "events_designer_id_idx" ON "public"."events" USING "btree" ("designer_id");
CREATE INDEX "project_participants_room_idx" ON "public"."project_participants" USING "btree" ("room_id");
CREATE INDEX "project_task_events_room_idx" ON "public"."project_task_events" USING "btree" ("room_id", "created_at" DESC);
CREATE INDEX "project_tasks_room_idx" ON "public"."project_tasks" USING "btree" ("room_id", "sort_order");
CREATE INDEX "projects_designer_id_idx" ON "public"."projects" USING "btree" ("designer_id");
CREATE INDEX "projects_intake_token_idx" ON "public"."projects" USING "btree" ("intake_token");
CREATE INDEX "proposals_project_id_idx" ON "public"."proposals" USING "btree" ("project_id");
CREATE INDEX "proposals_public_token_idx" ON "public"."proposals" USING "btree" ("public_token");
CREATE INDEX "rate_limits_key_created_idx" ON "public"."rate_limits" USING "btree" ("key", "created_at" DESC);
CREATE INDEX "risk_cards_project_id_idx" ON "public"."risk_cards" USING "btree" ("project_id");
CREATE INDEX "studio_members_email_idx" ON "public"."studio_members" USING "btree" ("email");
CREATE INDEX "studio_members_invite_token_idx" ON "public"."studio_members" USING "btree" ("invite_token") WHERE ("invite_token" IS NOT NULL);
CREATE INDEX "studio_members_member_idx" ON "public"."studio_members" USING "btree" ("member_id") WHERE ("member_id" IS NOT NULL);
ALTER TABLE ONLY "public"."answers"
    ADD CONSTRAINT "answers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."designers"
    ADD CONSTRAINT "designers_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_designer_id_fkey" FOREIGN KEY ("designer_id") REFERENCES "public"."designers"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."project_participants"
    ADD CONSTRAINT "project_participants_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."project_participants"
    ADD CONSTRAINT "project_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."project_rooms"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."project_rooms"
    ADD CONSTRAINT "project_rooms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."project_rooms"
    ADD CONSTRAINT "project_rooms_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."project_task_events"
    ADD CONSTRAINT "project_task_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."project_rooms"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."project_task_events"
    ADD CONSTRAINT "project_task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_assignee_participant_id_fkey" FOREIGN KEY ("assignee_participant_id") REFERENCES "public"."project_participants"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."project_rooms"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_designer_id_fkey" FOREIGN KEY ("designer_id") REFERENCES "public"."designers"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."risk_cards"
    ADD CONSTRAINT "risk_cards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."studio_members"
    ADD CONSTRAINT "studio_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."studio_members"
    ADD CONSTRAINT "studio_members_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."designers"("id") ON DELETE CASCADE;
ALTER TABLE "public"."answers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "answers_studio_all" ON "public"."answers" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "answers"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "answers"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."designers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "designers_self_insert" ON "public"."designers" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));
CREATE POLICY "designers_studio_select" ON "public"."designers" FOR SELECT USING ("public"."is_studio_member"("id", "auth"."uid"()));
CREATE POLICY "designers_studio_update" ON "public"."designers" FOR UPDATE USING ("public"."is_studio_member"("id", "auth"."uid"()));
ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_studio_insert" ON "public"."events" FOR INSERT WITH CHECK ("public"."is_studio_member"("designer_id", "auth"."uid"()));
CREATE POLICY "events_studio_select" ON "public"."events" FOR SELECT USING ("public"."is_studio_member"("designer_id", "auth"."uid"()));
ALTER TABLE "public"."project_participants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_participants_studio_all" ON "public"."project_participants" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_rooms" "r"
     JOIN "public"."projects" "p" ON (("p"."id" = "r"."project_id")))
  WHERE (("r"."id" = "project_participants"."room_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_rooms" "r"
     JOIN "public"."projects" "p" ON (("p"."id" = "r"."project_id")))
  WHERE (("r"."id" = "project_participants"."room_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."project_rooms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_rooms_studio_all" ON "public"."project_rooms" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_rooms"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "project_rooms"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."project_task_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_task_events_studio_all" ON "public"."project_task_events" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_rooms" "r"
     JOIN "public"."projects" "p" ON (("p"."id" = "r"."project_id")))
  WHERE (("r"."id" = "project_task_events"."room_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_rooms" "r"
     JOIN "public"."projects" "p" ON (("p"."id" = "r"."project_id")))
  WHERE (("r"."id" = "project_task_events"."room_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."project_tasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_tasks_studio_all" ON "public"."project_tasks" USING ((EXISTS ( SELECT 1
   FROM ("public"."project_rooms" "r"
     JOIN "public"."projects" "p" ON (("p"."id" = "r"."project_id")))
  WHERE (("r"."id" = "project_tasks"."room_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."project_rooms" "r"
     JOIN "public"."projects" "p" ON (("p"."id" = "r"."project_id")))
  WHERE (("r"."id" = "project_tasks"."room_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_studio_all" ON "public"."projects" USING ("public"."is_studio_member"("designer_id", "auth"."uid"())) WITH CHECK ("public"."is_studio_member"("designer_id", "auth"."uid"()));
ALTER TABLE "public"."proposals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals_studio_all" ON "public"."proposals" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "proposals"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "proposals"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."risk_cards" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk_cards_studio_all" ON "public"."risk_cards" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "risk_cards"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "risk_cards"."project_id") AND "public"."is_studio_member"("p"."designer_id", "auth"."uid"())))));
ALTER TABLE "public"."studio_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "studio_members_owner_delete" ON "public"."studio_members" FOR DELETE USING (("owner_id" = "auth"."uid"()));
CREATE POLICY "studio_members_owner_insert" ON "public"."studio_members" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));
CREATE POLICY "studio_members_select" ON "public"."studio_members" FOR SELECT USING ("public"."is_studio_member"("owner_id", "auth"."uid"()));
ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT ALL ON FUNCTION "public"."is_studio_member"("owner" "uuid", "uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_studio_member"("owner" "uuid", "uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_studio_member"("owner" "uuid", "uid" "uuid") TO "service_role";
GRANT ALL ON TABLE "public"."answers" TO "anon";
GRANT ALL ON TABLE "public"."answers" TO "authenticated";
GRANT ALL ON TABLE "public"."answers" TO "service_role";
GRANT ALL ON TABLE "public"."designers" TO "anon";
GRANT ALL ON TABLE "public"."designers" TO "authenticated";
GRANT ALL ON TABLE "public"."designers" TO "service_role";
GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";
GRANT ALL ON TABLE "public"."project_participants" TO "anon";
GRANT ALL ON TABLE "public"."project_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."project_participants" TO "service_role";
GRANT ALL ON TABLE "public"."project_rooms" TO "anon";
GRANT ALL ON TABLE "public"."project_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."project_rooms" TO "service_role";
GRANT ALL ON TABLE "public"."project_task_events" TO "anon";
GRANT ALL ON TABLE "public"."project_task_events" TO "authenticated";
GRANT ALL ON TABLE "public"."project_task_events" TO "service_role";
GRANT ALL ON TABLE "public"."project_tasks" TO "anon";
GRANT ALL ON TABLE "public"."project_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."project_tasks" TO "service_role";
GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";
GRANT ALL ON TABLE "public"."proposals" TO "anon";
GRANT ALL ON TABLE "public"."proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."proposals" TO "service_role";
GRANT ALL ON TABLE "public"."rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limits" TO "service_role";
GRANT ALL ON SEQUENCE "public"."rate_limits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rate_limits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rate_limits_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."risk_cards" TO "anon";
GRANT ALL ON TABLE "public"."risk_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."risk_cards" TO "service_role";
GRANT ALL ON TABLE "public"."studio_members" TO "anon";
GRANT ALL ON TABLE "public"."studio_members" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_members" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
