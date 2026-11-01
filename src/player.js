import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from './vue.js';
import { findLyricIndex, parseLrc } from './lrc.js';
import { read, readJSON, write, writeJSON } from './storage.js';
import render from './render.generated.cjs';

/* ---------------- 常量 ---------------- */

const STORAGE_KEYS = {
    position: 'player-widget-position',
    scale: 'player-widget-scale',
    collapsed: 'player-widget-collapsed',
    mode: 'player-widget-mode',
    lyricsPosition: 'lyrics-position',
    lyricsVisible: 'lyrics-visible',
    lyricsSettings: 'lyrics-settings',
    appearance: 'player-widget-appearance',
};

// 这些区域内的按下事件不触发拖拽，避免与控件冲突
const DRAG_EXCLUDE =
    'button, input, .progress-container, .volume-slider-container, .more-menu-popup, .playlist-panel, .settings-menu';

const MIN_SCALE = 0.75;
const MAX_SCALE = 1.6;
const SCALE_STEP = 0.05;
const MIN_OPACITY = 0.3;
const MAX_BLUR = 24;
const MODES = ['widget', 'full'];
const DEFAULT_BLUR = 12;
const DRAG_THRESHOLD = 5;
const EDGE_MARGIN = 10;

const LOOP_MODES = [
    { value: 'list', label: '列表循环' },
    { value: 'one', label: '单曲循环' },
    { value: 'shuffle', label: '随机播放' },
];

const DEFAULT_SETTINGS = { fontSize: 24, color: '#ffffff' };

/* ---------------- 组件 ---------------- */

export default {
    name: 'MusicPlayer',
    render,
    props: {
        options: { type: Object, default: () => ({}) },
        emitter: { type: Object, default: null },
    },
    setup(props, { expose }) {
        /* --- 元素引用 --- */
        const rootEl = ref(null);
        const widgetEl = ref(null);
        const audioEl = ref(null);
        const moreEl = ref(null);
        const menuEl = ref(null);
        const progressEl = ref(null);

        /* --- 播放状态 --- */
        const playing = ref(false);
        const playlist = ref([]);
        const currentIndex = ref(0);
        const progress = ref(0);
        const loopMode = ref('list');

        /* --- 音量 --- */
        const volume = ref(props.options.volume ?? 0.7);
        const lastVolume = ref(volume.value);
        const volumeHover = ref(false);

        /* --- 面板 --- */
        const moreOpen = ref(false);
        const playlistOpen = ref(false);
        const lyricsVisible = ref(props.options.lyrics !== false);

        /* --- 歌词 --- */
        const lyrics = ref([]);
        const lyricIndex = ref(-1);
        const currentLine = ref('');
        const nextLine = ref('');
        const lyricsPos = ref({ x: 0, y: 0 });
        const lyricsDragging = ref(false);

        /* --- 形态与外观 --- */
        const mode = ref(normalizeMode(props.options.mode ?? read(STORAGE_KEYS.mode, 'widget')));
        const visible = ref(props.options.visible !== false);
        const storedAppearance = readJSON(STORAGE_KEYS.appearance, {}) || {};
        const appearance = ref({
            widget: { opacity: 1, blur: DEFAULT_BLUR, ...(storedAppearance.widget || {}) },
            full: { opacity: 1, blur: DEFAULT_BLUR, ...(storedAppearance.full || storedAppearance.card || {}) },
        });
        const lyricsCustom = ref(false); // 歌词浮层是否被用户拖过

        /* --- 位置与缩放 --- */
        const positionStore = ref(readJSON(STORAGE_KEYS.position, {}) || {});
        const position = ref(positionStore.value[mode.value] || null);
        const dragging = ref(false);
        const scale = ref(clampScale(readJSON(STORAGE_KEYS.scale, 1)));
        const collapsed = ref(read(STORAGE_KEYS.collapsed, 'false') === 'true');

        const menu = ref({ visible: false, x: 0, y: 0 });
        const settings = ref({ ...DEFAULT_SETTINGS, ...readJSON(STORAGE_KEYS.lyricsSettings, {}) });

        let pendingPlay = false; // 资源未就绪时暂存的播放意图
        let interacting = false; // 指针是否停留在播放器上
        let collapseTimer = null;

        /* ---------------- 派生数据 ---------------- */

        const currentSong = computed(() => playlist.value[currentIndex.value] || null);

        const loopLabel = computed(() => {
            const mode = LOOP_MODES.find((item) => item.value === loopMode.value);
            return mode ? mode.label : LOOP_MODES[0].label;
        });

        const scalePercent = computed(() => Math.round(scale.value * 100));

        /** 当前形态的外观（悬浮卡片 / 全屏卡片各自一套） */
        const currentAppearance = computed(() => appearance.value[mode.value]);
        /* 模板里用 v-model 直接改这两个属性 */
        const appearanceProxy = computed(() => currentAppearance.value);
        const opacityPercent = computed(() => Math.round(currentAppearance.value.opacity * 100));

        /** 卡片内联样式：缩放 + 背景不透明度 + 背景模糊 */
        const widgetStyle = computed(() => ({
            '--aplayer-scale': scale.value,
            '--aplayer-opacity': currentAppearance.value.opacity,
            '--aplayer-blur': `${currentAppearance.value.blur}px`,
        }));

        const rootStyle = computed(() => {
            if (!position.value) {
                // 交给 CSS：悬浮形态落左下角，全屏形态居中
                return null;
            }
            const style = {
                left: `${position.value.left}px`,
                top: `${position.value.top}px`,
                right: 'auto',
                bottom: 'auto',
            };
            if (mode.value === 'full') {
                // 居中靠 translate(-50%, -50%)，一旦手动定位就改回左上角对齐
                style.transform = 'none';
            }
            return style;
        });

        const lyricsStyle = computed(() => {
            const { x, y } = lyricsPos.value;
            if (!lyricsCustom.value) {
                // 默认屏幕正下方居中
                return { left: '50%', top: `${y}px`, transform: 'translateX(-50%)' };
            }
            return { left: `${x}px`, top: `${y}px` };
        });

        /* 卡片内歌词跟着文字色走，浮层歌词才用自定义颜色 */
        const isInCard = computed(() => mode.value === 'full');

        const currentLineStyle = computed(() => ({
            fontSize: `${Math.round(settings.value.fontSize * (isInCard.value ? 0.62 : 1))}px`,
            color: isInCard.value ? 'var(--text-color, #23231f)' : settings.value.color,
        }));

        const nextLineStyle = computed(() => ({
            fontSize: `${Math.round(settings.value.fontSize * (isInCard.value ? 0.46 : 0.75))}px`,
            color: isInCard.value ? 'var(--text-secondary, #6d6d66)' : settings.value.color,
        }));

        const lyricsPlaceholderColor = computed(() =>
            isInCard.value ? 'var(--text-secondary, #6d6d66)' : settings.value.color
        );

        /* ---------------- 工具函数 ---------------- */

        function emit(name, ...args) {
            if (props.emitter) {
                props.emitter.emit(name, ...args);
            }
        }

        function clamp(value, min, max) {
            return Math.min(Math.max(value, min), max);
        }

        function clampScale(value) {
            return clamp(Number(value) || 1, MIN_SCALE, MAX_SCALE);
        }

        function normalizeMode(value) {
            return MODES.includes(value) ? value : 'widget';
        }

        function clampOpacity(value) {
            return clamp(Number(value) || 1, MIN_OPACITY, 1);
        }

        function clampBlur(value) {
            return clamp(Math.round(Number(value) || 0), 0, MAX_BLUR);
        }

        function clampPosition(left, top, width, height) {
            const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
            const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
            return { left: clamp(left, EDGE_MARGIN, maxX), top: clamp(top, EDGE_MARGIN, maxY) };
        }

        /** 拖拽结束后吞掉紧随其后的 click，避免误触发控件 */
        function suppressNextClick() {
            const handler = (event) => {
                event.stopPropagation();
                event.preventDefault();
            };
            window.addEventListener('click', handler, { capture: true, once: true });
            window.setTimeout(() => window.removeEventListener('click', handler, { capture: true }), 0);
        }

        function preventScroll(event) {
            if (event.cancelable) {
                event.preventDefault();
            }
        }

        /* ---------------- 播放控制 ---------------- */

        async function play() {
            const audio = audioEl.value;
            if (!audio) {
                return;
            }
            try {
                await audio.play();
                pendingPlay = false;
            } catch {
                // 自动播放被拦截或资源尚未就绪，等 canplay 后重试
                pendingPlay = true;
            }
        }

        function pause() {
            const audio = audioEl.value;
            if (!audio) {
                return;
            }
            pendingPlay = false;
            audio.pause();
        }

        function toggle() {
            if (playing.value) {
                pause();
            } else {
                play();
            }
        }

        function playIndex(index) {
            if (index < 0 || index >= playlist.value.length) {
                return;
            }
            currentIndex.value = index;
            nextTick(play);
        }

        function resolveNextIndex(step) {
            const total = playlist.value.length;
            if (!total) {
                return 0;
            }
            if (loopMode.value === 'shuffle' && step > 0 && total > 1) {
                let next = currentIndex.value;
                while (next === currentIndex.value) {
                    next = Math.floor(Math.random() * total);
                }
                return next;
            }
            return (currentIndex.value + step + total) % total;
        }

        function next() {
            playIndex(resolveNextIndex(1));
        }

        function prev() {
            playIndex(resolveNextIndex(-1));
        }

        function cycleLoopMode() {
            const index = LOOP_MODES.findIndex((item) => item.value === loopMode.value);
            loopMode.value = LOOP_MODES[(index + 1) % LOOP_MODES.length].value;
            emit('loopchange', loopMode.value);
        }

        function seekTo(seconds) {
            const audio = audioEl.value;
            if (!audio || !Number.isFinite(audio.duration)) {
                return;
            }
            audio.currentTime = clamp(seconds, 0, audio.duration);
            progress.value = (audio.currentTime / audio.duration) * 100;
        }

        function setVolume(value) {
            volume.value = clamp(Number(value) || 0, 0, 1);
        }

        function toggleMute() {
            if (volume.value > 0) {
                lastVolume.value = volume.value;
                setVolume(0);
            } else {
                setVolume(lastVolume.value || 0.7);
            }
        }

        /* ---------------- 音频事件 ---------------- */

        function handlePlay() {
            playing.value = true;
            setCollapsed(false);
            emit('play', currentSong.value);
        }

        function handlePause() {
            playing.value = false;
            scheduleCollapse();
            emit('pause', currentSong.value);
        }

        function handleEnded() {
            emit('ended', currentSong.value);
            if (loopMode.value === 'one') {
                // 单曲循环交给 audio[loop]，这里兜底
                seekTo(0);
                play();
                return;
            }
            next();
        }

        function handleTimeUpdate() {
            const audio = audioEl.value;
            if (!audio) {
                return;
            }
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                progress.value = (audio.currentTime / audio.duration) * 100;
                emit('timeupdate', { currentTime: audio.currentTime, duration: audio.duration });
            }
            if (!lyrics.value.length) {
                return;
            }
            const index = findLyricIndex(lyrics.value, audio.currentTime);
            if (index === lyricIndex.value) {
                return;
            }
            lyricIndex.value = index;
            currentLine.value = index >= 0 ? lyrics.value[index].text : '';
            nextLine.value = index >= 0 && index + 1 < lyrics.value.length ? lyrics.value[index + 1].text : '';
        }

        function handleCanPlay() {
            if (pendingPlay) {
                pendingPlay = false;
                play();
            }
            emit('canplay', currentSong.value);
        }

        function handleLoadedMetadata() {
            const audio = audioEl.value;
            if (audio) {
                audio.volume = volume.value;
                emit('loadedmetadata', { duration: audio.duration });
            }
        }

        function handleError() {
            console.warn('[APlayer] 音频加载失败，尝试跳到下一首');
            emit('error', currentSong.value);
            if (playing.value) {
                window.setTimeout(next, 1000);
            }
        }

        /* ---------------- 歌单与歌词 ---------------- */

        function normalizeAudio(list) {
            return list.map((item) => ({
                name: item.name || item.title || '未知歌曲',
                artist: item.artist || item.author || '',
                url: item.url,
                cover: item.cover || item.pic || '',
                lrc: item.lrc || '',
            }));
        }

        async function loadPlaylist() {
            const { audio, api, server, type, playlistId } = props.options;

            if (Array.isArray(audio) && audio.length) {
                playlist.value = normalizeAudio(audio);
                emit('playlist', playlist.value);
                return;
            }
            if (!playlistId) {
                return;
            }

            const url = api || `https://api.i-meto.com/meting/api?server=${server}&type=${type}&id=${playlistId}`;
            try {
                const response = await fetch(url);
                const data = await response.json();
                if (!Array.isArray(data)) {
                    return;
                }
                playlist.value = data.map((item) => ({
                    name: item.title || item.name,
                    artist: item.author || item.artist,
                    url: item.url,
                    cover: item.pic || item.cover,
                    lrc: item.lrc,
                }));
                emit('playlist', playlist.value);
            } catch (error) {
                console.error('[APlayer] 歌单加载失败:', error);
                emit('error', error);
            }
        }

        async function loadLyrics(url) {
            lyrics.value = [];
            currentLine.value = '';
            nextLine.value = '';
            lyricIndex.value = -1;
            if (!url) {
                return;
            }
            try {
                const response = await fetch(url);
                lyrics.value = parseLrc(await response.text());
                emit('lyrics', lyrics.value);
            } catch (error) {
                console.error('[APlayer] 歌词加载失败:', error);
            }
        }

        /* ---------------- 折叠 ---------------- */

        function setCollapsed(value) {
            if (collapsed.value === value) {
                return;
            }
            collapsed.value = value;
            write(STORAGE_KEYS.collapsed, String(value));
        }

        function scheduleCollapse() {
            window.clearTimeout(collapseTimer);
            // 全屏卡片常驻展开，只有悬浮形态会空闲折叠
            if (mode.value !== 'widget') {
                setCollapsed(false);
                return;
            }
            if (interacting || playing.value) {
                setCollapsed(false);
                return;
            }
            setCollapsed(false);
            collapseTimer = window.setTimeout(() => setCollapsed(true), props.options.collapseDelay ?? 500);
        }

        function handleEnter() {
            interacting = true;
            window.clearTimeout(collapseTimer);
            setCollapsed(false);
        }

        function handleLeave() {
            interacting = false;
            scheduleCollapse();
        }

        /* ---------------- 拖拽与缩放 ---------------- */

        function startDrag(event) {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }
            const root = rootEl.value;
            const widget = widgetEl.value;
            if (!root || !widget) {
                return;
            }
            if (event.target.closest && event.target.closest(DRAG_EXCLUDE)) {
                return;
            }

            const rootRect = root.getBoundingClientRect();
            const { width, height } = widget.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            let moved = false;
            let latest = clampPosition(rootRect.left, rootRect.top, width, height);

            const onMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!moved) {
                    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
                        return;
                    }
                    moved = true;
                    dragging.value = true;
                }
                latest = clampPosition(rootRect.left + dx, rootRect.top + dy, width, height);
                position.value = latest;
            };

            const onEnd = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
                window.removeEventListener('touchmove', preventScroll);
                if (!moved) {
                    return;
                }
                dragging.value = false;
                positionStore.value[mode.value] = latest;
                writeJSON(STORAGE_KEYS.position, positionStore.value);
                suppressNextClick();
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onEnd);
            window.addEventListener('pointercancel', onEnd);
            window.addEventListener('touchmove', preventScroll, { passive: false });
        }

        function startLyricsDrag(event) {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }
            const startX = event.clientX;
            const startY = event.clientY;
            const origin = { ...lyricsPos.value };
            const container = event.currentTarget;
            const bounds = container ? container.getBoundingClientRect() : { width: 200, height: 60 };
            let moved = false;

            const onMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!moved) {
                    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
                        return;
                    }
                    moved = true;
                    lyricsDragging.value = true;
                }
                const maxX = Math.max(EDGE_MARGIN, window.innerWidth - bounds.width - EDGE_MARGIN);
                const maxY = Math.max(EDGE_MARGIN, window.innerHeight - bounds.height - EDGE_MARGIN);
                lyricsPos.value = {
                    x: clamp(origin.x + dx, EDGE_MARGIN, maxX),
                    y: clamp(origin.y + dy, EDGE_MARGIN, maxY),
                };
            };

            const onEnd = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
                window.removeEventListener('touchmove', preventScroll);
                if (!moved) {
                    return;
                }
                lyricsDragging.value = false;
                lyricsCustom.value = true;
                writeJSON(STORAGE_KEYS.lyricsPosition, lyricsPos.value);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onEnd);
            window.addEventListener('pointercancel', onEnd);
            window.addEventListener('touchmove', preventScroll, { passive: false });
        }

        /** Ctrl / ⌘ + 滚轮（含触控板双指捏合）调整界面缩放 */
        function handleWheel(event) {
            if (!event.ctrlKey && !event.metaKey) {
                return;
            }
            event.preventDefault();
            setScale(scale.value + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
        }

        function setScale(value) {
            scale.value = clampScale(Math.round(value / SCALE_STEP) * SCALE_STEP);
        }

        function resetScale() {
            setScale(1);
            moreOpen.value = false;
        }

        function resetSettings() {
            settings.value = { ...DEFAULT_SETTINGS };
        }

        /* ---------------- 形态与外观 ---------------- */

        /** 切换形态：widget（悬浮小卡） / full（全屏卡片） */
        function setMode(value) {
            const nextMode = normalizeMode(value);
            if (nextMode === mode.value) {
                return;
            }
            mode.value = nextMode;
            // 两种形态各记一份位置
            position.value = positionStore.value[nextMode] || null;
            write(STORAGE_KEYS.mode, nextMode);
            emit('modechange', nextMode);
        }

        function toggleMode() {
            setMode(mode.value === 'full' ? 'widget' : 'full');
        }

        /** 显示 / 隐藏整个播放器（隐藏时音频继续播放） */
        function setVisible(value) {
            const next = Boolean(value);
            if (next === visible.value) {
                return;
            }
            visible.value = next;
            moreOpen.value = false;
            menu.value.visible = false;
            emit('visiblechange', next);
        }

        function show() {
            setVisible(true);
        }

        function hide() {
            setVisible(false);
        }

        function toggleVisible() {
            setVisible(!visible.value);
        }

        /**
         * 调整当前形态的背景不透明度与模糊度。
         * 传 { opacity, blur } 改当前形态；也可以直接指定形态，如 { cardOpacity: 0.8 }。
         */
        function setAppearance(patch) {
            if (!patch || typeof patch !== 'object') {
                return;
            }
            const next = {
                widget: { ...appearance.value.widget },
                full: { ...appearance.value.full },
            };
            const assign = (target, key, value) => {
                if (value === undefined || value === null) {
                    return;
                }
                if (key === 'opacity') {
                    target.opacity = clampOpacity(value);
                } else if (key === 'blur') {
                    target.blur = clampBlur(value);
                }
            };
            assign(next[mode.value], 'opacity', patch.opacity);
            assign(next[mode.value], 'blur', patch.blur);
            assign(next.widget, 'opacity', patch.widgetOpacity);
            assign(next.widget, 'blur', patch.widgetBlur);
            // card* 是 full* 的别名，方便按“卡片”概念传参
            assign(next.full, 'opacity', patch.fullOpacity ?? patch.cardOpacity);
            assign(next.full, 'blur', patch.fullBlur ?? patch.cardBlur);
            appearance.value = next;
            emit('appearancechange', { mode: mode.value, ...next[mode.value] });
        }

        /** 桌面歌词显隐（外部可调） */
        function setLyricsVisible(value) {
            const next = Boolean(value);
            if (next === lyricsVisible.value) {
                return;
            }
            lyricsVisible.value = next;
            write(STORAGE_KEYS.lyricsVisible, String(next));
            emit('lyricschange', next);
        }

        /** 外部指定播放器位置（左上角坐标，传 null 回到默认位置） */
        function setPosition(value) {
            if (!value) {
                positionStore.value[mode.value] = null;
                position.value = null;
                writeJSON(STORAGE_KEYS.position, positionStore.value);
                return;
            }
            const { width, height } = widgetEl.value
                ? widgetEl.value.getBoundingClientRect()
                : { width: 320, height: 60 };
            const next = clampPosition(Number(value.left) || 0, Number(value.top) || 0, width, height);
            position.value = next;
            positionStore.value[mode.value] = next;
            writeJSON(STORAGE_KEYS.position, positionStore.value);
        }

        /** 外部指定歌词浮层位置；centered 为 true 时回到屏幕正下方居中 */
        function setLyricsPosition(value) {
            if (!value || value.centered) {
                lyricsCustom.value = false;
                lyricsPos.value = defaultLyricsPosition(true);
                writeJSON(STORAGE_KEYS.lyricsPosition, null);
                return;
            }
            lyricsCustom.value = true;
            lyricsPos.value = { x: Number(value.x) || 0, y: Number(value.y) || 0 };
            writeJSON(STORAGE_KEYS.lyricsPosition, lyricsPos.value);
        }

        /** 从“更多”菜单打开外观设置 */
        function openAppearanceMenu() {
            const anchor = moreEl.value;
            const rect = anchor ? anchor.getBoundingClientRect() : { left: 40, bottom: 80 };
            const width = 260;
            const height = 260;
            menu.value = {
                visible: true,
                x: clamp(rect.left - width + 40, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN)),
                y: clamp(rect.bottom - height, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN)),
            };
            moreOpen.value = false;
        }

        /* ---------------- 菜单 ---------------- */

        function toggleMore() {
            moreOpen.value = !moreOpen.value;
        }

        function togglePlaylist() {
            playlistOpen.value = !playlistOpen.value;
            moreOpen.value = false;
        }

        function toggleLyrics() {
            lyricsVisible.value = !lyricsVisible.value;
            write(STORAGE_KEYS.lyricsVisible, String(lyricsVisible.value));
            moreOpen.value = false;
        }

        function openSettingsMenu(event) {
            const width = 220;
            const height = 190;
            menu.value = {
                visible: true,
                x: clamp(event.clientX, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN)),
                y: clamp(event.clientY, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN)),
            };
        }

        function closeMenus(event) {
            if (menu.value.visible && !(menuEl.value && menuEl.value.contains(event.target))) {
                menu.value.visible = false;
            }
            if (moreOpen.value && !(moreEl.value && moreEl.value.contains(event.target))) {
                moreOpen.value = false;
            }
        }

        /* ---------------- 进度条拖动 ---------------- */

        function startSeek(event) {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }
            seekFromEvent(event);
            const onMove = (moveEvent) => seekFromEvent(moveEvent);
            const onEnd = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onEnd);
            window.addEventListener('pointercancel', onEnd);
        }

        function seekFromEvent(event) {
            const audio = audioEl.value;
            const node = progressEl.value;
            if (!audio || !node || !Number.isFinite(audio.duration) || audio.duration <= 0) {
                return;
            }
            const rect = node.getBoundingClientRect();
            const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            audio.currentTime = audio.duration * percent;
            progress.value = percent * 100;
        }

        /* ---------------- 尺寸变化 ---------------- */

        function handleResize() {
            if (position.value && widgetEl.value) {
                const { width, height } = widgetEl.value.getBoundingClientRect();
                position.value = clampPosition(position.value.left, position.value.top, width, height);
            }
            if (!lyricsCustom.value) {
                lyricsPos.value = defaultLyricsPosition(true);
                return;
            }
            const node = rootEl.value && rootEl.value.querySelector('.lyrics-container');
            const rect = node ? node.getBoundingClientRect() : { width: 200, height: 60 };
            lyricsPos.value = {
                x: clamp(lyricsPos.value.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN)),
                y: clamp(lyricsPos.value.y, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN)),
            };
        }

        /** 歌词浮层默认位置：屏幕正下方居中；force 为 true 时忽略已保存的自定义位置 */
        function defaultLyricsPosition(force) {
            if (!force) {
                const saved = readJSON(STORAGE_KEYS.lyricsPosition, null);
                if (saved) {
                    lyricsCustom.value = true;
                    return saved;
                }
            }
            lyricsCustom.value = false;
            return {
                x: Math.round(window.innerWidth / 2),
                y: Math.max(EDGE_MARGIN, window.innerHeight - (window.innerWidth < 768 ? 180 : 150)),
            };
        }

        /* ---------------- 侦听 ---------------- */

        watch(volume, (value) => {
            if (audioEl.value) {
                audioEl.value.volume = value;
            }
            if (value > 0) {
                lastVolume.value = value;
            }
            emit('volumechange', value);
        });

        watch(scale, (value) => writeJSON(STORAGE_KEYS.scale, value));

        watch(settings, (value) => writeJSON(STORAGE_KEYS.lyricsSettings, value), { deep: true });

        watch(appearance, (value) => writeJSON(STORAGE_KEYS.appearance, value), { deep: true });

        watch(currentSong, (song) => {
            progress.value = 0;
            if (song && song.lrc) {
                loadLyrics(song.lrc);
            } else {
                lyrics.value = [];
                currentLine.value = '';
                nextLine.value = '';
                lyricIndex.value = -1;
            }
            emit('switch', song);
        });

        watch(mode, () => scheduleCollapse());

        watch(playing, (value) => {
            window.clearTimeout(collapseTimer);
            if (value) {
                setCollapsed(false);
            } else {
                scheduleCollapse();
            }
        });

        /* ---------------- 生命周期 ---------------- */

        onMounted(() => {
            const savedPosition = readJSON(STORAGE_KEYS.position, null);
            if (savedPosition) {
                position.value = savedPosition;
            }
            lyricsPos.value = defaultLyricsPosition();
            if (read(STORAGE_KEYS.lyricsVisible, null) !== null) {
                lyricsVisible.value = read(STORAGE_KEYS.lyricsVisible, 'true') === 'true';
            }

            if (audioEl.value) {
                audioEl.value.volume = volume.value;
            }

            loadPlaylist();
            scheduleCollapse();

            window.addEventListener('click', closeMenus);
            window.addEventListener('resize', handleResize);
        });

        onBeforeUnmount(() => {
            window.clearTimeout(collapseTimer);
            window.removeEventListener('click', closeMenus);
            window.removeEventListener('resize', handleResize);
            pause();
            emit('destroy');
        });

        /* ---------------- 对外接口 ---------------- */

        expose({
            audio: audioEl,
            play,
            pause,
            toggle,
            next,
            prev,
            seek: seekTo,
            setVolume,
            getVolume: () => volume.value,
            switchTo: playIndex,
            setScale,
            resetScale,
            getMode: () => mode.value,
            setMode,
            toggleMode,
            getVisible: () => visible.value,
            setVisible,
            show,
            hide,
            toggleVisible,
            getAppearance: () => ({
                widget: { ...appearance.value.widget },
                full: { ...appearance.value.full },
            }),
            setAppearance,
            getLyricsVisible: () => lyricsVisible.value,
            setLyricsVisible,
            setPosition,
            getPosition: () => (position.value ? { ...position.value } : null),
            setLyricsPosition,
            getLyricsPosition: () => ({ ...lyricsPos.value }),
            getPlaylist: () => playlist.value,
            getCurrent: () => currentSong.value,
        });

        /* ---------------- 模板绑定 ---------------- */

        return {
            MIN_SCALE,
            MAX_SCALE,
            MIN_OPACITY,
            MAX_BLUR,
            rootEl,
            widgetEl,
            audioEl,
            moreEl,
            menuEl,
            progressEl,
            playing,
            playlist,
            currentIndex,
            currentSong,
            progress,
            loopMode,
            loopLabel,
            volume,
            volumeHover,
            moreOpen,
            playlistOpen,
            lyricsVisible,
            lyricsPos,
            lyricsDragging,
            currentLine,
            nextLine,
            currentLineStyle,
            nextLineStyle,
            lyricsStyle,
            rootStyle,
            position,
            dragging,
            scale,
            scalePercent,
            collapsed,
            menu,
            settings,
            mode,
            visible,
            appearanceProxy,
            opacityPercent,
            widgetStyle,
            lyricsPlaceholderColor,
            handlePlay,
            handlePause,
            handleEnded,
            handleTimeUpdate,
            handleCanPlay,
            handleLoadedMetadata,
            handleError,
            play,
            pause,
            toggle,
            playIndex,
            next,
            prev,
            cycleLoopMode,
            toggleMute,
            toggleMore,
            togglePlaylist,
            toggleLyrics,
            startDrag,
            startLyricsDrag,
            startSeek,
            handleWheel,
            handleEnter,
            handleLeave,
            openSettingsMenu,
            openAppearanceMenu,
            resetSettings,
            resetScale,
            setMode,
            toggleMode,
            setVisible,
            show,
            hide,
            toggleVisible,
            setAppearance,
            setLyricsVisible,
            setPosition,
            setLyricsPosition,
        };
    },
};
