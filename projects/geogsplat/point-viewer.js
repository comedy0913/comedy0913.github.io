const subtract = (left, right) => left.map((value, index) => value - right[index]);
const add = (left, right) => left.map((value, index) => value + right[index]);
const scale = (vector, factor) => vector.map(value => value * factor);
const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const cross = (left, right) => [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
const length = vector => Math.hypot(...vector);
const normalize = vector => scale(vector, 1 / Math.max(length(vector), 1e-8));
const rotate = (vector, axis, angle) => add(add(scale(vector, Math.cos(angle)), scale(cross(axis, vector), Math.sin(angle))), scale(axis, dot(axis, vector) * (1 - Math.cos(angle))));

function lookAt(eye, target, up) {
  const backward = normalize(subtract(eye, target));
  const right = normalize(cross(up, backward));
  const vertical = cross(backward, right);
  return new Float32Array([right[0], vertical[0], backward[0], 0, right[1], vertical[1], backward[1], 0, right[2], vertical[2], backward[2], 0, -dot(right, eye), -dot(vertical, eye), -dot(backward, eye), 1]);
}

function perspective(aspect, near, far) {
  const focal = 1 / Math.tan(52 * Math.PI / 360);
  return new Float32Array([focal / aspect, 0, 0, 0, 0, focal, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
}

export function parseCloud(buffer) {
  const header = new DataView(buffer);
  if (buffer.byteLength < 16 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'GSP1' || header.getUint32(8, true) !== 1) throw new Error('Unsupported point-cloud file');
  const count = header.getUint32(4, true);
  if (!count || count > 2_000_000 || buffer.byteLength !== 16 + count * 15) throw new Error('Invalid point-cloud length');
  return { count, positions: new Float32Array(buffer, 16, count * 3), colors: new Uint8Array(buffer, 16 + count * 12, count * 3) };
}

export class PointViewer {
  constructor(canvas, onError) {
    this.canvas = canvas;
    this.onError = onError;
    this.pointSize = 3;
    this.span = 1;
    this.count = 0;
    this.visible = true;
    this.dirty = true;
    this.autoRotate = false;
    this.pointers = new Map();
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'low-power' });
    if (!this.gl) throw new Error('WebGL is unavailable. A static preview is shown instead.');
    this.initializeProgram();
    this.bindControls();
    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; this.dirty = true; });
    this.intersectionObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.onError('The 3D context was interrupted. Static preview shown; reload to resume.'); });
    canvas.addEventListener('webglcontextrestored', () => { this.initializeProgram(); if (this.cloud) this.upload(this.cloud); this.dirty = true; });
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  initializeProgram() {
    const gl = this.gl;
    const createShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertex = createShader(gl.VERTEX_SHADER, `
      attribute vec3 a_position;
      attribute vec3 a_color;
      uniform mat4 u_view;
      uniform mat4 u_projection;
      uniform float u_size;
      varying vec3 v_color;
      void main() {
        gl_Position = u_projection * u_view * vec4(a_position, 1.0);
        gl_PointSize = u_size;
        v_color = a_color;
      }
    `);
    const fragment = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 v_color;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        float opacity = 1.0 - smoothstep(0.36, 0.5, radius);
        gl_FragColor = vec4(v_color, opacity);
      }
    `);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.positionAttribute = gl.getAttribLocation(this.program, 'a_position');
    this.colorAttribute = gl.getAttribLocation(this.program, 'a_color');
    this.viewUniform = gl.getUniformLocation(this.program, 'u_view');
    this.projectionUniform = gl.getUniformLocation(this.program, 'u_projection');
    this.sizeUniform = gl.getUniformLocation(this.program, 'u_size');
    this.maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.positionBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(12 / 255, 20 / 255, 30 / 255, 1);
  }

  upload(cloud) {
    this.cloud = cloud;
    this.count = cloud.count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.colors, gl.STATIC_DRAW);
    this.dirty = true;
    if (this.eye && this.canvas.clientHeight > 0) this.draw();
  }

  setCamera(camera, span) {
    this.eye = [...camera.eye];
    this.target = [...camera.target];
    this.up = normalize(camera.up);
    this.span = span;
    this.dirty = true;
  }

  notifyCameraChange() {
    this.onCameraChange?.({ eye: [...this.eye], target: [...this.target], up: [...this.up] }, this.span);
  }

  orbit(horizontal, vertical) {
    if (!this.eye) return;
    let offset = subtract(this.eye, this.target);
    offset = rotate(offset, this.up, horizontal);
    const right = normalize(cross(this.up, offset));
    const tilted = rotate(offset, right, vertical);
    if (Math.abs(dot(normalize(tilted), this.up)) < 0.985) offset = tilted;
    this.eye = add(this.target, offset);
    this.dirty = true;
    this.notifyCameraChange();
  }

  zoom(delta) {
    if (!this.eye) return;
    const offset = subtract(this.eye, this.target);
    const distance = Math.max(this.span * 0.015, Math.min(this.span * 12, length(offset) * Math.exp(delta * 0.001)));
    this.eye = add(this.target, scale(normalize(offset), distance));
    this.dirty = true;
    this.notifyCameraChange();
  }

  pan(horizontal, vertical) {
    if (!this.eye) return;
    const backward = normalize(subtract(this.eye, this.target));
    const right = normalize(cross(this.up, backward));
    const verticalAxis = cross(backward, right);
    const units = length(subtract(this.eye, this.target)) / Math.max(this.canvas.clientHeight, 1);
    const movement = scale(add(scale(right, -horizontal), scale(verticalAxis, vertical)), units);
    this.eye = add(this.eye, movement);
    this.target = add(this.target, movement);
    this.dirty = true;
    this.notifyCameraChange();
  }

  bindControls() {
    const canvas = this.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
      this.pinchDistance = null;
      this.autoRotate = false;
      canvas.dispatchEvent(new CustomEvent('manualorbit'));
    });
    canvas.addEventListener('pointermove', event => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (this.pointers.size > 1) {
        const positions = [...this.pointers.values()];
        const distance = Math.hypot(positions[0][0] - positions[1][0], positions[0][1] - positions[1][1]);
        if (this.pinchDistance) this.zoom((this.pinchDistance - distance) * 5);
        this.pinchDistance = distance;
        return;
      }
      const horizontal = event.clientX - previous[0];
      const vertical = event.clientY - previous[1];
      if (event.shiftKey || event.buttons === 2) this.pan(horizontal, vertical);
      else this.orbit(-horizontal * 0.006, -vertical * 0.006);
    });
    const release = event => { this.pointers.delete(event.pointerId); this.pinchDistance = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoom(event.deltaY); }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const keys = { ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] };
      if (keys[event.key]) { event.preventDefault(); this.orbit(...keys[event.key]); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoom(-100); }
      if (event.key === '-') { event.preventDefault(); this.zoom(100); }
    });
  }

  tick(time) {
    const elapsed = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    if (this.visible && !document.hidden) {
      if (this.autoRotate && !this.pointers.size) this.orbit(elapsed * 0.16, 0);
      if (this.dirty && this.count && this.eye && !this.gl.isContextLost()) this.draw();
    }
    this.frame = requestAnimationFrame(next => this.tick(next));
  }

  draw() {
    const gl = this.gl;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionAttribute);
    gl.vertexAttribPointer(this.positionAttribute, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(this.colorAttribute);
    gl.vertexAttribPointer(this.colorAttribute, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.uniformMatrix4fv(this.viewUniform, false, lookAt(this.eye, this.target, this.up));
    gl.uniformMatrix4fv(this.projectionUniform, false, perspective(width / height, this.span * 0.0002, this.span * 40 + length(subtract(this.eye, this.target))));
    gl.uniform1f(this.sizeUniform, Math.min(this.pointSize * ratio, this.maxPointSize));
    gl.drawArrays(gl.POINTS, 0, this.count);
    this.dirty = false;
    this.canvas.dataset.rendered = String(this.count);
  }
}
