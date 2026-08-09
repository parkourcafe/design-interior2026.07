"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import { SupabaseLayoutRepository } from "@/lib/layout-studio/adapters/supabase/supabase-layout-repository";
import {
  WORKSPACE_VARIANT_ROLES,
  type WorkspaceVariantRole,
} from "@/lib/layout-studio/application/workspace-binding";
import { createRoomDocument, validateRoomSpec } from "@/lib/layout-studio/domain/create-room";
import { forkLayoutDocument } from "@/lib/layout-studio/domain/fork-variant";
import { ru } from "@/lib/i18n/ru";

/**
 * Создание планировки по габаритам помещения.
 *
 * Всё происходит на сервере: клиент присылает четыре числа и название, а
 * документ собирается здесь и здесь же проверяется замороженной схемой.
 * Принимать готовый документ от браузера нельзя — тогда в базу можно было бы
 * положить что угодно, а на этих данных потом стоит семантический хеш версии.
 *
 * Принадлежность проекту не проверяется отдельным запросом: вставка идёт через
 * RLS, и политика отклонит проект чужой студии. Отдельная проверка добавила бы
 * второй источник истины о правах.
 */
export async function createLayout(projectId: string, formData: FormData) {
  if (!isLayoutStudioEnabled()) return { error: "disabled" as const };

  const name = String(formData.get("name") ?? "");
  const toMm = (field: string) => {
    const raw = String(formData.get(field) ?? "").replace(",", ".").trim();
    // Дизайнер вводит метры — так он думает о помещении. В канон уходят
    // миллиметры, поэтому округление происходит ровно один раз, здесь.
    const metres = Number(raw);
    return Number.isFinite(metres) ? Math.round(metres * 1000) : Number.NaN;
  };

  const spec = {
    name,
    projectUuid: projectId,
    documentId: `layout.${randomUUID()}`,
    widthMm: toMm("widthM"),
    depthMm: toMm("depthM"),
    clearHeightMm: toMm("heightM"),
  };

  const issues = validateRoomSpec(spec);
  if (issues.length > 0) return { error: "invalid" as const, issues };

  const supabase = await createClient();
  const repository = new SupabaseLayoutRepository(supabase);
  try {
    await repository.createDocument(projectId, createRoomDocument(spec), spec.name.trim());
  } catch {
    return { error: "storage" as const };
  }

  revalidatePath(`/dashboard/projects/${projectId}/layouts`);
  redirect(`/dashboard/projects/${projectId}/layouts/${encodeURIComponent(spec.documentId)}`);
}

/**
 * Копия планировки под новый вариант комнаты (экономичный / премиальный).
 *
 * Как и создание, форк целиком серверный: источник читается из базы по RLS,
 * копию собирает чистая функция forkLayoutDocument, браузер присылает только
 * роль. Привязка к рабочему пространству переносится той же вставкой — с той
 * же комнатой и выбранной ролью, — поэтому «наполовину привязанных» копий не
 * бывает: строка либо появляется целиком, либо нет.
 *
 * Непривязанный источник тоже копируется: вариант можно готовить до привязки,
 * роль тогда живёт только в подписи варианта.
 */
export async function forkLayout(projectId: string, documentId: string, formData: FormData) {
  if (!isLayoutStudioEnabled()) return { error: "disabled" as const };

  const role = String(formData.get("role") ?? "");
  if (!(WORKSPACE_VARIANT_ROLES as readonly string[]).includes(role)) {
    return { error: "invalid" as const };
  }

  const supabase = await createClient();
  const repository = new SupabaseLayoutRepository(supabase);

  try {
    const source = await repository.loadDraft(documentId);
    if (!source) return { error: "not_found" as const };

    const variantLabel =
      ru.layoutStudio.workspace.roleNames[role] ?? role;
    const fork = forkLayoutDocument(source, {
      documentId: `layout.${randomUUID()}`,
      variantLabel,
    });

    const sourceBinding = await repository.loadWorkspaceBinding(documentId);
    const title = `${fork.name} — ${variantLabel}`;
    await repository.createDocument(
      projectId,
      fork,
      title,
      sourceBinding
        ? { ...sourceBinding, role: role as WorkspaceVariantRole }
        : undefined,
    );

    revalidatePath(`/dashboard/projects/${projectId}/layouts`);
    return { documentId: fork.documentId };
  } catch {
    return { error: "storage" as const };
  }
}
