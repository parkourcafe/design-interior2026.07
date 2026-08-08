import { describe, expect, it } from 'vitest';
import {
  PROJECTCEO_COMMAND_CONTRACT_VERSION,
  projectCeoCommandSchema,
} from '@/lib/project-intelligence/delivery/projectceo/command-contract';

const uuid = {
  command: '10000000-0000-4000-8000-000000000001',
  project: '10000000-0000-4000-8000-000000000002',
  package: '10000000-0000-4000-8000-000000000003',
  revision: '10000000-0000-4000-8000-000000000004',
  expectedRevision: '10000000-0000-4000-8000-000000000005',
} as const;

type MutableCommandFixture = {
  contractVersion: string;
  commandId: string;
  projectId: string;
  kind: string;
  payload: {
    packageId: string;
    commitId: string;
    revisionId: string;
    expectedRevisionId: string | null;
    approvalPackageId: string;
    roomId: string;
    designIntentRevisionId: string;
    chosenVariant: {
      variantId: string;
      role: string;
      layoutDocumentId: string;
      layoutVersionId: string;
      semanticHash: string;
    };
    approvedSelectionRevisionIds: string[];
    budget: {
      asOf: string;
      staleAfterDays: number;
      amountRub: number;
      staleSelectionRevisionIds: string[];
      missingPriceSelectionRevisionIds: string[];
    };
    submittedAt: string;
    reviewedAt: string;
    submissionReason: string;
    reviewReason: string;
  };
};

function validCommand(): MutableCommandFixture {
  return {
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    commandId: uuid.command,
    projectId: uuid.project,
    kind: 'commit_m2_approval',
    payload: {
      packageId: uuid.package,
      commitId: 'commit-42',
      revisionId: uuid.revision,
      expectedRevisionId: uuid.expectedRevision,
      approvalPackageId: 'approval-package-42',
      roomId: 'living-room',
      designIntentRevisionId: 'design-intent-r7',
      chosenVariant: {
        variantId: 'variant-premium',
        role: 'premium',
        layoutDocumentId: 'layout-document-1',
        layoutVersionId: 'layout-version-3',
        semanticHash: `sha256:${'a'.repeat(64)}`,
      },
      approvedSelectionRevisionIds: ['selection-r1', 'selection-r2'],
      budget: {
        asOf: '2026-08-06T10:15:30+08:00',
        staleAfterDays: 30,
        amountRub: 1250000,
        staleSelectionRevisionIds: [],
        missingPriceSelectionRevisionIds: [],
      },
      submittedAt: '2026-08-06T10:15:30+08:00',
      reviewedAt: '2026-08-06T11:00:00+08:00',
      submissionReason: 'Дизайн-пакет готов к согласованию',
      reviewReason: 'Вариант и выборы согласованы',
    },
  };
}

type InvalidCase = {
  name: string;
  mutate: (command: MutableCommandFixture) => void;
};

const invalidCases: InvalidCase[] = [
  {
    name: 'rejects unknown command fields',
    mutate: (command) => Object.assign(command, { unexpected: true }),
  },
  {
    name: 'rejects unknown payload fields',
    mutate: (command) => Object.assign(command.payload, { unexpected: true }),
  },
  {
    name: 'rejects unknown chosen-variant fields',
    mutate: (command) => Object.assign(command.payload.chosenVariant, { unexpected: true }),
  },
  {
    name: 'rejects unknown budget fields',
    mutate: (command) => Object.assign(command.payload.budget, { unexpected: true }),
  },
  {
    name: 'rejects duplicate approved selections',
    mutate: (command) => {
      command.payload.approvedSelectionRevisionIds = ['selection-r1', 'selection-r1'];
    },
  },
  {
    name: 'rejects an empty approved-selection list',
    mutate: (command) => {
      command.payload.approvedSelectionRevisionIds = [];
    },
  },
  {
    name: 'rejects more than 500 approved selections',
    mutate: (command) => {
      command.payload.approvedSelectionRevisionIds = Array.from(
        { length: 501 },
        (_, index) => `selection-${index}`,
      );
    },
  },
  {
    name: 'rejects blank identifiers',
    mutate: (command) => {
      command.payload.commitId = '   ';
    },
  },
  {
    name: 'rejects identifiers longer than 160 characters',
    mutate: (command) => {
      command.payload.chosenVariant.layoutVersionId = 'x'.repeat(161);
    },
  },
  {
    name: 'rejects untrimmed identifiers',
    mutate: (command) => {
      command.payload.roomId = ' living-room ';
    },
  },
  {
    name: 'rejects an invalid variant role',
    mutate: (command) => {
      command.payload.chosenVariant.role = 'standard';
    },
  },
  {
    name: 'rejects an invalid semantic hash',
    mutate: (command) => {
      command.payload.chosenVariant.semanticHash = `sha256:${'A'.repeat(64)}`;
    },
  },
  {
    name: 'rejects a negative RUB amount',
    mutate: (command) => {
      command.payload.budget.amountRub = -1;
    },
  },
  {
    name: 'rejects an unsafe RUB amount',
    mutate: (command) => {
      command.payload.budget.amountRub = Number.MAX_SAFE_INTEGER + 1;
    },
  },
  {
    name: 'rejects a non-positive staleness period',
    mutate: (command) => {
      command.payload.budget.staleAfterDays = 0;
    },
  },
  {
    name: 'rejects a non-integer staleness period',
    mutate: (command) => {
      command.payload.budget.staleAfterDays = 1.5;
    },
  },
  {
    name: 'rejects stale selections',
    mutate: (command) => {
      command.payload.budget.staleSelectionRevisionIds = ['selection-r1'];
    },
  },
  {
    name: 'rejects selections with missing prices',
    mutate: (command) => {
      command.payload.budget.missingPriceSelectionRevisionIds = ['selection-r2'];
    },
  },
  {
    name: 'rejects timestamps without an offset',
    mutate: (command) => {
      command.payload.submittedAt = '2026-08-06T10:15:30';
    },
  },
  {
    name: 'rejects review before submission',
    mutate: (command) => {
      command.payload.reviewedAt = '2026-08-06T09:00:00+08:00';
    },
  },
  {
    name: 'rejects client-supplied actor fields',
    mutate: (command) => Object.assign(command.payload, { actorId: uuid.command }),
  },
  {
    name: 'rejects client-supplied scope fields',
    mutate: (command) => Object.assign(command.payload, { organizationId: uuid.project }),
  },
  {
    name: 'rejects client-supplied system fields',
    mutate: (command) =>
      Object.assign(command.payload, { committedAt: '2026-08-06T11:01:00+08:00' }),
  },
];

describe('commit_m2_approval command contract', () => {
  it('accepts a valid request-bound M2 approval commit', () => {
    expect(projectCeoCommandSchema.safeParse(validCommand()).success).toBe(true);

    const withoutExpectedRevision = validCommand();
    withoutExpectedRevision.payload.expectedRevisionId = null;
    expect(projectCeoCommandSchema.safeParse(withoutExpectedRevision).success).toBe(true);
  });

  it.each(['preferred', 'value_engineered', 'premium'] as const)(
    'accepts the domain M2 variant role %s',
    (role) => {
      const command = validCommand();
      command.payload.chosenVariant.role = role;

      const result = projectCeoCommandSchema.safeParse(command);

      expect(result.success).toBe(true);
      if (result.success && result.data.kind === 'commit_m2_approval') {
        expect(result.data.payload.chosenVariant.role).toBe(role);
      }
    },
  );

  it.each(invalidCases)('$name', ({ mutate }) => {
    const command = validCommand();
    mutate(command);
    expect(projectCeoCommandSchema.safeParse(command).success).toBe(false);
  });
});
