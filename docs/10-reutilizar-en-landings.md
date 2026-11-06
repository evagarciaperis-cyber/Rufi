# 10 · Cómo reutilizar el modelo 3D en futuras landings

> Estado: el modelo se ve bien en reposo y pesa 698 KB. **Sus animaciones actuales deforman a Rufi** (ver `09-modelo-3d-meshy.md`), así que en una web pública solo debe usarse en reposo o con movimientos de esqueleto probados (por ejemplo, la respiración de la columna) hasta que esté re-riggeado. El componente completo con estados, burbujas y panel es la fase siguiente (`08-runtime-web-plan.md`).

## 1. Archivos

| Archivo | Uso |
|---|---|
| `models/rufi.web.glb` | **El que se publica en las webs** (698 KB, Meshopt + WebP) |
| `models/original/rufianimado.glb` | Fuente intacta (33 MB, Git LFS). Nunca se publica en una web |
| `assets/web/rufi-*.webp` | Imagen estática: póster y alternativa |

Ruta recomendada en el servidor: `https://referencehome.es/images/rufi/rufi.web.glb`, junto al original que ya está allí.

## 2. Configuración del servidor

- Servir `.glb` con `Content-Type: model/gltf-binary`. Hoy `rufianimado.glb` se sirve **sin Content-Type**. En Apache: `AddType model/gltf-binary .glb`.
- Caché larga (`Cache-Control: public, max-age=31536000, immutable`) y cambiar el nombre del archivo en cada versión (`rufi.web.v2.glb`).
- Compresión HTTP: no hace falta; el GLB ya va comprimido por dentro.
- Si se carga desde otro dominio: `Access-Control-Allow-Origin` para ese dominio.

## 3. Integración mínima (patrón)

Principios que no se negocian (de `CLAUDE.md`): la imagen estática se ve primero; three.js se carga después y solo si hay WebGL y no hay movimiento reducido; posición fija (sin CLS); sin estilos globales.

```html
<!-- Contenedor fijo con la imagen oficial como póster -->
<div id="rufi" style="position:fixed;right:12px;bottom:12px;width:140px;height:160px;z-index:46">
  <img src="/images/rufi/rufi-256.webp" alt="" width="140" height="140" style="width:100%;height:auto">
</div>

<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
} }
</script>
<script type="module">
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = !!document.createElement('canvas').getContext('webgl2');
  if (!reduce && gl) {
    const start = () => import('./rufi-3d.js').then((m) => m.mount(document.getElementById('rufi'), '/images/rufi/rufi.web.glb'));
    ('requestIdleCallback' in window) ? requestIdleCallback(start, { timeout: 3000 }) : setTimeout(start, 1500);
  }
</script>
```

`rufi-3d.js` (esqueleto del módulo):

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function mount(container, url) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const { width, height } = container.getBoundingClientRect();
  renderer.setSize(width, height);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f88, 2), Object.assign(new THREE.DirectionalLight(0xffffff, 1.7), { position: new THREE.Vector3(-1.2, 2.4, 2.6) }));
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 20);
  camera.position.set(0, 0.85, 3.6); camera.lookAt(0, 0.8, 0);   // modelo de 1,65 m

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  scene.add(gltf.scene);
  renderer.render(scene, camera);
  container.replaceChildren(renderer.domElement);   // sustituye el póster cuando ya está listo

  // Movimiento de esqueleto probado: respiración suave en la columna (±2 %).
  // Los clips de Meshy (Idle_11, Idle_15, Walking, Running) NO se usan hasta re-riggear.
  const spine = ['mixamorigSpine1', 'mixamorigSpine2'].map((n) => gltf.scene.getObjectByName(n));
  const clock = new THREE.Clock();
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) return;              // no gastar batería fuera de la vista
    const s = 1 + 0.02 * (0.5 - 0.5 * Math.cos(clock.getElapsedTime() * Math.PI / 2));
    for (const b of spine) b.scale.set(1 + (s - 1) * 0.6, s, 1 + (s - 1) * 0.6);
    renderer.render(scene, camera);
  });
}
```

Notas:

- En three.js los nombres de hueso llegan **sin `:`**: `mixamorig:Spine1` → `mixamorigSpine1`.
- Para un clip del GLB: `new THREE.AnimationMixer(gltf.scene).clipAction(THREE.AnimationClip.findByName(gltf.animations, 'Idle_11')).play()`. **No usarlo en producción** hasta que el modelo esté re-riggeado.
- Cámara: el modelo mide 1,65 m y su origen está en los pies.
- Accesibilidad: el lienzo es decorativo (`aria-hidden="true"`); cualquier información va en texto.

## 4. Comprobaciones antes de publicar en una landing

```bash
node tools/validate-glb.mjs models/rufi.web.glb      # presupuesto y extensiones
node tools/inspect-model.mjs models/rufi.web.glb     # qué contiene
```

- Abrir `examples/visor-rufi/` y revisar en reposo y con la animación que se vaya a usar.
- Probar en un móvil de gama media: fluidez y que la página no se ralentice.
- Lighthouse: el LCP y el CLS no deben empeorar respecto a la página sin Rufi.

## 5. Actualizar el modelo cuando haya una versión nueva

1. Guardar el nuevo original en `models/original/` (Git LFS) sin modificarlo.
2. `node tools/optimize-model.mjs models/original/NUEVO.glb models/rufi.web.glb --ratio 0.1 --error 0.01`
3. `node tools/inspect-model.mjs` y `node tools/validate-glb.mjs`.
4. Revisión visual en el visor y aprobación de Reference Home.
5. Subir `rufi.web.glb` al servidor con un nombre nuevo (caché).
