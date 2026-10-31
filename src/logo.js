// Optimum logo — the OFFICIAL mark (assets/brand/optimum-icon-white.svg, "Light Icon (svg)" from
// Optimum's brand-assets page, bytes unchanged). Path data is embedded verbatim; meshes are built
// from it with SVGLoader -> ShapeGeometry, so silhouette and proportions match the official file exactly.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

export const LOGO_VB = [900, 485];
export const LOGO_D = 'M657.531 485C607.578 485 559.644 469.973 518.773 441.432C498.086 427.01 474.068 419.345 449.243 419.345C424.418 419.345 402.116 426.606 382.64 440.423C341.567 469.57 293.128 484.899 242.57 484.899C192.012 484.899 113.299 458.274 67.0797 409.764C20.8609 361.355 -2.85405 297.818 0.274301 230.751C3.09991 170.844 28.2276 114.266 71.0154 71.3028C113.904 28.4404 170.416 3.22727 230.359 0.302545C234.396 0.10084 238.433 0 242.469 0C292.422 0 340.356 15.027 381.227 43.5683C401.914 57.9902 425.932 65.655 450.757 65.655C475.582 65.655 497.884 58.3936 517.36 44.5768C558.433 15.4305 606.872 0.100859 657.43 0.100859C707.988 0.100859 786.701 26.7259 832.92 75.236C879.139 123.645 902.854 187.182 899.726 254.249C896.9 314.156 871.772 370.734 828.985 413.697C786.096 456.56 729.584 481.773 669.64 484.697C665.604 484.899 661.567 485 657.531 485ZM449.344 351.471C480.022 351.471 509.59 360.85 535.021 378.601C562.873 398.065 595.67 408.352 629.779 408.352C663.888 408.352 635.33 408.352 638.155 408.15C679.026 406.133 717.676 388.887 747.042 359.539C776.307 330.191 793.564 291.565 795.481 250.619C797.6 204.731 781.454 161.263 749.868 128.184C718.281 95.104 675.695 76.8497 629.88 76.8497C584.065 76.8497 562.167 87.3383 534.112 107.206C509.691 124.452 480.93 133.63 450.757 133.63C420.079 133.63 390.511 124.25 365.08 106.5C337.228 87.0358 304.431 76.7488 270.322 76.7488C236.212 76.7488 264.771 76.7488 261.946 76.9505C221.075 78.9675 182.425 96.2133 153.059 125.561C123.794 154.91 106.537 193.536 104.62 234.482C102.501 280.37 118.647 323.838 150.233 356.917C181.82 389.997 224.405 408.251 270.221 408.251C316.036 408.251 337.934 397.763 365.989 377.895C390.41 360.649 419.171 351.471 449.344 351.471Z';

let _shapes = null, _pts = null;
function shapes() {
  if (_shapes) return _shapes;
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 485"><path d="${LOGO_D}"/></svg>`);
  _shapes = data.paths.flatMap(p => SVGLoader.createShapes(p));
  return _shapes;
}
// official units -> normalised: x in [-1,1], y up, aspect preserved (y in about [-0.539, 0.539])
const nx = x => (x - 450) / 450, ny = y => -(y - 242.5) / 450;

/** Points on the official mark outline (outer contour + inner hole), normalised as above. */
export function logoPoints(n = 128) {
  if (!_pts) {
    const s = shapes()[0];
    const outer = s.getSpacedPoints(400).map(p => ({ x: nx(p.x), y: ny(p.y) }));
    const inner = s.holes.flatMap(h => h.getSpacedPoints(300).map(p => ({ x: nx(p.x), y: ny(p.y) })));
    _pts = { outer, inner };
  }
  const no = Math.round(n * 0.57), ni = n - no, out = [];
  for (let i = 0; i < no; i++) out.push(_pts.outer[Math.floor(i / no * _pts.outer.length)]);
  for (let i = 0; i < ni; i++) out.push(_pts.inner[Math.floor(i / ni * _pts.inner.length)]);
  return out;
}
export function logoPoint(t) { const p = logoPoints(400); return p[Math.floor((((t % 1) + 1) % 1) * p.length)]; }

// Official brand colours (Optimum Brand Guidelines, MAR '26): the mark stays Alabaster/white (no recolouring);
// the neon light behind it uses the secondary palette's Azure.
export const BRAND_WHITE = 0xfffbfb, BRAND_AZURE = 0x51b1fe;

/** Inline SVG of the official mark (Alabaster fill) with an optional Azure neon glow behind it. */
export function logoSVG({ width = 100, height = 60, color = '#51B1FE', glow = true, cls = '' } = {}) {
  const id = 'lg' + width + 'x' + height;
  const f = glow ? `<defs><filter id="${id}" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="16" result="b"/><feFlood flood-color="${color}" flood-opacity="0.95"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` : '';
  return `<svg class="${cls}" viewBox="-60 -60 1020 605" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${f}<path d="${LOGO_D}" fill="#FFFBFB" ${glow ? `filter="url(#${id})"` : ''}/></svg>`;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 300; const x = c.getContext('2d');
  x.translate(256, 150); x.scale(400 / 900, 400 / 900); x.translate(-450, -242.5);
  x.filter = 'blur(26px)'; x.fillStyle = '#fff'; x.fill(new Path2D(LOGO_D));
  _glowTex = new THREE.CanvasTexture(c); return _glowTex;
}

/** Neon logo mesh in the XY plane facing +Z: exact official filled silhouette + a soft additive halo.
 *  scale = half-width in world units. (thickness kept for call compatibility; the mark's own stroke is used.) */
export function makeLogoMesh(scale = 1, thickness = 0, color = BRAND_AZURE, intensity = 1.4) {
  const g = new THREE.Group();
  const geo = new THREE.ShapeGeometry(shapes(), 24);
  geo.translate(-450, -242.5, 0); geo.scale(scale / 450, -scale / 450, 1);
  // flipping y reverses winding -> fix the index order so the face points +Z
  const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  geo.computeVertexNormals();
  const col = new THREE.Color(color);
  const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(BRAND_WHITE).multiplyScalar(intensity), side: THREE.DoubleSide, fog: false }));
  core.position.z = 0.004;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(scale * 2.56, scale * 2.56 * 300 / 512), new THREE.MeshBasicMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  core.renderOrder = 2; halo.renderOrder = 1;
  g.add(halo, core);
  g.material = core.material;
  g.userData.core = core; g.userData.halo = halo;
  return g;
}

// The mascot goggle uses the official DARK ICON (assets/brand/optimum-icon-black.svg, viewBox 900x492), path bytes unchanged.
export const ICON_BLACK_VB = [900, 492];
export const ICON_BLACK_D = 'M654.139 0.0124815C601.245 0.0124815 552.248 16.7297 512.142 45.1896C474.522 71.8798 424.21 70.6123 386.423 44.1851C343.496 14.1707 290.532 -2.47477 233.576 0.299485C107.928 6.42197 6.1577 108.424 0.278029 234.15C-6.34255 375.397 106.136 491.988 245.837 491.988C298.73 491.988 347.751 475.27 387.833 446.81C425.429 420.12 475.765 421.388 513.552 447.815C556.503 477.829 609.444 494.475 666.424 491.701C792.048 485.602 893.818 383.576 899.722 257.85C906.343 116.603 793.864 0.0124815 654.162 0.0124815H654.139ZM782.678 253.593C780.886 292.074 764.705 328.498 737.123 356.121C709.541 383.768 673.188 400.007 634.731 401.896C632.126 402.016 629.473 402.087 626.867 402.087C594.744 402.087 563.912 392.401 537.716 374.082C511.521 355.786 480.975 346.1 449.33 346.1C417.685 346.1 388.383 355.547 363.167 373.436C336.756 392.162 305.613 402.064 273.108 402.064C230.063 402.064 189.981 384.892 160.224 353.705C130.515 322.543 115.266 281.599 117.298 238.383C119.09 199.902 135.271 163.478 162.853 135.855C190.435 108.208 226.788 91.9695 265.244 90.104C267.85 89.9844 270.503 89.9127 273.108 89.9127C305.231 89.9127 336.063 99.5984 362.259 117.918C388.43 136.214 419 145.9 450.645 145.9C481.812 145.9 511.593 136.453 536.808 118.564C563.219 99.8376 594.362 89.9366 626.867 89.9366C669.913 89.9366 710.019 107.108 739.752 138.295C769.461 169.457 784.71 210.401 782.678 253.617V253.593Z';
/** Shapes (outer contour + hollow centre as a hole) of the dark icon, in SVG units (y down). */
export function iconBlackShapes() {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 492"><path d="${ICON_BLACK_D}"/></svg>`);
  return data.paths.flatMap(p => SVGLoader.createShapes(p));
}
