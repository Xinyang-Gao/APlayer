import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const root = dirname(new URL(import.meta.url).pathname);
const production = process.argv.includes('--production');

/**
 * 播放器样式与模板都打进 JS，页面只需要引一个脚本。
 * 模板在构建期编译成 render 函数（src/render.generated.js），
 * 因此运行时只需要 Vue 的 runtime 版本，不必带上模板编译器。
 */

/** 构建期在 Node 里跑 Vue 时用的最小 DOM 桩（仅供 HTML 实体解码） */
function installDomStub() {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const decode = (text) =>
        text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
            if (body[0] === '#') {
                const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
                return String.fromCodePoint(code);
            }
            return named[body.toLowerCase()] ?? match;
        });

    let html = '';
    const decoder = {
        set innerHTML(value) {
            html = value;
        },
        get innerHTML() {
            return html;
        },
        get textContent() {
            return decode(html);
        },
        children: [
            {
                getAttribute: () => {
                    const matched = /^<div foo="([\s\S]*)">$/.exec(html);
                    return matched ? decode(matched[1]) : decode(html);
                },
            },
        ],
        setAttribute() {},
        appendChild() {},
        remove() {},
    };

    globalThis.document = { createElement: () => decoder };
}

function loadVue(file) {
    const source = readFileSync(resolve(root, 'node_modules/vue/dist', file), 'utf8');
    return new Function(`return (function(){ ${source}; return Vue; })()`)();
}

/** 把 vue 的 global 构建补一行 export，方便被 import */
function writeVueShim() {
    const file = production ? 'vue.runtime.global.prod.js' : 'vue.runtime.global.js';
    const source = readFileSync(resolve(root, 'node_modules/vue/dist', file), 'utf8');
    // 用 CommonJS 输出：Vue 的 render 代码里有 with(_ctx)，ESM 的严格模式不允许
    writeFileSync(resolve(root, 'src/vue-global.cjs'), `${source}\nmodule.exports = Vue;\n`, 'utf8');
}

/** 编译模板 → src/render.generated.js */
function generateRender() {
    installDomStub();
    const full = production ? 'vue.global.prod.js' : 'vue.global.js';
    const Vue = loadVue(full);
    globalThis.Vue = Vue; // global 构建的 render 代码从闭包外取 _Vue

    const template = readFileSync(resolve(root, 'src/template.js'), 'utf8');
    const start = template.indexOf('`');
    const end = template.lastIndexOf('`');
    // 关闭静态提升：这样编译产物里不会出现 render 函数之外的常量声明
    const render = Vue.compile(template.slice(start + 1, end), { hoistStatic: false }).toString();

    writeFileSync(
        resolve(root, 'src/render.generated.cjs'),
        `// 本文件由 build.mjs 自动生成：src/template.js 的编译产物，请勿手动编辑。\n` +
            `const _Vue = require('./vue-global.cjs');\n\n` +
            `module.exports = ${render};\n`,
        'utf8'
    );
    console.log(`[build] 模板编译完成（${render.length} 字节）`);
}

async function run() {
    generateRender();
    writeVueShim();
    mkdirSync(resolve(root, 'dist'), { recursive: true });

    await esbuild.build({
        entryPoints: [resolve(root, 'src/index.js')],
        outfile: resolve(root, 'dist/APlayer.min.js'),
        bundle: true,
        minify: production,
        sourcemap: true,
        target: ['es2018'],
        format: 'iife',
        globalName: 'APlayer',
        // esbuild 的 iife 产物是命名空间对象，这里还原成构造函数本身
        footer: {
            js: 'if (typeof module === "object" && module.exports) { module.exports = APlayer.default || APlayer; } else { APlayer = APlayer.default || APlayer; }',
        },
        loader: { '.css': 'text' },
        legalComments: 'none',
        logLevel: 'info',
    });

    // 另存一份独立 CSS，方便用 <link> 引入而不必等 JS 注入
    await esbuild.build({
        entryPoints: [resolve(root, 'src/style.css')],
        outfile: resolve(root, 'dist/APlayer.min.css'),
        bundle: true,
        minify: true,
        loader: { '.css': 'css' },
        logLevel: 'info',
    });
}

run().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
});
