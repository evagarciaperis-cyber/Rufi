"""
Exporta Rufi desde un .blend a GLB con los ajustes del contrato web.

Uso:
  blender --background ruta/rufi.blend --python blender/scripts/rufi_export_glb.py -- --out build/rufi.glb
  python3 blender/scripts/rufi_export_glb.py --blend ruta/rufi.blend --out build/rufi.glb   (con bpy)

Después:
  node tools/validate-glb.mjs build/rufi.glb
  (y, para producción, compresión con glTF-Transform: ver docs/06-pipeline.md)

Ajustes clave y por qué:
  - Solo huesos de deformación (los CTRL_/MCH_ se quedan en el .blend).
  - Sin aplicar modificadores: aplicar modificadores impide exportar shape keys.
  - Animaciones por ACCIÓN: cada acción/pista NLA = un clip glTF con su nombre.
  - Sin normales de morph targets: reduce mucho el peso y en un personaje
    de fieltro mate la diferencia visual es mínima.
"""
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = {"--out": None, "--blend": None}
    for k in args:
        if k in argv:
            args[k] = os.path.abspath(argv[argv.index(k) + 1])
    if not args["--out"]:
        sys.exit("Falta --out ruta.glb")
    return args


def main():
    args = parse_args()
    if args["--blend"]:
        bpy.ops.wm.open_mainfile(filepath=args["--blend"])
    os.makedirs(os.path.dirname(args["--out"]), exist_ok=True)
    # Ocultar referencias para que no se exporten
    for o in bpy.data.objects:
        if o.name.startswith("REF_"):
            o.hide_render = True
    bpy.ops.export_scene.gltf(
        filepath=args["--out"],
        export_format="GLB",
        use_selection=False,
        use_visible=False,
        use_renderable=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_skins=True,
        export_def_bones=True,
        export_all_influences=False,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=True,
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"GLB exportado: {args['--out']} ({os.path.getsize(args['--out']) / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
