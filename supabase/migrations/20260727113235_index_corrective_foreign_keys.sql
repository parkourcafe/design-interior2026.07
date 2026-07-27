-- Cover foreign keys introduced by the corrective governance migrations.

create index if not exists proposal_revisions_created_by_idx
  on public.proposal_revisions(created_by);

create index if not exists proposals_issued_revision_idx
  on public.proposals(issued_revision_id);
