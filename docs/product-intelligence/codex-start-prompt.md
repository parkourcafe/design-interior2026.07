# Стартовый prompt для Codex

Продолжай переход ArchiDom к Project Intelligence Core в репозитории `repo/`.

Если работа запускается несколькими агентами, сначала прочитай `docs/product-intelligence/multi-agent/README.md` и используй только назначенное агенту ТЗ/пути. Не позволяй двум агентам менять один файл.

Сначала полностью прочитай:

1. `docs/product-intelligence/README.md`;
2. `docs/product-intelligence/architecture-v0.1.md`;
3. `docs/product-intelligence/project-graph.md`;
4. `docs/product-intelligence/technical-audit-2026-07-16.md`;
5. `docs/product-intelligence/codex-execution-spec.md`;
6. все файлы `docs/product-intelligence/adr/`;
7. локальные `AGENTS.md`/`CLAUDE.md`, только если они реально материализованы и читаются.

Текущий первый work item — **PI-001**, затем **PI-002**. Не начинай новую database migration, пока не выполнены оба гейта:

- `git status` достоверно работает и сохранены все uncommitted изменения;
- восстановлена и проверена непрерывная migration chain `0001…0009` против пустой и живой database.

Сохраняй текущий M1 workflow. Новая схема вводится additive и через dual-write/projection. Не превращай legacy `project_rooms` в физические помещения: это collaboration workspace. Не делай одновременно полноценные Studio и Renovation workflows.

Для любого нового graph-кода используй публичный контракт `lib/project-intelligence`. Change-impact остаётся детерминированным; AI не имеет права назначать human status или создавать скрытый impact без сохранённой связи.

Перед изменениями:

- покажи обнаруженный baseline и dirty files;
- назови конкретный backlog ID;
- перечисли файлы и acceptance criteria;
- проверь, что работа не зависит от человеческого выбора build-track.

После изменений выполни `lint`, `typecheck`, `test`, `build`, обнови verification report и остановись на следующем гейте, требующем production access или решения владельца.
