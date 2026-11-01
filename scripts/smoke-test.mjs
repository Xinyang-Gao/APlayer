/* 冒烟测试：在无浏览器环境下校验模板可被 Vue 运行时编译器编译 */
import { readFileSync, writeFileSync } from 'node:fs';

const log = [];
globalThis.document = {
    createElement: () => ({ innerHTML: '', textContent: '', setAttribute() {}, appendChild() {} }),
};

try {
    const vueSource = readFileSync(new URL('../src/vue-global.js', import.meta.url), 'utf8').replace(
        /\nexport default Vue;\n/,
        '\n'
    );
    const Vue = new Function('return (function(){' + vueSource + '; return Vue; })()')();
    log.push('vue loaded: ' + typeof Vue + ', compile: ' + typeof Vue.compile);

    const mod = readFileSync(new URL('../src/template.js', import.meta.url), 'utf8');
    const start = mod.indexOf('`');
    const end = mod.lastIndexOf('`');
    const render = Vue.compile(mod.slice(start + 1, end));
    log.push('template compiled: ' + typeof render);
} catch (error) {
    log.push('FAILED: ' + error.message);
}

writeFileSync('/tmp/smoke-result.txt', log.join('\n'));
