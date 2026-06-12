import Image from "next/image";

// Brand icons from the hand-drawn icon library (docs/assets/branding/icons,
// 24 glyphs x 4 palette colors). Rendered via <Image> so each SVG keeps its
// internal filter defs isolated.

// Icons are drawn with dark outlines for light backgrounds; the papel chip
// keeps them legible on the dark hoja band.
function CardIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-papel">
      <Image src={src} alt={alt} width={44} height={44} className="h-11 w-11" />
    </span>
  );
}

export function EnvelopeGlyph() {
  return <CardIcon src="/brand/icons/sobre-miel.svg" alt="" />;
}

export function SproutGlyph() {
  return <CardIcon src="/brand/icons/plantita-miel.svg" alt="" />;
}

export function TandaGlyph() {
  return <CardIcon src="/brand/icons/tanda-miel.svg" alt="" />;
}

export function PlantPotGlyph() {
  return (
    <Image
      src="/brand/icons/maceta-barro.svg"
      alt=""
      width={120}
      height={120}
      className="plant-sway h-[120px] w-[120px]"
    />
  );
}
