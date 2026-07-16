(function () {
  "use strict";

  let data = window.KORA_DEMO_DATA;
  if (!data) return;

  const roleLabels = {
    canonical_issue: "Выдача",
    source_editable: "Исходник",
    existing_condition: "Существующее",
    reference_render: "Референс",
    quantity_input: "Объёмы",
    project_brief: "Требования",
    design_iteration: "Вариант",
    recovery_only: "Резерв",
    context_excluded: "Вне baseline",
    compiled_reference: "Сводный комплект",
    archive_container: "Архив",
    context_only: "Контекст",
    curated_derivative: "Производная копия",
    drawing_candidate: "Чертёж-кандидат",
    dwg_rar: "DWG-комплект",
    food_hall_archive: "Архив Food Hall",
    mep_baseline_candidate: "MEP-кандидат",
    project_context: "Контекст проекта",
    quantity_baseline_candidate: "Объёмы-кандидат",
    requires_human_review: "Ручная проверка",
    schedule_baseline_candidate: "График-кандидат",
    site_or_plan_image: "Фото / план",
    specification_candidate: "Спецификация",
    superseded_drawing: "Заменённый чертёж",
    superseded_plan: "Заменённый план",
    visualization: "Визуализация",
  };

  const statusLabels = {
    current: "Действующий кандидат",
    needs_review: "Нужна проверка",
    previous_revision: "Предыдущая ревизия",
    reference: "Справочный",
    duplicate: "Дубликат",
    excluded: "Не входит",
  };

  const claimLabels = {
    extracted: "Извлечено",
    interpreted: "Интерпретировано",
    unknown: "Неизвестно",
    confirmed: "Подтверждено",
  };

  const collectionLabels = {
    kora_construction: "KORA Construction · рабочая коллекция",
    food_hall: "05 Kora Food Hall · кандидат выдачи",
    food_hall_copy: "05 Kora Food Hall 2 · зеркало",
    kora_10_construction: "KORA / 10 Construction · контекст исполнения",
    curated_construction: "Стройка Ubud · производные референсы",
    external_archives: "Внешние архивы",
  };

  const floorLabels = {
    first_floor: "Первый этаж",
    second_floor: "Второй этаж",
    second_floor_toilet: "Санузел 2 этажа",
    exterior: "Фасад / территория",
    unspecified: "Объект целиком",
  };

  const disciplineLabels = {
    architecture: "Архитектура",
    archive: "Архив",
    brief_specification: "Требования",
    general: "Общее",
    mep: "MEP",
    project_controls: "Управление проектом",
    quantity_cost: "Объёмы / стоимость",
    site_evidence: "Фотофиксация",
    visualization: "Визуализация",
  };

  const state = {
    query: "",
    package: "all",
    status: "all",
    stage: null,
  };

  const elements = {
    summary: document.querySelector("#summary"),
    pipeline: document.querySelector("#pipeline"),
    body: document.querySelector("#documents-body"),
    search: document.querySelector("#search"),
    packageFilter: document.querySelector("#package-filter"),
    statusFilter: document.querySelector("#status-filter"),
    reset: document.querySelector("#reset-filters"),
    resultCount: document.querySelector("#result-count"),
    empty: document.querySelector("#empty-state"),
    activeFilter: document.querySelector("#active-filter"),
    activeFilterLabel: document.querySelector("#active-filter-label"),
    clearStage: document.querySelector("#clear-stage"),
    insights: document.querySelector("#insights"),
    gaps: document.querySelector("#gaps"),
    gapCount: document.querySelector("#gap-count"),
    dialog: document.querySelector("#document-dialog"),
    dialogTitle: document.querySelector("#dialog-title"),
    dialogKicker: document.querySelector("#dialog-kicker"),
    dialogContent: document.querySelector("#dialog-content"),
    dialogClose: document.querySelector("#dialog-close"),
  };

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "размер неизвестен";
    const units = ["Б", "КБ", "МБ", "ГБ"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
  };

  const inferRevision = (name) => {
    const revision = name.match(/\b(?:rev(?:ision)?|версия|version)[ _.-]*([a-z]?\d+(?:\.\d+)*)/i);
    if (revision) return `Rev ${revision[1]}`;
    const layout = name.match(/\b(?:layout|планировка)[ _.-]*(\d{1,2})\b/i);
    if (layout) return `Вариант ${layout[1]}`;
    const version = name.match(/\bv(\d+(?:\.\d+)*)\b/i);
    if (version) return `v${version[1]}`;
    return "Не указана";
  };

  function inventoryStages(item) {
    const stages = ["ingestion"];
    if (!["archive_container", "food_hall_archive", "context_only"].includes(item.sourceRole)) {
      stages.push("baseline");
    }
    if (["architecture", "mep", "quantity_cost"].includes(item.discipline) && item.status !== "previous") {
      stages.push("wbs");
    }
    if (item.discipline === "quantity_cost") stages.push("estimate");
    if (["brief_specification", "project_controls"].includes(item.discipline)) stages.push("change");
    return stages;
  }

  function inventoryNote(item) {
    if (item.semanticConflict) {
      return "Источник изолирован: одинаковый hash связан с семантически разными именами. Нужна визуальная или человеческая проверка.";
    }
    if (item.availability === "cloud_placeholder") {
      return "Файл найден в облачной коллекции, но ещё не материализован локально. До загрузки и расчёта checksum он остаётся только inventory record.";
    }
    if (item.duplicateGroup) {
      return `Точный hash-дубликат. Физический источник сохраняется, но в Project Graph будет связан с одним уникальным blob.`;
    }
    if (item.status === "current") {
      return "Кандидат на текущую выдачу. Статус current не означает утверждение: baseline требует подтверждения человека.";
    }
    if (item.status === "previous") {
      return "Предыдущая версия сохранена для истории решений и version diff; не используется как текущая выдача.";
    }
    return "Источник зарегистрирован с provenance и доступен для связывания с baseline после проверки роли.";
  }

  function mapInventoryDocument(item, manifest) {
    const root = manifest.sourceRoots[item.collectionKey];
    const mappedStatus = {
      current: "current",
      previous: "previous_revision",
      reference: "reference",
      unknown: "needs_review",
    }[item.status];
    return {
      id: item.id,
      name: item.displayName,
      code: item.ext.toUpperCase(),
      package: collectionLabels[item.collectionKey] || item.collectionKey,
      zone: floorLabels[item.floor] || item.floor,
      type: item.ext.toUpperCase(),
      sheetCount: 1,
      locationCount: 1,
      revision: inferRevision(item.displayName),
      status: mappedStatus || "needs_review",
      manifestStatus: item.status,
      role: item.sourceRole,
      tags: [
        disciplineLabels[item.discipline] || item.discipline,
        floorLabels[item.floor] || item.floor,
        item.availability,
        item.semanticConflict ? "semantic conflict" : "",
      ].filter(Boolean),
      sha256: item.sha256,
      duplicateGroup: item.duplicateGroup,
      duplicateCount: item.hashAliases.length + 1,
      semanticConflict: item.semanticConflict,
      availability: item.availability,
      sizeBytes: item.sizeBytes,
      claimStatus:
        item.availability === "cloud_placeholder"
          ? "unknown"
          : item.semanticConflict
            ? "interpreted"
            : "extracted",
      stages: inventoryStages(item),
      locations: [`${root?.displayPath || item.collectionKey}/${item.relativePath}`],
      note: inventoryNote(item),
    };
  }

  async function loadFullManifest() {
    try {
      const response = await fetch("./manifest.json", { cache: "no-store" });
      if (!response.ok) return;
      const manifest = await response.json();
      if (!Array.isArray(manifest.inventory) || manifest.inventory.length === 0) return;
      data = {
        ...data,
        schemaVersion: manifest.contractVersion,
        generatedAt: manifest.capturedAt,
        manifestSummary: {
          ...manifest.summary,
          currentMeaning: manifest.classificationRules.find(({ status }) => status === "current")?.meaning,
        },
        documents: manifest.inventory.map((item) => mapInventoryDocument(item, manifest)),
      };
    } catch {
      // Curated fallback from data.js remains fully usable when the manifest copy is absent.
    }
  }

  const pluralize = (count, forms) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  };

  function renderSummary() {
    const manifest = data.manifestSummary;
    const cards = [
      {
        value: manifest.physicalSources,
        label: "физических источников",
        note: `${manifest.materializedSources} доступны локально · ${manifest.cloudPlaceholders} cloud placeholders`,
        tone: "neutral",
      },
      {
        value: manifest.uniqueMaterializedBlobs,
        label: "уникальных локальных файлов",
        note: `${manifest.duplicateHashGroups} групп точных дублей`,
        tone: "positive",
      },
      {
        value: manifest.byStatus.current,
        label: "кандидата current",
        note: "Current не означает «утверждено»",
        tone: "neutral",
      },
      {
        value: manifest.semanticNameConflictGroups,
        label: "конфликтов имён и hash",
        note: "Изолированы до визуальной проверки",
        tone: "warning",
      },
    ];
    elements.summary.innerHTML = cards
      .map(
        (card) => `
          <article class="summary-card ${card.tone}">
            <strong>${card.value}</strong>
            <span>${card.label}</span>
            <small>${card.note}</small>
          </article>
        `,
      )
      .join("");
  }

  function renderPipeline() {
    elements.pipeline.innerHTML = data.pipeline
      .map(
        (stage) => `
          <li>
            <button
              type="button"
              class="pipeline-step ${stage.state} ${state.stage === stage.id ? "selected" : ""}"
              data-stage="${stage.id}"
              aria-pressed="${state.stage === stage.id}"
            >
              <span class="step-index">${stage.index}</span>
              <strong>${stage.title}</strong>
              <small>${stage.detail}</small>
              <span class="step-state" aria-hidden="true"></span>
            </button>
          </li>
        `,
      )
      .join("");
  }

  function populatePackageFilter() {
    const packages = [...new Set(data.documents.map((item) => item.package))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    );
    elements.packageFilter.insertAdjacentHTML(
      "beforeend",
      packages.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join(""),
    );
  }

  function filteredDocuments() {
    const normalizedQuery = state.query.trim().toLocaleLowerCase("ru");
    return data.documents.filter((item) => {
      const searchable = [item.name, item.code, item.package, item.zone, item.type, item.revision, ...item.tags]
        .join(" ")
        .toLocaleLowerCase("ru");
      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (state.package === "all" || item.package === state.package) &&
        (state.status === "all" ||
          item.status === state.status ||
          (state.status === "duplicate" && Boolean(item.duplicateGroup)) ||
          (state.status === "conflict" && item.semanticConflict) ||
          (state.status === "cloud" && item.availability === "cloud_placeholder")) &&
        (!state.stage || item.stages.includes(state.stage))
      );
    });
  }

  function renderDocuments() {
    const documents = filteredDocuments();
    elements.resultCount.textContent = `${documents.length} ${pluralize(documents.length, [
      "документ",
      "документа",
      "документов",
    ])}`;
    elements.empty.hidden = documents.length > 0;
    elements.body.innerHTML = documents
      .map(
        (item) => `
          <tr>
            <td data-label="Документ">
              <button class="document-link" type="button" data-document-id="${item.id}">
                <span class="file-icon ${item.type.toLowerCase()}">${escapeHtml(item.type.slice(0, 2))}</span>
                <span>
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(item.code)} · ${
                    item.availability === "cloud_placeholder"
                      ? "cloud placeholder"
                      : item.sizeBytes
                        ? formatBytes(item.sizeBytes)
                        : item.sheetCount > 1
                          ? `${item.sheetCount} листов`
                          : item.type
                  }${item.duplicateGroup ? ` · дубль ×${item.duplicateCount || 2}` : ""}</small>
                </span>
              </button>
            </td>
            <td data-label="Зона">${escapeHtml(item.zone)}</td>
            <td data-label="Ревизия"><span class="revision">${escapeHtml(item.revision)}</span></td>
            <td data-label="Роль"><span class="role-tag">${escapeHtml(roleLabels[item.role] || item.role)}</span></td>
            <td data-label="Статус">
              <span class="status-stack">
                <span class="status-tag ${item.status}">${escapeHtml(statusLabels[item.status])}</span>
                ${item.semanticConflict ? '<span class="status-tag conflict">Карантин</span>' : ""}
              </span>
            </td>
            <td data-label="Связи">
              <span class="evidence-count" title="Связано с этапами Project Intelligence">
                ${item.stages.length} <span aria-hidden="true">↗</span>
              </span>
            </td>
          </tr>
        `,
      )
      .join("");

    elements.activeFilter.hidden = !state.stage;
    if (state.stage) {
      const stage = data.pipeline.find((item) => item.id === state.stage);
      elements.activeFilterLabel.textContent = `Этап: ${stage?.title || state.stage}`;
    }
  }

  function renderInsights() {
    elements.insights.innerHTML = data.insights
      .map(
        (item) => `
          <button class="insight" type="button" data-source-name="${escapeHtml(item.source)}">
            <span class="claim ${item.status}" aria-hidden="true"></span>
            <span>
              <strong><b>${escapeHtml(item.value)}</b> ${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.detail)}</small>
              <em>${escapeHtml(item.source)}</em>
            </span>
          </button>
        `,
      )
      .join("");
  }

  function renderGaps() {
    elements.gapCount.textContent = String(data.gaps.length);
    elements.gaps.innerHTML = data.gaps
      .map(
        (gap, index) => `
          <button class="gap" type="button" data-gap-index="${index}">
            <span class="severity ${gap.severity}" aria-hidden="true"></span>
            <span>
              <strong>${escapeHtml(gap.title)}</strong>
              <small>${escapeHtml(gap.detail)}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        `,
      )
      .join("");
  }

  function openDocument(id) {
    const item = data.documents.find((documentItem) => documentItem.id === id);
    if (!item) return;
    elements.dialogKicker.textContent = `${item.type} · ${item.package}`;
    elements.dialogTitle.textContent = item.name;
    const locations = item.locations || ["Путь будет добавлен после canonical manifest"];
    elements.dialogContent.innerHTML = `
      <div class="dialog-status-row">
        <span class="status-tag ${item.status}">${escapeHtml(statusLabels[item.status])}</span>
        <span class="role-tag">${escapeHtml(roleLabels[item.role] || item.role)}</span>
        <span class="claim-label"><span class="claim ${item.claimStatus}"></span>${escapeHtml(
          claimLabels[item.claimStatus],
        )}</span>
      </div>
      <div class="detail-grid">
        <div><small>Код</small><strong>${escapeHtml(item.code)}</strong></div>
        <div><small>Зона</small><strong>${escapeHtml(item.zone)}</strong></div>
        <div><small>Ревизия</small><strong>${escapeHtml(item.revision)}</strong></div>
        <div><small>Доступность</small><strong>${
          item.availability === "cloud_placeholder" ? "Облачный placeholder" : "Локально"
        }</strong></div>
      </div>
      <section class="dialog-section">
        <h3>Решение Project Intelligence</h3>
        <p>${escapeHtml(item.note)}</p>
      </section>
      <section class="dialog-section">
        <h3>Происхождение</h3>
        <ul class="path-list">
          ${locations.map((location) => `<li><span aria-hidden="true">↳</span>${escapeHtml(location)}</li>`).join("")}
        </ul>
        ${item.sha256 ? `<p class="checksum"><span>SHA-256</span><code>${escapeHtml(item.sha256)}</code></p>` : ""}
      </section>
      <section class="dialog-section">
        <h3>Связь с workflow</h3>
        <div class="stage-tags">
          ${item.stages
            .map((stageId) => {
              const stage = data.pipeline.find((pipelineItem) => pipelineItem.id === stageId);
              return `<span>${escapeHtml(stage?.title || stageId)}</span>`;
            })
            .join("")}
        </div>
      </section>
    `;
    elements.dialog.showModal();
  }

  function resetFilters() {
    state.query = "";
    state.package = "all";
    state.status = "all";
    state.stage = null;
    elements.search.value = "";
    elements.packageFilter.value = "all";
    elements.statusFilter.value = "all";
    renderPipeline();
    renderDocuments();
  }

  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderDocuments();
  });
  elements.packageFilter.addEventListener("change", (event) => {
    state.package = event.target.value;
    renderDocuments();
  });
  elements.statusFilter.addEventListener("change", (event) => {
    state.status = event.target.value;
    renderDocuments();
  });
  elements.reset.addEventListener("click", resetFilters);
  elements.clearStage.addEventListener("click", () => {
    state.stage = null;
    renderPipeline();
    renderDocuments();
  });
  elements.pipeline.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stage]");
    if (!button) return;
    state.stage = state.stage === button.dataset.stage ? null : button.dataset.stage;
    renderPipeline();
    renderDocuments();
    document.querySelector("#documents").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-document-id]");
    if (button) openDocument(button.dataset.documentId);
  });
  elements.gaps.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gap-index]");
    if (!button) return;
    const gap = data.gaps[Number(button.dataset.gapIndex)];
    state.query = gap.query || "";
    state.package = "all";
    state.status = "all";
    state.stage = null;
    elements.search.value = state.query;
    elements.packageFilter.value = "all";
    elements.statusFilter.value = "all";
    renderPipeline();
    renderDocuments();
    [...elements.body.querySelectorAll("tr")].forEach((row) => row.classList.add("highlighted"));
    document.querySelector("#documents").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.dialogClose.addEventListener("click", () => elements.dialog.close());
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.search.focus();
    }
  });

  async function initialize() {
    await loadFullManifest();
    populatePackageFilter();
    renderSummary();
    renderPipeline();
    renderDocuments();
    renderInsights();
    renderGaps();
  }

  initialize();
})();
