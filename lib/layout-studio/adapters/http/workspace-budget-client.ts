import type { WorkspaceBinding } from "@/lib/layout-studio/application/workspace-binding";

/**
 * Бюджет варианта в редакторе планировок: «во что обошлось».
 *
 * Здесь нет своего движка цен — и не будет. Материалы с ценами, варианты,
 * комнаты и бюджетная рамка живут в контуре projectceo (append-only ревизии,
 * команды create_m2_room / create_m2_variant / create_m2_material /
 * set_m2_budget). Этот клиент только читает их проекцию и шлёт их команды:
 * второй источник истины о деньгах был бы прямым нарушением правила
 * «один движок» и инварианта «деньги — integer в рублях» заодно.
 *
 * Сшивка миров — по идентификаторам: roomId и variantId бюджетных сущностей
 * — те же свободные строки, что и у публикации планировок. Комната, в которую
 * редактор публикует версии, и комната, на которую вешаются материалы, — одна
 * и та же строка. Реестра нет; первая запись и есть создание.
 */

const COMMAND_CONTRACT = "projectceo-command/0.1";

export interface WorkspaceMaterial {
  readonly materialId: string;
  readonly name: string;
  readonly supplierRef: string;
  readonly unit: string;
  readonly unitCostRub: number;
  readonly quantity: number;
  readonly costRub: number;
}

export interface WorkspaceBudgetFrame {
  readonly minRub: number;
  readonly maxRub: number;
  readonly contingencyPct: number;
}

export interface BudgetSnapshot {
  /** Рамка бюджета пакета; null — не задана (это сообщение, не ошибка). */
  readonly frame: WorkspaceBudgetFrame | null;
  /** Материалы ЭТОГО варианта, в порядке появления. */
  readonly materials: readonly WorkspaceMaterial[];
  /** Σ unitCostRub × quantity. Integer-рубли, без копеек — по инварианту. */
  readonly totalRub: number;
  /** Комната уже зарегистрирована в бюджетном мире? */
  readonly roomRegistered: boolean;
  readonly variantRegistered: boolean;
}

export interface AddMaterialInput {
  readonly name: string;
  readonly supplierRef: string;
  readonly unit: string;
  readonly unitCostRub: number;
  readonly quantity: number;
  /** Для первой записи: имя комнаты человеческими словами. */
  readonly roomName: string;
  /** Для первой записи: площадь из контура стен, целые м². */
  readonly roomAreaM2: number;
  /** Для первой записи: название варианта. */
  readonly variantTitle: string;
}

export class WorkspaceBudgetError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceBudgetError";
  }
}

interface WorkspaceReadRows {
  rooms: ReadonlyArray<{ id: string; packageId: string; revisionId: string }>;
  variants: ReadonlyArray<{ id: string; packageId: string; revisionId: string }>;
  materials: ReadonlyArray<{
    id: string;
    variantId: string;
    packageId: string;
    revisionNo: number;
    name: string;
    supplierRef: string;
    unit: string;
    unitCostRub: number;
    quantity: number;
    createdAt: string;
  }>;
  frames: ReadonlyArray<{
    packageId: string;
    revisionNo: number;
    minRub: number;
    maxRub: number;
    contingencyPct: number;
    createdAt: string;
  }>;
}

export class WorkspaceBudgetClient {
  constructor(
    private readonly binding: WorkspaceBinding,
    /** id варианта из самого документа — тот же, что у публикаций версий. */
    private readonly variantId: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly randomUUID: () => string = () => crypto.randomUUID(),
  ) {}

  async loadSnapshot(): Promise<BudgetSnapshot> {
    return this.snapshotFrom(await this.readWorkspace());
  }

  /**
   * Добавить материал с ценой к варианту. Если комната или вариант ещё не
   * записаны в бюджетном мире — первая запись создаёт их (та же
   * first-publication-семантика, что у версий планировок).
   */
  async addMaterial(input: AddMaterialInput): Promise<BudgetSnapshot> {
    const rows = await this.readWorkspace();
    const { roomId, packageId } = this.binding;
    const variantId = this.variantId;

    if (!rows.rooms.some((room) => room.id === roomId && room.packageId === packageId)) {
      if (!Number.isInteger(input.roomAreaM2) || input.roomAreaM2 < 1) {
        throw new WorkspaceBudgetError(
          "ROOM_AREA_UNDEFINED",
          "Площадь комнаты не определена: контур стен не замкнут",
        );
      }
      await this.command("create_m2_room", {
        packageId,
        roomId,
        revisionId: this.randomUUID(),
        expectedRevisionId: null,
        name: input.roomName,
        areaM2: input.roomAreaM2,
        reason: "Регистрация комнаты из редактора планировок",
      });
    }

    if (
      !rows.variants.some((variant) => variant.id === variantId && variant.packageId === packageId)
    ) {
      await this.command("create_m2_variant", {
        packageId,
        variantId,
        revisionId: this.randomUUID(),
        expectedRevisionId: null,
        roomId,
        title: input.variantTitle,
        description: "",
        reason: "Регистрация варианта из редактора планировок",
      });
    }

    const existing = rows.materials.filter(
      (material) => material.variantId === variantId && material.packageId === packageId,
    );
    await this.command("create_m2_material", {
      packageId,
      materialId: `${variantId}:m${existing.length + 1}`,
      revisionId: this.randomUUID(),
      expectedRevisionId: null,
      variantId,
      name: input.name,
      supplierRef: input.supplierRef,
      unit: input.unit,
      unitCostRub: input.unitCostRub,
      quantity: input.quantity,
      reason: "Материал с ценой из редактора планировок",
    });

    return this.snapshotFrom(await this.readWorkspace());
  }

  private async readWorkspace(): Promise<WorkspaceReadRows> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `/api/projectceo/projects/${encodeURIComponent(this.binding.projectId)}`,
        { method: "GET", credentials: "same-origin", cache: "no-store" },
      );
    } catch {
      throw new WorkspaceBudgetError("REQUEST_FAILED", "Нет связи с сервером контура");
    }
    if (!response.ok) {
      throw new WorkspaceBudgetError(
        response.status === 403 ? "FORBIDDEN" : "REQUEST_FAILED",
        "Сервер контура отклонил чтение рабочего пространства",
      );
    }
    const body = (await response.json().catch(() => null)) as {
      data?: {
        m2Rooms?: unknown;
        m2Variants?: unknown;
        m2Materials?: unknown;
        m2BudgetFrames?: unknown;
      } | null;
      error?: unknown;
    } | null;
    if (!body || body.error !== null || !body.data) {
      throw new WorkspaceBudgetError("MALFORMED_RESPONSE", "Чтение пришло в неожиданной форме");
    }
    const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
    return {
      rooms: asArray(body.data.m2Rooms) as WorkspaceReadRows["rooms"],
      variants: asArray(body.data.m2Variants) as WorkspaceReadRows["variants"],
      materials: asArray(body.data.m2Materials) as WorkspaceReadRows["materials"],
      frames: asArray(body.data.m2BudgetFrames) as WorkspaceReadRows["frames"],
    };
  }

  private snapshotFrom(rows: WorkspaceReadRows): BudgetSnapshot {
    const { packageId, roomId } = this.binding;
    const variantId = this.variantId;

    const materials = rows.materials
      .filter((material) => material.variantId === variantId && material.packageId === packageId)
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((material) => ({
        materialId: material.id,
        name: material.name,
        supplierRef: material.supplierRef,
        unit: material.unit,
        unitCostRub: material.unitCostRub,
        quantity: material.quantity,
        costRub: material.unitCostRub * material.quantity,
      }));

    // Рамка пакета: последняя по цепочке ревизий. Несколько рамок на пакет —
    // берём самую свежую запись: append-only мир, «текущая» = последняя.
    const frame = rows.frames
      .filter((candidate) => candidate.packageId === packageId)
      .slice()
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.revisionNo - right.revisionNo,
      )
      .at(-1);

    return {
      frame: frame
        ? {
            minRub: frame.minRub,
            maxRub: frame.maxRub,
            contingencyPct: frame.contingencyPct,
          }
        : null,
      materials,
      totalRub: materials.reduce((sum, material) => sum + material.costRub, 0),
      roomRegistered: rows.rooms.some(
        (room) => room.id === roomId && room.packageId === packageId,
      ),
      variantRegistered: rows.variants.some(
        (variant) => variant.id === variantId && variant.packageId === packageId,
      ),
    };
  }

  private async command(kind: string, payload: Record<string, unknown>): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl("/api/projectceo/commands", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: COMMAND_CONTRACT,
          commandId: this.randomUUID(),
          projectId: this.binding.projectId,
          kind,
          payload,
        }),
      });
    } catch {
      throw new WorkspaceBudgetError("REQUEST_FAILED", "Нет связи с сервером контура");
    }
    if (!response.ok) {
      throw new WorkspaceBudgetError(
        response.status === 403 ? "FORBIDDEN" : response.status === 409 ? "STALE_STATE" : "REQUEST_FAILED",
        `Команда ${kind} отклонена сервером`,
      );
    }
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (!body || body.status !== "completed") {
      throw new WorkspaceBudgetError("MALFORMED_RESPONSE", "Ответ команды в неожиданной форме");
    }
  }
}
