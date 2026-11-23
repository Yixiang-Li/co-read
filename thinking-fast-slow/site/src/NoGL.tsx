import { L } from './i18n'

// 浏览器画不了三维（没有 WebGL，或被关掉了），或者画到一半显卡把画面收回去了（手机切到后台再回来时偶尔会这样）
export const GL_OK = (() => {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
})()

export function NoGL() {
  return (
    <div className="glnote" role="alert">
      <p className="glnote-h">{L('这台设备画不了这里的三维画面。', 'This device can’t draw the 3D scenes here.')}</p>
      <p>{L('换用最新版的 Chrome、Safari 或 Edge 再打开试试；如果用的是 App 里的内置浏览器，点右上角在浏览器里打开。', 'Try the latest Chrome, Safari or Edge. If you opened this inside an app, open it in your browser instead.')}</p>
    </div>
  )
}

export function GLLost() {
  return (
    <div className="glnote lost" role="alert">
      <p className="glnote-h">{L('画面中断了。', 'The picture was interrupted.')}</p>
      <p>{L('切到别的应用再回来时，浏览器偶尔会把三维画面收回去。', 'Browsers sometimes drop 3D scenes when you switch away and come back.')}</p>
      <button className="btn" onClick={() => location.reload()}>
        {L('重新载入', 'Reload')}
      </button>
    </div>
  )
}
