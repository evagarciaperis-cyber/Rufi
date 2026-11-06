/**
 * Adaptador entre el contrato de la fase 1 (spec/rufi.character.json, RUFI.md) y el modelo real
 * (models/rufi-expresivo.web.glb). El componente habla siempre en términos del contrato
 * (estados idle, greet, curious, happy, sleep…); este módulo dice con qué animaciones y
 * expresiones REALES del GLB se representa cada uno. Ver docs/14-componente-web.md §3.
 */

/** Clips del contrato → clips del modelo. `null` = no existe en el modelo. */
export const CLIP_MAP = {
  idle_breathe: 'idle',
  greet_wave: 'wave',
  curious_tilt: 'curious',
  blink: 'blink',
  happy_jump: null, // no hay salto: "happy" se representa con la expresión smile
  talk_loop: null, // el modelo no tiene bocas de habla
  peek_in: null, // asomarse = desplazamiento del modelo en la escena 3D + curious
  enter: null, // entrar = desplazamiento del modelo en la escena 3D + idle
  exit: null,
  sleep_loop: null, // dormir = idle (sin expresiones integradas) a media velocidad + ojos cerrados
};

/** Shape keys del contrato → morph targets del modelo (con su peso). */
export const MORPH_MAP = {
  blink_L: ['blink', 1],
  blink_R: ['blink', 1], // el modelo tiene un único control para los dos ojos
  eye_happy_L: ['smile', 1],
  eye_happy_R: ['smile', 1],
  mouth_wide: ['smile', 1],
};

/** Huesos del contrato → huesos Mixamo del modelo (nombres tal como los deja GLTFLoader, sin ':'). */
export const BONE_MAP = {
  pelvis: 'mixamorigHips', spine: 'mixamorigSpine', chest: 'mixamorigSpine2', neck: 'mixamorigNeck', head: 'mixamorigHead',
  upper_arm_L: 'mixamorigLeftArm', forearm_L: 'mixamorigLeftForeArm', hand_L: 'mixamorigLeftHand',
  upper_arm_R: 'mixamorigRightArm', forearm_R: 'mixamorigRightForeArm', hand_R: 'mixamorigRightHand',
  leg_L: 'mixamorigLeftUpLeg', foot_L: 'mixamorigLeftFoot', leg_R: 'mixamorigRightUpLeg', foot_R: 'mixamorigRightFoot',
};

/**
 * Estados del componente (RUFI.md §6) → representación en el modelo.
 *  base:      clip de movimiento (idle/wave/curious) que se reproduce con fundido
 *  once/next: se reproduce una vez y vuelve al estado `next`
 *  overlay:   expresión aditiva encima del movimiento (blink/smile)
 *  stage:     posición del modelo en la escena (peek: asomado desde abajo; out: fuera)
 *  bodyOnly:  usar el clip sin sus expresiones integradas (para controlar los ojos a mano)
 */
export const STATE_MAP = {
  hidden: { base: 'idle', stage: 'out' },
  peek: { base: 'curious', stage: 'peek' },
  enter: { base: 'idle', stage: 'in' },
  greet: { base: 'wave', once: true, next: 'idle', stage: 'in' },
  idle: { base: 'idle', stage: 'in' },
  curious: { base: 'curious', once: true, next: 'idle', stage: 'in' },
  happy: { base: 'idle', overlay: 'smile', stage: 'in' },
  talking: { base: 'idle', stage: 'in' },
  sleep: { base: 'idle', bodyOnly: true, eyesClosed: true, timeScale: 0.6, stage: 'in' },
  exit: { base: 'idle', stage: 'out' },
};

/** Animaciones que debe tener el modelo para que el adaptador funcione. */
export const REQUIRED_CLIPS = ['idle', 'wave', 'curious', 'blink', 'smile'];
export const REQUIRED_MORPHS = ['blink', 'smile'];
