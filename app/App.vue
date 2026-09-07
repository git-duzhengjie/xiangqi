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
     * 在 plus 就绪后预热音效。
     *
     * 音频目录要靠 plus.io.convertLocalFileSystemURL 换算成设备真实路径，
     * 而对局页 onLoad 里的 preload 有可能赶在 plus 就绪之前跑，
     * 那时只能拿到兜底的相对路径，Android 播放器打不开，于是首次进对局没声音。
     *
     * sound.ensureDir 本身已经有兜底重试，但那要等到下一次 play 才会触发；
     * 这里在应用启动阶段就把路径提前敲定，让第一声就是对的。
     */
    warmUpSound() {
      // #ifdef APP-PLUS
      const run = () => {
        try { sound.preload() } catch (e) { console.warn('[App] 音效预热失败', e) }
      }
      // plus 已经就绪就直接执行，否则等 plusready 事件
      if (typeof plus !== 'undefined' && plus.io) {
        run()
      } else {
        document.addEventListener('plusready', run, false)
        // 兜底：个别机型 plusready 可能已经错过，延时再补一次。
        // preload 内部有 ready 标记，重复调用不会重建实例。
        setTimeout(run, 1500)
      }
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
