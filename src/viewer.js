/* ============================================================================
   MeshViewer — dependency-free WebGL mesh viewer with problem overlays.
   Flat shading via screen-space derivatives (no per-face vertex duplication),
   back faces tinted so holes and inverted faces are visible at a glance.
   ============================================================================ */
var MeshViewer = (function () {
'use strict';

/* ---- tiny mat4 helpers (column-major) ---- */
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

const SHADE = `
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 L1 = normalize(vec3(0.35, 0.45, 1.0)); vec3 L2 = normalize(vec3(-0.6, -0.3, 0.4));
  float d = max(dot(n, L1), 0.0) * 0.75 + max(dot(n, L2), 0.0) * 0.25;
  vec3 Vd = normalize(-vPos); float spec = pow(max(dot(reflect(-L1, n), Vd), 0.0), 40.0) * 0.18;
  vec3 base = gl_FrontFacing ? uColor : uBack;
  vec3 c = base * (0.28 + 0.72 * d) + vec3(spec);`;
// GLSL ES 1.00 (WebGL1, derivatives via extension)
// section view: fragments on the far side of the plane dot(p, uClip.xyz) = uClip.w are cut away (uClipOn > 0.5)
const CLIP = `if (uClipOn > 0.5 && dot(vW, uClip.xyz) > uClip.w) discard;`;
const VS1 = `attribute vec3 aPos; uniform mat4 uMVP; uniform mat4 uMV; varying vec3 vPos; varying vec3 vW;
void main(){ vec4 p = uMV * vec4(aPos, 1.0); vPos = p.xyz; vW = aPos; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const FS1 = `#extension GL_OES_standard_derivatives : enable
precision highp float; varying vec3 vPos; varying vec3 vW; uniform vec3 uColor; uniform vec3 uBack; uniform float uAlpha; uniform vec4 uClip; uniform float uClipOn;
void main(){ ${CLIP} ${SHADE} gl_FragColor = vec4(c, uAlpha); }`;
const VS1_LINE = `attribute vec3 aPos; uniform mat4 uMVP; varying vec3 vW; void main(){ vW = aPos; gl_Position = uMVP * vec4(aPos, 1.0); gl_Position.z -= 0.0008 * gl_Position.w; }`;
const FS1_LINE = `precision highp float; uniform vec3 uColor; varying vec3 vW; uniform vec4 uClip; uniform float uClipOn; void main(){ ${CLIP} gl_FragColor = vec4(uColor, 1.0); }`;
// GLSL ES 3.00 (WebGL2, derivatives are core)
const VS2 = `#version 300 es
in vec3 aPos; uniform mat4 uMVP; uniform mat4 uMV; out vec3 vPos; out vec3 vW;
void main(){ vec4 p = uMV * vec4(aPos, 1.0); vPos = p.xyz; vW = aPos; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const FS2 = `#version 300 es
precision highp float; in vec3 vPos; in vec3 vW; uniform vec3 uColor; uniform vec3 uBack; uniform float uAlpha; uniform vec4 uClip; uniform float uClipOn; out vec4 fragColor;
void main(){ ${CLIP} ${SHADE} fragColor = vec4(c, uAlpha); }`;
const VS2_LINE = `#version 300 es
in vec3 aPos; uniform mat4 uMVP; out vec3 vW; void main(){ vW = aPos; gl_Position = uMVP * vec4(aPos, 1.0); gl_Position.z -= 0.0008 * gl_Position.w; }`;
const FS2_LINE = `#version 300 es
precision highp float; uniform vec3 uColor; in vec3 vW; uniform vec4 uClip; uniform float uClipOn; out vec4 fragColor; void main(){ ${CLIP} fragColor = vec4(uColor, 1.0); }`;

function create(canvas, theme) {
  const isGL2 = !!window.WebGL2RenderingContext;
  let gl = isGL2 ? canvas.getContext('webgl2', { antialias: true, alpha: true, preserveDrawingBuffer: false }) : null;
  let gl2 = !!gl;
  if (!gl) { gl = canvas.getContext('webgl', { antialias: true, alpha: true }); gl2 = false; }
  if (!gl) return null;
  if (!gl2) { gl.getExtension('OES_element_index_uint'); if (!gl.getExtension('OES_standard_derivatives')) return null; }
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); } return s; };
  const program = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
  const pBody = gl2 ? program(VS2, FS2) : program(VS1, FS1), pLine = gl2 ? program(VS2_LINE, FS2_LINE) : program(VS1_LINE, FS1_LINE);
  if (!gl.getProgramParameter(pBody, gl.LINK_STATUS) || !gl.getProgramParameter(pLine, gl.LINK_STATUS)) { console.error('shader link failed', gl.getProgramInfoLog(pBody), gl.getProgramInfoLog(pLine)); return null; }
  const U = (p, n) => gl.getUniformLocation(p, n);
  const uB = { mvp: U(pBody, 'uMVP'), mv: U(pBody, 'uMV'), color: U(pBody, 'uColor'), back: U(pBody, 'uBack'), alpha: U(pBody, 'uAlpha'), clip: U(pBody, 'uClip'), clipOn: U(pBody, 'uClipOn'), pos: gl.getAttribLocation(pBody, 'aPos') };
  const uL = { mvp: U(pLine, 'uMVP'), color: U(pLine, 'uColor'), clip: U(pLine, 'uClip'), clipOn: U(pLine, 'uClipOn'), pos: gl.getAttribLocation(pLine, 'aPos') };

  const colors = Object.assign({
    body: '#c9d1da', back: '#e2604a', inverted: '#f0a41b', fill: '#3ec46d', naked: '#ff3b2f', nonManifold: '#e23bff', degenerate: '#ffd21f', selfx: '#22c7e6', wire: '#3a4250', clear: [0, 0, 0, 0],
  }, theme || {});

  const state = {
    V: null, nv: 0, nf: 0, bbox: null,
    vbo: null, ibo: null, subsets: {}, lines: {}, wireBuf: null, wireCount: 0,
    show: { problems: true, fills: true, wire: false },
    section: { axis: -1, t: 0.5 },
    cam: { yaw: 0.6, pitch: 0.5, dist: 10, target: [0, 0, 0], radius: 1 },
    dirty: true, alive: true,
  };

  function setMesh(mesh, overlays) {
    // mesh: {V: Float64Array|Float32Array, F: Uint32Array, nv, nf}
    for (const k of Object.keys(state.subsets)) gl.deleteBuffer(state.subsets[k].buf);
    for (const k of Object.keys(state.lines)) gl.deleteBuffer(state.lines[k].buf);
    if (state.vbo) gl.deleteBuffer(state.vbo); if (state.ibo) gl.deleteBuffer(state.ibo); if (state.wireBuf) gl.deleteBuffer(state.wireBuf);
    state.subsets = {}; state.lines = {}; state.wireBuf = null; state.wireCount = 0;
    if (!mesh || !mesh.nf) { state.V = null; state.nf = 0; state.dirty = true; return; }
    const V32 = mesh.V instanceof Float32Array ? mesh.V : Float32Array.from(mesh.V.subarray ? mesh.V.subarray(0, mesh.nv * 3) : mesh.V);
    state.V = V32; state.nv = mesh.nv; state.nf = mesh.nf; state.F = mesh.F;
    state.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, state.vbo); gl.bufferData(gl.ARRAY_BUFFER, V32, gl.STATIC_DRAW);
    state.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.F.subarray ? mesh.F.subarray(0, mesh.nf * 3) : mesh.F, gl.STATIC_DRAW);
    // bbox
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.nv; i++) for (let k = 0; k < 3; k++) { const v = V32[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    state.bbox = { min: mn, max: mx };
    const ov = overlays || {};
    const faceSubset = (name, list, color) => {
      if (!list || !list.length) return;
      const idx = new Uint32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) { const f = list[i]; idx[i * 3] = mesh.F[f * 3]; idx[i * 3 + 1] = mesh.F[f * 3 + 1]; idx[i * 3 + 2] = mesh.F[f * 3 + 2]; }
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      state.subsets[name] = { buf, count: idx.length, color: hexToRgb(color) };
    };
    const edgeSet = (name, pairs, color) => {
      if (!pairs || !pairs.length) return;
      const pos = new Float32Array(pairs.length * 3);
      for (let i = 0; i < pairs.length; i++) { const v = pairs[i] * 3; pos[i * 3] = V32[v]; pos[i * 3 + 1] = V32[v + 1]; pos[i * 3 + 2] = V32[v + 2]; }
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      state.lines[name] = { buf, count: pairs.length, color: hexToRgb(color) };
    };
    faceSubset('selfx', ov.selfxFaces, colors.selfx);
    faceSubset('fill', ov.fillFaces, colors.fill);
    faceSubset('inverted', ov.invertedFaces, colors.inverted);
    faceSubset('degenerate', ov.degenerateFaces, colors.degenerate);
    faceSubset('duplicate', ov.duplicateFaces, colors.degenerate);
    edgeSet('naked', ov.nakedEdges, colors.naked);
    edgeSet('nonManifold', ov.nonManifoldEdges, colors.nonManifold);
    state.dirty = true;
  }

  function buildWire() {
    if (state.wireBuf || !state.F) return;
    const F = state.F, nf = state.nf, V = state.V;
    // unique edges via hash of (lo,hi)
    const ns = nf * 3; let size = 1; while (size < ns * 2) size *= 2; const mask = size - 1;
    const table = new Int32Array(size).fill(-1); const eLo = new Uint32Array(ns), eHi = new Uint32Array(ns); let ne = 0;
    for (let s = 0; s < ns; s++) {
      const f = (s / 3) | 0, k = s % 3; const a = F[f * 3 + k], b = F[f * 3 + (k === 2 ? 0 : k + 1)];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      let h = (Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA77)) >>> 0; h &= mask;
      let found = false;
      while (true) { const t = table[h]; if (t < 0) break; if (eLo[t] === lo && eHi[t] === hi) { found = true; break; } h = (h + 1) & mask; }
      if (!found) { table[h] = ne; eLo[ne] = lo; eHi[ne] = hi; ne++; }
    }
    const pos = new Float32Array(ne * 6);
    for (let e = 0; e < ne; e++) { const a = eLo[e] * 3, b = eHi[e] * 3; pos[e * 6] = V[a]; pos[e * 6 + 1] = V[a + 1]; pos[e * 6 + 2] = V[a + 2]; pos[e * 6 + 3] = V[b]; pos[e * 6 + 4] = V[b + 1]; pos[e * 6 + 5] = V[b + 2]; }
    state.wireBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, state.wireBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW); state.wireCount = ne * 2;
  }

  function fit() {
    if (!state.bbox) return;
    const b = state.bbox; const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const r = Math.max(1e-6, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
    state.cam.target = c; state.cam.radius = r; state.cam.dist = r * 2.6; state.cam.yaw = 0.7; state.cam.pitch = 0.45; state.dirty = true;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; state.dirty = true; }
  }

  function render() {
    if (!state.alive) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    const cc = colors.clear; gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!state.vbo) return;
    const cam = state.cam;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye = [cam.target[0] + cam.dist * cp * Math.cos(cam.yaw), cam.target[1] + cam.dist * cp * Math.sin(cam.yaw), cam.target[2] + cam.dist * sp];
    const view = lookAt(eye, cam.target, [0, 0, 1]);
    const near = Math.max(cam.dist - cam.radius * 3, cam.radius * 0.01), far = cam.dist + cam.radius * 3;
    const proj = perspective(40 * Math.PI / 180, canvas.width / canvas.height, near, far);
    const mvp = mul(proj, view);
    // section plane: keep the part of the model below t along the chosen axis
    const sec = state.section, on = sec.axis >= 0 && state.bbox ? 1 : 0;
    const cn = [0, 0, 0]; let cw = 0;
    if (on) { cn[sec.axis] = 1; cw = state.bbox.min[sec.axis] + sec.t * (state.bbox.max[sec.axis] - state.bbox.min[sec.axis]); }
    const setClip = (u) => { gl.uniform4f(u.clip, cn[0], cn[1], cn[2], cw); gl.uniform1f(u.clipOn, on); };
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // body
    gl.useProgram(pBody);
    gl.uniformMatrix4fv(uB.mvp, false, mvp); gl.uniformMatrix4fv(uB.mv, false, view); setClip(uB);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.vbo); gl.enableVertexAttribArray(uB.pos); gl.vertexAttribPointer(uB.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.ibo);
    const body = hexToRgb(colors.body), back = hexToRgb(colors.back);
    gl.uniform3f(uB.color, body[0], body[1], body[2]); gl.uniform3f(uB.back, back[0], back[1], back[2]); gl.uniform1f(uB.alpha, 1.0);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.0, 1.0);
    gl.drawElements(gl.TRIANGLES, state.nf * 3, gl.UNSIGNED_INT, 0);
    // subsets
    gl.polygonOffset(-1.0, -1.0);
    const drawSub = (name) => { const s = state.subsets[name]; if (!s) return; gl.uniform3f(uB.color, s.color[0], s.color[1], s.color[2]); gl.uniform3f(uB.back, s.color[0] * 0.7, s.color[1] * 0.7, s.color[2] * 0.7); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.buf); gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, 0); };
    if (state.show.fills) drawSub('fill');
    if (state.show.problems) { drawSub('selfx'); drawSub('inverted'); drawSub('degenerate'); drawSub('duplicate'); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // lines
    gl.useProgram(pLine); gl.uniformMatrix4fv(uL.mvp, false, mvp); setClip(uL);
    if (state.show.wire) {
      buildWire();
      if (state.wireBuf) { const c = hexToRgb(colors.wire); gl.uniform3f(uL.color, c[0], c[1], c[2]); gl.bindBuffer(gl.ARRAY_BUFFER, state.wireBuf); gl.enableVertexAttribArray(uL.pos); gl.vertexAttribPointer(uL.pos, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.LINES, 0, state.wireCount); }
    }
    if (state.show.problems) {
      gl.disable(gl.DEPTH_TEST);
      for (const name of ['nonManifold', 'naked']) {
        const l = state.lines[name]; if (!l) continue;
        gl.uniform3f(uL.color, l.color[0], l.color[1], l.color[2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, l.buf); gl.enableVertexAttribArray(uL.pos); gl.vertexAttribPointer(uL.pos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, l.count);
      }
      gl.enable(gl.DEPTH_TEST);
    }
  }

  function loop() { if (!state.alive) return; if (state.dirty) { state.dirty = false; render(); } requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  /* ---- interaction ---- */
  let drag = null;
  const rect = () => canvas.getBoundingClientRect();
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey }; e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    const cam = state.cam;
    if (drag.btn === 0 && !drag.shift) { cam.yaw -= dx * 0.008; cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.008)); }
    else { // pan in view plane
      const r = rect(); const scale = cam.dist * Math.tan(20 * Math.PI / 180) * 2 / r.height;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const right = [-sy, cy, 0], up = [-sp * cy, -sp * sy, cp];
      for (let k = 0; k < 3; k++) cam.target[k] += (-dx * right[k] + dy * up[k]) * scale;
    }
    state.dirty = true;
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const f = Math.exp(Math.sign(e.deltaY) * 0.12); state.cam.dist = Math.max(state.cam.radius * 0.05, Math.min(state.cam.radius * 40, state.cam.dist * f)); state.dirty = true; }, { passive: false });
  canvas.addEventListener('dblclick', () => { fit(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // touch pinch
  let pinch = null;
  canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); } }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); state.cam.dist = Math.max(state.cam.radius * 0.05, state.cam.dist * pinch / Math.max(1, d)); pinch = d; state.dirty = true; e.preventDefault(); } }, { passive: false });
  canvas.addEventListener('touchend', () => { pinch = null; });
  if (window.ResizeObserver) new ResizeObserver(() => { state.dirty = true; }).observe(canvas);

  return {
    setMesh, fit, gl2,
    setShow(k, v) { state.show[k] = v; state.dirty = true; },
    setSection(axis, t) { state.section.axis = axis; if (t !== undefined) state.section.t = t; state.dirty = true; },
    getShow() { return Object.assign({}, state.show); },
    setColors(c) { Object.assign(colors, c); state.dirty = true; },
    redraw() { state.dirty = true; },
    destroy() { state.alive = false; },
  };
}
return { create };
})();
