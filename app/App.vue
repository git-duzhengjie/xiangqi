<script>
import sound from '@/utils/sound.js'

export default {
  onLaunch() {
    console.log('[App] launch')
    this.warmUpSound()
  },
  onShow() {
    console.log('[App] show')
  },
  onHide() {
    console.log('[App] hide')
  },

  methods: {
    /**
     * 启动后自动执行一次音效链路重置，等价于手动「关一次音效再打开」。
     *
     * 为什么这么做：
     * 首次启动无声的问题反复修了三次都没根治，但现象规律非常稳定 ——
     * 只要手动把音效关掉再打开，声音立刻就正常。既然这条路径经过真机
     * 反复验证确实有效，就直接把它自动化，不再依赖对「到底是哪个环节
     * 尚未就绪」的推断。已知有效，比理论正确更重要。
     *
     * 执行时机上做了三道保险，因为不同机型上 plus 与基座音频模块的
     * 就绪时间差异很大：
     *   1. plusready 事件触发时（正常情况）
     *   2. 800ms 后补一次（plus 已就绪但音频模块略慢）
     *   3. 2500ms 后再补一次（低端机型或冷启动较慢）
     * resetPipeline 是幂等的，多跑几次只是重建实例，代价很小；
     * 而少跑一次就可能又是整局无声。
     */
    warmUpSound() {
      // #ifdef APP-PLUS
      const reset = (tag) => {
        try {
          sound.resetPipeline()
          console.log('[App] 音效链路重置完成 @' + tag)
        } catch (e) {
          console.warn('[App] 音效重置失败 @' + tag, e)
        }
      }

      if (typeof plus !== 'undefined' && plus.io) {
        reset('immediate')
      } else {
        document.addEventListener('plusready', () => reset('plusready'), false)
      }

      // 两道延时补射，应对 plusready 已错过或音频模块就绪较晚的机型。
      setTimeout(() => reset('800ms'), 800)
      setTimeout(() => reset('2500ms'), 2500)
      // #endif
    }
  }
}
</script>

<style>
page {
  background-color: #F5DEB3;
}

/* 全局重置 */
view, text {
  box-sizing: border-box;
}
</style>
