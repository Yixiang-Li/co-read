import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { bus } from '../bus'
import { SEA_D, SEA_W, TD, TW } from './dims'
import { shoreD } from './isles'
import { sm } from './kit'
import { paintChart, ROSE } from './tex'

// 岸线距离留一份在内存里：正数是离岸多远的水面，负数是岛上离水边多远（兔子用它判断脚下是水还是岛）
export const shoreAt = (x: number, z: number) => shoreD(x, z)

// 把“离最近岸边多远”存成一张图给海面的着色器用：哪里是浅水、哪里起白沫都看它。直接从小岛的轮廓算，不用渲染。
function shoreTex() {
  const W = 512
  const H = Math.round((W * TD) / TW)
  const out = new Uint16Array(W * H)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) out[j * W + i] = THREE.DataUtils.toHalfFloat(Math.min(4, Math.max(0, shoreD(((i + 0.5) / W - 0.5) * TW, ((j + 0.5) / H - 0.5) * TD))))
  const tex = new THREE.DataTexture(out, W, H, THREE.RedFormat, THREE.HalfFloatType)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

const roundRect = (w: number, d: number, r: number) => {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -d / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r)
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

// 海：像倒在书页上的一层树脂。近岸是浅的青绿，往外变深；岸边一圈白沫，一圈圈细浪慢慢往外走；
// 水面有很轻的起伏，台灯的光在上面碎成一片。
export default function Sea() {
  const uni = useMemo(() => ({ uTime: { value: 0 }, uShore: { value: shoreTex() }, uChart: { value: paintChart(shoreD) }, uRose: { value: new THREE.Vector2(...ROSE) }, uSize: { value: new THREE.Vector2(TW, TD) }, uFade: { value: 0 } }), [])
  const geo = useMemo(() => new THREE.ShapeGeometry(roundRect(SEA_W, SEA_D, 0.42), 10), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.26, metalness: 0, envMapIntensity: 0.9 })
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeaP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaP = (modelMatrix * vec4(position, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uTime; uniform float uFade; uniform sampler2D uShore; uniform sampler2D uChart; uniform vec2 uSize; uniform vec2 uRose;
          varying vec3 vSeaP;
          float sHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float sNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
            return mix(mix(sHash(i), sHash(i + vec2(1, 0)), f.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), f.x), f.y);
          }
          // 水面的起伏：几道方向各不相同的正弦波叠起来（没有格子感，也便宜）
          float seaH(vec2 q) {
            float h = sin(dot(q, vec2(1.9, 0.7)) + uTime * 0.55) * 0.3;
            h += sin(dot(q, vec2(-0.8, 2.3)) - uTime * 0.47) * 0.26;
            h += sin(dot(q, vec2(3.1, -2.2)) + uTime * 0.7) * 0.18;
            h += sin(dot(q, vec2(-4.3, -3.6)) - uTime * 0.83) * 0.12;
            h += sin(dot(q, vec2(6.7, 4.9)) + uTime * 1.1 + sin(q.x * 1.3) * 1.5) * 0.08;
            return h * 0.5;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          vec2 sq = vSeaP.xz;
          float sd = texture2D(uShore, sq / uSize + 0.5).r;
          // 海图的设色：越浅的水颜色越淡，往外沉成墨青
          vec3 sCol = mix(vec3(0.2, 0.42, 0.4), vec3(0.035, 0.17, 0.2), smoothstep(0.0, 0.26, sd));
          sCol = mix(sCol, vec3(0.012, 0.07, 0.095), smoothstep(0.18, 0.95, sd));
          vec3 sInk = vec3(0.74, 0.78, 0.66); // 印线的颜色：淡淡的纸色
          // 等深线：从岸边往外四道，越远越疏、越淡；每隔一会儿有一道微光沿着它们往外走
          float sW = max(fwidth(sd) * 0.9, 0.0035);
          float sFar = 1.0 - smoothstep(0.1, 0.8, sd);
          float sPulse = exp(-pow((sd - fract(uTime * 0.04) * 0.9) / 0.06, 2.0));
          float sMark = 0.0;
          sMark = max(sMark, (1.0 - smoothstep(sW, sW * 2.0, abs(sd - 0.09))) * 0.36);
          sMark = max(sMark, (1.0 - smoothstep(sW, sW * 2.0, abs(sd - 0.21))) * 0.27);
          sMark = max(sMark, (1.0 - smoothstep(sW, sW * 2.0, abs(sd - 0.37))) * 0.2);
          sMark = max(sMark, (1.0 - smoothstep(sW, sW * 2.0, abs(sd - 0.58))) * 0.14);
          sMark *= 1.0 + 0.7 * sPulse * sFar;
          // 岸线：紧贴着岛的一道实线，外面一条很细的浅色边
          sMark = max(sMark, (1.0 - smoothstep(sW * 1.3, sW * 2.6, abs(sd - 0.014))) * 0.7);
          // 经纬细线
          vec2 sGr = abs(fract(sq / 1.3 + 0.5) - 0.5) * 1.3;
          vec2 sGw = fwidth(sq) * 1.2;
          float sGrid = max(1.0 - smoothstep(sGw.x, sGw.x * 2.0, sGr.x), 1.0 - smoothstep(sGw.y, sGw.y * 2.0, sGr.y));
          sMark = max(sMark, sGrid * 0.1 * smoothstep(0.1, 0.4, sd));
          // 罗盘花、航向线、水深数字
          float sCh = texture2D(uChart, vec2(sq.x / uSize.x + 0.5, 0.5 - sq.y / uSize.y)).r;
          sMark = max(sMark, sCh * 0.62 * smoothstep(0.02, 0.2, sd));
          float seaFoam = sMark;
          sCol = mix(sCol, sInk, sMark);
          diffuseColor.rgb = mix(vec3(0.89, 0.85, 0.75), sCol, uFade);`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, mix(roughnessFactor, 0.6, seaFoam), uFade);')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          {
            float e = 0.07;
            float hC = seaH(sq); float hX = seaH(sq + vec2(e, 0.0)); float hZ = seaH(sq + vec2(0.0, e));
            float amp = 0.035 * uFade;
            vec3 nW = normalize(vec3(-(hX - hC) / e * amp, 1.0, -(hZ - hC) / e * amp));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`,
        )
    }
    return m
  }, [uni])
  useFrame((_, dt) => {
    uni.uTime.value += Math.min(0.05, dt) * (1 - 0.93 * bus.t)
    uni.uFade.value = sm(0.6, 0.8, bus.open)
  })
  return <mesh geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow />
}
