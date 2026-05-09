/**
 * MWA Provider — Solana Mobile Wallet Adapter registration.
 *
 * Comadre is a thin client; all transaction signing happens server-side
 * via Privy. This provider is included for Solana Mobile dApp Store
 * compliance and the Solana Mobile prize requirement.
 *
 * NOTE: @solana-mobile/wallet-adapter-mobile v2.2.8 does NOT export a
 * MobileWalletAdapterProvider component. The MWA integration happens at
 * the native Android layer (intent-filter in app.json + AndroidManifest).
 * This provider is a stub for now. Full MWA integration requires native
 * module setup on a physical Android device.
 */
import React, { type ReactNode } from "react";

interface MWAProviderProps {
  children: ReactNode;
}

export function MWAProvider({ children }: MWAProviderProps) {
  return <>{children}</>;
}
