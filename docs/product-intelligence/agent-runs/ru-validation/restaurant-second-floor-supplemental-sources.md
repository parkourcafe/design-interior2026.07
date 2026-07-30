# Supplemental RU sources discovered locally

Scope is now the full local Kora Food Hall project, not only the Second Floor folder.
Included source families are: `KORA_Construction` drawings and MEP, first/second-floor
PDF/DWG sets, existing-condition references, second-floor toilet package, BOQ/volume
calculation, design brief and designer TZ. Website, branding, outreach and legal files
are retained as contextual references but are not construction baseline inputs.

The following documents are available in the KORA project folders and are included
in the source register for the RU fixture:

| Source | Role | SHA-256 |
|---|---|---|
| `Kora Food Hall - Volume Calculation.xlsx` | quantity/volume input for estimate baseline | `fe1fd85e50a6516734d909af7fa6726171503622e5bf02f13b8d2cbe8e75e531` |
| `KORA ORA Design Brief v1 2.docx` | project brief and scope context | `e8366e438b047859730e0ab9d24491bf35831e5e55ece5f9fe42a9c11345cca9` |
| `KORA_TZ_Designer.docx` | designer task/specification context | `d6ba561f57cca8806ac86d9e20b74943efdf2a8bc7ffbad5a95add121f87a25a` |
| `2st floor size_250719_211919.pdf` | existing second-floor reference | pending hash |

Import policy:

1. Drawing PDFs and the drawing list establish the deliverable baseline.
2. The volume workbook supplies quantity candidates; it does not silently become an
   approved estimate.
3. Brief/TZ documents become provenance sources and assumptions.
4. Every extracted value remains `unknown` or `interpreted` until human review.

No source has been uploaded to production. The next implementation step is a local
source-ingestion manifest and human-review queue for this package.
