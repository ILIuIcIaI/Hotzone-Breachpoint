// Nachbearbeitung: Welt + Waffenmodell, Bloom (optional), Vignette/Koerner/Schaden/Blendung, Tonemapping.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.35 }, uDamage: { value: 0 },
    uFlash: { value: 0 }, uSuppress: { value: 0 }, uLowHp: { value: 0 }, uGrain: { value: 0.035 }, uAspect: { value: 1.7 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uDamage, uFlash, uSuppress, uLowHp, uGrain, uAspect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uAspect, 1.0)) / uAspect * 1.6;
      // leichte chromatische Aberration am Rand + bei Beschuss
      float ca = 0.0012 + uSuppress * 0.004 + uDamage * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      // Entsaettigung bei wenig Leben
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(l), uLowHp * 0.6 + uSuppress * 0.15);
      // Vignette
      float v = smoothstep(0.35, 1.1, r);
      col *= 1.0 - v * (uVignette + uSuppress * 0.35 + uLowHp * 0.3);
      // Schaden: roter Rand
      col = mix(col, vec3(0.35,0.0,0.0) * (0.4 + l), clamp(v * uDamage * 1.6, 0.0, 0.85));
      // Filmkorn
      float g = h(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
      col += g * uGrain * (0.4 + 0.6 * (1.0 - l));
      // Blendgranate
      col = mix(col, vec3(4.0), uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, vmScene, vmCamera, quality) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.main = new RenderPass(scene, camera);
    this.view = new RenderPass(vmScene, vmCamera);
    this.view.clear = false; this.view.clearDepth = true;
    this.composer.addPass(this.main);
    this.composer.addPass(this.view);
    this.bloom = null;
    if (quality !== 'low') {
      const s = new THREE.Vector2(innerWidth, innerHeight);
      this.bloom = new UnrealBloomPass(s, quality === 'high' ? 0.36 : 0.3, 0.55, 1.15);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }
  setSize(w, h) { this.composer.setSize(w, h); this.grade.uniforms.uAspect.value = w / h; }
  render(dt) { this.grade.uniforms.uTime.value += dt; this.composer.render(dt); }
  get u() { return this.grade.uniforms; }
}
