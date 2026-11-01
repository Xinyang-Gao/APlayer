/**
 * 极简事件总线：组件与 APlayer 实例之间的通信桥梁。
 * 外部脚本可以 `ap.on('play', fn)` 订阅播放器事件。
 */
export default class EventEmitter {
    constructor() {
        this.events = new Map();
    }

    on(name, callback) {
        if (typeof callback !== 'function') {
            return this;
        }
        if (!this.events.has(name)) {
            this.events.set(name, new Set());
        }
        this.events.get(name).add(callback);
        return this;
    }

    off(name, callback) {
        if (!this.events.has(name)) {
            return this;
        }
        if (callback) {
            this.events.get(name).delete(callback);
        } else {
            this.events.delete(name);
        }
        return this;
    }

    once(name, callback) {
        const wrapper = (...args) => {
            this.off(name, wrapper);
            callback(...args);
        };
        return this.on(name, wrapper);
    }

    emit(name, ...args) {
        const handlers = this.events.get(name);
        if (!handlers) {
            return;
        }
        for (const handler of [...handlers]) {
            try {
                handler(...args);
            } catch (error) {
                console.error(`[APlayer] 事件 "${name}" 的监听器执行出错:`, error);
            }
        }
    }

    clear() {
        this.events.clear();
    }
}
