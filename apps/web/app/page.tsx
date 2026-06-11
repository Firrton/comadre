import Image from "next/image";
import Link from "next/link";

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER ?? "5491100000000";
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hola Comadre 👋")}`;

function WhatsAppButton({ label }: { label: string }) {
  return (
    <a
      href={WA_LINK}
      className="inline-block rounded-full bg-olivo px-8 py-4 text-lg font-medium text-papel shadow-md transition-colors hover:bg-hoja"
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
            <h2 className="font-headline text-xl text-miel">Manda y recibe</h2>
            <p className="mt-3 text-papel/80">
              Dile a quién y cuánto. Comadre confirma contigo antes de mover un
              solo peso.
            </p>
          </div>
          <div>
            <h2 className="font-headline text-xl text-miel">
              Ahorra de a poquito
            </h2>
            <p className="mt-3 text-papel/80">
              Tu ahorrito crece semana a semana, sin que tengas que pensarlo.
            </p>
          </div>
          <div>
            <h2 className="font-headline text-xl text-miel">
              Organiza tu tanda
            </h2>
            <p className="mt-3 text-papel/80">
              Cada quien pone un poquito y una recibe el pozo. Las cuentas
              claras, sin enredos.
            </p>
          </div>
        </div>
      </section>

      {/* Cómo funciona una tanda */}
      <section className="px-6 py-16">
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

      {/* Así se siente */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-md">
          <h2 className="text-center font-headline text-2xl">
            Así se siente usar Comadre
          </h2>
          <div
            role="img"
            aria-label="Ejemplo de conversación: le pides a Comadre mandar $20 a tu mamá, ella confirma contigo y lo envía."
            className="mt-8 space-y-3 rounded-2xl bg-olivo/10 p-5"
          >
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-nopal px-4 py-2 text-papel">
              Comadre, mándale $20 a mi mamá
            </p>
            <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2">
              A ver, mija — déjame confirmar: $20 para tu mamá, ¿va?
            </p>
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-nopal px-4 py-2 text-papel">
              Va 👍
            </p>
            <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2">
              Listo, ya lo mandé. Le aviso cuando lo reciba.
            </p>
          </div>
        </div>
      </section>

      {/* Cierre */}
      <section className="bg-nopal/15 px-6 py-20 text-center">
        <h2 className="font-display text-4xl italic">
          De a poquito, todo se logra<span className="text-barro">.</span>
        </h2>
        <div className="mt-8">
          <WhatsAppButton label="Empieza por WhatsApp" />
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
