# models/

| Archivo | Qué es | Almacenamiento |
|---|---|---|
| `original/rufianimado.glb` | Modelo 3D real de Rufi generado con Meshy, **copia intacta** de <https://referencehome.es/images/rufi/rufianimado.glb>. 33 MB, SHA-256 `df02630d9afe795f0e295739394c1da76bb9fc4d834f170f90372f7385996b20` | **Git LFS** |
| `rufi.web.glb` | Versión optimizada para la web: 27 040 triángulos, texturas WebP, Meshopt. **697,7 KB**, SHA-256 `d158be3a2dea0887d2a09a620e14ba04dcbca6602435d96956f321615e21aa3f` | Git normal |

- Regenerar la versión web: `npm run optimize` (ver `tools/optimize-model.mjs`).
- Ver qué contiene un GLB: `node tools/inspect-model.mjs archivo.glb`.
- Probarlo: `examples/visor-rufi/`.
- Análisis completo y limitaciones: `docs/09-modelo-3d-meshy.md`.

**Importante:** las 4 animaciones incluidas (Idle_11, Idle_15, Walking, Running) deforman la malla. No usar en producción hasta re-riggear.

## Fase 3

`rufi-animado.web.glb` (556,2 KB): modelo A-pose con los pesos corregidos por `tools/rig-fix/fix-rig.mjs` y las animaciones `idle`, `wave` y `curious`. Es la nueva base para la web (ver `docs/12-rigging-fase-3.md`). `rufi.web.glb` se conserva como referencia histórica.

## Candidatos

`candidatos/apose/`: modelo regenerado en A-pose (original en LFS + `rufi-apose.web.glb`, 609,9 KB). Validado en `docs/11-validacion-modelo-apose.md`. **No sustituye** a `rufi.web.glb` hasta que Reference Home lo apruebe.

## Clonar sin descargar el original

El original solo hace falta para volver a optimizar. Para clonar sin él (ahorra 33 MB y cuota de LFS):

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/evagarciaperis-cyber/Rufi.git
```

Para descargarlo más tarde: `git lfs pull --include="models/original/*"`.

Cuota de Git LFS: depende del plan de la cuenta de GitHub (Settings → Billing). Este archivo ocupa 33 MB de almacenamiento y cada descarga completa consume 33 MB de ancho de banda LFS.
