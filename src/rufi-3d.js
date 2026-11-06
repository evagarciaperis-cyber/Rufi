/**
 * Motor 3D de Rufi: carga el GLB y lo anima SOLO con sus animaciones reales (idle, wave,
 * curious, blink, smile) más el desplazamiento del modelo completo dentro de la escena para
 * asomarse/entrar/salir. Se empaqueta (con three.js) en dist/rufi-3d.js y lo carga rufi.js
 * de forma diferida.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, AnimationMixer, AnimationUtils,
  LoopOnce, LoopRepeat, AdditiveAnimationBlendMode, SRGBColorSpace, NeutralToneMapping, Box3, Vector3, Group,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { STATE_MAP, REQUIRED_CLIPS, REQUIRED_MORPHS } from './adapter.js';

const FADE = 0.35; // s de fundido entre movimientos

export async function createRufi3D({ container, modelUrl, modelBuffer = null, maxFps = 60, maxPixelRatio = 2, onStateEnd = () => {} }) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';

  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x9a8f88, 2.0));
  const key = new DirectionalLight(0xffffff, 1.7); key.position.set(-1.2, 2.4, 2.6); scene.add(key);
  const camera = new PerspectiveCamera(24, 1, 0.05, 20);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = modelBuffer ? await loader.parseAsync(modelBuffer, '') : await loader.loadAsync(modelUrl);
  const model = gltf.scene;
  const stage = new Group(); stage.add(model); scene.add(stage);
  const morphMeshes = []; model.traverse((o) => { if (o.isMesh && o.morphTargetDictionary) morphMeshes.push(o); });
  const names = gltf.animations.map((c) => c.name);
  const missing = REQUIRED_CLIPS.filter((c) => !names.includes(c));
  const missingMorphs = REQUIRED_MORPHS.filter((m) => !morphMeshes.some((o) => m in o.morphTargetDictionary));
  if (missing.length || missingMorphs.length) throw new Error(`Modelo incompleto: faltan ${[...missing, ...missingMorphs].join(', ')}`);

  // Encuadre: cuerpo entero, pies en la base del lienzo
  const box = new Box3().setFromObject(model, true); const size = box.getSize(new Vector3());
  const H = size.y;
  function frame() {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    const dist = (H * 0.56) / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, H * 0.5, dist); camera.lookAt(0, H * 0.5, 0); camera.updateProjectionMatrix();
    dirty = true;
  }

  // Animaciones: movimientos (con y sin sus expresiones) y expresiones aditivas
  const mixer = new AnimationMixer(model);
  const clip = (n) => gltf.animations.find((c) => c.name === n);
  const bodyOnly = new Map();
  const bodyOnlyClip = (n) => { if (!bodyOnly.has(n)) { const c = clip(n).clone(); c.name = `${n}_cuerpo`; c.tracks = c.tracks.filter((t) => !t.name.endsWith('.morphTargetInfluences')); bodyOnly.set(n, c); } return bodyOnly.get(n); };
  const additive = Object.fromEntries(['blink', 'smile'].map((n) => { const c = AnimationUtils.makeClipAdditive(clip(n).clone()); return [n, mixer.clipAction(c, model, AdditiveAnimationBlendMode)]; }));
  for (const a of Object.values(additive)) { a.setLoop(LoopOnce, 1); a.clampWhenFinished = false; }

  let current = null, state = 'hidden', stateToken = 0, eyesClosed = 0, eyesTarget = 0;
  function setInfluence(name, v) { for (const m of morphMeshes) { const k = m.morphTargetDictionary[name]; if (k !== undefined) m.morphTargetInfluences[k] = v; } }

  function playBase(def) {
    const c = def.bodyOnly ? bodyOnlyClip(def.base) : clip(def.base);
    const next = mixer.clipAction(c);
    if (next === current) { next.timeScale = def.timeScale || 1; return; }
    next.reset(); next.timeScale = def.timeScale || 1;
    next.setLoop(def.once ? LoopOnce : LoopRepeat, Infinity); next.clampWhenFinished = !!def.once;
    next.play();
    if (current) current.crossFadeTo(next, FADE, false);
    current = next;
  }

  mixer.addEventListener('finished', (e) => {
    if (e.action !== current) return;
    const def = STATE_MAP[state];
    if (def && def.once) { const tk = stateToken; const next = def.next || 'idle'; onStateEnd(state, next); if (tk === stateToken) setState(next); }
  });

  // Escena: el modelo completo se desplaza (no es una animación de huesos: el GLB no tiene clip
  // de "asomarse"). Movimiento amortiguado, sin saltos.
  const STAGES = { out: { y: -1.08, x: 0.1, r: 0 }, peek: { y: -0.52, x: 0.16, r: 0.16 }, in: { y: 0, x: 0, r: 0 } };
  let stageTarget = STAGES.out; const stagePos = { ...STAGES.out };
  function applyStage(dt) {
    const k = 1 - Math.exp(-dt * 5.5); let moving = false;
    for (const p of ['y', 'x', 'r']) { const d = stageTarget[p] - stagePos[p]; if (Math.abs(d) > 1e-4) moving = true; stagePos[p] += d * k; }
    stage.position.set(stagePos.x * H, stagePos.y * H, 0); stage.rotation.z = stagePos.r;
    return moving;
  }

  function setState(name) {
    const def = STATE_MAP[name]; if (!def) return;
    state = name; stateToken++;
    stageTarget = STAGES[def.stage || 'in'];
    eyesTarget = def.eyesClosed ? 1 : 0;
    playBase(def);
    if (def.overlay) react(def.overlay);
    wake();
  }

  /** Expresión aditiva puntual (blink o smile). Smile no se suma si el movimiento ya sonríe (wave). */
  function react(name) {
    const a = additive[name]; if (!a) return;
    if (name === 'smile' && current && current.getClip().name === 'wave') return;
    a.reset().play(); wake();
  }

  // Bucle de render: limitado a maxFps; se detiene fuera de la vista, con la pestaña oculta y
  // cuando Rufi duerme y todo está quieto.
  let raf = 0, last = performance.now(), visible = true, dirty = true, running = false;
  const minDt = 1 / maxFps;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = (now - last) / 1000; if (dt < minDt - 0.002) return; last = now;
    const step = Math.min(dt, 0.1);
    mixer.update(step);
    const moving = applyStage(step);
    eyesClosed += (eyesTarget - eyesClosed) * (1 - Math.exp(-step * 6));
    if (state === 'sleep' || eyesClosed > 0.001) setInfluence('blink', eyesClosed);
    renderer.render(scene, camera); dirty = false;
    const settled = state === 'sleep' && !moving && Math.abs(eyesTarget - eyesClosed) < 0.002;
    if (!visible || document.hidden || settled) stop();
  }
  function start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function wake() { if (visible && !document.hidden) start(); }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { threshold: 0 });
  io.observe(container);
  const onVis = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => { frame(); renderer.render(scene, camera); });
  ro.observe(container);

  container.appendChild(canvas);
  frame();
  setState('hidden');
  applyStage(10); renderer.render(scene, camera);

  return {
    canvas, setState, react, get state() { return state; }, clips: names,
    renderOnce() { mixer.update(0); applyStage(0); renderer.render(scene, camera); },
    dispose() { stop(); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); mixer.stopAllAction(); renderer.dispose(); canvas.remove(); },
    debug: () => ({ state, running, fps: maxFps, base: current && current.getClip().name, stage: { ...stagePos } }),
  };
}
