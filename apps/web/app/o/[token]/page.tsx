"use client";

// State machine: validating -> ready -> authenticating -> finalizing -> installing -> done | error
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
// Import the client-safe module directly: the sessionKey barrel re-exports
// sign/revoke, which pull @comadre/config env validation and the Turnkey
// server SDK into the browser bundle and blank the page on hydration.
import { approveSessionKey } from "@comadre/wallet-infra/sessionKey/approve";
import { monadTestnet } from "@comadre/wallet-infra/chains";
import type { Address } from "viem";

type SessionConfig = {
  privyAppId: string;
  chainId: number;
  comadreContractAddress: Address | null;
  usdcAddress: Address | null;
};

type Step =
  | { kind: "validating" }
  | { kind: "ready"; config: SessionConfig }
  | { kind: "authenticating"; config: SessionConfig }
  | { kind: "finalizing"; config: SessionConfig }
  | { kind: "installing"; config: SessionConfig }
  | { kind: "done" }
  | { kind: "error"; message: string };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER ?? "5491100000000";

export default function OnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/onboarding/monad/session/${token}`);
        if (!res.ok) throw new Error("bad token");
        const data = (await res.json()) as SessionConfig;
        if (!aborted) setConfig(data);
      } catch {
        if (!aborted) setBootError("Algo salió mal. ¿Probamos de nuevo?");
      }
    })();
    return () => {
      aborted = true;
    };
  }, [token]);

  if (bootError) {
    return (
      <Shell>
        <ErrorView message={bootError} onRetry={() => window.location.reload()} />
      </Shell>
    );
  }

  if (!config) {
    return (
      <Shell>
        <WaitScreen
          icon="/brand/icons/cafe-barro.svg"
          title="Preparando tu cuenta…"
          note="Tía Vera está poniendo todo en orden"
        />
      </Shell>
    );
  }

  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        loginMethods: ["sms"],
      }}
    >
      <OnboardingFlow token={token} config={config} />
    </PrivyProvider>
  );
}

function OnboardingFlow({ token, config }: { token: string; config: SessionConfig }) {
  const [step, setStep] = useState<Step>({ kind: "ready", config });
  const { login, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();

  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy"),
    [wallets],
  );

  const { getAccessToken } = usePrivy();

  const runInstall = useCallback(
    async (ownerAddress: Address) => {
      if (!user) throw new Error("missing user");

      // Audit COM-026/COM-027: phoneJwt is now required by both backend endpoints.
      const phoneJwt = await getAccessToken();
      if (!phoneJwt) throw new Error("missing privy access token");

      setStep({ kind: "finalizing", config });
      const finalizeRes = await fetch(
        `${API_BASE}/api/v1/onboarding/monad/finalize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, privyUserId: user.id, ownerAddress, phoneJwt }),
        },
      );
      if (!finalizeRes.ok) throw new Error("finalize failed");
      const { sessionAddress } = (await finalizeRes.json()) as {
        sessionAddress: Address;
      };

      setStep({ kind: "installing", config });

      // Contracts not deployed yet: skip on-chain approval, backend finishes later.
      if (!config.comadreContractAddress || !config.usdcAddress) {
        setStep({ kind: "done" });
        return;
      }

      if (!embedded) throw new Error("no embedded wallet");
      const provider = await embedded.getEthereumProvider();
      const { serializedBlob, smartWalletAddress } = await approveSessionKey({
        privyProvider: provider,
        sessionAddress,
        comadreAddress: config.comadreContractAddress,
        usdcAddress: config.usdcAddress,
        kind: "daily",
      });

      const installRes = await fetch(
        `${API_BASE}/api/v1/onboarding/monad/install-session-key`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, serializedBlob, smartWalletAddress, phoneJwt }),
        },
      );
      if (!installRes.ok) throw new Error("install failed");
      setStep({ kind: "done" });
    },
    [config, embedded, token, user, getAccessToken],
  );

  useEffect(() => {
    if (step.kind !== "authenticating") return;
    if (!authenticated || !embedded) return;
    const ownerAddress = embedded.address as Address;
    runInstall(ownerAddress).catch(() =>
      setStep({ kind: "error", message: "Algo salió mal. ¿Probamos de nuevo?" }),
    );
  }, [authenticated, embedded, runInstall, step.kind]);

  const handleStart = () => {
    setStep({ kind: "authenticating", config });
    login();
  };

  const handleRetry = () => setStep({ kind: "ready", config });

  const statusText: Record<Step["kind"], string> = {
    validating: "Preparando tu cuenta",
    ready: "",
    authenticating: "Confirmando tu número",
    finalizing: "Configurando tu seguridad",
    installing: "Casi listo, último paso",
    done: "Listo. Vuelve a WhatsApp y seguimos charlando.",
    error: step.kind === "error" ? step.message : "",
  };

  return (
    <Shell>
      {/* Persistent live region: screen readers announce step changes
          reliably only when content changes inside an existing region. */}
      <p aria-live="polite" role="status" className="sr-only">
        {statusText[step.kind]}
      </p>
      {step.kind === "ready" && (
        <>
          <h1 className="font-headline text-2xl font-semibold">
            Te llega un código por SMS.
          </h1>
          <p className="mt-3 text-base text-olivo">
            Toca Continuar y sigue los pasos para confirmar tu número.
          </p>
          <button
            onClick={handleStart}
            disabled={!ready}
            className="mt-8 w-full rounded-full bg-olivo px-6 py-4 text-lg font-semibold text-papel active:bg-hoja disabled:opacity-50"
          >
            Continuar
          </button>
        </>
      )}
      {step.kind === "authenticating" && (
        <WaitScreen
          icon="/brand/icons/telefono-nopal.svg"
          title="Confirmando tu número…"
          note="revisa tus mensajes"
        />
      )}
      {step.kind === "finalizing" && (
        <WaitScreen
          icon="/brand/icons/escudo-nopal.svg"
          title="Configurando tu seguridad…"
          note="tu dinero, en buenas manos"
        />
      )}
      {step.kind === "installing" && (
        <WaitScreen
          icon="/brand/icons/sol-miel.svg"
          title="Casi listo, último paso…"
          note="de a poquito, todo se logra"
        />
      )}
      {step.kind === "done" && (
        <>
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-papel">
            <Image
              src="/brand/icons/corazon-barro.svg"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11"
            />
          </span>
          <h1 className="mt-4 font-headline text-2xl font-semibold">¡Listo!</h1>
          <p className="mt-3 text-base text-olivo">
            Vuelve a WhatsApp y seguimos charlando.
          </p>
          <a
            href={`https://wa.me/${WA_NUMBER}`}
            className="mt-8 inline-block w-full rounded-full bg-olivo px-6 py-4 text-center text-lg font-semibold text-papel active:bg-hoja"
          >
            Abrir WhatsApp
          </a>
        </>
      )}
      {step.kind === "error" && (
        <ErrorView message={step.message} onRetry={handleRetry} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-papel px-5">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-sm">
        <span className="font-headline text-xl font-semibold">
          Comadre<span className="text-barro">.</span>
        </span>
        <Image
          src="/brand/tia-vera.png"
          alt=""
          width={72}
          height={72}
          className="mx-auto mt-4 rounded-full"
        />
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

function WaitScreen({
  icon,
  title,
  note,
}: {
  icon: string;
  title: string;
  note: string;
}) {
  return (
    <div>
      <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-papel">
        <Image
          src={icon}
          alt=""
          width={56}
          height={56}
          className="gentle-pulse h-14 w-14"
        />
      </span>
      <p className="mt-6 text-lg font-medium">{title}</p>
      <p className="mt-2 font-hand text-2xl text-barro">{note}</p>
      <span
        aria-hidden="true"
        className="wait-dots mt-5 flex items-center justify-center gap-1.5"
      >
        <i className="bg-olivo" />
        <i className="bg-olivo" />
        <i className="bg-olivo" />
      </span>
    </div>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <p className="text-4xl">😕</p>
      <h1 className="mt-4 font-headline text-2xl font-semibold">Ups</h1>
      <p className="mt-3 text-base text-olivo">{message}</p>
      <button
        onClick={onRetry}
        className="mt-8 w-full rounded-full bg-olivo px-6 py-4 text-lg font-semibold text-papel active:bg-hoja"
      >
        Reintentar
      </button>
    </>
  );
}
