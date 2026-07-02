"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { ru } from "@/lib/i18n/ru";

export default function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={signOut} className="text-muted hover:text-ink">
      {ru.nav.signOut}
    </button>
  );
}
