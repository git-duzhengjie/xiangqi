<template>
  <view class="game-page">
    <!-- 顶部信息栏 -->
    <view class="top-bar">
      <view class="btn-back" @click="goBack">‹ 返回</view>
      <view class="title">{{ difficultyName }}</view>
      <view class="btn-menu" @click="showMenu = !showMenu">⋮</view>
    </view>

    <!-- 黑方信息 -->
    <view class="player-bar" :class="{ active: currentSide === 'b' && !gameOver }">
      <view class="avatar black">将</view>
      <view class="pinfo">
        <text class="pname">Pikafish 引擎</text>
        <text class="pstatus">{{ blackStatus }}</text>
      </view>
    </view>

    <!-- 棋盘 -->
    <view class="board-wrap">
      <canvas
        canvas-id="boardCanvas"
        id="boardCanvas"
        class="board-canvas"
        :style="{ width: boardW + 'px', height: boardH + 'px' }"
        @touchstart="onTouch"
      ></canvas>
    </view>

    <!-- 红方信息 -->
    <view class="player-bar" :class="{ active: currentSide === 'r' && !gameOver }">
      <view class="avatar red">帅</view>
      <view class="pinfo">
        <text class="pname">您（红方）</text>
        <text class="pstatus">{{ redStatus }}</text>
      </view>
    </view>

    <!-- 操作栏 -->
    <view class="action-bar">
      <view class="act-btn" @click="onUndo">
        <text class="act-icon">↶</text><text class="act-text">悔棋</text>
      </view>
      <view class="act-btn" @click="onHint">
        <text class="act-icon">💡</text><text class="act-text">提示</text>
      </view>
      <view class="act-btn" @click="onRestart">
        <text class="act-icon">⟳</text><text class="act-text">重来</text>
      </view>
      <view class="act-btn" @click="showMoves = !showMoves">
        <text class="act-icon">☰</text><text class="act-text">棋谱</text>
      </view>
    </view>

    <!-- 棋谱面板 -->
    <view v-if="showMoves" class="moves-panel">
      <view class="mp-head">
        <text>对局记录（{{ history.length }} 步）</text>
        <text class="mp-close" @click="showMoves = false">×</text>
      </view>
      <scroll-view scroll-y class="mp-body">
        <view v-for="(h, i) in history" :key="i" class="mp-row">
          <text class="mp-no">{{ Math.floor(i / 2) + 1 }}.</text>
          <text class="mp-side" :class="h.side === 'r' ? 'red' : 'black'">
            {{ h.side === 'r' ? '红' : '黑' }}
          </text>
          <text class="mp-txt">{{ h.chinese }}</text>
        </view>
        <view v-if="!history.length" class="mp-empty">暂无记录</view>
      </scroll-view>
    </view>

    <!-- 菜单 -->
    <view v-if="showMenu" class="mask" @click="showMenu = false">
      <view class="menu" @click.stop>
        <view class="menu-item" @click="changeDifficulty">切换难度</view>
        <view class="menu-item" @click="onRestart">重新开局</view>
        <view class="menu-item" @click="goBack">退出对局</view>
      </view>
    </view>

    <!-- 结果弹窗 -->
    <view v-if="gameOver" class="mask">
      <view class="result-box">
        <text class="rb-title">{{ resultText }}</text>
        <text class="rb-sub">{{ resultSub }}</text>
        <view class="rb-btns">
          <view class="rb-btn primary" @click="onRestart">再来一局</view>
          <view class="rb-btn" @click="goBack">返回首页</view>
        </view>
      </view>
    </view>

    <!-- 引擎状态提示 -->
    <view v-if="engineMsg" class="engine-toast">{{ engineMsg }}</view>
  </view>
</template>

<script src="./game.js"></script>
<style scoped src="./game.css"></style>
