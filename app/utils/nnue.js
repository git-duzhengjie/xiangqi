/**
 * nnue.js —— NNUE 权重的下载与本地管理
 *
 * 为什么需要这个模块：
 *   Pikafish 官方权重在 2026-07 从约 12MB 涨到约 49MB。若把它打进原生插件，
 *   插件包会达到 102MB，远超 HBuilderX 云打包 40MB 的免费额度；而且官方
 *   还会继续更新权重，打进包里意味着每次都要重新发版。
 *   因此改为：App 首次启动时下载权重到本地，之后直接复用。
 *
 * 职责边界：
 *   本模块只负责「把权重弄到本地并给出可用的绝对路径」，
 *   不关心引擎怎么用它 —— 那是 engine.js 的事。
 */

// 官方权重下载地址。注意 master-net 是滚动 tag，官方更新后地址不变。
const NNUE_URL = 'https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue'

// 国内直连 GitHub 常失败，准备镜像作为备选。按顺序尝试。
const NNUE_MIRRORS = [
  NNUE_URL,
  'https://ghfast.top/' + NNUE_URL,
  'https://gh-proxy.com/' + NNUE_URL
]

// 本地保存位置。_downloads 是 uni-app 的可写目录，App 卸载时一并清除。
const LOCAL_DIR = '_downloads/engine'
const LOCAL_NAME = 'pikafish.nnue'

// 体积下限校验：低于此值一定是下载中断的碎片文件。
// 不校验精确大小，因为官方会更新权重导致体积变化。
const MIN_VALID_BYTES = 8 * 1024 * 1024

const STORAGE_KEY = 'nnue_local_path'

/**
 * 取已下载权重的本地路径
 * @returns {Promise<string|null>} 可用则返回绝对路径，否则 null
 */
export function getLocalNnue() {
  return new Promise(resolve => {
    const saved = uni.getStorageSync(STORAGE_KEY)
    if (!saved) {
      resolve(null)
      return
    }

    // 记录存在不代表文件还在（用户可能清理过缓存），必须实际核对
    // #ifdef APP-PLUS
    plus.io.resolveLocalFileSystemURL(
      saved,
      entry => {
        entry.file(
          file => {
            if (file.size >= MIN_VALID_BYTES) {
              resolve(saved)
            } else {
              // 碎片文件，清掉记录让上层重新下载
              uni.removeStorageSync(STORAGE_KEY)
              resolve(null)
            }
          },
          () => resolve(null)
        )
      },
      () => {
        uni.removeStorageSync(STORAGE_KEY)
        resolve(null)
      }
    )
    // #endif

    // #ifndef APP-PLUS
    resolve(null)
    // #endif
  })
}

/**
 * 把 uni-app 的逻辑路径（_downloads/...）转成原生层能用的绝对路径。
 *
 * 这一步不能省：原生引擎用的是标准 C 文件 IO，不认识 _downloads 这种
 * uni-app 私有的路径协议，必须转成 /data/user/0/... 或 /var/mobile/... 这样的真实路径。
 */
function toAbsolutePath(relativePath) {
  return new Promise(resolve => {
    // #ifdef APP-PLUS
    plus.io.resolveLocalFileSystemURL(
      relativePath,
      entry => {
        // toLocalURL() 给出的是带 file:// 的形式，原生层已做兼容处理，
        // 但这里统一去掉前缀，减少两端约定的复杂度。
        let p = entry.toLocalURL ? entry.toLocalURL() : relativePath
        if (p.indexOf('file://') === 0) p = p.substring(7)
        resolve(p)
      },
      () => resolve(relativePath)
    )
    // #endif

    // #ifndef APP-PLUS
    resolve(relativePath)
    // #endif
  })
}

/**
 * 下载权重
 *
 * @param {(percent:number, received:number, total:number)=>void} onProgress 进度回调
 * @returns {Promise<{success:boolean, path?:string, error?:string}>}
 */
export function downloadNnue(onProgress) {
  return new Promise(resolve => {
    // #ifndef APP-PLUS
    resolve({ success: false, error: '仅 App 端支持下载引擎权重' })
    return
    // #endif

    // #ifdef APP-PLUS
    let mirrorIndex = 0

    // 看门狗状态：记录最后一次有新数据的时间，停滞太久就换源
    const STALL_MS = 25000     // 25 秒没任何新字节，视为该源无效
    let watchdog = null
    let lastTick = 0
    let lastSize = 0
    let settled = false

    const done = r => {
      if (settled) return
      settled = true
      if (watchdog) clearInterval(watchdog)
      resolve(r)
    }

    const tryOne = () => {
      if (watchdog) clearInterval(watchdog)
      if (mirrorIndex >= NNUE_MIRRORS.length) {
        done({ success: false, error: '所有下载源均失败，请检查网络后重试' })
        return
      }

      const url = NNUE_MIRRORS[mirrorIndex]
      const isFirst = mirrorIndex === 0
      mirrorIndex++

      const task = plus.downloader.createDownload(
        url,
        {
          filename: LOCAL_DIR + '/' + LOCAL_NAME,
          // 官方权重约 49MB，弱网下要留足时间
          timeout: 600,
          retry: 1,
          retryInterval: 2
        },
        (download, status) => {
          if (status === 200 && download.filename) {
            // 下载完成不等于文件完整，必须校验体积
            plus.io.resolveLocalFileSystemURL(
              download.filename,
              entry => {
                entry.file(
                  async file => {
                    if (file.size < MIN_VALID_BYTES) {
                      // 拿到的可能是镜像站返回的错误页面，换下一个源
                      entry.remove(() => {}, () => {})
                      tryOne()
                      return
                    }
                    const abs = await toAbsolutePath(download.filename)
                    uni.setStorageSync(STORAGE_KEY, download.filename)
                    done({ success: true, path: abs, size: file.size })
                  },
                  () => tryOne()
                )
              },
              () => tryOne()
            )
          } else {
            // 首个源（GitHub 直连）失败很常见，静默换镜像
            tryOne()
          }
        }
      )

      task.addEventListener('statechanged', (d) => {
        if (!d) return
        if (d.state === 3 && d.totalSize > 0) {
          // 有数据到达就算有进展，刷新看门狗时间戳
          if (d.downloadedSize > lastSize) {
            lastSize = d.downloadedSize
            lastTick = Date.now()
          }
          if (typeof onProgress === 'function') {
            const percent = Math.floor((d.downloadedSize / d.totalSize) * 100)
            onProgress(percent, d.downloadedSize, d.totalSize)
          }
        }
      })

      // ----------------------------------------------------------
      //  停滞看门狗
      //
      //  plus.downloader 的 timeout 只管「连不上」，不管「连上了但不给
      //  数据」。镜像站若接受了连接却迟迟不响应，回调永远不触发，
      //  上层 Promise 跟着一起挂死，UI 就定在「引擎加载中…」。
      //  这里自己盯：超过 STALL_MS 没任何新字节就弃用该源，换下一个。
      // ----------------------------------------------------------
      lastTick = Date.now()
      lastSize = 0
      watchdog = setInterval(() => {
        if (settled) { clearInterval(watchdog); return }
        if (Date.now() - lastTick > STALL_MS) {
          clearInterval(watchdog)
          try { task.abort() } catch (e) {}
          tryOne()   // 换下一个镜像
        }
      }, 2000)

      task.start()
    }

    tryOne()
    // #endif
  })
}

/**
 * 确保权重可用：已下载则直接返回，否则下载
 *
 * @param {(percent:number)=>void} onProgress
 * @returns {Promise<{success:boolean, path?:string, error?:string, fromCache?:boolean}>}
 */
export async function ensureNnue(onProgress) {
  const local = await getLocalNnue()
  if (local) {
    const abs = await toAbsolutePath(local)
    return { success: true, path: abs, fromCache: true }
  }
  return await downloadNnue(onProgress)
}

/** 删除本地权重（用于「清理缓存」之类的功能） */
export function removeLocalNnue() {
  return new Promise(resolve => {
    const saved = uni.getStorageSync(STORAGE_KEY)
    uni.removeStorageSync(STORAGE_KEY)
    if (!saved) {
      resolve(true)
      return
    }
    // #ifdef APP-PLUS
    plus.io.resolveLocalFileSystemURL(
      saved,
      entry => entry.remove(() => resolve(true), () => resolve(false)),
      () => resolve(false)
    )
    // #endif
    // #ifndef APP-PLUS
    resolve(true)
    // #endif
  })
}

export const NNUE_INFO = {
  url: NNUE_URL,
  mirrors: NNUE_MIRRORS,
  minValidBytes: MIN_VALID_BYTES,
  approxMB: 49
}
