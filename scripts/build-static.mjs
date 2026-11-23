import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('site');
rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'assets'), { recursive: true });
copyFileSync(resolve('client/game.html'), resolve(out, 'index.html'));
writeFileSync(resolve(out, '.nojekyll'), '');
cpSync(resolve('public/assets'), resolve(out, 'assets'), { recursive: true });
console.log('静态站点已写入 site/（index.html 与 assets/）');
