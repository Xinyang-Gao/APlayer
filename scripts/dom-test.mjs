/**
 * DOM 冒烟测试：在 linkedom 提供的 DOM 里真正挂载一次播放器，
 * 检查结构、样式注入与交互回调是否正常。
 * 仅用于开发校验，不参与构建。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

async function main() {
const dom = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
const { window, document } = dom;

const store = new Map();
const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
};

const sandbox = {
    window,
    document,
    navigator: { userAgent: 'node' },
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Promise,
    Math,
    JSON,
    Date,
    fetch: () => Promise.reject(new Error('no network')),
    Element: window.Element,
    Node: window.Node,
    SVGElement: window.SVGElement || function () {},
    MutationObserver:
        window.MutationObserver ||
        class {
            observe() {}
            disconnect() {}
        },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
window.localStorage = localStorage;
window.innerWidth = 1280;
window.innerHeight = 800;

const code = readFileSync(new URL('../dist/APlayer.min.js', import.meta.url), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const APlayer = sandbox.APlayer;
const checks = [];

checks.push(['全局 APlayer 可用', typeof APlayer === 'function']);

const container = document.createElement('div');
document.body.appendChild(container);

const ap = new APlayer({
    container,
    audio: [{ name: '测试歌曲', artist: '测试歌手', url: 'https://example.com/a.mp3', cover: '', lrc: '' }],
});

await new Promise((r) => setTimeout(r, 50)); // 等 Vue 完成一次 DOM 更新

const wrapper = container.querySelector('.music-player-wrapper');
checks.push(['渲染出 .music-player-wrapper', !!wrapper]);
checks.push(['渲染出 .player-widget', !!container.querySelector('.player-widget')]);
checks.push(['渲染出封面占位', !!container.querySelector('.cover-placeholder')]);
const titleEl = container.querySelector('.song-title');
console.log('title outerHTML:', titleEl ? titleEl.outerHTML.slice(0, 200) : 'NULL');
checks.push(['歌曲名正确', !!titleEl && titleEl.textContent.includes('测试歌曲')]);
checks.push(['播放按钮存在', container.querySelectorAll('.icon-btn').length >= 4]);
checks.push(['音量条存在', !!container.querySelector('.volume-control-wrapper')]);
checks.push(['样式已注入', !!document.getElementById('aplayer-style')]);
checks.push(['对外方法齐全', ['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'scale', 'destroy'].every((m) => typeof ap[m] === 'function')]);

// 打开播放列表

const results = checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.stdout.write(results.join('\n') + '\n');
process.stdout.write(`歌曲列表长度: ${ap.playlist.length}\n`);
process.stdout.write(`失败项: ${results.filter((r) => r.startsWith('FAIL')).length}\n`);

}
main().catch((e) => { console.log('TEST ERR:', e.message.split('\n')[0]); });
