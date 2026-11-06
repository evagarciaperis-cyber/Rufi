import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Pruebas aisladas del plugin de Joomla (fase F), escritas en PHP: tests/php/run.php.
// Se omiten si no hay PHP en la máquina. No hay ningún Joomla real implicado.
const hasPhp = spawnSync('php', ['-v']).status === 0;

test('plugin de Joomla: pruebas PHP aisladas (inyector, estáticas y simulación)', { skip: !hasPhp && 'php no disponible' }, () => {
  const r = spawnSync('php', ['tests/php/run.php'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /(\d+)\/\1 superadas/);
});
