"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Auth (GoTrue) отвечает на просроченную или уже использованную ссылку из
// письма переходом на адрес сайта с ошибкой во фрагменте:
//   /#error=access_denied&error_code=otp_expired&error_description=…
// Без обработки человек видит лендинг без объяснения (MAIL-01, 08.10.2026).
// Переводим на страницу входа, которая показывает понятную причину.
export default function AuthHashError() {
  const router = useRouter();
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = hash.get("error_code") || hash.get("error");
    if (!code) return;
    router.replace(`/login?error=${encodeURIComponent(code)}`);
  }, [router]);
  return null;
}
