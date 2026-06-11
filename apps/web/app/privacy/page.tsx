import Link from "next/link";

export const metadata = {
  title: "Política de privacidad — Comadre.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-olivo underline hover:text-hoja">
        ← Volver a Comadre
      </Link>
      <h1 className="mt-6 font-headline text-3xl">Política de privacidad</h1>
      <p className="mt-2 text-sm text-olivo">Última actualización: junio de 2026</p>

      <div className="mt-8 space-y-6 leading-relaxed">
        <section>
          <h2 className="font-headline text-xl">Qué datos usamos</h2>
          <p className="mt-2">
            Para funcionar, Comadre necesita tu número de teléfono, el nombre
            con el que te presentas y el contenido de los mensajes que le
            envías por WhatsApp. Usamos esa información únicamente para
            prestarte el servicio: entender tus pedidos, confirmar tus
            operaciones y llevar el registro de tus movimientos.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl">Qué no hacemos</h2>
          <p className="mt-2">
            No vendemos tus datos ni usamos tus conversaciones para venderte
            publicidad. No te contactamos fuera de la conversación que tú
            inicias, salvo recordatorios que hayas pedido.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl">Con quién trabajamos</h2>
          <p className="mt-2">
            Comadre funciona sobre WhatsApp, un servicio de Meta, y usa
            proveedores de infraestructura como Twilio y servicios de nube
            para procesar mensajes y guardar datos de forma segura. Estos
            proveedores tratan tus datos según sus propias políticas de
            privacidad y nuestros acuerdos de servicio.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl">Cuánto tiempo guardamos tus datos</h2>
          <p className="mt-2">
            Guardamos tu información mientras uses el servicio. Si dejas de
            usar Comadre y nos pides borrar tus datos, eliminamos tu
            información personal salvo los registros que la ley nos obligue a
            conservar.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl">Tus derechos</h2>
          <p className="mt-2">
            Puedes pedirnos en cualquier momento una copia de tus datos, su
            corrección o su eliminación. Escríbenos por el mismo chat de
            WhatsApp o al correo de contacto.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl">Contacto</h2>
          <p className="mt-2">
            Para cualquier consulta sobre esta política:{" "}
            <a
              href="mailto:danyhidalgof@gmail.com"
              className="underline hover:text-olivo"
            >
              danyhidalgof@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
