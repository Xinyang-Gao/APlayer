import { createApp } from './vue.js';
import EventEmitter from './emitter.js';
import MusicPlayer from './player.js';
import injectStyles from './inject-style.js';

/**
 * 默认配置。
 * - playlistId：网易云歌单 ID（经 Meting API 拉取），传 audio 时不再请求网络
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
};

class APlayer {
    constructor(options = {}) {
        const { container, ...rest } = options;

        if (!container) {
            console.error('[APlayer] 缺少 container 配置项');
            return;
        }

        injectStyles();

        this.container = container;
        this.options = { ...defaultOptions, ...rest };
        this.events = new EventEmitter();

        this.app = createApp(MusicPlayer, {
            options: this.options,
            emitter: this.events,
        });
        this.instance = this.app.mount(container);
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

export default APlayer;
