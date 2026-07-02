import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";
import NewProject from "./new-project";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  client_name: string;
  status: string;
  created_at: string;
}

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, client_name, status, created_at")
    .order("created_at", { ascending: false });

  const rows = (projects ?? []) as ProjectRow[];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{ru.projects.title}</h1>
      </div>

      <div className="mt-6">
        <NewProject />
      </div>

      <div className="mt-8 space-y-3">
        {rows.length === 0 && <p className="text-muted">{ru.projects.empty}</p>}
        {rows.map((p) => (
          <Link
            key={p.id}
            href={`/dashboard/projects/${p.id}`}
            className="card flex items-center justify-between hover:border-accent"
          >
            <span className="font-medium">{p.client_name}</span>
            <span className="rounded-full bg-line/50 px-3 py-1 text-xs text-muted">
              {ru.projects.statusLabel[p.status] ?? p.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
