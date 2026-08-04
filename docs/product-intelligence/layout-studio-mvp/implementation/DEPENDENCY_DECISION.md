# Layout Studio dependency decision

## Existing stack

Next.js 16.2.10, React 18.3.1, TypeScript 5.6.3, Zod 3.23.8 and Vitest 4.1.10.

## Decision

- Domain, application, SVG projection, local persistence and deterministic exports use
  platform APIs and the existing stack.
- `three` is the only proposed runtime addition, isolated behind
  `lib/layout-studio/adapters/three/**`; its version must be verified before install.
- No CAD, geometry kernel, state manager, UI kit, database or AI dependency is added.
- PNG is produced at the browser boundary from SVG/canvas; canonical JSON/SVG and the
  sidecar manifest remain deterministic.
