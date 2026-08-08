import { describe, expect, it } from "vitest";

import { WorkspaceBudgetClient } from "@/lib/layout-studio/adapters/http/workspace-budget-client";
import { projectCeoCommandSchema } from "@/lib/project-intelligence/delivery/projectceo/command-contract";

/**
 * Замок бюджетного клиента: каждая команда, которую он шлёт
 * (create_m2_room / create_m2_variant / create_m2_material), разбирается
 * НАСТОЯЩЕЙ zod-схемой контура. Плюс first-publication-семантика: первая
 * запись материала сама регистрирует комнату и вариант, вторая — уже нет.
 */

const PROJECT_UUID = "20000000-0000-4000-8000-000000000002";
const PACKAGE_UUID = "20000000-0000-4000-8000-000000000003";
const VARIANT_ID = "variant.simple-room.main";

const BINDING = {
  projectId: PROJECT_UUID,
  packageId: PACKAGE_UUID,
  roomId: "kuhnya-gostinaya",
  role: "preferred",
} as const;

interface BudgetWorld {
  rooms: Array<{ id: string; packageId: string; revisionId: string }>;
  variants: Array<{ id: string; packageId: string; revisionId: string }>;
  materials: Array<Record<string, unknown>>;
  frames: Array<Record<string, unknown>>;
  commands: Array<{ kind: string; payload: Record<string, unknown> }>;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(world: BudgetWorld): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === `/api/projectceo/projects/${PROJECT_UUID}`) {
      return json({
        contractVersion: "projectceo-ui/0.1",
        requestId: "read-1",
        data: {
          m2Rooms: world.rooms,
          m2Variants: world.variants,
          m2Materials: world.materials,
          m2BudgetFrames: world.frames,
        },
        error: null,
      });
    }

    if (url === "/api/projectceo/commands") {
      const body = JSON.parse(String(init?.body)) as {
        kind: string;
        payload: Record<string, unknown>;
      };
      world.commands.push({ kind: body.kind, payload: body.payload });

      // Сердце замка: команду разбирает их настоящая схема.
      const parsed = projectCeoCommandSchema.safeParse(body);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: parsed.error.issues }), { status: 422 });
      }

      // Мок ведёт себя как сервер: запись попадает в проекцию.
      if (body.kind === "create_m2_room") {
        world.rooms.push({
          id: String(body.payload.roomId),
          packageId: String(body.payload.packageId),
          revisionId: String(body.payload.revisionId),
        });
      }
      if (body.kind === "create_m2_variant") {
        world.variants.push({
          id: String(body.payload.variantId),
          packageId: String(body.payload.packageId),
          revisionId: String(body.payload.revisionId),
        });
      }
      if (body.kind === "create_m2_material") {
        world.materials.push({
          id: String(body.payload.materialId),
          variantId: String(body.payload.variantId),
          packageId: String(body.payload.packageId),
          revisionNo: 1,
          name: String(body.payload.name),
          supplierRef: String(body.payload.supplierRef),
          unit: String(body.payload.unit),
          unitCostRub: Number(body.payload.unitCostRub),
          quantity: Number(body.payload.quantity),
          createdAt: `2026-08-08T12:00:0${world.materials.length}.000Z`,
        });
      }

      return json({
        contractVersion: "projectceo-command/0.1",
        requestId: "cmd-1",
        status: "completed",
        operation: "append_m2_workspace_revision",
        replay: false,
        stateRevision: world.commands.length,
        result: {},
      });
    }

    throw new Error(`Неожиданный запрос в тесте: ${url}`);
  };
}

function uuidSequence(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `40000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

function makeClient(world: BudgetWorld): WorkspaceBudgetClient {
  return new WorkspaceBudgetClient(BINDING, VARIANT_ID, makeFetch(world), uuidSequence());
}

const MATERIAL = {
  name: "Керамогранит, пол",
  supplierRef: "KG-600x600",
  unit: "м²",
  unitCostRub: 3200,
  quantity: 18,
  roomName: "Кухня-гостиная",
  roomAreaM2: 24,
  variantTitle: "Кухня-гостиная — Вариант A",
};

describe("WorkspaceBudgetClient: «во что обошлось» через движок контура", () => {
  it("первая запись материала регистрирует комнату и вариант, и все команды проходят их схему", async () => {
    const world: BudgetWorld = { rooms: [], variants: [], materials: [], frames: [], commands: [] };
    const snapshot = await makeClient(world).addMaterial(MATERIAL);

    expect(world.commands.map((command) => command.kind)).toEqual([
      "create_m2_room",
      "create_m2_variant",
      "create_m2_material",
    ]);
    // Сшивка миров: те же идентификаторы, что и у публикации версий.
    expect(world.commands[0]!.payload.roomId).toBe(BINDING.roomId);
    expect(world.commands[1]!.payload.variantId).toBe(VARIANT_ID);
    expect(world.commands[1]!.payload.roomId).toBe(BINDING.roomId);
    expect(world.commands[2]!.payload.variantId).toBe(VARIANT_ID);

    expect(snapshot.roomRegistered).toBe(true);
    expect(snapshot.variantRegistered).toBe(true);
    expect(snapshot.materials).toHaveLength(1);
    expect(snapshot.totalRub).toBe(3200 * 18);
  });

  it("вторая запись не регистрирует заново, итог складывается integer-рублями", async () => {
    const world: BudgetWorld = { rooms: [], variants: [], materials: [], frames: [], commands: [] };
    const client = makeClient(world);
    await client.addMaterial(MATERIAL);
    world.commands.length = 0;

    const snapshot = await client.addMaterial({
      ...MATERIAL,
      name: "Смеситель",
      unit: "шт",
      unitCostRub: 14500,
      quantity: 1,
    });

    expect(world.commands.map((command) => command.kind)).toEqual(["create_m2_material"]);
    expect(snapshot.totalRub).toBe(3200 * 18 + 14500);
    expect(snapshot.materials.map((material) => material.name)).toEqual([
      "Керамогранит, пол",
      "Смеситель",
    ]);
  });

  it("рамка пакета читается, и сравнение с итогом — дело интерфейса, не клиента", async () => {
    const world: BudgetWorld = { rooms: [], variants: [], materials: [], frames: [], commands: [] };
    world.frames.push({
      packageId: PACKAGE_UUID,
      revisionNo: 1,
      minRub: 500_000,
      maxRub: 900_000,
      contingencyPct: 10,
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    world.frames.push({
      packageId: PACKAGE_UUID,
      revisionNo: 2,
      minRub: 600_000,
      maxRub: 1_000_000,
      contingencyPct: 10,
      createdAt: "2026-08-08T11:00:00.000Z",
    });

    const snapshot = await makeClient(world).loadSnapshot();
    // Текущая рамка — последняя запись append-only мира.
    expect(snapshot.frame).toEqual({ minRub: 600_000, maxRub: 1_000_000, contingencyPct: 10 });
  });

  it("незамкнутый контур честно останавливает регистрацию комнаты", async () => {
    const world: BudgetWorld = { rooms: [], variants: [], materials: [], frames: [], commands: [] };
    await expect(
      makeClient(world).addMaterial({ ...MATERIAL, roomAreaM2: 0 }),
    ).rejects.toMatchObject({ code: "ROOM_AREA_UNDEFINED" });
    expect(world.commands).toHaveLength(0);
  });
});
