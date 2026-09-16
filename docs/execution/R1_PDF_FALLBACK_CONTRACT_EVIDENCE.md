# R1 architect-provided PDF fallback contract

This package defines an input contract only. It does not parse DWG, render a
preview, write a database record, expose a browser route, or create an approval.

The contract accepts opaque IDs for a DWG asset version, an independently
measured PDF asset version, a representation version, a pair-attestation ID and
the existing bounded documentation `sheet_id` plus `revision_id`. It requires an explicit architect-provided
producer marker, the frozen `unconfirmed` conversion status, finite page/crop/
rotation/units/axes metadata and an invertible page-to-preview transform.

The mandatory visible label is: `PDF предоставлен архитектором; DWG conversion
не подтверждён`.

The next persistence package must re-derive current request scope, actor and
capability; look up all IDs server-side; bind immutable byte identities; create
the durable pair attestation and sheet sidecar atomically; and preserve old
attestations. This contract is not an architect decision, does not prove PDF or
DWG fidelity, and cannot promote a fallback to a native-DWG acceptance.
