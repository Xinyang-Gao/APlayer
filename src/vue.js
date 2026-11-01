// vue 的运行时 + 模板编译器：由 build.mjs 从 vue 的 global 构建生成 vue-global.js。
import Vue from './vue-global.cjs';

export const { createApp, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;

export default Vue;
