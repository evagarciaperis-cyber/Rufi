// Informe de regiones anatómicas: node tools/rig-fix/report-regions.mjs modelo.glb [colores.bin]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { computeRegions } from './regions.mjs';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]);
const R = await computeRegions(doc);
const J = R.prim.getAttribute('JOINTS_0').getArray(), Wt = R.prim.getAttribute('WEIGHTS_0').getArray();
const names = ['cuerpo','cabeza','pañuelo','barriga','pierna','brazo'];
const yr = {}; const dom = {};
for (let i = 0; i < R.n; i++) { const r = names[R.region[i]]; const y = R.world[i*3+1]; yr[r] ??= [9,-9,0]; yr[r][0]=Math.min(yr[r][0],y); yr[r][1]=Math.max(yr[r][1],y); yr[r][2]++;
  let b=0,w=-1; for(let k=0;k<4;k++) if(Wt[i*4+k]>w){w=Wt[i*4+k];b=J[i*4+k];} dom[r] ??= {}; dom[r][R.jname[b]]=(dom[r][R.jname[b]]||0)+1; }
for (const r of names) if (yr[r]) console.log(r.padEnd(8), 'n', yr[r][2], 'y', yr[r][0].toFixed(3), '→', yr[r][1].toFixed(3), JSON.stringify(Object.fromEntries(Object.entries(dom[r]).sort((a,b)=>b[1]-a[1]).slice(0,5))));
// export region colors for a visual check
const col = new Float32Array(R.n*3); const C=[[0.85,0.85,0.85],[0.9,0.3,0.35],[0.2,0.7,0.3],[0.25,0.45,0.95],[0.7,0.4,0.9],[0.95,0.7,0.2]];
for (let i=0;i<R.n;i++) col.set(C[R.region[i]], i*3);
const fs = await import('node:fs'); if (process.argv[3]) fs.writeFileSync(process.argv[3], Buffer.from(col.buffer));
