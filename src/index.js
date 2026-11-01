import { createApp } from './vue.js';
import EventEmitter from './emitter.js';
import MusicPlayer from './player.js';
import injectStyles from './inject-style.js';

/**
 * 默认配置。
 * - playlistId：网易云歌单 ID（经 Meting API 拉取），传 audio 时不再请求网络
 * - mode：初始形态，'widget' 悬浮小卡 / 'full' 全屏卡片
 * - collapseDelay：暂停或指针移开后多久折叠（毫秒）
 */
const defaultOptions = {
    server: 'netease',
    type: 'playlist',
    playlistId: '18022003523',
    api: '',
    audio: null,
    volume: 0.7,
    lyrics: true,
    collapseDelay: 500,
    mode: 'widget',
    visible: true,
};

class APlayer {
    constructor(options = {}) {
        const { container, ...rest } = options;

        if (!container) {
            console.error('[APlayer] 缺少 container 配置项');
            return;
        }

        injectStyles();

        this.container = resolveContainer(container);
        this.options = { ...defaultOptions, ...rest };
        this.events = new EventEmitter();

        this.app = createApp(MusicPlayer, {
            options: this.options,
            emitter: this.events,
        });
        this.instance = this.app.mount(this.container);
    }

    /** 内部 <audio> 元素 */
    get audio() {
        return this.instance ? this.instance.audio : null;
    }

    /** 当前播放列表 */
    get playlist() {
        return this.instance ? this.instance.getPlaylist() : [];
    }

    play() {
        this.instance && this.instance.play();
        return this;
    }

    pause() {
        this.instance && this.instance.pause();
        return this;
    }

    toggle() {
        this.instance && this.instance.toggle();
        return this;
    }

    next() {
        this.instance && this.instance.next();
        return this;
    }

    prev() {
        this.instance && this.instance.prev();
        return this;
    }

    /** 切到指定下标的歌曲 */
    switchTo(index) {
        this.instance && this.instance.switchTo(index);
        return this;
    }

    /** 跳到指定时间（秒） */
    seek(seconds) {
        this.instance && this.instance.seek(seconds);
        return this;
    }

    /** 传值设置音量（0~1），不传值返回当前音量 */
    volume(value) {
        if (!this.instance) {
            return value === undefined ? 0 : this;
        }
        if (value === undefined) {
            return this.instance.getVolume();
        }
        this.instance.setVolume(value);
        return this;
    }

    /** 界面缩放（0.75~1.6），不传值表示重置为 100% */
    scale(value) {
        if (!this.instance) {
            return this;
        }
        if (value === undefined) {
            this.instance.resetScale();
        } else {
            this.instance.setScale(value);
        }
        return this;
    }

    /* ---------------- 形态 ---------------- */

    /** 传值切换形态，不传值返回当前形态：'widget' | 'full' */
    mode(value) {
        if (!this.instance) {
            return value === undefined ? 'widget' : this;
        }
        if (value === undefined) {
            return this.instance.getMode();
        }
        this.instance.setMode(value);
        return this;
    }

    /** 在悬浮小卡与全屏卡片之间来回切 */
    toggleMode() {
        this.instance && this.instance.toggleMode();
        return this;
    }

    /** 显式切到全屏卡片 */
    setMode(value) {
        this.instance && this.instance.setMode(value);
        return this;
    }

    /* ---------------- 显示与隐藏 ---------------- */

    /** 传值显示 / 隐藏，不传值返回当前可见状态 */
    visible(value) {
        if (!this.instance) {
            return value === undefined ? false : this;
        }
        if (value === undefined) {
            return this.instance.getVisible();
        }
        this.instance.setVisible(value);
        return this;
    }

    show() {
        this.instance && this.instance.show();
        return this;
    }

    hide() {
        this.instance && this.instance.hide();
        return this;
    }

    toggleVisible() {
        this.instance && this.instance.toggleVisible();
        return this;
    }

    /* ---------------- 外观 ---------------- */

    /**
     * 背景不透明度与模糊度。
     *   ap.style({ opacity: 0.8, blur: 20 })                 // 只改当前形态
     *   ap.style({ widgetOpacity: 0.9, cardBlur: 24 })        // 指定形态
     *   ap.style()                                            // 读取全部配置
     */
    style(patch) {
        if (!this.instance) {
            return patch === undefined ? null : this;
        }
        if (patch === undefined) {
            return this.instance.getAppearance();
        }
        this.instance.setAppearance(patch);
        return this;
    }

    /* ---------------- 歌词与位置 ---------------- */

    /** 传值显示 / 隐藏歌词（悬浮形态为浮层，全屏形态为卡片内歌词），不传值返回状态 */
    lyrics(value) {
        if (!this.instance) {
            return value === undefined ? false : this;
        }
        if (value === undefined) {
            return this.instance.getLyricsVisible();
        }
        this.instance.setLyricsVisible(value);
        return this;
    }

    toggleLyrics() {
        this.instance && this.instance.setLyricsVisible(!this.instance.getLyricsVisible());
        return this;
    }

    /** 播放器位置（左上角坐标）；传 null 回到默认位置；不传值则读取 */
    position(value) {
        if (!this.instance) {
            return value === undefined ? null : this;
        }
        if (value === undefined) {
            return this.instance.getPosition();
        }
        this.instance.setPosition(value);
        return this;
    }

    /** 歌词浮层位置；传 { centered: true } 回到屏幕正下方居中；不传值则读取 */
    lyricsPosition(value) {
        if (!this.instance) {
            return value === undefined ? null : this;
        }
        if (value === undefined) {
            return this.instance.getLyricsPosition();
        }
        this.instance.setLyricsPosition(value);
        return this;
    }

    /* ---------------- 事件与销毁 ---------------- */

    on(name, callback) {
        this.events.on(name, callback);
        return this;
    }

    off(name, callback) {
        this.events.off(name, callback);
        return this;
    }

    once(name, callback) {
        this.events.once(name, callback);
        return this;
    }

    destroy() {
        if (this.app) {
            this.app.unmount();
        }
        this.events.clear();
        this.app = null;
        this.instance = null;
    }
}

/**
 * 挂载容器兜底：直接传 document.body 时 Vue 会清空 body 的原有内容，
 * 这里改成往 body 里插一个专用节点，避免页面被整体替换。
 */
function resolveContainer(container) {
    const doc = container.ownerDocument || document;
    if (container === doc.body || container === doc.documentElement) {
        const host = doc.createElement('div');
        host.className = 'aplayer-host';
        doc.body.appendChild(host);
        return host;
    }
    return container;
}

export default APlayer;
