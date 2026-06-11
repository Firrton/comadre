import Image from "next/image";
import Link from "next/link";
import { ChatDemo } from "./components/ChatDemo";
import {
  CoinsGlyph,
  EnvelopeGlyph,
  PlantPotGlyph,
  SproutGlyph,
} from "./components/glyphs";

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER ?? "5491100000000";
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hola Comadre 👋")}`;

function WhatsAppButton({
  label,
  onDark = false,
}: {
  label: string;
  onDark?: boolean;
}) {
  return (
    <a
      href={WA_LINK}
      className={`inline-block rounded-full px-8 py-4 text-lg font-medium shadow-md transition-colors ${
        onDark
          ? "bg-miel text-hoja hover:bg-papel"
          : "bg-olivo text-papel hover:bg-hoja"
      }`}
    >
      {label}
    </a>
  );
}

function Wordmark() {
  return (
    <span className="font-headline text-2xl font-semibold text-hoja">
      Comadre<span className="text-barro">.</span>
    </span>
  );
}

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-20 pt-14 text-center">
        <Wordmark />
        <Image
          src="/brand/tia-vera.png"
          alt="Tía Vera, la cara de Comadre"
          width={144}
          height={144}
          priority
          className="mt-10 rounded-full"
        />
        <h1 className="mt-8 font-display text-5xl italic leading-tight sm:text-6xl">
          Tu dinero, en buenas manos<span className="text-barro">.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-olivo">
          Como si te ayudara una vecina, no un banco. Manda plata, ahorra de a
          poquito y organiza tandas — todo desde WhatsApp.
        </p>
        <div className="mt-10">
          <WhatsAppButton label="Escríbele a Comadre" />
        </div>
        <p aria-hidden="true" className="mt-4 font-hand text-2xl text-barro">
          tu vecina de confianza, en tu teléfono
        </p>
      </section>

      {/* Qué hace */}
      <section className="bg-hoja px-6 py-16 text-papel">
        <div className="mx-auto grid max-w-4xl gap-10 sm:grid-cols-3">
          <div>
            <EnvelopeGlyph />
            <h2 className="mt-4 font-headline text-xl text-miel">
              Manda y recibe
            </h2>
            <p className="mt-3 text-papel/80">
              Dile a quién y cuánto. Comadre confirma contigo antes de mover un
              solo peso.
            </p>
          </div>
          <div>
            <SproutGlyph />
            <h2 className="mt-4 font-headline text-xl text-miel">
              Ahorra de a poquito
            </h2>
            <p className="mt-3 text-papel/80">
              Tu ahorrito crece semana a semana, sin que tengas que pensarlo.
            </p>
          </div>
          <div>
            <CoinsGlyph />
            <h2 className="mt-4 font-headline text-xl text-miel">
              Organiza tu tanda
            </h2>
            <p className="mt-3 text-papel/80">
              Cada quien pone un poquito y una recibe el pozo. Las cuentas
              claras, sin enredos.
            </p>
          </div>
        </div>
      </section>

      {/* Mira cómo funciona */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-headline text-2xl">
            Mira cómo funciona
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-olivo">
            Tres cosas que le puedes pedir hoy, tal como se ven en tu WhatsApp.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <ChatDemo
              emoji="💸"
              title="Mandar plata"
              ariaLabel="Ejemplo: le pides a Comadre mandar $20 a tu mamá, ella confirma contigo y lo envía."
              messages={[
                { from: "user", text: "Comadre, mándale $20 a mi mamá" },
                { from: "comadre", text: "A ver, mija — ¿$20 para tu mamá, va?" },
                { from: "user", text: "Va 👍" },
                { from: "comadre", text: "Listo, ya lo mandé ✅" },
              ]}
            />
            <ChatDemo
              emoji="🌱"
              title="El guardadito"
              ariaLabel="Ejemplo: le pides a Comadre guardar $10 por semana y ella te avisa cuánto llevas ahorrado."
              messages={[
                { from: "user", text: "Guárdame $10 por semana" },
                { from: "comadre", text: "Anotado, mija. Yo me encargo 🌱" },
                { from: "user", text: "¿Cómo va mi ahorrito?" },
                { from: "comadre", text: "Esta semana ahorraste $50" },
              ]}
            />
            <ChatDemo
              emoji="🤝"
              title="La tanda"
              ariaLabel="Ejemplo: le pides a Comadre armar una tanda con tus primas y ella la organiza."
              messages={[
                { from: "user", text: "Arma una tanda con mis primas" },
                { from: "comadre", text: "¿Cuántas son y cuánto pone cada una?" },
                { from: "user", text: "Somos 4, $25 cada semana" },
                { from: "comadre", text: "¡Que la tanda comience! 🎉" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Cómo empezar */}
      <section className="bg-nopal/15 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center font-headline text-2xl">Cómo empezar</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            <li className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-miel font-headline text-lg font-semibold">
                1
              </span>
              <p className="mt-4">
                Toca el botón y guarda el número de Comadre.
              </p>
            </li>
            <li className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-miel font-headline text-lg font-semibold">
                2
              </span>
              <p className="mt-4">Tía Vera te saluda y te conoce.</p>
            </li>
            <li className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-miel font-headline text-lg font-semibold">
                3
              </span>
              <p className="mt-4">
                Listo: manda, ahorra y organiza, todo desde el chat.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* El guardadito */}
      <section className="px-6 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <PlantPotGlyph />
          <h2 className="mt-6 font-headline text-2xl">El guardadito</h2>
          <p className="mt-4 max-w-xl text-olivo">
            Cada semana, Comadre aparta lo que tú le digas. Tu ahorrito crece
            de a poquito, sin que tengas que pensarlo.
          </p>
          <p className="mt-6 font-hand text-2xl text-barro">
            “Anotado. Esta semana ahorraste $50.”
          </p>
        </div>
      </section>

      {/* Cómo funciona una tanda */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <Image
            src="/brand/tandas-visual.png"
            alt="Cómo funciona una tanda: cuatro vecinas, un pozo, un turno por mes. Cada quien pone un poquito y una recibe el pozo."
            width={1766}
            height={1180}
            className="w-full rounded-2xl"
          />
        </div>
      </section>

      {/* Cierre */}
      <section className="bg-hoja px-6 py-20 text-center text-papel">
        <h2 className="font-display text-4xl italic">
          De a poquito, todo se logra<span className="text-barro">.</span>
        </h2>
        <div className="mt-8">
          <WhatsAppButton label="Empieza por WhatsApp" onDark />
        </div>
      </section>

      {/* Footer */}
      <footer className="flex flex-col items-center gap-3 px-6 py-10 text-sm text-olivo">
        <Wordmark />
        <Link href="/privacy" className="underline hover:text-hoja">
          Política de privacidad
        </Link>
        <p>© 2026 Comadre</p>
      </footer>
    </main>
  );
}
