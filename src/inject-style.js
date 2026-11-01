/**
 * 样式注入：把 CSS 打进 JS，页面只需引入一个脚本。
 * 同一份样式只注入一次，多个实例共用。
 */
import cssText from './style.css';

const STYLE_ID = 'aplayer-style';

export default function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = cssText;
    document.head.appendChild(style);
}
