/**
 * localStorage 安全封装：隐私模式 / 禁用存储时静默降级为内存值。
 */
const memory = new Map();

function available() {
    try {
        const probe = '__aplayer_probe__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return true;
    } catch {
        return false;
    }
}

const enabled = typeof window !== 'undefined' && available();

export function read(key, fallback = null) {
    try {
        const value = enabled ? window.localStorage.getItem(key) : memory.get(key);
        return value === null || value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

export function write(key, value) {
    try {
        if (enabled) {
            window.localStorage.setItem(key, String(value));
        } else {
            memory.set(key, String(value));
        }
    } catch {
        /* 配额超限时忽略 */
    }
}

export function readJSON(key, fallback) {
    const raw = read(key);
    if (raw === null) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

export function writeJSON(key, value) {
    write(key, JSON.stringify(value));
}
