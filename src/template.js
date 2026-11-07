/**
 * 播放器模板（构建期由 build.mjs 编译成 render 函数，故以字符串形式存放）。
 * 模板中出现的每个标识符都由 player.js 的 setup() 返回。
 *
 * 两种形态共用一套 DOM：
 *   - widget：左下角悬浮小卡，歌词为独立浮层
 *   - full  ：居中大卡，歌词收进卡片内（右侧下方居中）
 */

/* 歌词行片段：浮层与卡片内歌词共用 */
const lyricLines = `
    <template v-if="currentLine || nextLine">
        <Transition name="lyric-fade" mode="out-in">
            <div :key="currentLine" class="lyric-line current" :style="currentLineStyle">
                {{ currentLine || '...' }}
            </div>
        </Transition>
        <Transition name="lyric-fade" mode="out-in">
            <div v-if="nextLine" :key="nextLine" class="lyric-line next" :style="nextLineStyle">
                {{ nextLine }}
            </div>
        </Transition>
    </template>
    <div v-else class="lyrics-placeholder">
        {{ currentSong ? '纯音乐，请欣赏' : '等待歌词…' }}
    </div>
`;

export default `
<div
    ref="rootEl"
    class="music-player-wrapper"
    :class="{ dragging: dragging }"
    :data-mode="mode"
    :data-collapsed="collapsed ? 'true' : undefined"
    :data-visible="visible ? 'true' : 'false'"
    :style="rootStyle"
>
    <audio
        ref="audioEl"
        :src="currentSong ? currentSong.url : undefined"
        :loop="loopMode === 'one'"
        preload="auto"
        @play="handlePlay"
        @pause="handlePause"
        @ended="handleEnded"
        @timeupdate="handleTimeUpdate"
        @canplay="handleCanPlay"
        @loadedmetadata="handleLoadedMetadata"
        @error="handleError"
    ></audio>

    <!-- 桌面歌词浮层：仅悬浮形态，可拖拽，右键呼出外观设置 -->
    <div
        v-if="lyricsVisible && mode === 'widget'"
        class="lyrics-container"
        :class="{ dragging: lyricsDragging }"
        :style="lyricsStyle"
        @pointerdown="startLyricsDrag"
        @contextmenu.prevent="openSettingsMenu"
    >${lyricLines}
    </div>

    <!-- 外观设置：缩放 / 透明度 / 模糊度 / 歌词字号（颜色自动反色，无需设置） -->
    <Transition name="fade-slide">
        <div
            v-if="menu.visible"
            ref="menuEl"
            class="settings-menu"
            :style="{ top: menu.y + 'px', left: menu.x + 'px' }"
            @pointerdown.stop
        >
            <div class="menu-header">外观设置</div>
            <div class="menu-item">
                <label>界面缩放</label>
                <div class="control-group">
                    <input v-model.number="scale" type="range" :min="MIN_SCALE" :max="MAX_SCALE" step="0.05" />
                    <span class="value">{{ scalePercent }}%</span>
                </div>
            </div>
            <div class="menu-item">
                <label>背景不透明度</label>
                <div class="control-group">
                    <input v-model.number="appearanceProxy.opacity" type="range" :min="MIN_OPACITY" :max="1" step="0.05" />
                    <span class="value">{{ opacityPercent }}%</span>
                </div>
            </div>
            <div class="menu-item">
                <label>背景模糊</label>
                <div class="control-group">
                    <input v-model.number="appearanceProxy.blur" type="range" :min="0" :max="MAX_BLUR" step="1" />
                    <span class="value">{{ appearanceProxy.blur }}px</span>
                </div>
            </div>
            <div class="menu-item">
                <label>歌词字号</label>
                <div class="control-group">
                    <input v-model.number="settings.fontSize" type="range" min="16" max="64" step="1" />
                    <span class="value">{{ settings.fontSize }}px</span>
                </div>
            </div>
            <div class="menu-item">
                <label>歌词</label>
                <div class="control-group">
                    <span class="menu-hint">自动与背景反色</span>
                    <button class="text-btn" type="button" @click="resetSettings">重置字号</button>
                </div>
            </div>
        </div>
    </Transition>

    <!-- 播放器主体 -->
    <div
        ref="widgetEl"
        class="player-widget"
        :style="widgetStyle"
        @pointerdown="startDrag"
        @pointerenter="handleEnter"
        @pointerleave="handleLeave"
        @wheel="handleWheel"
    >
        <div class="cover-container" title="播放 / 暂停" @click="toggle">
            <div class="cover-wrapper">
                <img
                    v-if="currentSong && currentSong.cover"
                    :src="currentSong.cover"
                    alt="cover"
                    class="cover-img"
                    :class="{ rotating: playing }"
                />
                <div v-else class="cover-placeholder">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                    </svg>
                </div>
            </div>
        </div>

        <div class="content-container">
            <div class="info-row">
                <div class="song-info">
                    <span class="song-title" :title="currentSong ? currentSong.name : ''">
                        {{ (currentSong && currentSong.name) || '加载中…' }}
                    </span>
                    <span v-if="currentSong && currentSong.artist" class="song-artist">
                        - {{ currentSong.artist }}
                    </span>
                </div>
            </div>

            <!-- 全屏卡片形态：歌词收进卡片，位于右侧下方居中 -->
            <div v-if="mode === 'full' && lyricsVisible" class="lyric-slot">${lyricLines}
            </div>

            <div class="controls-row">
                <div class="controls">
                    <button class="icon-btn" type="button" title="上一首" @click="prev">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <polygon points="19 20 9 12 19 4 19 20" />
                            <line x1="5" y1="19" x2="5" y2="5" />
                        </svg>
                    </button>

                    <button class="icon-btn" type="button" title="播放 / 暂停" @click="toggle">
                        <svg
                            v-if="playing"
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="none"
                        >
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                        </svg>
                        <svg
                            v-else
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="none"
                        >
                            <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                    </button>

                    <button class="icon-btn" type="button" title="下一首" @click="next">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <polygon points="5 4 15 12 5 20 5 4" />
                            <line x1="19" y1="5" x2="19" y2="19" />
                        </svg>
                    </button>

                    <div
                        class="volume-control-wrapper"
                        @pointerenter="volumeHover = true"
                        @pointerleave="volumeHover = false"
                    >
                        <Transition name="fade">
                            <div v-show="volumeHover" class="volume-slider-container">
                                <div class="volume-track">
                                    <div class="volume-bar" :style="{ height: volume * 100 + '%' }"></div>
                                    <input
                                        v-model.number="volume"
                                        class="volume-slider-vertical"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        title="音量"
                                    />
                                </div>
                            </div>
                        </Transition>
                        <button class="icon-btn" type="button" title="静音 / 恢复" @click="toggleMute">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <template v-if="volume > 0">
                                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                                </template>
                                <template v-else>
                                    <line x1="23" y1="9" x2="17" y2="15" />
                                    <line x1="17" y1="9" x2="23" y2="15" />
                                </template>
                            </svg>
                        </button>
                    </div>

                    <div ref="moreEl" class="more-control-wrapper">
                        <button
                            class="icon-btn"
                            :class="{ active: moreOpen }"
                            type="button"
                            title="更多"
                            @click="toggleMore"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            >
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="19" cy="12" r="1" />
                                <circle cx="5" cy="12" r="1" />
                            </svg>
                        </button>

                        <Transition name="fade-slide-up">
                            <div v-if="moreOpen" class="more-menu-popup">
                                <div class="more-menu-item" @click="toggleLyrics">
                                    <span class="menu-icon text-icon">词</span>
                                    <span class="menu-text">歌词</span>
                                    <div class="menu-toggle" :class="{ active: lyricsVisible }"></div>
                                </div>
                                <div class="more-menu-item" @click="togglePlaylist">
                                    <span class="menu-icon">
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        >
                                            <line x1="8" y1="6" x2="21" y2="6" />
                                            <line x1="8" y1="12" x2="21" y2="12" />
                                            <line x1="8" y1="18" x2="21" y2="18" />
                                            <line x1="3" y1="6" x2="3.01" y2="6" />
                                            <line x1="3" y1="12" x2="3.01" y2="12" />
                                            <line x1="3" y1="18" x2="3.01" y2="18" />
                                        </svg>
                                    </span>
                                    <span class="menu-text">播放列表</span>
                                    <div class="menu-toggle" :class="{ active: playlistOpen }"></div>
                                </div>
                                <div class="more-menu-item" @click="cycleLoopMode">
                                    <span class="menu-icon">
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        >
                                            <polyline points="17 1 21 5 17 9" />
                                            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                                            <polyline points="7 23 3 19 7 15" />
                                            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                                        </svg>
                                    </span>
                                    <span class="menu-text">{{ loopLabel }}</span>
                                </div>
                                <div class="more-menu-item" @click="toggleMode">
                                    <span class="menu-icon text-icon">卡</span>
                                    <span class="menu-text">全屏卡片</span>
                                    <div class="menu-toggle" :class="{ active: mode === 'full' }"></div>
                                </div>
                                <div class="more-menu-item" @click="openAppearanceMenu">
                                    <span class="menu-icon text-icon">色</span>
                                    <span class="menu-text">外观设置</span>
                                    <span class="menu-value">{{ scalePercent }}%</span>
                                </div>
                                <div class="more-menu-item" @click="resetScale">
                                    <span class="menu-icon text-icon">缩</span>
                                    <span class="menu-text">重置缩放</span>
                                    <span class="menu-value">{{ scalePercent }}%</span>
                                </div>
                                <div class="more-menu-item" @click="hide">
                                    <span class="menu-icon text-icon">隐</span>
                                    <span class="menu-text">隐藏播放器</span>
                                </div>
                            </div>
                        </Transition>
                    </div>
                </div>
            </div>

            <div ref="progressEl" class="progress-container" title="拖动调整进度" @pointerdown="startSeek">
                <div class="progress-bg">
                    <div class="progress-fill" :style="{ width: progress + '%' }"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- 播放列表 -->
    <Transition name="fade-slide">
        <div v-if="playlistOpen" class="playlist-panel">
            <div class="playlist-header">
                <span>播放列表 ({{ playlist.length }})</span>
                <button class="icon-btn" type="button" title="关闭" @click="playlistOpen = false">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
            <ul class="playlist-items">
                <li
                    v-for="(song, index) in playlist"
                    :key="song.url || song.name || index"
                    :class="{ active: index === currentIndex }"
                    @click="playIndex(index)"
                >
                    <div class="item-index">
                        <svg
                            v-if="index === currentIndex"
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="none"
                        >
                            <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        <template v-else>{{ index + 1 }}</template>
                    </div>
                    <div class="item-info">
                        <div class="item-title">{{ song.name }}</div>
                        <div class="item-artist">{{ song.artist }}</div>
                    </div>
                </li>
            </ul>
        </div>
    </Transition>
</div>
`;
