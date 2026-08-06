import { describe, expect, it } from "vitest";

import { semanticHash, type LayoutDocument } from "@/lib/layout-studio/domain";
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  projectCeoCommandSchema,
} from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { makeSimpleRoom } from "@/tests/layout-studio/application/layout-test-fixture";

const uuid = {
  command: "20000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000002",
  package: "20000000-0000-4000-8000-000000000003",
  revision: "20000000-0000-4000-8000-000000000004",
  expectedRevision: "20000000-0000-4000-8000-000000000005",
} as const;

const LAYOUT_SCHEMA_VERSION = "project-ceo-m2-layout/0.1" as const;
const MAX_LAYOUT_CONTENT_BYTES = 65_536;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type MutableCommandFixture = {
  contractVersion: string;
  commandId: string;
  projectId: string;
  kind: string;
  payload: {
    packageId: string;
    documentId: string;
    versionId: string;
    revisionId: string;
    expectedRevisionId: string | null;
    roomId: string;
    variantId: string;
    role: string;
    semanticHash: string;
    schemaVersion: string;
    layoutContent: LayoutDocument | Record<string, JsonValue>;
    reason: string;
  };
};

async function validCommand(): Promise<MutableCommandFixture> {
  const layoutContent = makeSimpleRoom();
  layoutContent.documentId = "living-room-layout";
  layoutContent.projectId = uuid.project;
  layoutContent.variant.id = "variant-preferred";

  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    commandId: uuid.command,
    projectId: uuid.project,
    kind: "publish_m2_layout_version",
    payload: {
      packageId: uuid.package,
      documentId: "living-room-layout",
      versionId: "living-room-layout@3",
      revisionId: uuid.revision,
      expectedRevisionId: uuid.expectedRevision,
      roomId: "living-room",
      variantId: "variant-preferred",
      role: "preferred",
      semanticHash: `sha256:${await semanticHash(layoutContent)}`,
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      layoutContent,
      reason: "Публикация согласуемой версии планировки",
    },
  };
}

type InvalidCase = {
  name: string;
  mutate: (command: MutableCommandFixture) => void;
};

const invalidCases: InvalidCase[] = [
  {
    name: "rejects unknown command fields",
    mutate: (command) => Object.assign(command, { unexpected: true }),
  },
  {
    name: "rejects unknown payload fields",
    mutate: (command) => Object.assign(command.payload, { unexpected: true }),
  },
  {
    name: "rejects a non-UUID package id",
    mutate: (command) => {
      command.payload.packageId = "package-1";
    },
  },
  {
    name: "rejects blank identifiers",
    mutate: (command) => {
      command.payload.documentId = "";
    },
  },
  {
    name: "rejects identifiers longer than 160 characters",
    mutate: (command) => {
      command.payload.versionId = "x".repeat(161);
    },
  },
  {
    name: "rejects untrimmed identifiers instead of normalizing them",
    mutate: (command) => {
      command.payload.roomId = " living-room ";
    },
  },
  {
    name: "rejects an invalid revision UUID",
    mutate: (command) => {
      command.payload.revisionId = "revision-1";
    },
  },
  {
    name: "rejects an untrimmed expected revision id",
    mutate: (command) => {
      command.payload.expectedRevisionId = ` ${uuid.expectedRevision}`;
    },
  },
  {
    name: "rejects a role outside the three M2 variant roles",
    mutate: (command) => {
      command.payload.role = "standard";
    },
  },
  {
    name: "rejects uppercase semantic hashes",
    mutate: (command) => {
      command.payload.semanticHash = `sha256:${"A".repeat(64)}`;
    },
  },
  {
    name: "rejects malformed semantic hashes",
    mutate: (command) => {
      command.payload.semanticHash = "sha256:not-a-hash";
    },
  },
  {
    name: "rejects any other layout schema version",
    mutate: (command) => {
      command.payload.schemaVersion = "project-ceo-m2-layout/0.2";
    },
  },
  {
    name: "rejects an array as layout content",
    mutate: (command) => {
      command.payload.layoutContent = [] as unknown as Record<string, JsonValue>;
    },
  },
  {
    name: "rejects empty layout content",
    mutate: (command) => {
      command.payload.layoutContent = {};
    },
  },
  {
    name: "rejects layout content larger than 65536 serialized UTF-8 bytes",
    mutate: (command) => {
      command.payload.layoutContent = { data: "я".repeat(MAX_LAYOUT_CONTENT_BYTES) };
    },
  },
  {
    name: "rejects non-finite layout numbers",
    mutate: (command) => {
      command.payload.layoutContent = { xMm: Number.POSITIVE_INFINITY };
    },
  },
  {
    name: "rejects unsafe layout integers",
    mutate: (command) => {
      command.payload.layoutContent = { xMm: Number.MAX_SAFE_INTEGER + 1 };
    },
  },
  {
    name: "rejects undefined nested layout values instead of silently dropping them",
    mutate: (command) => {
      command.payload.layoutContent = { object: { id: undefined } } as unknown as Record<
        string,
        JsonValue
      >;
    },
  },
  {
    name: "rejects bigint layout values that cannot be serialized as JSON",
    mutate: (command) => {
      command.payload.layoutContent = { xMm: 1n } as unknown as Record<string, JsonValue>;
    },
  },
  {
    name: "rejects client-supplied actor fields",
    mutate: (command) => Object.assign(command.payload, { actorId: uuid.command }),
  },
  {
    name: "rejects client-supplied organization fields",
    mutate: (command) => Object.assign(command.payload, { organizationId: uuid.project }),
  },
  {
    name: "rejects client-supplied publication timestamps",
    mutate: (command) =>
      Object.assign(command.payload, { publishedAt: "2026-08-06T12:00:00+08:00" }),
  },
  {
    name: "rejects a blank reason",
    mutate: (command) => {
      command.payload.reason = "  ";
    },
  },
  {
    name: "rejects a reason longer than 4000 characters",
    mutate: (command) => {
      command.payload.reason = "x".repeat(4001);
    },
  },
];

describe("publish_m2_layout_version command contract", () => {
  it("accepts a strict request-bound immutable M2 LayoutDocument version", async () => {
    const result = projectCeoCommandSchema.safeParse(await validCommand());

    expect(result.success).toBe(true);

    const withoutExpectedRevision = await validCommand();
    withoutExpectedRevision.payload.expectedRevisionId = null;
    expect(projectCeoCommandSchema.safeParse(withoutExpectedRevision).success).toBe(true);
  });

  it("requires one of the three explicit M2 variant roles", async () => {
    const command = await validCommand();
    delete (command.payload as Partial<MutableCommandFixture["payload"]>).role;

    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });

  it.each(["preferred", "value_engineered", "premium"] as const)(
    "accepts the domain M2 variant role %s",
    async (role) => {
      const command = await validCommand();
      command.payload.role = role;

      expect(projectCeoCommandSchema.safeParse(command).success).toBe(true);
    },
  );

  it.each([
    ["document id", (command: MutableCommandFixture) => { command.payload.documentId = "another-document"; }],
    ["project id", (command: MutableCommandFixture) => { command.payload.layoutContent.projectId = uuid.package; }],
    ["variant id", (command: MutableCommandFixture) => { command.payload.variantId = "another-variant"; }],
  ] as const)("rejects an envelope %s that differs from embedded LayoutDocument content", async (_label, mutate) => {
    const command = await validCommand();
    mutate(command);

    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });

  it("requires the declared semantic hash to match canonical LayoutDocument content", async () => {
    const command = await validCommand();
    const layout = command.payload.layoutContent as LayoutDocument;
    layout.nodes.reverse();
    layout.stateRevision += 1;

    expect(command.payload.semanticHash).toBe(`sha256:${await semanticHash(layout)}`);
    expect(projectCeoCommandSchema.safeParse(command).success).toBe(true);

    layout.objects[0]!.xMm += 1;
    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });

  it("rejects excessive JSON depth without throwing or overflowing the stack", async () => {
    const command = await validCommand();
    let nested: Record<string, JsonValue> = {};
    const root = nested;
    for (let depth = 0; depth < 1_000; depth += 1) {
      nested.next = {};
      nested = nested.next as Record<string, JsonValue>;
    }
    command.payload.layoutContent = root;

    expect(() => projectCeoCommandSchema.safeParse(command)).not.toThrow();
    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });

  it("rejects a LayoutDocument with an excessive node count", async () => {
    const command = await validCommand();
    const layout = command.payload.layoutContent as LayoutDocument;
    layout.nodes = Array.from({ length: 10_001 }, (_, index) => ({
      id: `node.limit.${index}`,
      xMm: index,
      yMm: 0,
      locked: false,
    }));
    command.payload.semanticHash = `sha256:${await semanticHash(layout)}`;

    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });

  it.each(invalidCases)("$name", async ({ mutate }) => {
    const command = await validCommand();
    mutate(command);

    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });
});
