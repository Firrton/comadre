import type { Metadata } from "next";
import { Newsreader, Petrona, Outfit, Caveat } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["italic"],
  variable: "--font-newsreader",
});

const petrona = Petrona({
  subsets: ["latin"],
  variable: "--font-petrona",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  title: "Comadre. — tu vecina de confianza, en tu teléfono",
  description:
    "Manda plata, ahorra de a poquito y organiza tandas, todo por WhatsApp. Como si te ayudara una vecina, no un banco.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${newsreader.variable} ${petrona.variable} ${outfit.variable} ${caveat.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
