# @comadre/indexer

Recibe webhooks de Helius. Parsea logs Anchor con `EventParser`. Materializa estado on-chain a Postgres.

**Port:** 3004
**Routes:** `POST /webhook`, `POST /reindex` (admin)

Eventos manejados:
- TandaCreated, MemberJoined, ContributionMade, PayoutExecuted, TandaCompleted
- DisputeOpened, DisputeVoted, DisputeResolved
- LoanRequested, LoanCosigned, LoanDisbursed, LoanRepaid, LoanDefaulted
- BadgeMinted, KycTierUpdated
