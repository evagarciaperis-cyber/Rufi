"""
Construye la PLANTILLA de producción de Rufi en Blender a partir de
spec/rufi.character.json.

IMPORTANTE: esto NO crea el modelo de Rufi. Crea:
  1. RIG_Rufi: el esqueleto con los nombres y la jerarquía del contrato.
  2. REF_Rufi_Frontal: la imagen oficial colocada a escala real (1,0 m de alto,
     suelo en Z=0) detrás del personaje, para modelar encima.
  3. (opcional, --with-proxy) una MAQUETA gris PROXY_* hecha con primitivas,
     con shape keys y clips de previsualización con los nombres del contrato.
     Sirve SOLO para probar el pipeline Blender → GLB → web. El validador
     rechaza cualquier GLB que la contenga salvo con --allow-proxy.

Uso (Blender 4.2+ o el módulo bpy):
  blender --background --python blender/scripts/rufi_build_template.py -- \
      --out blender/rufi_rig_template.blend [--with-proxy]
  python3 blender/scripts/rufi_build_template.py --out ... [--with-proxy]   (con bpy instalado)
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(ROOT, "spec", "rufi.character.json")
REF_IMG = os.path.join(ROOT, "assets", "original", "mascota.png")
FPS = 30


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = os.path.join(ROOT, "blender", "rufi_rig_template.blend")
    with_proxy = "--with-proxy" in argv
    if "--out" in argv:
        out = os.path.abspath(argv[argv.index("--out") + 1])
    return out, with_proxy


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def build_armature(spec):
    arm_data = bpy.data.armatures.new(spec["rig"]["armature"])
    arm_obj = bpy.data.objects.new(spec["rig"]["armature"], arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.show_in_front = True
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = {}
    for b in spec["rig"]["huesos"]:
        eb = arm_data.edit_bones.new(b["nombre"])
        eb.head = Vector(b["cabeza"])
        eb.tail = Vector(b["cola"])
        eb.use_deform = bool(b["deform"])
        ebones[b["nombre"]] = eb
    for b in spec["rig"]["huesos"]:
        if b["padre"]:
            ebones[b["nombre"]].parent = ebones[b["padre"]]
            ebones[b["nombre"]].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def add_reference_image():
    """Imagen oficial a escala: la figura (1232 px de alto) mide 1,0 m."""
    if not os.path.exists(REF_IMG):
        print("Aviso: no se encuentra la imagen de referencia", REF_IMG)
        return None
    img = bpy.data.images.load(REF_IMG)
    img.filepath = bpy.path.relpath(REF_IMG) if bpy.data.filepath else REF_IMG
    empty = bpy.data.objects.new("REF_Rufi_Frontal", None)
    empty.empty_display_type = "IMAGE"
    empty.data = img
    w_px, h_px = img.size
    fig_h_px, fig_top_px, fig_cx_px = 1232, 11, 615  # de spec/reference-analysis.json
    empty.empty_display_size = max(w_px, h_px) / fig_h_px
    # Centro de la imagen → coordenadas del mundo (suelo en z=0, eje entre los pies en x=0)
    cx = (w_px / 2 - fig_cx_px) / fig_h_px
    cz = 1.0 - (h_px / 2 - fig_top_px) / fig_h_px
    empty.location = (cx, 0.6, cz)  # detrás del personaje
    empty.rotation_euler = (math.radians(90), 0, 0)
    empty.empty_image_side = "FRONT"
    empty.color[3] = 0.5
    empty.use_empty_image_alpha = True
    empty.hide_select = True
    bpy.context.scene.collection.objects.link(empty)
    return empty


# ---------------------------------------------------------------- maqueta --

def _proxy_material():
    m = bpy.data.materials.new("PROXY_Gris")
    m.diffuse_color = (0.6, 0.6, 0.6, 1)
    return m


def _rigid_bind(obj, arm_obj, bone):
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    obj.parent = arm_obj


def _sphere(name, loc, scale, seg=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return o


def build_proxy(spec, arm_obj):
    """Maqueta de primitivas grises. NO representa la estética de Rufi."""
    mat = _proxy_material()
    p = spec["proporciones"]
    parts = []
    head_w = p["cabeza_anchura_max"]["valor"]
    head_d = p["cabeza_profundidad"]["valor"]
    head = _sphere("PROXY_Head", (0, 0, 0.64), (head_w / 2, head_d / 2, 0.2), seg=24, rings=14)
    head.data.name = spec["shape_keys"]["mesh"]  # mesh con el nombre del contrato
    parts.append((head, "head"))
    parts.append((_sphere("PROXY_Crest_Big", (-0.01, 0, 0.92), (0.07, 0.05, 0.08)), "crest_lobe_big"))
    parts.append((_sphere("PROXY_Crest_Small", (-0.09, 0, 0.87), (0.06, 0.045, 0.04)), "crest_lobe_small"))
    parts.append((_sphere("PROXY_Body", (0, 0, 0.27), (0.2, p["cuerpo_profundidad"]["valor"] / 2, 0.2)), "spine"))
    for side, sx in (("L", 1), ("R", -1)):
        parts.append((_sphere(f"PROXY_Eye_{side}", (sx * 0.13, -0.19, 0.645), (0.06, 0.03, 0.05), seg=12, rings=8), f"eye_{side}"))
        parts.append((_sphere(f"PROXY_Arm_{side}", (sx * 0.26, 0, 0.34), (0.05, 0.05, 0.1), seg=12, rings=8), f"upper_arm_{side}"))
        parts.append((_sphere(f"PROXY_Foot_{side}", (sx * 0.1, -0.02, 0.05), (0.08, 0.09, 0.05), seg=12, rings=8), f"foot_{side}"))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.03, location=(0, 0, 0.45))
    scarf = bpy.context.active_object
    scarf.name = "PROXY_Scarf"
    parts.append((scarf, "chest"))
    for obj, bone in parts:
        obj.data.materials.append(mat)
        _rigid_bind(obj, arm_obj, bone)

    # Shape keys de marcador: deformaciones mínimas, solo para que existan
    # los nombres del contrato y probar su exportación y animación.
    head.shape_key_add(name="Basis", from_mix=False)
    names = spec["shape_keys"]["obligatorias"]
    for i, n in enumerate(names):
        k = head.shape_key_add(name=n, from_mix=False)
        for v_idx, v in enumerate(k.data):
            if v_idx % len(names) == i:
                v.co.z += 0.004
    return head


def _key_bone(arm_obj, bone, frame, rot=None, loc=None, scale=None):
    pb = arm_obj.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    if rot is not None:
        if isinstance(rot, dict):
            # Giro alrededor de un eje DEL MUNDO (en reposo), convertido a ejes locales.
            # Útil en huesos diagonales como los brazos.
            b = arm_obj.data.bones[bone]
            local_axis = (b.matrix_local.to_3x3().inverted() @ Vector(rot["world"])).normalized()
            pb.rotation_euler = Quaternion(local_axis, math.radians(rot["deg"])).to_euler("XYZ")
        else:
            pb.rotation_euler = Euler([math.radians(a) for a in rot])
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = Vector(loc)
        pb.keyframe_insert("location", frame=frame)
    if scale is not None:
        pb.scale = Vector(scale)
        pb.keyframe_insert("scale", frame=frame)


# Claves de previsualización (frame, hueso, rot, loc, scale). Movimiento
# esquemático para probar tiempos y exportación; el animador las sustituye.
# OJO: rotación/traslación/escala de un pose bone van en EJES LOCALES DEL HUESO.
# En los huesos verticales (pelvis, spine, chest, neck, head): Y local = arriba
# (giro yaw / desplazamiento vertical), X local = cabeceo, Z local = inclinación
# lateral (roll). En root (apunta a +Y del mundo): Z local = arriba.
PREVIZ = {
    "idle_breathe": [(1, "spine", None, None, (1, 1, 1)), (60, "spine", None, None, (1.02, 1.03, 1.02)), (120, "spine", None, None, (1, 1, 1))],
    "peek_in": [(1, "root", None, (0.4, 0, -0.5), None), (36, "root", None, (0, 0, -0.25), None)],
    "peek_hold": [(1, "head", (0, 0, 8), None, None), (45, "head", (0, 0, 12), None, None), (90, "head", (0, 0, 8), None, None)],
    "enter": [(1, "root", None, (0, 0, -1.0), None), (22, "root", None, (0, 0, 0.05), None), (30, "root", None, (0, 0, 0), None)],
    # Brazo izquierdo: giro negativo alrededor de Y del mundo = levantar hacia fuera.
    "greet_wave": [(1, "upper_arm_L", (0, 0, 0), None, None), (10, "upper_arm_L", {"world": (0, 1, 0), "deg": -85}, None, None),
                   (40, "upper_arm_L", {"world": (0, 1, 0), "deg": -85}, None, None), (48, "upper_arm_L", (0, 0, 0), None, None),
                   (1, "forearm_L", (0, 0, 0), None, None), (10, "forearm_L", {"world": (0, 1, 0), "deg": 45}, None, None),
                   (17, "forearm_L", {"world": (0, 1, 0), "deg": 20}, None, None), (24, "forearm_L", {"world": (0, 1, 0), "deg": 50}, None, None),
                   (31, "forearm_L", {"world": (0, 1, 0), "deg": 20}, None, None), (40, "forearm_L", {"world": (0, 1, 0), "deg": 45}, None, None),
                   (48, "forearm_L", (0, 0, 0), None, None)],
    "curious_tilt": [(1, "head", (0, 0, 0), None, None), (24, "head", (0, 0, -12), None, None)],
    "happy_jump": [(1, "pelvis", None, (0, 0, 0), (1.06, 0.92, 1.06)), (10, "pelvis", None, (0, 0.18, 0), (0.96, 1.06, 0.96)),
                   (20, "pelvis", None, (0, 0, 0), (1.05, 0.94, 1.05)), (27, "pelvis", None, (0, 0, 0), (1, 1, 1))],
    "talk_loop": [(1, "head", (0, 0, 0), None, None), (9, "head", (3, 0, 0), None, None), (18, "head", (0, 0, 0), None, None)],
    "sleep_in": [(1, "head", (0, 0, 0), None, None), (36, "head", (12, 0, 6), None, None)],
    "sleep_loop": [(1, "spine", None, None, (1, 1, 1)), (60, "spine", None, None, (1.015, 1.02, 1.015)), (120, "spine", None, None, (1, 1, 1))],
    "wake_up": [(1, "head", (12, 0, 6), None, None), (30, "head", (0, 0, 0), None, None)],
    "exit": [(1, "root", None, (0, 0, 0), None), (24, "root", None, (0, 0, -1.0), None)],
    # Pose de la imagen oficial: cabeza girada ~20° hacia +X (Y local +) e
    # inclinada ~15° con el ojo izquierdo más alto (Z local +); brazo izquierdo arriba.
    "pose_reference": [(1, "head", (0, 20, 15), None, None),
                       (1, "upper_arm_L", {"world": (0, 1, 0), "deg": -85}, None, None),
                       (1, "forearm_L", {"world": (0, 1, 0), "deg": 45}, None, None)],
}


# Shape keys de previsualización por clip: (frame, shape_key, valor).
# Un clip puede animar huesos, shape keys o ambos; en ese caso se usa UNA
# acción con dos "slots" (armature + shape keys) para que el exportador
# genere UNA sola animación glTF con ese nombre (Blender 4.4+).
PREVIZ_KEYS = {
    "blink": [(1, "blink_L", 0.0), (3, "blink_L", 1.0), (6, "blink_L", 0.0),
              (1, "blink_R", 0.0), (3, "blink_R", 1.0), (6, "blink_R", 0.0)],
    "happy_jump": [(1, "eye_happy_L", 0.0), (8, "eye_happy_L", 0.8), (27, "eye_happy_L", 0.0),
                   (1, "eye_happy_R", 0.0), (8, "eye_happy_R", 0.8), (27, "eye_happy_R", 0.0)],
    "sleep_in": [(1, "blink_L", 0.0), (36, "blink_L", 1.0), (1, "blink_R", 0.0), (36, "blink_R", 1.0)],
}


def _assign(id_data, action, id_type):
    """Asigna la acción al datablock usando un slot propio (API de Blender 4.4+)."""
    ad = id_data.animation_data or id_data.animation_data_create()
    ad.action = action
    if hasattr(ad, "action_slot"):
        slot = next((s for s in action.slots if s.target_id_type == id_type), None)
        if slot is None:
            slot = action.slots.new(id_type=id_type, name=id_data.name)
        ad.action_slot = slot
    return ad


def build_previz_actions(arm_obj, head_mesh, spec):
    """Crea una acción por clip obligatorio y la guarda en pistas NLA."""
    required = [c["nombre"] for c in spec["clips"]["obligatorios"]]
    keys = head_mesh.data.shape_keys if head_mesh is not None else None
    for name in required:
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        bone_keys = PREVIZ.get(name, [])
        morph_keys = PREVIZ_KEYS.get(name, []) if keys else []
        if not bone_keys and not morph_keys:
            bone_keys = [(1, "root", None, (0, 0, 0), None)]
        if bone_keys:
            ad = _assign(arm_obj, action, "OBJECT")
            for (frame, bone, rot, loc, scale) in bone_keys:
                _key_bone(arm_obj, bone, frame, rot, loc, scale)
            track = ad.nla_tracks.new()
            track.name = name
            strip = track.strips.new(name, 1, action)
            if hasattr(strip, "action_slot") and hasattr(ad, "action_slot"):
                strip.action_slot = ad.action_slot
            track.mute = True
            ad.action = None
            for pb in arm_obj.pose.bones:  # volver a reposo entre clips
                pb.location = (0, 0, 0)
                pb.rotation_euler = (0, 0, 0)
                pb.scale = (1, 1, 1)
        if morph_keys:
            kad = _assign(keys, action, "KEY")
            for (frame, key_name, value) in morph_keys:
                kb = keys.key_blocks[key_name]
                kb.value = value
                kb.keyframe_insert("value", frame=frame)
            tr = kad.nla_tracks.new()
            tr.name = name
            strip = tr.strips.new(name, 1, action)
            if hasattr(strip, "action_slot") and hasattr(kad, "action_slot"):
                strip.action_slot = kad.action_slot
            tr.mute = True
            kad.action = None
            for kb in keys.key_blocks:
                kb.value = 0.0


def main():
    out, with_proxy = parse_args()
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)
    reset_scene()
    arm = build_armature(spec)
    head = build_proxy(spec, arm) if with_proxy else None
    build_previz_actions(arm, head, spec)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out, relative_remap=True)
    add_reference_image()  # después de guardar para poder usar ruta relativa
    bpy.ops.wm.save_mainfile()
    print(f"Plantilla guardada en {out} (maqueta: {'sí' if with_proxy else 'no'})")


if __name__ == "__main__":
    main()
