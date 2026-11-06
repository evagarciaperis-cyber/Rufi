#!/usr/bin/env python3
"""
Análisis reproducible de la imagen oficial de Rufi.

Uso:
    python3 tools/analyze_reference.py [ruta_png]

Entrada por defecto: assets/original/mascota.png (copia sin modificar de
https://referencehome.es/images/mascota.png).

Salidas (se regeneran siempre igual a partir del mismo PNG):
    spec/reference-analysis.json      medidas, proporciones, paleta y regiones
    assets/reference/rufi-regions.png  máscaras de color por zona
    assets/reference/rufi-guides.png   guías de proporción sobre el original
    assets/reference/rufi-palette.png  muestras de color por zona

Requiere: Pillow (pip install pillow). No modifica la imagen original.

Limitaciones honestas:
- La segmentación es por color (HSV) y posición, no semántica. Es una ayuda
  para el modelador, no una medida exacta del volumen 3D.
- Es UNA sola vista (frontal, cabeza ligeramente girada, brazo levantado).
  Profundidades, perfil y espalda NO se pueden deducir de aquí.
"""
import colorsys
import hashlib
import json
import os
import sys
from collections import defaultdict

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "assets/original/mascota.png")
OUT_JSON = os.path.join(ROOT, "spec/reference-analysis.json")
OUT_DIR = os.path.join(ROOT, "assets/reference")

ALPHA_SOLID = 128  # píxel considerado parte del personaje

REGION_COLORS = {  # colores de visualización de las máscaras (no son del personaje)
    "cresta": (220, 30, 60),
    "suelas": (160, 0, 160),
    "panuelo": (40, 170, 60),
    "rasgos_oscuros": (20, 20, 20),
    "esclerotica": (80, 160, 255),
    "brillos_ojos": (255, 230, 0),
    "boca": (255, 120, 0),
    "rubor": (255, 150, 200),
    "cuerpo": (235, 215, 190),
}


def classify(x, y, r, g, b, H):
    """Clasifica un píxel opaco en una región. H = alto de la imagen."""
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hd = h * 360
    ny = y / H
    is_red_hue = hd >= 330 or hd <= 15
    # Granate: cresta (arriba) y suelas (abajo)
    if is_red_hue and s > 0.55 and v < 0.75:
        if ny < 0.35:
            return "cresta"
        if ny > 0.85:
            return "suelas"
        return "boca"  # interior de la boca (rojo oscuro)
    # Verde salvia del pañuelo
    if 40 <= hd <= 100 and s > 0.18 and v < 0.85 and 0.45 < ny < 0.82:
        return "panuelo"
    # Zona de la cara
    in_face = 0.18 < ny < 0.52
    if in_face and v < 0.40:
        return "rasgos_oscuros"  # cejas, contorno de ojos, iris/pupila oscuros
    if in_face and v > 0.78 and s < 0.12:
        # brillos pequeños vs. blanco del ojo: se separan después por tamaño
        return "esclerotica"
    if in_face and (hd >= 340 or hd <= 20) and s > 0.35 and v > 0.55 and 0.40 < ny < 0.52:
        return "boca"
    if in_face and v < 0.62 and 15 <= hd <= 40 and s > 0.35:
        return "rasgos_oscuros"  # iris marrón medio
    if in_face and (hd >= 345 or hd <= 25) and 0.22 < s <= 0.45 and v > 0.85:
        return "rubor"
    return "cuerpo"


def components(pts):
    """Componentes conexas (vecindad 4) de un conjunto de píxeles. Python puro."""
    rest = set(pts)
    comps = []
    while rest:
        seed = rest.pop()
        stack, comp = [seed], [seed]
        while stack:
            x, y = stack.pop()
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in rest:
                    rest.remove(n)
                    stack.append(n)
                    comp.append(n)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


# Cuántas manchas principales se esperan por zona (el resto son bordes/ruido
# de antialiasing y se devuelven a "cuerpo").
EXPECTED_BLOBS = {
    "cresta": (1, 500),
    "suelas": (2, 500),
    "panuelo": (1, 500),
    "boca": (1, 300),
    "esclerotica": (2, 30),
    "brillos_ojos": (2, 10),
    "rubor": (2, 300),
    "rasgos_oscuros": (6, 300),  # 2 cejas + 2 ojos (contorno+iris) + margen
}


def bbox_of(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def main():
    raw = open(SRC, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    im = Image.open(SRC).convert("RGBA")
    W, H = im.size
    px = im.load()

    regions = defaultdict(list)
    alpha_hist = defaultdict(int)
    row_extent = {}
    # Eje central del tronco en esta vista (entre los pies). Se usa para medir
    # anchuras con el tramo de píxeles que lo contiene, excluyendo así el brazo
    # levantado cuando aparece separado del contorno de la cabeza.
    CX = W // 2
    for y in range(H):
        run_start, runs = None, []
        for x in range(W):
            r, g, b, a = px[x, y]
            alpha_hist[a] += 1
            if a < ALPHA_SOLID:
                if run_start is not None:
                    runs.append((run_start, x - 1))
                    run_start = None
                continue
            if run_start is None:
                run_start = x
            regions[classify(x, y, r, g, b, H)].append((x, y))
        if run_start is not None:
            runs.append((run_start, W - 1))
        central = [r_ for r_ in runs if r_[0] <= CX <= r_[1]]
        if central:
            row_extent[y] = central[0]

    # Separar brillos (blanco puro) del blanco del ojo antes de limpiar.
    bright = [(x, y) for (x, y) in regions["esclerotica"] if sum(px[x, y][:3]) / 3 > 248]
    if bright:
        bright_set = set(bright)
        regions["brillos_ojos"] = bright
        regions["esclerotica"] = [p for p in regions["esclerotica"] if p not in bright_set]

    blobs = {}
    for name, (k, min_size) in EXPECTED_BLOBS.items():
        if not regions.get(name):
            continue
        comps = [c for c in components(regions[name])[:k] if len(c) >= min_size]
        kept = set(p for c in comps for p in c)
        regions["cuerpo"].extend(p for p in regions[name] if p not in kept)
        regions[name] = list(kept)
        blobs[name] = [bbox_of(c) for c in comps]

    solid = [p for pts in regions.values() for p in pts]
    fig = bbox_of(solid)
    fig_h = fig[3] - fig[1] + 1


    def rel(v):  # proporción respecto a la altura total de la figura
        return round(v / fig_h, 4)

    out_regions = {}
    for name, pts in sorted(regions.items()):
        if not pts:
            continue
        bb = bbox_of(pts)
        cols = [px[x, y][:3] for (x, y) in pts]
        # Mediana por canal (robusta) y percentiles de luminancia para sombra/luz
        med = tuple(sorted(c[i] for c in cols)[len(cols) // 2] for i in range(3))
        cols.sort(key=lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
        lo = cols[int(len(cols) * 0.1)]
        hi = cols[int(len(cols) * 0.9)]
        out_regions[name] = {
            "pixels": len(pts),
            "area_pct_figura": round(100 * len(pts) / len(solid), 2),
            "bbox_px": bb,
            "bbox_rel_altura": [rel(bb[0] - fig[0]), rel(bb[1] - fig[1]), rel(bb[2] - fig[0]), rel(bb[3] - fig[1])],
            "color_mediana": "#%02X%02X%02X" % med,
            "color_sombra_p10": "#%02X%02X%02X" % lo,
            "color_luz_p90": "#%02X%02X%02X" % hi,
            "manchas_bbox_px": blobs.get(name, [bb]),
        }

    # Perfil de anchura: cabeza (sobre el pañuelo) vs. cuerpo (bajo el pañuelo)
    scarf_bb = out_regions.get("panuelo", {}).get("bbox_px")
    crest_bb = out_regions.get("cresta", {}).get("bbox_px")
    soles_bb = out_regions.get("suelas", {}).get("bbox_px")
    widths = {y: e[1] - e[0] + 1 for y, e in row_extent.items()}
    head_rows = {y: w for y, w in widths.items() if crest_bb and crest_bb[3] < y < (scarf_bb[1] if scarf_bb else H)}
    head_y = max(head_rows, key=head_rows.get) if head_rows else None
    # Cuerpo: filas bajo el pañuelo y sobre los pies. El brazo levantado no llega aquí.
    body_rows = {y: w for y, w in widths.items() if scarf_bb and scarf_bb[3] < y < (soles_bb[1] - 120 if soles_bb else H)}
    body_y = max(body_rows, key=body_rows.get) if body_rows else None

    # Cabeza: desde la parte superior de la piel crema (bajo la cresta) hasta el pañuelo.
    cream_rows = defaultdict(int)
    for (x, y) in regions["cuerpo"]:
        cream_rows[y] += 1
    max_head_w = max(head_rows.values()) if head_rows else 0
    cream_top = min((y for y, n in cream_rows.items() if n >= 0.25 * max_head_w), default=None)
    proportions = {
        "altura_figura_px": fig_h,
        "anchura_figura_px": fig[2] - fig[0] + 1,
        "cresta_alto_rel": rel(crest_bb[3] - crest_bb[1]) if crest_bb else None,
        "cabeza_inicio_y_rel": rel(cream_top - fig[1]) if cream_top is not None else None,
        "panuelo_y_rel": [rel(scarf_bb[1] - fig[1]), rel(scarf_bb[3] - fig[1])] if scarf_bb else None,
        "cabeza_anchura_max_rel": rel(head_rows[head_y]) if head_y else None,
        "cabeza_anchura_max_en_y_rel": rel(head_y - fig[1]) if head_y else None,
        "cuerpo_anchura_max_rel": rel(body_rows[body_y]) if body_y else None,
        "cuerpo_anchura_max_en_y_rel": rel(body_y - fig[1]) if body_y else None,
        "suelas_y_rel": [rel(soles_bb[1] - fig[1]), rel(soles_bb[3] - fig[1])] if soles_bb else None,
        "nota": "Valores relativos a la altura total de la figura (cresta a suela) en ESTA vista. "
                "La cabeza está ligeramente girada hacia la derecha del espectador y el brazo IZQUIERDO "
                "del personaje (a la derecha del espectador) está levantado, por lo que la anchura total de la figura incluye el brazo. La anchura de la cabeza se mide sin el brazo; "
                "la del cuerpo incluye el brazo DERECHO del personaje, pegado al tronco e inseparable por silueta.",
    }

    partial = sum(c for a, c in alpha_hist.items() if 0 < a < 255)
    alpha_info = {
        "transparentes_0": alpha_hist[0],
        "opacos_255": alpha_hist[255],
        "parciales_1_254": partial,
        "valor_mas_frecuente_en_figura": max(((a, c) for a, c in alpha_hist.items() if a >= ALPHA_SOLID), key=lambda t: t[1])[0],
        "nota": "La figura tiene alfa ~253 (≈1 % translúcida) y un halo de alfa 1-2 alrededor. "
                "Artefacto de exportación: al preparar texturas o carteles conviene forzar alfa 255 "
                "dentro de la silueta y limpiar el halo, sin tocar el color.",
    }

    data = {
        "fuente": {
            "url": "https://referencehome.es/images/mascota.png",
            "archivo": os.path.relpath(SRC, ROOT),
            "sha256": sha,
            "tamano_px": [W, H],
        },
        "bbox_figura_px": fig,
        "proporciones": proportions,
        "regiones": out_regions,
        "alfa": alpha_info,
        "advertencia": "Segmentación automática por color. Revisar visualmente con assets/reference/rufi-regions.png.",
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # --- Imágenes de referencia -------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    base = Image.alpha_composite(white, im).convert("RGB")

    reg = Image.new("RGB", im.size, (255, 255, 255))
    rp = reg.load()
    for name, pts in regions.items():
        col = REGION_COLORS.get(name, (128, 128, 128))
        for (x, y) in pts:
            rp[x, y] = col
    reg_small = reg.resize((627, 627), Image.NEAREST)
    d = ImageDraw.Draw(reg_small)
    yy = 8
    for name, col in REGION_COLORS.items():
        d.rectangle([8, yy, 22, yy + 12], fill=col, outline=(0, 0, 0))
        d.text((28, yy), name, fill=(0, 0, 0))
        yy += 16
    reg_small.save(os.path.join(OUT_DIR, "rufi-regions.png"))

    g = base.copy()
    d = ImageDraw.Draw(g)
    def hline(y, label, col):
        d.line([(0, y), (W, y)], fill=col, width=3)
        d.text((10, y + 4), label, fill=col)
    hline(fig[1], "parte superior (cresta)", (160, 0, 40))
    if cream_top is not None:
        hline(cream_top, "inicio cabeza", (120, 60, 0))
    if head_y:
        e = row_extent[head_y]
        d.line([(e[0], head_y), (e[1], head_y)], fill=(0, 90, 200), width=4)
        d.text((e[0] + 8, head_y + 6), "anchura max. cabeza", fill=(0, 90, 200))
    if scarf_bb:
        hline(scarf_bb[1], "panuelo (arriba)", (40, 120, 40))
        hline(scarf_bb[3], "panuelo (abajo)", (40, 120, 40))
    if body_y:
        e = row_extent[body_y]
        d.line([(e[0], body_y), (e[1], body_y)], fill=(0, 90, 200), width=4)
        d.text((e[0] + 8, body_y + 6), "anchura max. cuerpo", fill=(0, 90, 200))
    if soles_bb:
        hline(soles_bb[1], "suelas", (120, 0, 120))
    hline(fig[3], "base", (60, 60, 60))
    for name in ("cresta", "panuelo", "boca", "suelas"):
        if name in out_regions:
            d.rectangle(out_regions[name]["bbox_px"], outline=(255, 0, 255), width=2)
    g.resize((627, 627), Image.LANCZOS).save(os.path.join(OUT_DIR, "rufi-guides.png"))

    sw = 150
    names = list(out_regions.keys())
    pal = Image.new("RGB", (sw * 3, 40 + 70 * len(names)), (255, 255, 255))
    d = ImageDraw.Draw(pal)
    d.text((8, 8), "zona: sombra p10 | mediana | luz p90", fill=(0, 0, 0))
    for i, name in enumerate(names):
        y0 = 30 + i * 70
        for j, k in enumerate(("color_sombra_p10", "color_mediana", "color_luz_p90")):
            hexv = out_regions[name][k]
            col = tuple(int(hexv[t:t + 2], 16) for t in (1, 3, 5))
            d.rectangle([j * sw, y0, (j + 1) * sw - 2, y0 + 50], fill=col)
            lum = sum(col) / 3
            d.text((j * sw + 6, y0 + 4), hexv, fill=(0, 0, 0) if lum > 128 else (255, 255, 255))
        d.text((6, y0 + 52), name, fill=(0, 0, 0))
    pal.save(os.path.join(OUT_DIR, "rufi-palette.png"))

    print(json.dumps({"sha256": sha, "proporciones": proportions}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
