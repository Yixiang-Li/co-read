import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, Noise, SMAA, TiltShift2, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, SMAAPreset, ToneMappingMode } from 'postprocessing'

// 后期：灯光的光晕、移轴式的虚化（微缩景观的感觉）、电影式的色调压缩、暗角和一点颗粒。
// level 1 以上是完整效果；0 是省电档，只留光晕、色调压缩、调色和暗角。
export default function Post({ level, mobile }: { level: 0 | 1 | 2; mobile: boolean }) {
  const no = new URLSearchParams(location.search).get('no') ?? '' // 调试：?no=ao,bloom,tilt,aa,grain 关掉某几项看开销
  const on = (k: string, min: number) => level >= min && !no.includes(k)
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {/* 接触阴影：实测开了以后 100 帧掉到 60、最差的帧只有 30，所以默认关着；地址加 ?ao=1 可以打开看效果 */}
      {on('ao', 2) && !mobile && location.search.includes('ao=1') ? <N8AO halfRes aoSamples={8} denoiseSamples={4} denoiseRadius={8} aoRadius={0.28} distanceFalloff={0.5} intensity={1.9} quality="performance" color="#20140a" /> : <></>}
      {on('bloom', 0) ? <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1.05} luminanceSmoothing={0.25} radius={0.72} /> : <></>}
      {on('tilt', 1) ? <TiltShift2 blur={0.11} taper={0.62} start={[0, 0.54]} end={[1, 0.54]} samples={mobile ? 5 : 8} direction={[1, 1]} /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={-0.08} />
      <BrightnessContrast brightness={0.0} contrast={0.06} />
      {on('aa', 1) ? <SMAA preset={SMAAPreset.MEDIUM} /> : <></>}
      <Vignette offset={0.22} darkness={0.72} />
      {on('grain', 1) ? <Noise blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.07} /> : <></>}
    </EffectComposer>
  )
}
