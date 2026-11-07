/**
 * DOM 冒烟测试：在 linkedom 提供的 DOM 里真正挂载一次播放器，
 * 校验结构、样式注入、两种形态、显隐与外观控制。
 * 仅用于开发校验，不参与构建。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // 默认测 dist 产物；设 APLAYER_BUNDLE 可指向别处（如站点 vendor 目录）的同版本文件
    const bundlePath = process.env.APLAYER_BUNDLE
        ? resolve(process.env.APLAYER_BUNDLE)
        : new URL('../dist/APlayer.min.js', import.meta.url);
    const code = readFileSync(bundlePath, 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const APlayer = sandbox.APlayer;
    const checks = [];
    const check = (name, ok) => checks.push([name, Boolean(ok)]);

    check('全局 APlayer 可用', typeof APlayer === 'function');

    const container = document.createElement('div');
    document.body.appendChild(container);

    const ap = new APlayer({
        container,
        audio: [{ name: '测试歌曲', artist: '测试歌手', url: 'https://example.com/a.mp3', cover: '', lrc: '' }],
    });

    await sleep(50);

    const wrapper = container.querySelector('.music-player-wrapper');
    check('渲染出 .music-player-wrapper', wrapper);
    check('渲染出 .player-widget', container.querySelector('.player-widget'));
    check('渲染出封面占位', container.querySelector('.cover-placeholder'));
    const titleEl = container.querySelector('.song-title');
    check('歌曲名正确', titleEl && titleEl.textContent.includes('测试歌曲'));
    check('控件按钮齐全', container.querySelectorAll('.icon-btn').length >= 4);
    check('音量条存在', container.querySelector('.volume-control-wrapper'));
    check('样式已注入', document.getElementById('aplayer-style'));

    /* ---------- 形态 ---------- */
    check('默认形态为悬浮小卡', ap.mode() === 'widget' && wrapper.getAttribute('data-mode') === 'widget');
    check('悬浮形态下歌词为独立浮层', container.querySelector('.lyrics-container'));

    let modeEvent = null;
    ap.on('modechange', (m) => {
        modeEvent = m;
    });
    ap.mode('full');
    await sleep(50);
    check('切换到全屏卡片', ap.mode() === 'full' && wrapper.getAttribute('data-mode') === 'full');
    check('modechange 事件触发', modeEvent === 'full');
    check('全屏形态下歌词收进卡片', container.querySelector('.lyric-slot'));
    check('全屏形态不再渲染浮层', !container.querySelector('.lyrics-container'));

    ap.toggleMode();
    await sleep(50);
    check('toggleMode 切回悬浮形态', ap.mode() === 'widget');
    check('悬浮形态浮层回归', container.querySelector('.lyrics-container'));

    /* ---------- 歌词默认居中 ---------- */
    const lyricsEl = container.querySelector('.lyrics-container');
    const lyricsInline = (lyricsEl.getAttribute('style') || '').replace(/\s+/g, '');
    check('歌词默认水平居中', lyricsInline.includes('left:50%') && lyricsInline.includes('translateX(-50%)'));

    /* ---------- 显隐 ---------- */
    let visibleEvent = null;
    ap.on('visiblechange', (v) => {
        visibleEvent = v;
    });
    ap.hide();
    await sleep(30);
    check('hide 后标记不可见', ap.visible() === false && wrapper.getAttribute('data-visible') === 'false');
    check('visiblechange 事件触发', visibleEvent === false);
    ap.show();
    await sleep(30);
    check('show 后恢复可见', ap.visible() === true && wrapper.getAttribute('data-visible') === 'true');

    /* ---------- 外观 ---------- */
    let appearanceEvent = null;
    ap.on('appearancechange', (a) => {
        appearanceEvent = a;
    });
    ap.style({ opacity: 0.6, blur: 20 });
    await sleep(30);
    const widgetInline = (container.querySelector('.player-widget').getAttribute('style') || '').replace(/\s+/g, '');
    check('不透明度写入卡片变量', widgetInline.includes('--aplayer-opacity:0.6'));
    check('模糊度写入卡片变量', widgetInline.includes('--aplayer-blur:20px'));
    check('appearancechange 事件触发', appearanceEvent && appearanceEvent.opacity === 0.6);

    const allAppearance = ap.style();
    check(
        '两种形态外观各自独立',
        allAppearance.widget.opacity === 0.6 && allAppearance.full.opacity === 1
    );
    ap.style({ fullOpacity: 0.5, fullBlur: 4 });
    check(
        '可单独设置全屏形态外观',
        ap.style().full.opacity === 0.5 && ap.style().full.blur === 4 && ap.style().widget.opacity === 0.6
    );

    /* ---------- 歌词显隐与外部定位 ---------- */
    ap.lyrics(false);
    await sleep(30);
    check('关闭歌词', ap.lyrics() === false && !container.querySelector('.lyrics-container'));
    ap.lyrics(true);
    await sleep(30);
    check('重新打开歌词', ap.lyrics() === true && container.querySelector('.lyrics-container'));

    ap.lyricsPosition({ x: 120, y: 300 });
    await sleep(30);
    const moved = (container.querySelector('.lyrics-container').getAttribute('style') || '').replace(/\s+/g, '');
    check('歌词位置可外部指定', moved.includes('left:120px') && moved.includes('top:300px'));
    ap.lyricsPosition({ centered: true });
    await sleep(30);
    const recentered = (container.querySelector('.lyrics-container').getAttribute('style') || '').replace(/\s+/g, '');
    check('歌词可回到居中', recentered.includes('left:50%'));

    /* ---------- 兜底：容器为 body 时不清空页面 ---------- */
    document.body.innerHTML = '<main id="keep">页面内容</main>';
    const ap2 = new APlayer({ container: document.body });
    await sleep(30);
    check('传 body 时保留页面内容', !!document.getElementById('keep'));
    check('传 body 时自动建挂载点', !!document.querySelector('.aplayer-host .player-widget'));

    /* ---------- 样式规则：玻璃层必须真的消费这两个变量 ---------- */
    const css = readFileSync(new URL('../dist/APlayer.min.css', import.meta.url), 'utf8');
    check('玻璃层伪元素存在', css.includes('.player-widget::before') || css.includes('.player-widget:before'));
    check('模糊度变量被 backdrop-filter 消费', /backdrop-filter:\s*blur\(var\(--aplayer-blur/.test(css));
    check('不透明度变量被玻璃层消费', /opacity:\s*var\(--aplayer-opacity/.test(css));
    /* 歌词反色：不再有形态 / 主题条件色 */
    const renderSource = readFileSync(new URL('../src/render.generated.cjs', import.meta.url), 'utf8');
    check('歌词统一用 difference 反色', /mix-blend-mode:\s*difference/.test(css));
    check('产物里不再有歌词颜色选择器', !renderSource.includes('type:"color"'));
    check('产物里不再读取 settings.color', !renderSource.includes('settings.color'));
    check('全屏卡片宽度已放大', css.includes('min(760px'));
    check(
        '模板里没有残留的插值占位符',
        !readFileSync(new URL('../src/render.generated.cjs', import.meta.url), 'utf8').includes('lyricLines')
    );

    /* ---------- 对外方法 ---------- */
    check(
        '对外方法齐全',
        ['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'scale', 'mode', 'visible', 'style', 'lyrics', 'destroy'].every(
            (m) => typeof ap[m] === 'function'
        )
    );

    const results = checks.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'}  ${name}`);
    process.stdout.write(results.join('\n') + '\n');
    process.stdout.write(`歌曲列表长度: ${ap.playlist.length}\n`);
    process.stdout.write(`失败项: ${results.filter((r) => r.startsWith('FAIL')).length} / ${results.length}\n`);
}

main().catch((e) => {
    process.stdout.write('TEST ERR: ' + e.message.split('\n')[0] + '\n');
});
