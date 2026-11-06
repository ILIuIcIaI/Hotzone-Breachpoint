// Materialien + Shader-Erweiterungen fuer vorberechnete Beleuchtung (Bake) und Lichtproben.
import * as THREE from 'three';

export const BAKE = { scale: { value: 0.5 } };

// Statische Welt: Attribut "bake" (Irradianz pro Vertex) wird zur indirekten Beleuchtung addiert.
export function bakeify(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBakeScale = BAKE.scale;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;\nuniform float uBakeScale;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nirradiance += vBake * uBakeScale;');
  };
  mat.customProgramCacheKey = () => 'bake';
  return mat;
}

// Dynamische Objekte: eine Uniform-Farbe (aus dem Lichtgitter gesampelt) als Umgebungslicht.
// Leicht richtungsabhaengig (von oben heller), damit Figuren plastisch wirken.
export function probeify(mat, probe) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uProbe = probe;
    sh.uniforms.uBakeScale = BAKE.scale;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uProbe;\nuniform float uBakeScale;')
      .replace('#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\n{ vec3 wn = inverseTransformDirection( geometryNormal, viewMatrix );\n' +
        'irradiance += uProbe * uBakeScale * (0.62 + 0.38 * wn.y); }');
  };
  mat.customProgramCacheKey = () => 'probe';
  return mat;
}

export function makeProbe() { return { value: new THREE.Color(0.3, 0.3, 0.3) }; }

// Weltmaterialien. Jeder Schluessel = ein Draw-Call fuer die zusammengefuehrte Geometrie.
// phys: Durchschlagwiderstand pro Meter + Effekttyp
export const PHYS = {
  concrete: { resist: 9, fx: 'dust', snd: 'concrete' },
  drywall: { resist: 2.2, fx: 'plaster', snd: 'drywall' },
  wood: { resist: 2.8, fx: 'wood', snd: 'wood' },
  metal: { resist: 7, fx: 'spark', snd: 'metal' },
  glass: { resist: 0.4, fx: 'glass', snd: 'glass' },
  fabric: { resist: 1.0, fx: 'fabric', snd: 'soft' },
  plastic: { resist: 1.8, fx: 'plastic', snd: 'plastic' },
  flesh: { resist: 2.0, fx: 'blood', snd: 'flesh' },
};

export function buildWorldMaterials(T, envMap) {
  const M = {};
  const std = (key, o) => {
    const m = new THREE.MeshStandardMaterial({
      color: o.color ?? 0xffffff, map: o.map ?? null, normalMap: o.normal ?? null,
      roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, envMap: o.env ? envMap : null, envMapIntensity: o.envI ?? 0.25,
      emissive: o.emissive ?? 0x000000, emissiveMap: o.emissiveMap ?? null, emissiveIntensity: o.emissiveI ?? 1,
      side: o.side ?? THREE.FrontSide,
    });
    if (o.normal) m.normalScale.set(o.nS ?? 1, o.nS ?? 1);
    if (!o.noBake) bakeify(m);
    M[key] = { mat: m, tex: o.tex ?? 1, phys: o.phys ?? 'concrete' };
    return m;
  };
  std('carpet_blue', { map: T.carpet.map, normal: T.carpet.normal, color: 0x56606e, rough: 1, tex: 1.2, phys: 'concrete' });
  std('carpet_red', { map: T.carpet.map, normal: T.carpet.normal, color: 0x6b4a44, rough: 1, tex: 1.2, phys: 'concrete' });
  std('carpet_grey', { map: T.carpet.map, normal: T.carpet.normal, color: 0x6b6a66, rough: 1, tex: 1.2, phys: 'concrete' });
  std('tile', { map: T.tile.map, normal: T.tile.normal, rough: 0.42, tex: 1.2, env: true, envI: 0.35, phys: 'concrete' });
  std('tile_dark', { map: T.tile.map, normal: T.tile.normal, color: 0x6f6a62, rough: 0.3, tex: 1.2, env: true, envI: 0.45, phys: 'concrete' });
  std('concrete', { map: T.concrete.map, normal: T.concrete.normal, color: 0xa29f99, rough: 0.92, tex: 3, phys: 'concrete' });
  std('concrete_floor', { map: T.concrete.map, normal: T.concrete.normal, color: 0x8c8a85, rough: 0.7, tex: 3, env: true, envI: 0.2, phys: 'concrete' });
  std('asphalt', { map: T.asphalt.map, normal: T.asphalt.normal, color: 0x9a9a9a, rough: 0.95, tex: 4, phys: 'concrete' });
  std('sidewalk', { map: T.concrete.map, normal: T.concrete.normal, color: 0x9f9c95, rough: 0.9, tex: 1.5, phys: 'concrete' });
  std('paint_white', { map: T.paint.map, normal: T.paint.normal, color: 0xd9d4c8, rough: 0.9, tex: 2, phys: 'drywall', nS: 0.6 });
  std('paint_beige', { map: T.paint.map, normal: T.paint.normal, color: 0xc9b99c, rough: 0.9, tex: 2, phys: 'drywall', nS: 0.6 });
  std('paint_blue', { map: T.paint.map, normal: T.paint.normal, color: 0x8796a3, rough: 0.9, tex: 2, phys: 'drywall', nS: 0.6 });
  std('paint_green', { map: T.paint.map, normal: T.paint.normal, color: 0x9aa58f, rough: 0.9, tex: 2, phys: 'drywall', nS: 0.6 });
  std('paint_grey', { map: T.paint.map, normal: T.paint.normal, color: 0x8f8f8c, rough: 0.9, tex: 2, phys: 'drywall', nS: 0.6 });
  std('accent_wall', { map: T.wood.map, normal: T.wood.normal, color: 0x7a5a40, rough: 0.6, tex: 2.5, phys: 'drywall' });
  std('facade', { map: T.facade.map, normal: T.facade.normal, color: 0xb2ada3, rough: 0.9, tex: 6, phys: 'concrete' });
  std('ceiling', { map: T.ceiling.map, normal: T.ceiling.normal, rough: 0.95, tex: 1.2, phys: 'drywall' });
  std('baseboard', { color: 0x3a3836, rough: 0.6, phys: 'wood' });
  std('wood', { map: T.wood.map, normal: T.wood.normal, color: 0xb08a68, rough: 0.55, tex: 1.6, phys: 'wood', env: true, envI: 0.2 });
  std('wood_dark', { map: T.wood.map, normal: T.wood.normal, color: 0x6b4e3a, rough: 0.5, tex: 1.6, phys: 'wood', env: true, envI: 0.25 });
  std('laminate', { map: T.plastic.map, color: 0xd8d4cc, rough: 0.5, tex: 1, phys: 'wood', env: true, envI: 0.2 });
  std('metal', { map: T.metal.map, normal: T.metal.normal, color: 0x9aa0a6, rough: 0.45, metal: 0.7, tex: 1, phys: 'metal', env: true, envI: 0.5 });
  std('metal_dark', { map: T.metal.map, normal: T.metal.normal, color: 0x3c4046, rough: 0.5, metal: 0.6, tex: 1, phys: 'metal', env: true, envI: 0.4 });
  std('metal_paint', { map: T.plastic.map, color: 0x8b9096, rough: 0.55, metal: 0.2, tex: 1, phys: 'metal', env: true, envI: 0.3 });
  std('fabric_blue', { map: T.fabric.map, normal: T.fabric.normal, color: 0x5d6b7c, rough: 1, tex: 0.8, phys: 'fabric' });
  std('fabric_grey', { map: T.fabric.map, normal: T.fabric.normal, color: 0x77746f, rough: 1, tex: 0.8, phys: 'fabric' });
  std('leather', { map: T.plastic.map, color: 0x24211f, rough: 0.55, tex: 1, phys: 'fabric', env: true, envI: 0.2 });
  std('plastic_black', { map: T.plastic.map, color: 0x1d1f22, rough: 0.45, tex: 1, phys: 'plastic', env: true, envI: 0.3 });
  std('plastic_white', { map: T.plastic.map, color: 0xd4d6d6, rough: 0.5, tex: 1, phys: 'plastic', env: true, envI: 0.2 });
  std('plant', { color: 0x355c2c, rough: 0.8, phys: 'fabric' });
  std('pot', { color: 0x5a4b3c, rough: 0.8, phys: 'plastic' });
  std('cardboard', { map: T.concrete.map, color: 0xa7865c, rough: 0.95, tex: 1, phys: 'fabric' });
  std('server', { map: T.server.map, emissiveMap: T.serverEmissive, emissive: 0xffffff, emissiveI: 2.2, rough: 0.5, metal: 0.3, tex: 1, phys: 'metal', noUV: true });
  std('screen', { map: T.screen, emissiveMap: T.screen, emissive: 0xffffff, emissiveI: 0.9, rough: 0.2, tex: 1, phys: 'glass', noBake: false });
  std('camscreen', { map: T.camscreen, emissiveMap: T.camscreen, emissive: 0xffffff, emissiveI: 1.0, rough: 0.2, tex: 1, phys: 'glass' });
  std('logo', { map: T.logo, rough: 0.4, tex: 1, phys: 'metal' });
  std('police', { map: T.policeText, rough: 0.4, tex: 1, phys: 'metal' });
  std('car_paint', { color: 0x1a2a44, rough: 0.3, metal: 0.4, env: true, envI: 0.6, phys: 'metal' });
  std('car_white', { color: 0xe4e6ea, rough: 0.3, metal: 0.3, env: true, envI: 0.6, phys: 'metal' });
  std('tire', { color: 0x111111, rough: 0.9, phys: 'fabric' });
  std('roof', { map: T.concrete.map, color: 0x55524d, rough: 0.95, tex: 4, phys: 'concrete' });

  // unbeleuchtete Leuchtflaechen (nicht gebacken)
  const emis = (key, color, intensity) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
    M[key] = { mat: m, tex: 1, phys: 'glass', unlit: true };
  };
  emis('lamp_on', 0xfff3dc, 1.7);
  emis('lamp_off', 0x3a3c3e, 1.0);
  emis('lamp_emergency', 0xff3a2a, 2.0);
  emis('lamp_flicker', 0xfff3dc, 1.7);
  emis('lamp_sodium', 0xffb066, 3.0);
  emis('exit_sign', 0x2bff6a, 1.6);
  emis('led_blue', 0x3d8bff, 2.5);
  const exitMat = new THREE.MeshBasicMaterial({ map: T.exit, color: new THREE.Color(1.6, 1.6, 1.6) });
  M.exit_sign = { mat: exitMat, tex: 1, phys: 'plastic', unlit: true };

  // Glas (transparent, separat gerendert)
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fb8c4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18,
    envMap, envMapIntensity: 0.9, depthWrite: false,
  });
  M.glass = { mat: glass, tex: 1, phys: 'glass', transparent: true };
  return M;
}
