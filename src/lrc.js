/**
 * LRC 歌词解析：支持一行多个时间标签、[mm:ss.xx] 与 [mm:ss:xx] 写法。
 */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function toSeconds(minute, second, fraction) {
    let value = Number(minute) * 60 + Number(second);
    if (fraction) {
        // 两位数补位是厘秒（.25 = 250ms），三位数是毫秒
        value += Number(fraction) / (fraction.length >= 3 ? 1000 : 100);
    }
    return value;
}

export function parseLrc(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const lines = [];
    for (const rawLine of text.split(/\r?\n/)) {
        TIME_TAG.lastIndex = 0;
        const stamps = [...rawLine.matchAll(TIME_TAG)];
        if (!stamps.length) {
            continue;
        }

        const content = rawLine.replace(TIME_TAG, '').trim();
        if (!content) {
            continue;
        }

        for (const [, minute, second, fraction] of stamps) {
            lines.push({ time: toSeconds(minute, second, fraction), text: content });
        }
    }

    return lines.sort((a, b) => a.time - b.time);
}

/**
 * 根据播放时间定位当前歌词下标，未开始时返回 -1。
 */
export function findLyricIndex(lines, currentTime) {
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (currentTime + 0.05 >= lines[i].time) {
            index = i;
        } else {
            break;
        }
    }
    return index;
}
