// 思源宋体只带网站文案用到的字，由 tools/fonts.mjs 在打包前生成
import './fonts/noto-serif-sc.css'
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/fraunces/wght-italic.css'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import ModelPage from './ModelPage.tsx'
import { GL_OK, NoGL } from './NoGL.tsx'
import './index.css'

const qs = new URLSearchParams(location.search)
const model = qs.get('model')
// 等待页只有正式页面会接管（见 Loader）；画不了三维、或者打开的是单看角色的调试页，直接撤掉
if (!GL_OK || model) document.getElementById('boot')?.remove()
createRoot(document.getElementById('root')!).render(!GL_OK ? <NoGL /> : model ? <ModelPage names={model.split(',')} /> : <App />)
