import { describe, expect, test } from "bun:test";

import { toolsForWalletState } from "../agentLoop.js";

describe("agent tool surface", () => {
  test("keeps onboarding available before a wallet exists", () => {
    const names = toolsForWalletState(null).map((tool) => tool.function.name);
    expect(names).toContain("iniciar_onboarding");
  });

  test("hides onboarding once the user already has a wallet", () => {
    const names = toolsForWalletState("11111111111111111111111111111111").map(
      (tool) => tool.function.name,
    );
    expect(names).not.toContain("iniciar_onboarding");
    expect(names).toContain("consultar_guardadito");
  });
});
