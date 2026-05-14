"""Final extraction of structured tire vendor rows for the Bolivia search."""
import json, os, re, hashlib

TARGETS = json.load(open("scrape_targets.json"))
ALL_URLS = json.load(open("urls_all.json"))


def fname(url):
    h = hashlib.md5(url.encode()).hexdigest()[:12]
    return f"scraped/{h}.json"


TIRE_RX = {
    "245/40 R21": re.compile(r"245[\s/\-_]*40[\s/\-_]*Z?R?F?[\s/\-_]*21\b", re.I),
    "225/45 R21": re.compile(r"225[\s/\-_]*45[\s/\-_]*Z?R?F?[\s/\-_]*21\b", re.I),
}

BRANDS = [
    "Bridgestone","Firestone","Michelin","Pirelli","Continental","Goodyear","Hankook",
    "Yokohama","Dunlop","Toyo","Nexen","Kumho","Falken","Davanti","Achilles","BFGoodrich",
    "Cooper","Maxxis","Nitto","General","Lassa","Sailun","Triangle","Westlake","Linglong",
    "Doublestar","GT Radial","Riken","Mastercraft","Aptany","Forceland","Delinte",
]

STOCK_TXT_RX = re.compile(
    r"((?:\+?\d{1,2}\s+en\s+existencia)|(?:en\s+existencia)|(?:solo\s+quedan?\s+\d+\s+disponibles?)|(?:stock\s*:\s*\d+)|(?:en\s+stock)|(?:disponible)|(?:stock\s+disponible)|(?:hay\s+stock)|(?:sin\s+stock)|(?:agotado)|(?:no\s+disponible)|(?:consultar\s+stock)|(?:consultar\s+disponibilidad)|(?:stock\s+limitado)|(?:pr[oó]ximamente))",
    re.I,
)

CITY_RX = re.compile(
    r"\b(La\s+Paz|Santa\s+Cruz(?:\s+de\s+la\s+Sierra)?|Cochabamba|El\s+Alto|Sucre|Tarija|Oruro|Potos[ií]|Trinidad|Beni|Pando)\b",
    re.I,
)

ADDR_RX = re.compile(
    r"((?:Direcci[oó]n|Avenida|Carretera|Esquina|Av\.\s|C/\s|Calle\s|Esq\.\s|Zona\s)[A-ZÁÉÍÓÚÑa-záéíóúñ0-9][^\n,;\|]{6,140})"
)


def parse_num(s):
    s = (s or "").strip()
    s = re.sub(r"[^\d.,]", "", s)
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and 1 <= len(parts[-1]) <= 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "." in s:
        parts = s.split(".")
        if len(parts) == 2 and 1 <= len(parts[-1]) <= 2:
            pass
        else:
            s = s.replace(".", "")
    try:
        return float(s)
    except Exception:
        return None


PRICE_BS_RX = re.compile(r"(?:Bs\.?|BOB|Bolivianos?)\s*\.?\s*([\d.,]{2,12})", re.I)
PRICE_USD_RX = re.compile(r"(?:US\$|USD|\$us|\$Us|U\$S)\s*([\d.,]{2,12})", re.I)


def parse_prices(text, rx, lo, hi):
    out = []
    for m in rx.finditer(text):
        v = parse_num(m.group(1))
        if v is not None and lo <= v <= hi:
            out.append(v)
    return out


def normalize_bo_phone(raw):
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("591"):
        digits = digits[3:]
    # Reject other country codes
    if len(digits) >= 10 and digits.startswith("5"):
        return None
    if len(set(digits)) <= 2:
        return None
    if len(digits) == 8 and digits[0] in "67":
        return f"+591 {digits[:4]} {digits[4:]}"
    if len(digits) == 7 and digits[0] in "234":
        return f"+591 {digits[0]} {digits[1:4]} {digits[4:]}"
    if len(digits) == 8 and digits[0] in "234":
        return f"+591 {digits[0]} {digits[1:4]} {digits[4:]}"
    return None


def extract_phones(text):
    phones = set()
    for m in re.finditer(r"tel:\+?(\d{7,15})", text):
        p = normalize_bo_phone(m.group(1))
        if p:
            phones.add(p)
    for m in re.finditer(r"wa\.me/\+?(\d{7,15})", text, re.I):
        p = normalize_bo_phone(m.group(1))
        if p:
            phones.add(p)
    for m in re.finditer(r"api\.whatsapp\.com/send\?phone=\+?(\d{7,15})", text, re.I):
        p = normalize_bo_phone(m.group(1))
        if p:
            phones.add(p)
    label_rx = re.compile(
        r"(?:whatsapp|whatssapp|wsp|tel\.?|tel[eé]fono|cel\.?|celular|ll[aá]manos|llamenos|contacto)[^\d\n]{0,20}((?:\+?591[\s\-]?)?\d[\d\s\-\.]{6,15})",
        re.I,
    )
    for m in label_rx.finditer(text):
        p = normalize_bo_phone(m.group(1))
        if p:
            phones.add(p)
    return sorted(phones)


def is_excluded_host(host, md):
    if any(host.endswith(s) for s in (".py", ".mx", ".ar", ".pe", ".co", ".cl", ".es")):
        return True
    if "interllantas.com" in host:  # Colombian
        return True
    if "cubiertas.com" in host and "/py/" in md.lower()[:200]:
        return True
    if host in ("llantasneumaticos.com",):
        return True
    if host in ("www.discounttire.com", "www.utires.com", "simpletire.com", "tires.bridgestone.com"):
        return True
    if "pirelli.com" in host and "boliv" not in md.lower()[:1000]:
        return True
    # Colombian peso pricing pattern
    if re.search(r"\$\s*\d{1,3}\.\d{3}\.\d{3}", md):
        return True
    return False


def vendor_title(md, host):
    h = re.search(r"^#\s+(.{3,120})$", md, re.M)
    if h:
        return h.group(1).strip()
    return host


# --- per-vendor (host) context aggregation -----------------------------------
PER_HOST = {}
for t in TARGETS:
    fp = fname(t["url"])
    if not os.path.exists(fp):
        continue
    try:
        d = json.load(open(fp))
    except Exception:
        continue
    md = (d.get("data", {}) or {}).get("markdown") or ""
    if not md:
        continue
    host = t["host"]
    if is_excluded_host(host, md):
        continue
    ctx = PER_HOST.setdefault(host, {"phones": set(), "addresses": set(), "cities": set()})
    ctx["phones"].update(extract_phones(md))
    for m in ADDR_RX.finditer(md):
        a = re.sub(r"[\*\[\]]+$", "", m.group(1)).strip()
        if 8 <= len(a) <= 200:
            ctx["addresses"].add(a)
    for m in CITY_RX.finditer(md):
        ctx["cities"].add(m.group(0).title())


# --- generate rows -----------------------------------------------------------
rows = []

# 1) llantas.bo style — parse catalog cards by splitting on `### `
def parse_llantasbo_catalog(md, url, ctx):
    out = []
    sections = re.split(r"^###\s+", md, flags=re.M)
    for section in sections[1:]:
        # First line is "Brand[Model](link)..."
        head_m = re.match(r"([A-Za-z]+)(?:\s*\[([^\]]+)\])?", section)
        if not head_m:
            continue
        brand = head_m.group(1).strip()
        if brand not in BRANDS:
            continue
        model = (head_m.group(2) or "").strip()
        # Find target tire mention anywhere in the section
        for size, rx in TIRE_RX.items():
            tire_m = rx.search(section)
            if not tire_m:
                continue
            # Look for the stock signal in the remainder of the section,
            # but stop before the next product link "Ver opciones" to avoid bleeding.
            tail = section[tire_m.end(): tire_m.end() + 3000]
            cutoff = tail.find("Ver opciones")
            if cutoff > 0:
                tail = tail[:cutoff + 50]
            stock_m = STOCK_TXT_RX.search(tail)
            stock = stock_m.group(1).strip() if stock_m else "Consultar"
            # Capture spec snippet (e.g. "245/40R21 100Y XL ...")
            spec_m = re.search(
                r"(\d{3}[\s/]\d{2}\s*Z?R?F?\s*21[^\n\[]{0,80})",
                section[tire_m.start():tire_m.end() + 200],
            )
            spec = (spec_m.group(1).strip() if spec_m else "").strip()
            out.append({
                "tire": size,
                "brand": brand,
                "model": model,
                "spec": spec,
                "stock": stock,
                "price_bs": "",
                "price_usd": "",
                "vendor": "Llantas.bo (Importadora Llantas Bolivia)",
                "city": ", ".join(sorted(ctx["cities"])) or "Bolivia (sin ciudad detectada en página)",
                "address": " | ".join(sorted(list(ctx["addresses"]))[:2]),
                "phone": ", ".join(sorted(ctx["phones"])),
                "url": url,
                "source_type": "catálogo importadora",
                "notes": "Sitio oficial llantas.bo — modelos disponibles vía importación",
            })
    return out


for t in TARGETS:
    fp = fname(t["url"])
    if not os.path.exists(fp):
        continue
    try:
        d = json.load(open(fp))
    except Exception:
        continue
    md = (d.get("data", {}) or {}).get("markdown") or ""
    if not md:
        continue
    host = t["host"]
    if is_excluded_host(host, md):
        continue
    url = t["url"]
    ctx = PER_HOST.get(host, {"phones": set(), "addresses": set(), "cities": set()})

    if host == "www.llantas.bo":
        # Only treat the size-category pages as authoritative; skip individual
        # product pages because their "en existencia" counts are for OTHER sizes
        # listed for comparison on the same page.
        is_size_page = bool(re.search(r"/llantas-(245-40r21|225-45r21)$", url))
        if is_size_page:
            rows.extend(parse_llantasbo_catalog(md, url, ctx))
        continue
    if host == "www.cubiertas.com":
        # Same vendor as llantas.bo (sister site, often Paraguay); skip individual pages.
        continue

    title = vendor_title(md, host)
    matched = [name for name, rx in TIRE_RX.items() if rx.search(md)]
    if not matched:
        continue

    bs = parse_prices(md, PRICE_BS_RX, 100, 50000)
    usd = parse_prices(md, PRICE_USD_RX, 20, 6000)

    for size in matched:
        rx = TIRE_RX[size]
        near_bs, near_usd, near_stock, near_brand = [], [], [], ""
        for m in rx.finditer(md):
            window = md[max(0, m.start() - 500): m.end() + 500]
            near_bs.extend(parse_prices(window, PRICE_BS_RX, 100, 50000))
            near_usd.extend(parse_prices(window, PRICE_USD_RX, 20, 6000))
            for s in STOCK_TXT_RX.finditer(window):
                near_stock.append(s.group(1).strip())
            if not near_brand:
                for b in BRANDS:
                    if re.search(r"\b" + re.escape(b) + r"\b", window, re.I):
                        near_brand = b
                        break
        ps = list(dict.fromkeys(near_stock))
        pb = near_bs or bs
        pu = near_usd or usd
        rows.append({
            "tire": size,
            "brand": near_brand,
            "model": "",
            "spec": "",
            "stock": "; ".join(ps)[:120] if ps else "Consultar",
            "price_bs": (f"{min(pb):.0f}-{max(pb):.0f}" if len(set(pb)) > 1 else (f"{pb[0]:.0f}" if pb else "")),
            "price_usd": (f"{min(pu):.0f}-{max(pu):.0f}" if len(set(pu)) > 1 else (f"{pu[0]:.0f}" if pu else "")),
            "vendor": title[:80],
            "city": ", ".join(sorted(ctx["cities"])),
            "address": " | ".join(sorted(list(ctx["addresses"]))[:2]),
            "phone": ", ".join(sorted(ctx["phones"])),
            "url": url,
            "source_type": "vendedor web",
            "notes": "",
        })


# 2) Facebook / Instagram rows (we couldn't scrape; use snippet)
fb_rows = []
for u in ALL_URLS:
    host = u["host"]
    if not any(x in host for x in ("facebook.com", "instagram.com")):
        continue
    blob = (u.get("title") or "") + " :: " + (u.get("description") or "")
    blob_lower = blob.lower()
    if not any(k in blob_lower for k in ["bolivia", "la paz", "santa cruz", "cochabamba", "el alto", "sucre", "tarija", "oruro", "potosi"]):
        if not any(k in u["url"].lower() for k in ["bolivia", "lapaz", "santacruz", "cochabamba"]):
            continue
    # Detect tire sizes literally in the snippet
    tires_in_blob = [name for name, rx in TIRE_RX.items() if rx.search(blob)]
    if not tires_in_blob:
        tires_in_blob = u.get("tires", [])  # fall back to which query found it
    bs = parse_prices(blob, PRICE_BS_RX, 100, 50000)
    usd = parse_prices(blob, PRICE_USD_RX, 20, 6000)
    phones = extract_phones(blob)
    cities = sorted({m.group(0).title() for m in CITY_RX.finditer(blob)})
    brand = ""
    for b in BRANDS:
        if re.search(r"\b" + re.escape(b) + r"\b", blob, re.I):
            brand = b
            break
    for tire in tires_in_blob:
        fb_rows.append({
            "tire": tire,
            "brand": brand,
            "model": "",
            "spec": "",
            "stock": "Publicación pública (mensajear al vendedor)",
            "price_bs": (f"{bs[0]:.0f}" if bs else ""),
            "price_usd": (f"{usd[0]:.0f}" if usd else ""),
            "vendor": (u.get("title") or host)[:80],
            "city": ", ".join(cities),
            "address": "",
            "phone": ", ".join(phones),
            "url": u["url"],
            "source_type": "Facebook/IG",
            "notes": (u.get("description") or "")[:300],
        })


# Dedupe
seen = set()
clean = []
for r in rows + fb_rows:
    key = (r["tire"], (r.get("model") or "")[:40], r["url"])
    if key in seen:
        continue
    seen.add(key)
    clean.append(r)

# Tag posts that explicitly mention BOTH a target tire + a Bolivia city
for r in clean:
    blob = " ".join([r.get("vendor",""), r.get("notes",""), r.get("city","")])
    if r["city"] or "Bolivia" in blob:
        r["bolivia_confirmed"] = "Sí"
    else:
        r["bolivia_confirmed"] = "Probable"

print(f"Final rows: {len(clean)}")
from collections import Counter
print("By tire:", Counter(r['tire'] for r in clean))
print("By source_type:", Counter(r['source_type'] for r in clean))

json.dump(clean, open("rows_final.json","w"), indent=2, ensure_ascii=False, default=str)
