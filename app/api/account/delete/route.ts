import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// DEC-047: запрос удаления сразу закрывает аккаунт (кабинет, экспорт,
// запись, клиентские ссылки); данные уничтожает оператор в течение 30 дней
// (scripts/account-purge.ts, функция базы purge_designer_account). Отмена —
// только через поддержку до уничтожения.

const CONFIRMATION = "УДАЛИТЬ";

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { confirmation?: unknown };
  if (body.confirmation !== CONFIRMATION) {
    return NextResponse.json(
      { error: `Для подтверждения введите «${CONFIRMATION}».` },
      { status: 400 },
    );
  }

  // Заявка создаётся от имени самого дизайнера (auth.uid в базе); повтор
  // возвращает ту же заявку.
  const { data, error } = await supabase.rpc("request_account_deletion", { p_reason: null });
  if (error || !data || typeof data !== "object") {
    return NextResponse.json({ error: "Не удалось оформить удаление аккаунта." }, { status: 500 });
  }
  const retention = data as { purgeAfter?: unknown; replay?: unknown };
  return NextResponse.json({
    ok: true,
    purgeAfter: typeof retention.purgeAfter === "string" ? retention.purgeAfter : null,
    replay: retention.replay === true,
  });
}
