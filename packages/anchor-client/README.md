# @comadre/anchor-client

TypeScript client typed-codegen del programa Anchor. Regenerar tras cualquier cambio en `anchor-program`:

```bash
bun run codegen   # ejecuta scripts/codegen-client.sh
```

Exporta:
- `IDL` — del programa
- `Program<Comadre>` type
- PDA helpers (`deriveUserPda`, `deriveTandaPda`, etc.)
- Instruction builders typed
