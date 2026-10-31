// STEP-4 visual layer: image-based light, post stack (GTAO, bloom, DOF, grade/vignette/grain),
// volumetric lamp cones, chimney smoke, footprints in the snow, ice glints, BOOSTED shockwaves,
// and a runtime performance governor for weak devices.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { canvasTexture, glowTexture } from './util.js?v=8fa77074';

// ------------------------------------------------------------- environment
export async function loadEnvironment(renderer, scene, url, intensity) {
  try {
    const tex = await new RGBELoader().loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromEquirectangular(tex); tex.dispose(); pm.dispose();
    scene.environment = rt.texture; scene.environmentIntensity = intensity;
    return true;
  } catch (e) { console.warn('HDRI not loaded, continuing without IBL', e); return false; }
}

// ------------------------------------------------------------- NaN / Inf killer
// Runs right after the scene render, before bloom. A single NaN/Inf pixel in the HDR buffer is
// smeared by UnrealBloom's separable blur across its low mips into big solid rectangles (seen as
// black screen-space patches on Apple GPUs). Comparisons are written so fast-math can't fold them.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 48.0 }, uDebug: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax, uDebug; uniform vec2 uTexel; varying vec2 vUv;
    // integer tests survive fast-math (Metal) where isnan()/isinf() may be folded away
    bool isBad(float x){ return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
    bool isNaNb(float x){ return isBad(x) && (floatBitsToUint(x) & 0x007fffffu) != 0u; }
    bool bad4(vec4 c){ return isBad(c.r) || isBad(c.g) || isBad(c.b) || isBad(c.a); }
    bool nan4(vec4 c){ return isNaNb(c.r) || isNaNb(c.g) || isNaNb(c.b) || isNaNb(c.a); }
    vec4 fix(vec4 c){ // +Inf (additive overflow) -> bright, -Inf/NaN -> 0
      return vec4(isBad(c.r) ? (isNaNb(c.r) || c.r < 0.0 ? 0.0 : uMax) : c.r, isBad(c.g) ? (isNaNb(c.g) || c.g < 0.0 ? 0.0 : uMax) : c.g,
                  isBad(c.b) ? (isNaNb(c.b) || c.b < 0.0 ? 0.0 : uMax) : c.b, isBad(c.a) ? 1.0 : c.a); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      bool b = bad4(c);
      if (uDebug > 0.5) { gl_FragColor = b ? (nan4(c) ? vec4(1.0, 0.0, 1.0, 1.0) : vec4(0.0, 1.0, 0.0, 1.0)) : vec4(c.rgb * 0.15, 1.0); return; }
      if (b && nan4(c)) { // NaN pixel: rebuild from the valid neighbours (a NaN fragment never shows as a black hole)
        vec4 acc = vec4(0.0); float n = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.785398; vec4 q = texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * uTexel * 2.0);
          if (!bad4(q)) { acc += q; n += 1.0; }
        }
        c = n > 0.0 ? acc / n : vec4(0.0, 0.0, 0.0, 1.0);
      } else if (b) c = fix(c);
      gl_FragColor = clamp(c, vec4(0.0), vec4(uMax));
    }`,
};

// ------------------------------------------------------------- final pass
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uDof: { value: 0 }, uFocus: { value: 12 }, uNear: { value: 0.1 }, uFar: { value: 900 },
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uVig: { value: 0.55 }, uGrain: { value: 0.035 }, uMaxBlur: { value: 5 },
    uBoost: { value: 0 }, uFlash: { value: 0 }, uStorm: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `#include <packing>
    uniform sampler2D tDiffuse, tDepth; uniform float uDof, uFocus, uNear, uFar, uTime, uVig, uGrain, uMaxBlur, uBoost, uFlash, uStorm; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float coc(vec2 uv){
      float z = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
      return clamp(abs(z - uFocus) / max(z, 0.1) * 1.6 - 0.12, 0.0, 1.0) * smoothstep(0.0, 0.6, z / uFocus + 0.2);
    }
    void main(){
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uDof > 0.5) {
        float k = coc(uv);
        if (k > 0.02) {
          vec3 acc = c; float wsum = 1.0;
          for (int i = 0; i < 16; i++) {
            float fi = float(i);
            float r = sqrt((fi + 0.5) / 16.0) * k * uMaxBlur;
            float a = fi * 2.39996;
            vec2 o = vec2(cos(a), sin(a)) * r / uRes;
            float w = coc(uv + o) + 0.05;
            acc += texture2D(tDiffuse, uv + o).rgb * w; wsum += w;
          }
          c = acc / wsum;
        }
      }
      // grade: cool shadows / warm highlights, gentle s-curve, saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // deep blue shadows, warm amber light pools (cozy, more contrast)
      c = mix(c * vec3(0.86, 0.95, 1.12), c * vec3(1.16, 1.0, 0.82), smoothstep(0.1, 0.55, l));
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.34);
      c = mix(vec3(l), c, 1.06 - uStorm * 0.25);
      c += vec3(0.1, 0.55, 1.0) * uFlash * 0.35 * (1.0 - l);
      // vignette (a touch stronger and bluer while BOOSTED)
      vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float v = smoothstep(1.05, 0.25, length(d));
      c *= mix(1.0, v, uVig);
      c += vec3(0.05, 0.25, 0.5) * uBoost * (1.0 - v) * 0.6;
      // film grain
      float n = hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      c += n * uGrain * (1.0 - l * 0.7);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// Scene render + first NaN sanitize in one pass. Only the scene target is multisampled: the composer's ping-pong
// targets stay single-sample, so bloom / output / grade passes never write (and resolve) 4x MSAA half-float buffers.
class SceneSanitizePass extends Pass {
  constructor(scene, camera, sanitize, type, samples) {
    super(); this.scene = scene; this.camera = camera; this.sanitize = sanitize; this.needsSwap = true;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type, samples });
    this.rt.texture.name = 'SceneMSAA';
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
    this.sanitize.renderToScreen = this.renderToScreen;
    this.sanitize.render(renderer, writeBuffer, this.rt, deltaTime, maskActive); // tDiffuse <- resolved scene
  }
  dispose() { this.rt.dispose(); }
}

export class PostFX {
  constructor(renderer, scene, camera, Q, bloomCfg, look) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.Q = Q; this.look = look;
    this.enabled = Q.bloom || Q.ao || Q.grade;
    if (!this.enabled) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // half-float HDR target where the GPU can render to it (iOS / older GPUs fall back to 8-bit)
    const ext = renderer.extensions, half = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    const maxS = renderer.capabilities.maxSamples || 0;
    this.halfFloat = half;
    const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.samples = Math.min(Q.msaa || 0, maxS);
    // post ping-pong targets: single-sample, no depth (every pass after the scene is a full-screen quad)
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type, samples: 0, depthBuffer: false });
    const composer = this.composer = new EffectComposer(renderer, rt);
    this.sanitize = new ShaderPass(SanitizeShader);
    this.scenePass = new SceneSanitizePass(scene, camera, this.sanitize, type, this.samples); composer.addPass(this.scenePass);
    if (Q.ao) {
      const ao = this.ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.9;
      ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.0, scale: 1.1, samples: 12, distanceFallOff: 1.0 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // keep additive glows / sprites / trails out of the AO normal pass
      const ov = ao.overrideVisibility.bind(ao);
      ao.overrideVisibility = function () {
        ov();
        this.scene.traverse(o => { if (o.visible && (o.isSprite || o.userData.noAO || (o.material && !Array.isArray(o.material) && o.material.transparent && o.material.depthWrite === false))) o.visible = false; });
      };
      composer.addPass(ao);
      this.sanitize2 = new ShaderPass(SanitizeShader); composer.addPass(this.sanitize2);
      if (Q.ao === 'cinematic') ao.enabled = false;
    }
    if (Q.bloom) {
      const bs = Q.bloomScale || 1;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), bloomCfg.strength, bloomCfg.radius, bloomCfg.threshold);
      this.bloomBase = { ...bloomCfg };
      composer.addPass(this.bloom);
      // bloom's mip chain can turn an overflowing (+Inf) highlight into Inf - Inf = NaN: kill again before tone mapping
      this.sanitize3 = new ShaderPass(SanitizeShader); composer.addPass(this.sanitize3);
    }
    composer.addPass(new OutputPass());
    if (Q.grade) {
      this.final = new ShaderPass(FinalShader);
      const u = this.final.uniforms;
      u.uVig.value = look.vignette; u.uGrain.value = look.grain; u.uMaxBlur.value = look.dofMaxBlurPx;
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      if (this.ao && Q.dof) { u.tDepth.value = this.ao.depthTexture; u.uDof.value = Q.dof === 'cinematic' ? 0 : 1; }
      composer.addPass(this.final);
    }
    this.setSize(innerWidth, innerHeight);
  }
  setSize(w, h) {
    if (!this.enabled) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this._w = w; this._h = h; const bs = this.bloomScaleNow ?? this.Q.bloomScale;
    if (this.bloom && bs && bs < 1) this.bloom.setSize(w * this.renderer.getPixelRatio() * bs, h * this.renderer.getPixelRatio() * bs);
    this.final?.uniforms.uRes.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    for (const p of [this.sanitize, this.sanitize2, this.sanitize3]) p?.uniforms.uTexel.value.set(1 / Math.max(1, w * this.renderer.getPixelRatio()), 1 / Math.max(1, h * this.renderer.getPixelRatio()));
  }
  update(t, { focus = 12, boost = 0, flash = 0, storm = 0 } = {}) {
    if (!this.final) return;
    const u = this.final.uniforms;
    u.uTime.value = t; u.uFocus.value = focus; u.uBoost.value = boost; u.uFlash.value = flash; u.uStorm.value = storm;
  }
  /** 'cinematic' AO / DOF (high preset): only while the camera is in a cutscene (title, level complete, ending) */
  setCinematic(on) {
    if (this._cine === on) return; this._cine = on;
    if (this.Q.ao === 'cinematic' && this.ao && !this._aoOff) this.ao.enabled = on;
    if (this.Q.dof === 'cinematic' && this.final && this.ao && !this._dofOff) this.final.uniforms.uDof.value = on && this.ao.enabled ? 1 : 0;
  }
  setDof(on) { this._dofOff = !on; if (this.final) this.final.uniforms.uDof.value = on && this.ao?.enabled ? 1 : 0; }
  setAO(on) { if (this.ao) { this.ao.enabled = on; this._aoOff = !on; if (!on) this.setDof(false); } }
  /** debug: magenta where the scene buffer holds NaN/Inf (bloom + grade bypassed so it stays pixel-exact) */
  nanView(on) { if (!this.sanitize) return; this.sanitize.uniforms.uDebug.value = on ? 1 : 0; if (this.bloom) this.bloom.enabled = !on && !this._bloomOff; if (this.final) this.final.enabled = !on; }
  /** safety net: bloom mip-chain resolution (fraction of the drawing buffer); glow strength / radius unchanged */
  setBloomScale(k) { if (!this.bloom) return; this.bloomScaleNow = k; if (this._w) this.setSize(this._w, this._h); }
  setBloom(on) { this._bloomOff = !on; if (this.bloom) this.bloom.enabled = on; }
  /** weather-driven post (CONFIG.weather.post): crisp clear nights, softer glow + more depth haze in a storm */
  setWeather(storm) {
    const P = this.weatherPost; if (!P) return;
    const m = (a, b) => a + (b - a) * storm;
    if (this.bloom) { this.bloom.strength = m(P.clear.bloomStrength, P.storm.bloomStrength); this.bloom.radius = m(P.clear.bloomRadius, P.storm.bloomRadius); this.bloom.threshold = m(P.clear.bloomThreshold, P.storm.bloomThreshold); }
    if (this.final) this.final.uniforms.uMaxBlur.value = m(P.clear.dofBlurPx, P.storm.dofBlurPx);
  }
  render() { if (this.enabled) this.composer.render(); else this.renderer.render(this.scene, this.camera); }
}

// ------------------------------------------------------- volumetric lamp cones
export class LampCones {
  constructor(scene, lamps, intensity = 0.12) {
    this.lamps = lamps; const n = lamps.length;
    const h = 1;
    const geo = new THREE.CylinderGeometry(0.22, 2.9, h, 28, 6, true); geo.translate(0, h / 2, 0);
    this.uniforms = { uTime: { value: 0 }, uI: { value: intensity }, uStorm: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vW; varying vec3 vN; varying float vT; varying vec3 vC;
        void main(){
          vT = position.y; vC = instanceColor;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `uniform float uTime, uI, uStorm; varying vec3 vW; varying vec3 vN; varying float vT; varying vec3 vC;
        float h(vec3 p){ return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5); }
        float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float edge = pow(abs(dot(normalize(vN), V)), 1.6);
          float top = 1.0 - vT;                       // 0 at the lantern, 1 at the ground
          float a = edge * (1.0 - smoothstep(0.82, 1.0, top)) * (0.35 + 0.65 * (1.0 - top)) * smoothstep(0.0, 0.06, top);
          float dust = 0.65 + 0.7 * noise(vW * 2.3 + vec3(0.0, -uTime * 0.9, uTime * 0.3));
          float dist = length(cameraPosition - vW);
          a *= dust * smoothstep(90.0, 30.0, dist) * smoothstep(1.0, 4.0, dist);
          gl_FragColor = vec4(vC * a * uI * (1.0 + uStorm * 0.9), 1.0);
        }`,
    });
    const im = this.mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => { m.compose(new THREE.Vector3(l.x, 0.02, l.z), new THREE.Quaternion(), new THREE.Vector3(1, l.y + 0.02, 1)); im.setMatrixAt(i, m); im.setColorAt(i, l.color); });
    im.userData.noAO = true; im.frustumCulled = false; im.renderOrder = 2;
    scene.add(im); this.acc = 0;
  }
  update(dt, t, storm) {
    this.uniforms.uTime.value = t; this.uniforms.uStorm.value = storm;
    this.acc -= dt; if (this.acc > 0) return; this.acc = 0.2;
    this.lamps.forEach((l, i) => this.mesh.setColorAt(i, l.color)); this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------- footprints
function bootTexture() {
  return canvasTexture(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const blob = (x, y, rx, ry, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y); g.fillStyle = gr; g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, 7); g.fill(); g.restore(); };
    blob(32, 40, 22, 34, 1); blob(32, 98, 17, 22, 0.95);
  });
}
export class Footprints {
  constructor(scene, max = 220) {
    this.max = max; this.i = 0; this.dist = 0; this.side = 1;
    const geo = new THREE.PlaneGeometry(0.2, 0.4); geo.rotateX(-Math.PI / 2);
    this.birth = new Float32Array(max).fill(-1e4);
    geo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uTime: { value: 0 }, uMap: { value: bootTexture() }, uLife: { value: 28 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: 'attribute float aBirth; uniform float uTime, uLife; varying vec2 vUv; varying float vA; void main(){ vUv = uv; float age = uTime - aBirth; vA = (1.0 - smoothstep(uLife * 0.5, uLife, age)) * step(0.0, age); gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D uMap; varying vec2 vUv; varying float vA; void main(){ float m = texture2D(uMap, vUv).a; if (m * vA < 0.01) discard; gl_FragColor = vec4(vec3(0.07, 0.1, 0.19), m * vA * 0.5); }',
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max); this.mesh.frustumCulled = false; this.mesh.userData.noAO = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let k = 0; k < max; k++) this.mesh.setMatrixAt(k, zero);
    scene.add(this.mesh); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.last = null;
  }
  reset() { this.birth.fill(-1e4); this.mesh.geometry.attributes.aBirth.needsUpdate = true; this.last = null; }
  /** stamp one boot print exactly where a foot planted (event-driven from the rig) */
  stamp(x, z, heading, t, y = null) {
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI);
    this.m.compose(new THREE.Vector3(x, (y ?? (this.heightAt ? this.heightAt(x, z) : 0)) + 0.035, z), this.q, new THREE.Vector3(0.9, 1, 0.8));
    this.mesh.setMatrixAt(this.i, this.m); this.birth[this.i] = t;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.geometry.attributes.aBirth.needsUpdate = true;
    this.i = (this.i + 1) % this.max;
  }
  update(t, pos, heading, enabled) {
    this.uniforms.uTime.value = t;
    if (!enabled) { this.last = null; return; }
    if (!this.last) { this.last = pos.clone(); return; }
    const d = Math.hypot(pos.x - this.last.x, pos.z - this.last.z);
    if (d > 3) { this.last.copy(pos); return; }
    this.dist += d; this.last.copy(pos);
    if (this.dist < 0.62) return;
    this.dist = 0; this.side = -this.side;
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI + this.side * 0.08);
    const fpx = pos.x + rx * 0.15 * this.side, fpz = pos.z + rz * 0.15 * this.side;
    this.m.compose(new THREE.Vector3(fpx, (this.heightAt ? this.heightAt(fpx, fpz) : 0) + 0.035, fpz), this.q, new THREE.Vector3(1, 1, 1));
    this.mesh.setMatrixAt(this.i, this.m); this.birth[this.i] = t;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.geometry.attributes.aBirth.needsUpdate = true;
    this.i = (this.i + 1) % this.max;
  }
}

// ------------------------------------------------------- chimney smoke
function smokeTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    for (let k = 0; k < 9; k++) {
      const x = w / 2 + (Math.random() - 0.5) * 40, y = h / 2 + (Math.random() - 0.5) * 40, r = 22 + Math.random() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  });
}
/** Find the chimney top of a building model (prominent narrow peak on the roof) in the model's parent space. */
export function findChimney(object) {
  object.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(object.parent ? object.parent.matrixWorld : new THREE.Matrix4()).invert();
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), pts = [];
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 0;
  object.traverse(o => {
    if (!o.isMesh) return; for (let p = o; p; p = p.parent) if (p.name === 'LOD1') return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const a = o.geometry.attributes.position, step = Math.max(1, Math.floor(a.count / 30000));
    for (let i = 0; i < a.count; i += step) { v.fromBufferAttribute(a, i).applyMatrix4(m); pts.push(v.x, v.y, v.z); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); maxY = Math.max(maxY, v.y); }
  });
  const cs = 0.3, nx = Math.ceil((maxX - minX) / cs) + 1, nz = Math.ceil((maxZ - minZ) / cs) + 1;
  const hm = new Float32Array(nx * nz);
  for (let i = 0; i < pts.length; i += 3) { const ix = Math.floor((pts[i] - minX) / cs), iz = Math.floor((pts[i + 2] - minZ) / cs); const k = iz * nx + ix; if (pts[i + 1] > hm[k]) hm[k] = pts[i + 1]; }
  let best = null, bestP = 0.55;
  for (let iz = 2; iz < nz - 2; iz++) for (let ix = 2; ix < nx - 2; ix++) {
    const h = hm[iz * nx + ix]; if (h < maxY * 0.45) continue;
    let ring = 0;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const c = Math.max(Math.abs(dx), Math.abs(dz)); if (c < 3) continue;
      const x = ix + dx, z = iz + dz; if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
      ring = Math.max(ring, hm[z * nx + x]);
    }
    const p = h - ring; if (p > bestP) { bestP = p; best = new THREE.Vector3(minX + (ix + 0.5) * cs, h, minZ + (iz + 0.5) * cs); }
  }
  return best;
}
export class ChimneySmoke {
  constructor(scene, sources, perSource = 22) {
    const n = sources.length * perSource;
    const org = new Float32Array(n * 3), ph = new Float32Array(n);
    sources.forEach((s, j) => { for (let k = 0; k < perSource; k++) { const i = j * perSource + k; org.set([s.x, s.y, s.z], i * 3); ph[i] = (k + Math.random() * 0.6) / perSource; } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(org, 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.9, 0.35) }, uMap: { value: smokeTexture() }, uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute float aPhase; uniform float uTime, uScale; uniform vec2 uWind; varying float vA; varying float vAge; varying float vRot;
        void main(){
          float age = fract(uTime * 0.12 + aPhase); vAge = age;
          vec3 p = position;
          float sway = sin(uTime * 0.7 + aPhase * 37.0) * 0.35 * age;
          p += vec3(uWind.x * age * age * 6.0 + sway, age * 6.5, uWind.y * age * age * 6.0 - sway * 0.5);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.5 + age * 3.2) * uScale / -mv.z;
          vA = smoothstep(0.0, 0.08, age) * (1.0 - age) * smoothstep(160.0, 60.0, -mv.z);
          vRot = aPhase * 6.28 + uTime * 0.2;
        }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; varying float vAge; varying float vRot;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float s = sin(vRot), co = cos(vRot); c = mat2(co, -s, s, co) * c;
          float m = texture2D(uMap, c + 0.5).a;
          vec3 col = mix(vec3(0.62, 0.55, 0.5), vec3(0.42, 0.48, 0.62), smoothstep(0.0, 0.4, vAge));
          gl_FragColor = vec4(col, m * vA * 0.75);
        }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 3;
    scene.add(this.points);
  }
  update(t, storm, viewportH, fov) {
    this.uniforms.uTime.value = t;
    this.uniforms.uWind.value.set(0.9 + storm * 5, 0.35 + storm * 2.5);
    this.uniforms.uScale.value = viewportH * 0.5 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  }
}

// ------------------------------------------------------- ice + snow glints
export class Sparkles {
  constructor(scene, count = 1600) {
    this.scene = scene;
    this.ground = this.makePoints(count, 0.45, true);
    this.ice = null;
  }
  makePoints(n, bright, follow, positions) {
    const pos = positions || new Float32Array(n * 3).map((_, i) => i % 3 === 1 ? 0.06 : Math.random() * 36);
    const ph = new Float32Array(pos.length / 3).map(() => Math.random());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const u = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uFollow: { value: follow ? 1 : 0 }, uB: { value: bright } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aPh; uniform float uTime, uFollow; uniform vec3 uCenter; varying float vB;
        void main(){
          vec3 p = position;
          if (uFollow > 0.5) { vec3 o = uCenter - vec3(18.0, 0.0, 18.0); p.x = o.x + mod(p.x - o.x, 36.0); p.z = o.z + mod(p.z - o.z, 36.0); }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // glint depends on the eye position, so it flickers as the camera moves
          float g = sin(aPh * 80.0 + dot(cameraPosition.xz, vec2(0.9, 1.3)) * 1.7 + uTime * (0.6 + aPh));
          vB = pow(max(0.0, g), 18.0) * smoothstep(40.0, 6.0, -mv.z);
          gl_PointSize = (1.5 + 3.0 * vB) * (1.0 + 4.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: 'uniform float uB; varying float vB; void main(){ vec2 c = gl_PointCoord - 0.5; float s = max(0.0, 1.0 - (abs(c.x) + abs(c.y)) * 2.2) + max(0.0, 1.0 - length(c) * 3.0); if (vB < 0.01) discard; gl_FragColor = vec4(vec3(0.8, 0.92, 1.0) * s * vB * uB * 2.2, 1.0); }',
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; this.scene.add(pts);
    return { pts, u };
  }
  setIce(patches) {
    if (this.ice) { this.scene.remove(this.ice.pts); this.ice.pts.geometry.dispose(); this.ice = null; }
    if (!patches.length) return;
    const arr = [];
    for (const p of patches) { const n = Math.round(p.r * p.r * 6); for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * p.r * 0.95; arr.push(p.x + Math.cos(a) * r, 0.1, p.z + Math.sin(a) * r); } }
    this.ice = this.makePoints(0, 1.6, false, new Float32Array(arr));
  }
  update(t, center) {
    for (const s of [this.ground, this.ice]) if (s) { s.u.uTime.value = t; s.u.uCenter.value.copy(center); }
  }
}

// ------------------------------------------------------- BOOSTED shockwaves
export class Shockwaves {
  constructor(scene) { this.scene = scene; this.list = []; this.geo = new THREE.RingGeometry(0.85, 1, 96, 1); this.geo.rotateX(-Math.PI / 2); this.pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true); this.pillarGeo.translate(0, 0.5, 0); }
  spawn(pos, radius = 20, dur = 0.9, color = 0x49c2ff, pillar = false) {
    const mk = (geo, frag) => new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uC: { value: new THREE.Color(color) }, uA: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: frag,
    }));
    const ring = mk(this.geo, 'uniform vec3 uC; uniform float uA; varying vec2 vUv; void main(){ float e = sin(vUv.y * 3.14159); gl_FragColor = vec4(uC * 1.8 * uA * (0.3 + e), uA); }');
    ring.position.set(pos.x, 0.12, pos.z); ring.userData.noAO = true; this.scene.add(ring);
    const w = { ring, t: 0, dur, radius };
    if (pillar) {
      const p = mk(this.pillarGeo, 'uniform vec3 uC; uniform float uA; varying vec2 vUv; void main(){ float f = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.0); gl_FragColor = vec4(uC * 0.75 * f * uA, 1.0); }');
      p.position.set(pos.x, 0, pos.z); p.userData.noAO = true; this.scene.add(p); w.pillar = p;
    }
    this.list.push(w);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i]; w.t += dt / w.dur; const t = Math.min(1, w.t), e = 1 - Math.pow(1 - t, 3);
      w.ring.scale.set(0.5 + e * w.radius, 1, 0.5 + e * w.radius); w.ring.material.uniforms.uA.value = (1 - t) * (1 - t);
      if (w.pillar) { w.pillar.scale.set(0.6 + e * 1.8, 6 + e * 20, 0.6 + e * 1.8); w.pillar.material.uniforms.uA.value = (1 - t) * (1 - t) * 0.8; }
      if (w.t >= 1) { for (const m of [w.ring, w.pillar]) if (m) { this.scene.remove(m); m.material.dispose(); } this.list.splice(i, 1); }
    }
  }
}

// ------------------------------------------------------- performance governor
export class Governor {
  /** steps: [{name, apply()}] applied in order while fps < minFps for `window` seconds. */
  constructor(steps, { minFps = 30, window = 3, warmup = 4 } = {}) { this.steps = steps; this.minFps = minFps; this.win = window; this.t = -warmup; this.acc = 0; this.n = 0; this.applied = []; }
  tick(dt, active) {
    if (!active || !this.steps.length) { return; }
    this.t += dt; if (this.t < 0) return;
    this.acc += dt; this.n++;
    if (this.t >= this.win) {
      const fps = this.n / this.acc;
      if (fps < this.minFps) { const s = this.steps.shift(); s.apply(); this.applied.push(s.name); console.info(`[quality] fps ${fps.toFixed(0)} < ${this.minFps}: ${s.name}`); this.t = -1.5; }
      else this.t = 0;
      this.acc = 0; this.n = 0;
    }
  }
}

// ------------------------------------------------------- snow kick-up puffs (footsteps, landings)
export class SnowPuffs {
  constructor(scene, max = 400) {
    this.max = max; this.i = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.ml = new Float32Array(max).fill(1); this.sz = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.aA = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage); g.setAttribute('aA', this.aA);
    this.aS = new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage); g.setAttribute('aS', this.aS);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uPx: { value: 600 } },
      vertexShader: 'attribute float aA, aS; uniform float uPx; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aS * uPx / max(0.5, -mv.z); }',
      fragmentShader: 'varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vec3(0.86, 0.9, 1.0), vA * (1.0 - r) * 0.75); }' });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.userData.noAO = true; scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, size) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.life[i] = life; this.ml[i] = life; this.sz[i] = size;
  }
  kick(x, y, z, dirX, dirZ, n = 6, k = 1) { // small spray thrown back from a planted boot
    for (let j = 0; j < n; j++) this.spawn(x + (Math.random() - 0.5) * 0.12, y, z + (Math.random() - 0.5) * 0.12,
      -dirX * (0.4 + Math.random() * 0.9) * k + (Math.random() - 0.5) * 0.5, (0.5 + Math.random() * 0.9) * k, -dirZ * (0.4 + Math.random() * 0.9) * k + (Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.3, 0.05 + Math.random() * 0.05);
  }
  ring(x, y, z, k = 0.5, n = 20) { // landing puff
    for (let j = 0; j < n; j++) { const a = j / n * 6.283 + Math.random() * 0.3, sp = (1.2 + Math.random() * 1.6) * (0.6 + k);
      this.spawn(x + Math.cos(a) * 0.25, y, z + Math.sin(a) * 0.25, Math.cos(a) * sp, 0.4 + Math.random() * 1.2 * k, Math.sin(a) * sp, 0.5 + Math.random() * 0.4, 0.08 + Math.random() * 0.08); }
  }
  update(dt, pxScale) {
    if (pxScale) this.points.material.uniforms.uPx.value = pxScale;
    const a = this.aA.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { a[i] = 0; continue; }
      this.life[i] -= dt; const o = i * 3;
      this.v[o + 1] -= 4.5 * dt; const dr = Math.exp(-2.5 * dt); this.v[o] *= dr; this.v[o + 2] *= dr;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      const t = this.life[i] / this.ml[i]; a[i] = Math.max(0, t) * Math.min(1, (1 - t) * 6); this.sz[i] *= 1 + dt * 1.2;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.aA.needsUpdate = true; this.aS.needsUpdate = true;
  }
}
