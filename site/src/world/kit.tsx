import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bus } from '../bus'

// 整个世界共用的尺寸、颜色和小零件。微观世界也从这里取，保证画风一致。
export { PD, PW, TD, TW } from './dims'
import { PW, TW } from './dims'
export const S0 = (PW * 2) / TW
export const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const backOut = (t: number) => {
  const u = Math.min(1, Math.max(0, t)) - 1
  return 1 + 2.7 * u * u * u + 1.7 * u * u
}
// 色板（彩色图解）。旧的键名保留，方便已有的场景自动换色。
export const C = {
  paper: '#f2e8d2', ink: '#1b2a27', blue: '#3b5c9c', yellow: '#e6cc5e', coral: '#dd7b58', red: '#d9502f', green: '#6c9670', teal: '#1f6660', lilac: '#b79bbd', pink: '#e0aeb1', olive: '#a0a355', mint: '#a6c6ae',
  navy: '#2c4580', gold: '#e3b54c', white: '#f6efe0', trunk: '#1b2a27', g1: '#6c9670', g2: '#93b59a', g3: '#1f6660', skin: '#f3e9d6', cream: '#efe5cf',
}

// 像立体书一样弹起来；有微观世界打开时，舞台附近的布景先让开
export function Pop({ at, children, ...rest }: { at: number; children: React.ReactNode } & Record<string, unknown>) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!g.current) return
    let s = backOut((bus.open - 0.76 - at * 0.012) / 0.2)
    const m = bus.micro
    // near：岛上的树和石头。它所在的岛被点开时让开，给案例腾地方
    if (m.k > 0.001 && rest.near && g.current.parent) {
      const dx = g.current.parent.position.x - m.ox
      const dz = g.current.parent.position.z - m.oz
      // 被点开的那座岛，和挡在镜头前面的那几座岛，树和房子都先收起来
      if (Math.hypot(dx, dz) < 0.5 || (dz > 0.8 && Math.abs(dx) < 4.4)) s *= 1 - sm(0, 0.6, m.k)
    }
    g.current.scale.setScalar(Math.max(0.0001, s))
  })
  return (
    <group ref={g} {...rest}>
      {children}
    </group>
  )
}

// —— 泥塑 / 毛毡的质感 ——
// 在标准材质上加四样东西：颜色里细微的深浅和冷暖、表面一点点手捏的凹凸、
// 光从侧面绕过来一些（明暗交界不那么硬）、边缘一圈绒毛似的微亮。
const CLAY_GLSL = /* glsl */ `
varying vec3 vClayP;
float clayHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float clayNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(clayHash(i), clayHash(i + vec3(1, 0, 0)), f.x), mix(clayHash(i + vec3(0, 1, 0)), clayHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(clayHash(i + vec3(0, 0, 1)), clayHash(i + vec3(1, 0, 1)), f.x), mix(clayHash(i + vec3(0, 1, 1)), clayHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`
// 光绕到背面去只改漫反射。高光那一项在“既背光又贴着轮廓”的地方会除以接近零的数，
// 要是把绕过来的光也乘进去，轮廓上就会冒出亮得离谱的像素（一模糊就是一团白）。
const WRAP_FROM = 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );'
const WRAP_TO = 'float cW = saturate( dot( geometryNormal, directLight.direction ) * 0.72 + 0.28 ); cW *= 0.6 + 0.4 * cW; reflectedLight.directDiffuse += cW * directLight.color * diffuseBRDF * ( 1.0 - F );'
// extra：在泥塑质感之上再加一层花纹（比如龟甲）。pars 是函数和常量；color 可以改 diffuseColor；height 往 cHx 上加起伏（单位和模型一样）。
// bump：基础颗粒的强弱（1 是默认的泥塑颗粒）；rim：轮廓上那圈绒毛似的微亮有多强。
export type ClayExtra = { pars?: string; color?: string; height?: string; bump?: number; rim?: number }

// “看颜色认材质”：道具几百个，不可能一个个指定材质，所以让着色器自己从底色判断这是什么东西——
// 木头色的出木纹、偏哑；金色的当黄铜，有金属反光；白和奶油色是搪瓷或瓷，光滑；鲜艳的颜色是上了漆的木玩具，半亮；
// 很深的颜色是哑光的橡胶或铁。这样一张桌子、一台收银机、一枚硬币、一个小人的头，各有各的质感。
const CRAFT_COLOR = /* glsl */ `
      {
        vec3 kc = diffuseColor.rgb;
        float kmx = max(kc.r, max(kc.g, kc.b));
        float kmn = min(kc.r, min(kc.g, kc.b));
        float ks = (kmx - kmn) / max(kmx, 0.001);
        float kd = max(kmx - kmn, 0.0001);
        float kh = kmx == kc.r ? (kc.g - kc.b) / kd / 6.0 : (kmx == kc.g ? (2.0 + (kc.b - kc.r) / kd) / 6.0 : (4.0 + (kc.r - kc.g) / kd) / 6.0);
        kh = fract(kh);
        kWood = smoothstep(0.028, 0.045, kh) * (1.0 - smoothstep(0.088, 0.1, kh)) * smoothstep(0.42, 0.56, ks) * (1.0 - smoothstep(0.86, 0.92, ks)) * smoothstep(0.03, 0.08, kmx) * (1.0 - smoothstep(0.62, 0.75, kmx));
        kGold = smoothstep(0.08, 0.09, kh) * (1.0 - smoothstep(0.104, 0.114, kh)) * smoothstep(0.76, 0.86, ks) * smoothstep(0.4, 0.55, kmx);
        kWhite = (1.0 - smoothstep(0.2, 0.34, ks)) * smoothstep(0.42, 0.6, kmx);
        kDark = 1.0 - smoothstep(0.025, 0.06, kmx);
        kPaint = smoothstep(0.5, 0.66, ks) * (1.0 - kWood) * (1.0 - kGold) * (1.0 - kDark);
        // 木纹：顺着板子的长边走。板面朝哪边，就在那个面里取“顺纹”和“横纹”两个方向
        vec3 kn = abs(normalize(vClayN));
        vec2 kuv = kn.x > 0.62 ? vec2(vClayP.z, vClayP.y) : vec2(vClayP.x, kn.y > kn.z ? vClayP.z : vClayP.y);
        float kFib = clayNoise(vec3(kuv.x * 2.2, kuv.y * 70.0, 3.7));
        float kBand = clayNoise(vec3(kuv.x * 0.9 + 9.0, kuv.y * 11.0 + kFib * 0.6, 1.3));
        float kGrain = (kFib - 0.5) * 0.2 + (kBand - 0.5) * 0.22;
        diffuseColor.rgb *= 1.0 + kGrain * kWood * cF2;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 0.98, 0.9), kWood * kBand * 0.5);
        cHx += (kFib - 0.5) * 0.0011 * kWood * cF2;
        // 黄铜：半金属。全金属的话，朝向暗处的那一面会黑成巧克力色；留一半底色，暗处也还是金的
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.0, 0.92, 0.8), kGold);
        kSmooth = clamp(kPaint * 0.85 + kGold + kWhite * 0.8, 0.0, 1.0);
      }`
export const makeClay =
  (extra: ClayExtra = {}, craft = false) =>
  (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vClayP;\nvarying vec3 vClayN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvClayP = position;\nvClayN = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLAY_GLSL}\nvarying vec3 vClayN;\n${extra.pars ?? ''}`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(WRAP_FROM, WRAP_TO))
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
      // 一个像素盖住多大一块表面：太细的纹理在远处要淡掉，不然会闪
      float cFoot = length(fwidth(vClayP));
      float cF2 = 1.0 - smoothstep(0.004, 0.016, cFoot);
      float cF3 = 1.0 - smoothstep(0.0012, 0.0045, cFoot);
      float cN1 = clayNoise(vClayP * 2.6 + 3.1);
      float cN2 = clayNoise(vClayP * 34.0);
      float cN3 = clayNoise(vClayP * 118.0 + 7.0);
      float cHx = 0.0;
      float kWood = 0.0; float kGold = 0.0; float kWhite = 0.0; float kDark = 0.0; float kPaint = 0.0; float kSmooth = 0.0;
      ${craft ? CRAFT_COLOR : ''}
      ${extra.color ?? ''}
      diffuseColor.rgb *= 1.0 + ((cN1 - 0.5) * 0.11 + (cN2 - 0.5) * 0.06 * cF2 + (cN3 - 0.5) * 0.05 * cF3) * (1.0 - 0.7 * kSmooth);
      diffuseColor.rgb *= mix(vec3(0.98, 1.0, 1.03), vec3(1.04, 1.0, 0.95), cN1);`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${craft ? 'roughnessFactor = mix(roughnessFactor, 0.34 + 0.1 * cN1, kPaint); roughnessFactor = mix(roughnessFactor, 0.5, kWhite); roughnessFactor = mix(roughnessFactor, 0.62, kWood); roughnessFactor = mix(roughnessFactor, 0.27 + 0.16 * cN2, kGold); roughnessFactor = mix(roughnessFactor, 0.9, kDark);' : ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${craft ? 'metalnessFactor = mix(metalnessFactor, 0.55, kGold);' : ''}`)
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
      {
        float cH = (cN2 * 0.0024 * cF2 + cN3 * 0.0008 * cF3) * ${(extra.bump ?? 1).toFixed(3)} * (1.0 - 0.88 * kSmooth) * (1.0 - 0.5 * kWood) + cHx;
        ${extra.height ?? ''}
        vec3 cSx = dFdx(-vViewPosition);
        vec3 cSy = dFdy(-vViewPosition);
        vec3 cR1 = cross(cSy, normal);
        vec3 cR2 = cross(normal, cSx);
        float cDet = dot(cSx, cR1) * faceDirection;
        vec3 cG = sign(cDet) * (dFdx(cH) * cR1 + dFdy(cH) * cR2);
        vec3 cP = abs(cDet) * normal - cG;
        if (dot(cP, cP) > 1e-20) normal = normalize(cP); // 太小的三角形算不出斜率，就不扰动
      }`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `float cRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.3);
      outgoingLight += (diffuseColor.rgb * 0.55 + 0.22) * cRim * ${(0.2 * (extra.rim ?? 1)).toFixed(3)} * (1.0 - 0.8 * kSmooth);
      outgoingLight = clamp(outgoingLight, 0.0, 1.9); // 不留过亮的值
      #include <opaque_fragment>`,
      )
  }
export const clay = makeClay()
// 小岛的地面：草是植绒的（两三种深浅的细点，微微起毛），沙是细颗粒，偶尔一粒深色的。远看会自动淡掉，不闪。
export const GROUND: ClayExtra = {
  color: /* glsl */ `
      {
        vec3 gc = diffuseColor.rgb;
        float gGrass = smoothstep(0.0, 0.05, gc.g - gc.r * 0.98);
        float gA = clayNoise(vClayP * 150.0);
        float gB = clayNoise(vClayP * 430.0 + 4.0);
        diffuseColor.rgb *= mix(1.0, 0.76 + 0.48 * gA, gGrass * cF2);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.1, 0.78), gGrass * smoothstep(0.6, 0.8, gB) * cF3 * 0.7);
        float gSand = 1.0 - gGrass;
        diffuseColor.rgb *= mix(1.0, 0.88 + 0.24 * gB, gSand * cF3);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6, gSand * smoothstep(0.87, 0.94, gA) * cF2 * 0.6);
        cHx += (gA - 0.5) * 0.003 * gGrass * cF2 + (gB - 0.5) * 0.001 * cF3;
      }`,
}
// 毛毡：没有泥巴那种一坑一坑的颗粒，只有很细的纤维；颜色里有极淡的杂点；轮廓上一圈起毛的亮边
export const FELT: ClayExtra = {
  bump: 0.12,
  rim: 2.4,
  color: /* glsl */ `
      {
        float fA = clayNoise(vClayP * 210.0);
        float fB = clayNoise(vec3(vClayP.x * 60.0, vClayP.y * 320.0, vClayP.z * 60.0) + 3.0);
        diffuseColor.rgb *= 1.0 + ((fA - 0.5) * 0.1 + (fB - 0.5) * 0.08) * cF3;
        cHx += ((fA - 0.5) * 0.0011 + (fB - 0.5) * 0.0009) * cF3;
      }`,
}
// 皮肤（乌龟的头和腿）：比泥巴细腻，只留很浅的起伏
export const SKIN: ClayExtra = { bump: 0.4, rim: 1.3 }
// 金属用旧了的样子：粗糙度深浅不匀，有很淡的擦痕和一点发暗的地方，不再像刚电镀出来的塑料
export function aged(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vClayP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvClayP = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLAY_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat aN = clayNoise(vClayP * 5.0 + 2.0); float aS = clayNoise(vec3(vClayP.x * 6.0, vClayP.y * 160.0, vClayP.z * 6.0)); diffuseColor.rgb *= 0.86 + 0.2 * aN; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.62, 0.5), smoothstep(0.62, 0.9, clayNoise(vClayP * 2.2 + 7.0)) * 0.55);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (aN - 0.5) * 0.26 + (aS - 0.5) * 0.14, 0.12, 0.9);')
  }
  m.customProgramCacheKey = () => 'aged'
  return m
}
// 道具用的：在泥塑质感之上“看颜色认材质”
export const craft = makeClay({}, true)
export const craftKey = () => 'craft2'
// 现成的泥塑材质（颜色来自顶点）。同样的参数只建一次，大家共用。
const clayMats = new Map<string, THREE.MeshStandardMaterial>()
export function clayMat(rough = 0.9, key = 'plain', extra?: ClayExtra, more: THREE.MeshStandardMaterialParameters = {}) {
  const id = key + rough
  let m = clayMats.get(id)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0, ...more })
    m.onBeforeCompile = extra ? makeClay(extra) : clay
    m.customProgramCacheKey = () => 'clay-' + key
    clayMats.set(id, m)
  }
  return m
}
export const clayKey = () => 'clay2'

// rough 越小越光滑，但最光滑也只到蜡的程度，不出硬的高光
// 哑光平涂的卡纸材质：不要高光，不要泥塑感
// 微观世界里的道具用的基础材质：哑光，带一层很细的手工颗粒，像上了色的陶土或木头。
export const M = ({ color, rough = 0.9 }: { color: string; rough?: number }) => (
  <meshStandardMaterial color={color} roughness={0.62 + 0.26 * rough} metalness={0} envMapIntensity={0.9} onBeforeCompile={craft} customProgramCacheKey={craftKey} />
)
// 给一个现成的标准材质（纯色、没有贴图的）换上“看颜色认材质”。微观世界里直接写的材质靠它统一升级。
export function upgrade(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial
  if (!s.isMeshStandardMaterial || s.userData.craft || s.map || s.transparent || s.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return
  s.userData.craft = true
  s.onBeforeCompile = craft
  s.customProgramCacheKey = craftKey
  s.needsUpdate = true
}
export const PUFF: [number, number, number, number][] = [[0, 0, 0, 0.5], [0.36, 0.1, 0.1, 0.38], [-0.34, 0.06, 0.12, 0.4], [0.05, 0.32, -0.05, 0.4], [0.1, 0.02, 0.36, 0.34], [-0.12, 0.06, -0.34, 0.36], [0.26, 0.26, -0.22, 0.3]]

// 共用的球：BALL 给近处的大件，BALL_S 给小东西和远处的布景
export const BALL = new THREE.SphereGeometry(1, 20, 14)
export const BALL_S = new THREE.SphereGeometry(1, 12, 8)
// 同一个颜色派生出几档深浅：k < 0 更深更冷，k > 0 更亮更暖
const _c = new THREE.Color()
export const shade = (color: string, k: number) => {
  _c.set(color)
  _c.offsetHSL(k * 0.022, k > 0 ? k * 0.02 : k * -0.03, k * 0.085)
  return `#${_c.getHexString()}`
}

// 把好几个零件烤成一个网格，颜色写进顶点里：一样东西只画一次，省绘制调用。
// 配套的材质用 <Baked />。
export type Part = { g: THREE.BufferGeometry; c: string; p?: [number, number, number]; s?: number | [number, number, number]; r?: [number, number, number] }
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
export function bake(parts: Part[]) {
  const gs = parts.map(({ g, c, p = [0, 0, 0], s = 1, r = [0, 0, 0] }) => {
    const o = g.index ? g.toNonIndexed() : g.clone()
    for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k)
    if (typeof s === 'number') _s.setScalar(s)
    else _s.set(s[0], s[1], s[2])
    o.applyMatrix4(_m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s))
    _c.set(c)
    const n = o.attributes.position.count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3)
    o.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return o
  })
  const out = mergeGeometries(gs)
  gs.forEach((g) => g.dispose())
  return out
}
export const Baked = ({ rough = 0.9, glow = 0, glowColor = '#000000' }: { rough?: number; glow?: number; glowColor?: string }) => (
  <meshStandardMaterial vertexColors roughness={0.62 + 0.34 * rough} emissive={glowColor} emissiveIntensity={glow} envMapIntensity={0.9} onBeforeCompile={craft} customProgramCacheKey={craftKey} />
)
const cache = new Map<string, THREE.BufferGeometry>()
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  let g = cache.get(key)
  if (!g) cache.set(key, (g = make()))
  return g
}

// 一簇圆球（树冠、云）。高处的球亮一点，低处的深一点，看起来才有体积。
const puffParts = (color: string): Part[] => PUFF.map(([x, y, z, r], i) => ({ g: BALL, c: shade(color, y * 2.2 - 0.25 + ((i * 7) % 3) * 0.12 - (x + z) * 0.25), p: [x, y, z], s: [r, r * 0.94, r] }))
export function Puff({ color, s = 1, glow = 0 }: { color: string; s?: number; glow?: number }) {
  return (
    <mesh scale={s} geometry={cached('puff' + color, () => bake(puffParts(color)))} castShadow receiveShadow>
      <Baked rough={1} glow={glow} glowColor={color} />
    </mesh>
  )
}

const TRUNK = new THREE.CylinderGeometry(0.05, 0.085, 0.6, 8)
export function Bush({ color, s = 1 }: { color: string; s?: number }) {
  const g = cached('bush' + color, () =>
    bake([{ g: TRUNK, c: C.trunk, p: [0, 0.3, 0] }, { g: BALL_S, c: C.trunk, p: [0, 0.02, 0], s: [0.12, 0.05, 0.12] }, ...puffParts(color).map((q) => ({ ...q, p: [q.p![0], q.p![1] + 0.85, q.p![2]] as [number, number, number] }))]),
  )
  return (
    <mesh scale={s} geometry={g} castShadow receiveShadow>
      <Baked rough={1} />
    </mesh>
  )
}

// 小人：一颗圆头，一个底下收圆、肩膀也收圆的身子，像手捏的木偶棋子。整个人是一个网格。
// 小人：一颗圆头，一个底下收圆、肩膀也收圆的身子，像手捏的木偶棋子。整个人是一个网格。
const MEEPLE_BODY = new THREE.LatheGeometry(
  new THREE.SplineCurve(
    ([[0, 0], [0.13, 0.001], [0.185, 0.014], [0.204, 0.052], [0.198, 0.105], [0.168, 0.2], [0.136, 0.3], [0.108, 0.4], [0.092, 0.47], [0.086, 0.515], [0.066, 0.55], [0, 0.562]] as const).map(([x, y]) => new THREE.Vector2(x, y)),
  )
    .getPoints(26)
    .map((p) => p.setX(Math.max(0, p.x))),
  24,
)
const COLLAR = new THREE.TorusGeometry(0.083, 0.024, 8, 20)
export function Meeple({ color, x = 0, children }: { color: string; x?: number; children?: React.ReactNode }) {
  const g = cached('meeple' + color, () =>
    bake([
      { g: MEEPLE_BODY, c: color },
      { g: COLLAR, c: shade(color, -0.9), p: [0, 0.505, 0], r: [Math.PI / 2, 0, 0] },
      { g: BALL, c: C.skin, p: [0, 0.668, 0], s: 0.146 },
    ]),
  )
  return (
    <group position={[x, 0, 0]}>
      <mesh geometry={g} castShadow receiveShadow>
        <Baked rough={0.78} />
      </mesh>
      {children}
    </group>
  )
}

// 场景里的小标签（比如“银行出纳”）。字要少，一个标签不超过八个字。
// 跟着三维里的点走的网页元素，窄屏上可能被推到画面外：每隔几帧量一下，出界就往里挪，挪到离边 8 像素
export function useKeepOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const shift = useRef(0)
  const n = useRef(0)
  useFrame(() => {
    const el = ref.current
    if (!el || ++n.current % 4) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    const l = r.left - shift.current
    const rr = r.right - shift.current
    const W = innerWidth
    const s = r.width > W - 16 ? (W - r.width) / 2 - l : l < 8 ? 8 - l : rr > W - 8 ? W - 8 - rr : 0
    if (Math.abs(s - shift.current) > 0.5) {
      shift.current = s
      el.style.translate = `${s.toFixed(1)}px 0`
    }
  })
}

export function Tag({ children, position, tone = 'light', show = true, below = false, big = false }: { children: React.ReactNode; position?: [number, number, number]; tone?: 'light' | 'dark' | 'red' | 'blue'; show?: boolean; below?: boolean; big?: boolean }) {
  // below：排在同一位置那张签的正下方（按屏幕像素，不随镜头远近错开）。big：字大一号。
  const ref = useRef<HTMLSpanElement>(null)
  useKeepOnScreen(ref)
  return (
    <Html center position={position} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <span ref={ref} className="tag3d-fit">
        <span className={`tag3d ${tone} ${show ? 'show' : ''} ${below ? 'below' : ''} ${big ? 'big' : ''}`}>{children}</span>
      </span>
    </Html>
  )
}

// —— 图解风的零件 ——
// 立着的圆卡纸片：正反两面是颜色，边是白的纸芯。默认面朝 +z（朝镜头）。
export function Disc({ r, color, thick = 0.05, edge = '#fbf8f0', ...rest }: { r: number; color: string; thick?: number; edge?: string } & Record<string, unknown>) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow {...rest}>
      <cylinderGeometry args={[r, r, thick, 48]} />
      <meshStandardMaterial attach="material-0" color={edge} roughness={1} />
      <meshStandardMaterial attach="material-1" color={color} roughness={1} />
      <meshStandardMaterial attach="material-2" color={color} roughness={1} />
    </mesh>
  )
}

// 任意轮廓的立着的卡纸片（点是 x、y，单位和世界一样；底边在 y = 0）
export function Card({ pts, color, thick = 0.05, edge = '#fbf8f0', ...rest }: { pts: [number, number][]; color: string; thick?: number; edge?: string } & Record<string, unknown>) {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false })
    g.translate(0, 0, -thick / 2)
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pts), thick])
  return (
    <mesh geometry={geo} castShadow {...rest}>
      <meshStandardMaterial attach="material-0" color={color} roughness={1} />
      <meshStandardMaterial attach="material-1" color={edge} roughness={1} />
    </mesh>
  )
}

// 圆片树：黑色的三角树干，上面一两片圆卡纸，圆片上画着黑色的枝
export function DiscTree({ r = 0.7, color = C.green, h = 1.5, twin }: { r?: number; color?: string; h?: number; twin?: string }) {
  return (
    <group>
      <Card pts={[[-0.09, 0], [0.09, 0], [0, h]]} color={C.ink} edge={C.ink} thick={0.04} position={[0, 0, 0.04]} />
      <Disc r={r} color={color} position={[0, h, 0]} />
      {[-0.5, 0.45].map((a, i) => (
        <mesh key={i} position={[Math.sin(a) * r * 0.32, h + r * 0.12 + i * 0.08, 0.03]} rotation={[0, 0, -a]}>
          <boxGeometry args={[0.035, r * 0.75, 0.012]} />
          <meshStandardMaterial color={C.ink} roughness={1} />
        </mesh>
      ))}
      {twin && <Disc r={r * 0.62} color={twin} position={[r * 0.95, h - r * 0.45, -0.07]} />}
    </group>
  )
}
