import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from './vue.js';
import { findLyricIndex, parseLrc } from './lrc.js';
import { read, readJSON, write, writeJSON } from './storage.js';
import render from './render.generated.cjs';

/* ---------------- 常量 ---------------- */

const STORAGE_KEYS = {
    position: 'player-widget-position',
    scale: 'player-widget-scale',
    collapsed: 'player-widget-collapsed',
    lyricsPosition: 'lyrics-position',
    lyricsVisible: 'lyrics-visible',
    lyricsSettings: 'lyrics-settings',
};

// 这些区域内的按下事件不触发拖拽，避免与控件冲突
const DRAG_EXCLUDE =
    'button, input, .progress-container, .volume-slider-container, .more-menu-popup, .playlist-panel, .settings-menu';

const MIN_SCALE = 0.75;
const MAX_SCALE = 1.6;
const SCALE_STEP = 0.05;
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

        /* --- 位置与缩放 --- */
        const position = ref(null);
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

        const rootStyle = computed(() => {
            if (!position.value) {
                return null;
            }
            return {
                left: `${position.value.left}px`,
                top: `${position.value.top}px`,
                right: 'auto',
                bottom: 'auto',
            };
        });

        const lyricsStyle = computed(() => ({
            left: `${lyricsPos.value.x}px`,
            top: `${lyricsPos.value.y}px`,
        }));

        const currentLineStyle = computed(() => ({
            fontSize: `${settings.value.fontSize}px`,
            color: settings.value.color,
        }));

        const nextLineStyle = computed(() => ({
            fontSize: `${settings.value.fontSize * 0.75}px`,
            color: settings.value.color,
        }));

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
                writeJSON(STORAGE_KEYS.position, latest);
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
            const node = rootEl.value && rootEl.value.querySelector('.lyrics-container');
            const rect = node ? node.getBoundingClientRect() : { width: 200, height: 60 };
            lyricsPos.value = {
                x: clamp(lyricsPos.value.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - rect.width - EDGE_MARGIN)),
                y: clamp(lyricsPos.value.y, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - rect.height - EDGE_MARGIN)),
            };
        }

        function defaultLyricsPosition() {
            const saved = readJSON(STORAGE_KEYS.lyricsPosition, null);
            if (saved) {
                return saved;
            }
            if (window.innerWidth < 768) {
                return { x: 20, y: window.innerHeight - 200 };
            }
            return { x: Math.max(EDGE_MARGIN, window.innerWidth - 400), y: 80 };
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
            getPlaylist: () => playlist.value,
            getCurrent: () => currentSong.value,
        });

        /* ---------------- 模板绑定 ---------------- */

        return {
            MIN_SCALE,
            MAX_SCALE,
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
            resetSettings,
            resetScale,
        };
    },
};
