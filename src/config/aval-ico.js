/**
 * Configuración de Rufi para https://referencehome.es/ICO/aval-ico-valencia.html
 *
 * Selectores reales de la landing (comprobados sobre la página publicada):
 *   #test            sección del test de requisitos
 *   #t-test          su título (recibe el foco al llegar)
 *   #q-body .q-res   resultado del test (aparece al terminarlo)
 *   #simulador       sección del simulador
 *   #t-sim           su título
 *   #sim-figures     cifras del simulador (deja de estar oculto cuando hay resultado)
 *   #masc            mascota anterior (v0): Rufi la oculta en tiempo de ejecución, sin editar el HTML
 *
 * Copiar este archivo como plantilla para otras landings: cambiar `page`, los textos, las
 * opciones del panel y los disparadores.
 */
window.RufiConfig = {
  page: 'aval-ico-valencia',
  replaceSelector: '#masc',
  zIndex: 46,
  // En móvil la barra de WhatsApp (#wa-dock) reserva 106 px a la derecha para la mascota.
  size: { mobile: [104, 122], desktop: [150, 176] },
  offset: { mobile: [2, 0], desktop: [20, 16] },
  welcome: { text: '¡Holaaa! 👋 Soy Rufi. ¿Te echo una patita con el Aval ICO? 🏡' },
  whatsapp: { number: '34674612272', message: 'Hola, he visto vuestra guía del Aval ICO y me gustaría recibir asesoramiento' },
  panel: {
    title: '¿En qué te ayudo?',
    subtitle: 'Soy Rufi, de Reference Home. Elige una opción y te acompaño.',
    options: [
      { id: 'requisitos', label: 'Comprobar requisitos', hint: 'Test del aval · 1 minuto', icon: 'check', action: { type: 'scroll', target: '#test', focus: '#t-test' } },
      { id: 'ahorro', label: 'Calcular ahorro necesario', hint: 'Simulador orientativo', icon: 'calculator', action: { type: 'scroll', target: '#simulador', focus: '#t-sim' } },
      { id: 'asesor', label: 'Hablar con Reference Home', hint: 'WhatsApp · +34 674 61 22 72', icon: 'whatsapp', action: { type: 'whatsapp' } },
    ],
    footnote: 'Información orientativa. La aprobación del aval depende siempre del banco.',
  },
  triggers: [
    { id: 'llega-test', on: 'visible', selector: '#test', threshold: 0.35, dwell: 1400, state: 'curious', say: '¡Tengo una idea! ¿Lo comprobamos juntos? Son unas preguntas rápidas.' },
    { id: 'fin-test', on: 'complete', selector: '#q-body', match: '.q-res', state: 'happy', say: '¡Hecho! 🎉 Es orientativo: la decisión final es del banco. ¿Calculamos ahora el ahorro que necesitarías?', bubbleAction: { type: 'scroll', target: '#simulador', focus: '#t-sim' } },
    { id: 'llega-simulador', on: 'visible', selector: '#simulador', threshold: 0.35, dwell: 1400, state: 'curious', say: '¿Vemos cuánto ahorro necesitarías? Es una estimación orientativa.' },
    { id: 'resultado-simulador', on: 'shown', selector: '#sim-figures', state: 'happy', say: 'Es una estimación orientativa. Si quieres, lo revisamos contigo por WhatsApp.', bubbleAction: { type: 'whatsapp', number: '34674612272', message: 'Hola, he usado el simulador del Aval ICO y me gustaría revisarlo con vosotros' } },
  ],
};
