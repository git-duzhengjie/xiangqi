<template>
  <view class="home">
    <view class="hero">
      <text class="hero-title">中国象棋</text>
      <text class="hero-sub">内置 Pikafish 专业引擎</text>
    </view>

    <view class="levels">
      <text class="sec-title">选择难度</text>
      <view
        v-for="lv in levels"
        :key="lv.id"
        class="level-card"
        :class="{ hard: lv.id >= 5 }"
        @click="startGame(lv.id)"
      >
        <view class="lc-left">
          <text class="lc-name">{{ lv.name }}</text>
          <text class="lc-desc">{{ lv.desc }}</text>
        </view>
        <view class="lc-right">
          <text class="lc-elo">≈{{ lv.elo >= 9999 ? '满级' : lv.elo }}</text>
          <text class="lc-go">›</text>
        </view>
      </view>
    </view>

    <view class="footer">
      <text class="ft-text" @click="showAbout">关于 / 开源许可</text>
    </view>
  </view>
</template>

<script>
import { DIFFICULTY_LEVELS } from '@/utils/constants.js'

export default {
  data() {
    return {
      levels: DIFFICULTY_LEVELS
    }
  },
  methods: {
    startGame(level) {
      uni.navigateTo({ url: `/pages/game/game?level=${level}` })
    },
    showAbout() {
      uni.showModal({
        title: '开源许可',
        content: '本应用内置 Pikafish 象棋引擎，遵循 GPL-3.0 许可证发布。' +
                 '本应用整体源码同样以 GPL-3.0 开源，您有权获取、修改与再分发源码。',
        showCancel: false,
        confirmText: '知道了'
      })
    }
  }
}
</script>

<style scoped>
.home {
  min-height: 100vh;
  background: linear-gradient(180deg, #3E2723 0%, #6D4C41 100%);
  display: flex;
  flex-direction: column;
  padding: 0 40rpx;
}
.hero {
  padding-top: 140rpx;
  padding-bottom: 60rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hero-title {
  font-size: 72rpx;
  font-weight: bold;
  color: #F5DEB3;
  letter-spacing: 12rpx;
}
.hero-sub {
  font-size: 24rpx;
  color: #BCAAA4;
  margin-top: 20rpx;
}
.sec-title {
  font-size: 26rpx;
  color: #BCAAA4;
  margin-bottom: 20rpx;
  display: block;
}
.levels { flex: 1; }
.level-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgba(255, 255, 255, 0.09);
  border-radius: 16rpx;
  padding: 28rpx 32rpx;
  margin-bottom: 18rpx;
}
.level-card:active { background-color: rgba(255, 255, 255, 0.18); }
.level-card.hard {
  border: 2rpx solid rgba(192, 57, 43, 0.6);
}
.lc-left { display: flex; flex-direction: column; }
.lc-name { font-size: 32rpx; color: #F5DEB3; font-weight: bold; }
.lc-desc { font-size: 22rpx; color: #A1887F; margin-top: 8rpx; }
.lc-right { display: flex; align-items: center; }
.lc-elo { font-size: 24rpx; color: #8D6E63; margin-right: 16rpx; }
.lc-go { font-size: 40rpx; color: #8D6E63; }
.footer {
  padding: 40rpx 0 60rpx;
  display: flex;
  justify-content: center;
}
.ft-text { font-size: 22rpx; color: #8D6E63; }
</style>
