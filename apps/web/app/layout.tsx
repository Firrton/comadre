// TODO: root layout
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

export const metadata = {
  title: "Comadre",
  description: "AI Agent Tía de LATAM — tandas + USDC + Solana",
};
