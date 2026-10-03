import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = new URL('.', import.meta.url);
const src = new URL('src/', root);
const dist = new URL('dist/', root);
await rm(dist, {recursive:true,force:true});
await mkdir(dist, { recursive: true });

const read = async path => readFile(new URL(path, src), 'utf8');
const stripModuleSyntax = source => source
  .replace(/^import .*?;\s*$/gm, '')
  .replace(/\bexport\s+(?=(const|function)\b)/g, '');

const readerTemplate = await read('reader/index.html');
const readerCss = await read('reader/style.css');
const readerScoring = stripModuleSyntax(await read('reader/scoring.mjs'));
const readerApp = stripModuleSyntax(await read('reader/app.js'));
const readerHtml = readerTemplate
  .replace('<link rel="stylesheet" href="/style.css">', `<style>${readerCss}</style>`)
  .replace('<script type="module" src="/app.js"></script>', `<script>${readerScoring}\n${readerApp}<\/script>`)
  .replace('href="/" aria-label', 'href="#" aria-label');

const curriculum = stripModuleSyntax(await read('curriculum.mjs'));
const engine = stripModuleSyntax(await read('engine.mjs'));
const studio = stripModuleSyntax(await read('studio.js'));
const storage = stripModuleSyntax(await read('storage.mjs'));
const deviceRecovery = stripModuleSyntax(await read('device-recovery.mjs'));
// Escape markup openers so an embedded </script> cannot terminate the outer
// module while the browser is still parsing the standalone document.
const readerLiteral = `const READER_HTML=${JSON.stringify(readerHtml).replaceAll('<', '\\u003c')};`;
const app = `${curriculum}\n${engine}\n${storage}\n${deviceRecovery}\n${readerLiteral}\n${studio}\n${await read('cloud.js')}\n${await read('open-models.js')}\n${await read('learning-ai.js')}\n${await read('webmcp.js')}`;
const css = (await read('studio.css')) + '\n' + (await read('refinements.css'))+'\n'+(await read('accounts.css'))+'\n'+(await read('learning-ai.css'));
let html = await read('index.html');
const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='17' fill='%23292d61'/%3E%3Cpath d='M18 14v34h23v-8H27V14z' fill='white'/%3E%3Ccircle cx='43' cy='19' r='6' fill='%23e6b450'/%3E%3C/svg%3E">`;
html = html
  .replace('</title>', `</title>${favicon}`)
  .replace('<!-- STYLES -->', `<style>${css}</style>`)
  .replace('<!-- SCRIPTS -->', `<script>window.CLOUD_MODE=true;<\/script><script type="module">${app}<\/script>`);

await writeFile(new URL('index.html', dist), html);
await writeFile(new URL('open-worker.mjs',dist),'export default '+JSON.stringify(await read('open-model-worker.js'))+';');
// Every browser-served copy enables cloud storage. Regression harnesses extract
// the module separately to exercise both the legacy migration and cloud paths.
await writeFile(new URL('page.mjs', dist), 'export default '+JSON.stringify(html)+';');
await build({configFile:false,publicDir:false,build:{target:'es2022',emptyOutDir:false,outDir:fileURLToPath(new URL('server/',dist)),minify:false,lib:{entry:fileURLToPath(new URL('server/index.mjs',root)),formats:['es'],fileName:()=> 'index.js'}}});
await rm(new URL('page.mjs',dist));
await rm(new URL('open-worker.mjs',dist));
await mkdir(new URL('.openai/',dist),{recursive:true});
await cp(new URL('.openai/hosting.json',root),new URL('.openai/hosting.json',dist));
await cp(new URL('drizzle/',root),new URL('.openai/drizzle/',dist),{recursive:true});
console.log('Built standalone test fixture and D1-backed Sites Worker.');
