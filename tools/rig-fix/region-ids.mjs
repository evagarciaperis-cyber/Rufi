// Escribe un .bin con la región (uint8) de cada vértice: 1 cabeza, 2 pañuelo, 3 tronco, 4 piernas, 5 brazos.
// Uso: node tools/rig-fix/region-ids.mjs modelo.glb salida.bin
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFileSync } from 'node:fs';
import { computeRegions } from './regions.mjs';
const R = await computeRegions(await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]));
writeFileSync(process.argv[3], Buffer.from(R.region.buffer));
console.log('regiones escritas', R.n);
