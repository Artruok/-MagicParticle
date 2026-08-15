/* Particle Forge — 图片转粒子生成器（中文版）
 * 素材：图片 / 文字 / 词云；景深可由真实深度图（Depth-Anything / MiDaS 等）驱动。
 * 预览：自动旋转、鼠标排斥（独立精细面板）、类苹果 3D 照片的视差倾斜、拖拽旋转、滚轮缩放。
 */
(() => {
  'use strict';

  const PRECISION = { low: 64, medium: 120, high: 180, ultra: 280, extreme: 420 };

  const state = {
    step: 'import',
    mode: 'image',
    image: null, imageName: '', imageW: 0, imageH: 0, objectURL: null,
    sourceCanvas: null,
    text: '', font: '"Microsoft YaHei", "PingFang SC", sans-serif',
    wcPalette: 'rainbow',
    depthImage: null, useDepthMap: false,
    target: 120,
    precisionKey: 'medium',
    thickness: 6,
    particles: [], cols: 0, rows: 0,
    buildProgress: 0, buildStart: 0,
    dirty: true,
    view: { yaw: 0, pitch: 0, zoom: 1, autoRotate: true, size: 2.4, depth: 0.6 },
    repel: true, repelRadius: 110, repelStrength: 46, repelGrow: 0.7,
    spatial: false, hoverScale: 1, rotSpeed: 0.004, pullback: 0.08, fps: 0, statCount: '', statDims: '',
    dragging: false, lastX: 0, lastY: 0,
    pointerInside: false, pointerX: 0, pointerY: 0,
  };

  let order = null, orderZ = null;
  let frameCount = 0, lastFpsT = 0;

  const $ = (id) => document.getElementById(id);
  const panels = { import: $('panel-import'), config: $('panel-config'), preview: $('panel-preview') };
  const steps = document.querySelectorAll('.step');
  // 顶部进度条可点击，方便任意退回/跳到已可达的步骤
  steps.forEach((li) => {
    li.style.cursor = 'pointer';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `跳到步骤：${li.querySelector('.step-cmd')?.textContent || ''}`);
    const jump = () => {
      const target = li.dataset.step;
      if (target === 'preview' && (!state.particles || !state.particles.length)) return; // 尚未生成，禁止跳预览
      goStep(target);
    };
    li.addEventListener('click', jump);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
  });
  const fileInput = $('fileInput');
  const dropzone = $('dropzone');
  const importErr = $('importErr');
  const textErr = $('textErr');
  const thumbImg = $('thumbImg');
  const thumbName = $('thumbName');
  const thumbDim = $('thumbDim');
  const precCards = document.querySelectorAll('.prec-card');
  const startBtn = $('startBtn');
  const backToImport = $('backToImport');
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const genOverlay = $('genOverlay');
  const genBar = $('genBar');
  const stageHint = $('stageHint');
  const autoRotateBtn = $('autoRotate');
  const repelToggle = $('repelToggle');
  const spatialToggle = $('spatialToggle');
  const resetTiltBtn = $('resetTilt');
  const resetViewBtn = $('resetView');
  const sizeRange = $('sizeRange'), zoomRange = $('zoomRange'), depthRange = $('depthRange');
  const sizeVal = $('sizeVal'), zoomVal = $('zoomVal'), depthVal = $('depthVal');
  const exportBtn = $('exportBtn'), reImportBtn = $('reImportBtn');
  const statLine = $('statLine');
  const rotSpeedRange = $('rotSpeedRange'), rotSpeedVal = $('rotSpeedVal');
  const pullbackRange = $('pullbackRange'), pullbackVal = $('pullbackVal');
  // 排斥面板
  const repelRadius = $('repelRadius'), repelStrength = $('repelStrength'), repelGrow = $('repelGrow');
  const repelRadiusVal = $('repelRadiusVal'), repelStrengthVal = $('repelStrengthVal'), repelGrowVal = $('repelGrowVal');
  // 词云配色
  const wcPalette = $('wcPalette'), wcCustom = $('wcCustom');
  // 深度图
  const useDepthMap = $('useDepthMap'), depthFileInput = $('depthFileInput'), depthInputRow = $('depthInputRow'), depthOptWrap = $('depthOptWrap');
  const aiPromptBox = $('aiPromptBox'), aiPromptText = $('aiPromptText');
  const customPrec = $('customPrec'), customPrecRow = $('customPrecRow'), customCountEl = $('customCount');
  const thicknessRange = $('thicknessRange'), thicknessVal = $('thicknessVal');

  // ---- 步骤切换 ----
  function goStep(step) {
    state.step = step;
    const orderMap = { import: 1, config: 2, preview: 3 };
    Object.entries(panels).forEach(([k, el]) => {
      const on = k === step;
      el.classList.toggle('is-active', on); el.hidden = !on;
    });
    steps.forEach((li) => {
      const s = li.dataset.step;
      li.classList.toggle('is-active', s === step);
      li.classList.toggle('is-done', orderMap[s] < orderMap[step]);
    });
  }

  // ---- 素材模式 ----
  const modeTabs = document.querySelectorAll('.mode-tab');
  const modePanes = document.querySelectorAll('.mode-pane');
  const fontRow = $('fontRow');
  const extrudeRow = $('extrudeRow');
  function setMode(mode) {
    state.mode = mode;
    modeTabs.forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    modePanes.forEach((p) => {
      const on = p.dataset.pane === mode;
      p.hidden = !on; p.classList.toggle('is-active', on);
    });
    fontRow.hidden = !(mode === 'text' || mode === 'wordcloud');
    extrudeRow.hidden = !(mode === 'text' || mode === 'wordcloud');
    const genActions = $('genActions');
    genActions.hidden = !(mode === 'text' || mode === 'wordcloud');
    $('textGenBtn').hidden = mode !== 'text';
    $('wcGenBtn').hidden = mode !== 'wordcloud';
  }
  modeTabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

  // ---- 文字 / 词云 输入 ----
  const textInput = $('textInput'), wcInput = $('wcInput'), fontSelect = $('fontSelect');
  textInput.addEventListener('input', () => { state.text = textInput.value; });
  wcInput.addEventListener('input', () => { state.text = wcInput.value; });
  fontSelect.addEventListener('change', () => { state.font = fontSelect.value; state.dirty = true; });

  document.querySelectorAll('.chip[data-fill]').forEach((c) => c.addEventListener('click', () => {
    textInput.value = c.dataset.fill.replace(/\\n/g, '\n');
    state.text = textInput.value; setMode('text');
  }));
  document.querySelectorAll('.chip[data-wcfill]').forEach((c) => c.addEventListener('click', () => {
    wcInput.value = c.dataset.wcfill; state.text = wcInput.value; setMode('wordcloud');
  }));

  $('textGenBtn').addEventListener('click', () => { state.text = textInput.value; proceedText(); });
  $('wcGenBtn').addEventListener('click', () => { state.text = wcInput.value; proceedText(); });

  function showTextError(msg) { textErr.textContent = msg; textErr.hidden = !msg; }
  function showError(msg) { importErr.textContent = msg; importErr.hidden = !msg; }

  function proceedText() {
    showTextError('');
    const txt = state.text.trim();
    if (!txt) { showTextError('请先输入一些文字'); return; }
    state.sourceCanvas = state.mode === 'text'
      ? renderTextCanvas(txt, state.font)
      : renderWordCloudCanvas(txt);
    enterConfig();
  }

  // ---- 渲染文字 / 词云 ----
  function renderTextCanvas(text, font) {
    const lines = text.split('\n').map((s) => s.replace(/\s+$/, '')).filter((l) => l.length);
    if (!lines.length) lines.push(' ');
    const pad = 48, baseW = 760, baseH = 760;
    const tmp = document.createElement('canvas').getContext('2d');
    let fs = 240; tmp.font = `800 ${fs}px ${font}`;
    let maxW = 0; lines.forEach((l) => { maxW = Math.max(maxW, tmp.measureText(l).width); });
    const scale = Math.min(1, (baseW - pad * 2) / (maxW || 1));
    let fs2 = fs * scale;
    fs2 = Math.min(fs2, (baseH - pad * 2) / (lines.length * 1.12));
    fs2 = Math.max(24, fs2);
    const lineH = fs2 * 1.12;
    const c = document.createElement('canvas');
    c.width = baseW; c.height = Math.round(pad * 2 + lineH * lines.length);
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = `800 ${fs2}px ${font}`;
    const startY = pad + lineH / 2;
    lines.forEach((l, i) => cx.fillText(l, baseW / 2, startY + i * lineH));
    return c;
  }

  const PALETTES = {
    neon: ['#ff2e97', '#00f0ff', '#7c4dff', '#00ff9d', '#ffe600'],
    morandi: ['#b7a99a', '#a3b1a1', '#c9b7a0', '#9aa7b1', '#c2b2c7', '#d9c5b2'],
    warm: ['#ff8a5b', '#ffd166', '#ef476f', '#f78c6b', '#ffb4a2'],
    cool: ['#4cc9f0', '#4361ee', '#7209b7', '#56cfe1', '#80ffdb'],
  };
  function wordColor(scheme, idx) {
    if (scheme === 'rainbow') return `hsl(${Math.floor(Math.random() * 360)}, 72%, 60%)`;
    if (scheme === 'custom') {
      const arr = Array.from(document.querySelectorAll('.color-input')).map((i) => i.value).filter(Boolean);
      return arr.length ? arr[idx % arr.length] : '#cc7a60';
    }
    const arr = PALETTES[scheme] || PALETTES.neon;
    return arr[idx % arr.length];
  }

  function shadeColor(col, f) {
    if (col[0] === '#') {
      const n = parseInt(col.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
    }
    if (col.startsWith('rgb(')) {
      const m = col.match(/\d+/g);
      return `rgb(${Math.round(m[0] * f)},${Math.round(m[1] * f)},${Math.round(m[2] * f)})`;
    }
    if (col.startsWith('hsl(')) {
      const m = col.match(/[\d.]+/g);
      const l = Math.max(0, Math.min(100, Math.round(parseFloat(m[2]) * f)));
      return `hsl(${m[0]},${m[1]}%,${l}%)`;
    }
    return col;
  }

  function renderWordCloudCanvas(text) {
    // Python wordcloud 风格：按词频定大小，大词优先，螺旋紧密排布，偶尔竖排
    const raw = text.split(/[\s,，、]+/).map((s) => s.trim()).filter(Boolean);
    const freq = new Map();
    raw.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
    const entries = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const W = 960, H = 720;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    const occ = new Uint8Array(W * H);
    const maxC = entries[0][1], minC = entries[entries.length - 1][1];
    const MAXF = 150, MINF = 20;
    const sizeFor = (cnt) => {
      if (maxC === minC) return (MAXF + MINF) / 2;
      const t = (Math.sqrt(cnt) - Math.sqrt(minC)) / (Math.sqrt(maxC) - Math.sqrt(minC));
      return Math.round(MINF + t * (MAXF - MINF));
    };
    entries.forEach(([word, cnt], idx) => {
      const ok = placeWord(cx, occ, W, H, word, sizeFor(cnt), wordColor(state.wcPalette, idx));
      if (!ok) {
        cx.save();
        cx.fillStyle = wordColor(state.wcPalette, idx);
        cx.font = `700 ${sizeFor(cnt)}px ${state.font}`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(word, W / 2, H / 2);
        cx.restore();
      }
    });
    return c;
  }

  function placeWord(cx, occ, W, H, word, size, color) {
    const pad = 10;
    const tc = document.createElement('canvas');
    tc.width = Math.ceil(size * word.length * 1.3) + pad * 2;
    tc.height = Math.ceil(size * 1.4) + pad * 2;
    const tctx = tc.getContext('2d');
    tctx.font = `700 ${size}px ${state.font}`;
    tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
    tctx.fillStyle = '#fff';
    tctx.fillText(word, tc.width / 2, tc.height / 2);
    const td = tctx.getImageData(0, 0, tc.width, tc.height).data;
    const px = [], py = [];
    for (let j = 0; j < tc.height; j++) {
      for (let i = 0; i < tc.width; i++) {
        if (td[(j * tc.width + i) * 4 + 3] > 128) { px.push(i - tc.width / 2); py.push(j - tc.height / 2); }
      }
    }
    if (!px.length) return false;
    const maxAttempts = 1200;
    for (let a = 0; a < maxAttempts; a++) {
      const ang = a * 0.35;
      const rad = 3 + 3.2 * ang;
      const gx = Math.round(W / 2 + rad * Math.cos(ang));
      const gy = Math.round(H / 2 + rad * Math.sin(ang));
      const rot = Math.random() < 0.22 ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : 0;
      const ca = Math.cos(rot), sa = Math.sin(rot);
      let ok = true;
      for (let k = 0; k < px.length; k++) {
        const rx = px[k] * ca - py[k] * sa, ry = px[k] * sa + py[k] * ca;
        const X = Math.round(gx + rx), Y = Math.round(gy + ry);
        if (X < 0 || Y < 0 || X >= W || Y >= H) { ok = false; break; }
        if (occ[Y * W + X]) { ok = false; break; }
      }
      if (ok) {
        for (let k = 0; k < px.length; k++) {
          const rx = px[k] * ca - py[k] * sa, ry = px[k] * sa + py[k] * ca;
          occ[Math.round(gy + ry) * W + Math.round(gx + rx)] = 1;
        }
        cx.save();
        cx.translate(gx, gy); cx.rotate(rot);
        cx.fillStyle = color;
        cx.font = `700 ${size}px ${state.font}`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(word, 0, 0);
        cx.restore();
        return true;
      }
    }
    return false;
  }

  // ---- 图片导入 ----
  const SUPPORTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml'];
  function handleFile(file) {
    if (!file) return;
    const okType = SUPPORTED.includes(file.type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
    if (!okType) { showError('不支持的格式，请选择 png / jpg / webp / gif / bmp / svg'); return; }
    showError('');
    setMode('image');
    useDepthMap.checked = false; depthInputRow.hidden = true; aiPromptBox.hidden = true; state.depthImage = null; depthFileInput.value = '';
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (state.objectURL) URL.revokeObjectURL(state.objectURL);
      state.objectURL = url; state.image = img;
      state.imageName = file.name; state.imageW = img.naturalWidth; state.imageH = img.naturalHeight;
      state.sourceCanvas = null;
      enterConfig();
    };
    img.onerror = () => showError('图片解析失败，请换一张试试');
    img.src = url;
  }

  function getSourceSize() {
    if (state.mode === 'image') return { w: state.imageW, h: state.imageH };
    if (state.sourceCanvas) return { w: state.sourceCanvas.width, h: state.sourceCanvas.height };
    return { w: 1, h: 1 };
  }
  function estimateCount(target, aspect) {
    let cols, rows;
    if (aspect >= 1) { cols = target; rows = Math.round(target / aspect); }
    else { rows = target; cols = Math.round(target * aspect); }
    return cols * rows;
  }
  function enterConfig() {
    if (state.mode === 'image') {
      thumbImg.src = state.objectURL;
      thumbName.textContent = state.imageName;
      thumbDim.textContent = `${state.imageW} × ${state.imageH} px`;
    } else {
      thumbImg.src = state.sourceCanvas.toDataURL();
      thumbName.textContent = state.mode === 'text' ? '文字粒子' : '词云粒子';
      thumbDim.textContent = `${state.sourceCanvas.width} × ${state.sourceCanvas.height} px`;
    }
    const sz = getSourceSize(); const ar = sz.w / sz.h;
    $('countLow').textContent = `~${estimateCount(PRECISION.low, ar).toLocaleString()} 粒子`;
    $('countMed').textContent = `~${estimateCount(PRECISION.medium, ar).toLocaleString()} 粒子`;
    $('countHigh').textContent = `~${estimateCount(PRECISION.high, ar).toLocaleString()} 粒子`;
    $('countUltra').textContent = `~${estimateCount(PRECISION.ultra, ar).toLocaleString()} 粒子`;
    $('countExtreme').textContent = `~${estimateCount(PRECISION.extreme, ar).toLocaleString()} 粒子`;
    selectPrecision('medium');
    // 导入普通照片后，深度图选项仍保留在精度步骤，供用户补充
    depthOptWrap.hidden = state.mode !== 'image';
    depthInputRow.hidden = !useDepthMap.checked;
    aiPromptBox.hidden = !useDepthMap.checked;
    goStep('config');
  }

  // ---- 精度选择 ----
  function selectPrecision(key) {
    state.precisionKey = key;
    precCards.forEach((c) => {
      const on = c.dataset.key === key;
      c.classList.toggle('is-selected', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (key === 'custom') {
      customPrecRow.hidden = false;
      state.target = Math.max(32, Math.min(800, parseInt(customPrec.value, 10) || 300));
      updateCustomCount();
    } else {
      customPrecRow.hidden = true;
      state.target = PRECISION[key];
    }
    startBtn.disabled = false;
  }
  function updateCustomCount() {
    const v = Math.max(32, Math.min(800, parseInt(customPrec.value, 10) || 300));
    const sz = getSourceSize(); const ar = sz.w / sz.h;
    if (customCountEl) customCountEl.textContent = `~${estimateCount(v, ar).toLocaleString()} 粒子`;
  }
  precCards.forEach((c) => {
    c.addEventListener('click', () => selectPrecision(c.dataset.key));
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPrecision(c.dataset.key); } });
  });
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  backToImport.addEventListener('click', () => goStep('import'));

  // ---- 生成粒子 ----
  function buildParticles() {
    const sz = getSourceSize();
    const aspect = sz.w / sz.h;
    let cols, rows;
    if (aspect >= 1) { cols = state.target; rows = Math.max(1, Math.round(state.target / aspect)); }
    else { rows = state.target; cols = Math.max(1, Math.round(state.target * aspect)); }

    const off = document.createElement('canvas'); off.width = cols; off.height = rows;
    const octx = off.getContext('2d', { willReadFrequently: true });

    let depthData = null;
    if (state.mode === 'image') {
      octx.drawImage(state.image, 0, 0, cols, rows);
      if (state.depthImage) {
        const dc = document.createElement('canvas'); dc.width = cols; dc.height = rows;
        const dctx = dc.getContext('2d', { willReadFrequently: true });
        dctx.drawImage(state.depthImage, 0, 0, cols, rows);
        depthData = dctx.getImageData(0, 0, cols, rows).data;
      }
    } else {
      if (!state.sourceCanvas) {
        state.sourceCanvas = state.mode === 'text'
          ? renderTextCanvas(state.text, state.font)
          : renderWordCloudCanvas(state.text);
      }
      octx.drawImage(state.sourceCanvas, 0, 0, cols, rows);
    }

    const data = octx.getImageData(0, 0, cols, rows).data;
    const halfX = (cols - 1) / 2, halfY = (rows - 1) / 2;
    const maxDim = Math.max(cols, rows);
    const s = 2 / maxDim;
    // 文字 / 词云：根据“厚度”挤出多层，形成 3D 立体体积（粒子数会随之增加）
    let layers = 1, layerStep = 0.045;
    if (state.mode !== 'image' && state.thickness > 0) {
      layers = state.thickness | 0;
      const est = cols * rows * 0.35 * layers;
      const CAP = 240000;
      if (est > CAP) layers = Math.max(2, Math.floor(CAP / (cols * rows * 0.35)));
    }

    const arr = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = (j * cols + i) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a < 16) continue;
        const u = (i - halfX) * s, v = (j - halfY) * s;
        let color, base;
        if (state.mode === 'text') {
          const hue = (u * 0.5 + 0.5) * 300;
          color = `hsl(${hue.toFixed(0)}, 78%, 62%)`;
          const wave = 0.5 + 0.4 * Math.sin(u * Math.PI * 3) * Math.cos(v * Math.PI * 2);
          base = wave - 0.5;
        } else if (state.mode === 'image' && depthData) {
          const di = idx;
          const dl = (0.299 * depthData[di] + 0.587 * depthData[di + 1] + 0.114 * depthData[di + 2]) / 255;
          color = `rgb(${r},${g},${b})`;
          base = dl - 0.5;
        } else {
          color = `rgb(${r},${g},${b})`;
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          base = lum - 0.5;
        }
        for (let li = 0; li < layers; li++) {
          const shade = li === 0 ? 1 : Math.max(0.4, 1 - li * 0.08);
          arr.push({ u, v, base: base - li * layerStep, color: shadeColor(color, shade) });
        }
      }
    }
    state.particles = arr; state.cols = cols; state.rows = rows;
    state.buildProgress = 0; state.buildStart = 0;
    const n = arr.length;
    order = new Int32Array(n); orderZ = new Float32Array(n);
    for (let k = 0; k < n; k++) order[k] = k;
    state.statCount = n.toLocaleString(); state.statDims = `${cols} × ${rows}`;
    updateStat();
  }

  startBtn.addEventListener('click', () => {
    buildParticles();
    goStep('preview');
    genOverlay.classList.remove('is-hidden');
    state.buildStart = 0; state.dirty = true;
  });

  // ---- 画布尺寸 ----
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  // ---- 渲染 ----
  function render() {
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.clearRect(0, 0, W, H);
    const parts = state.particles; const n = parts.length;
    if (!n) return;

    const cx = W / 2, cy = H / 2;
    const baseScale = Math.min(W, H) * 0.42 * state.view.zoom * state.hoverScale;
    const f = 3, camZ = 2.6;
    const yaw = state.view.yaw, pitch = state.view.pitch;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const cpitch = Math.cos(pitch), spitch = Math.sin(pitch);
    const sizeBase = state.view.size;
    const depthFactor = state.view.depth * (state.spatial ? 2.0 : 1);

    const needSort = state.view.autoRotate || state.spatial ||
      Math.abs(yaw) > 0.001 || Math.abs(pitch) > 0.001;

    let drawCount = n;
    if (state.buildProgress < 1) drawCount = Math.min(n, Math.floor(n * state.buildProgress));

    if (needSort) {
      for (let k = 0; k < n; k++) {
        const p = parts[k];
        const z1 = -p.u * syaw + p.base * depthFactor * cyaw;
        const y2 = p.v * cpitch - z1 * spitch;
        orderZ[k] = p.v * spitch + z1 * cpitch;
      }
      Array.prototype.sort.call(order, (a, b) => orderZ[b] - orderZ[a]);
    }

    const repel = state.repel && state.pointerInside;
    const mx = state.pointerX, my = state.pointerY;
    const R = state.repelRadius, R2 = R * R, strength = state.repelStrength, grow = state.repelGrow;

    for (let k = 0; k < drawCount; k++) {
      const p = parts[needSort ? order[k] : k];
      const x1 = p.u * cyaw + p.base * depthFactor * syaw;
      const z1 = -p.u * syaw + p.base * depthFactor * cyaw;
      const y2 = p.v * cpitch - z1 * spitch;
      const z2 = p.v * spitch + z1 * cpitch;
      const zCam = camZ - z2;
      const persp = f / zCam;
      let sx = cx + x1 * baseScale * persp;
      let sy = cy + y2 * baseScale * persp;
      let size = sizeBase * persp;

      if (repel) {
        const dx = sx - mx, dy = sy - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const force = (1 - d / R) * strength;
          sx += (dx / d) * force; sy += (dy / d) * force;
          size += (1 - d / R) * sizeBase * grow;
        }
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - size * 0.5, sy - size * 0.5, size, size);
    }
  }

  // ---- 状态栏（粒子数 + FPS） ----
  function updateStat() {
    if (!state.statCount) return;
    statLine.textContent = `粒子数：${state.statCount}（${state.statDims}） · ${state.fps} FPS`;
  }

  // ---- 主循环 ----
  function loop(t) {
    if (!lastFpsT) lastFpsT = t;
    frameCount++;
    if (t - lastFpsT >= 500) {
      state.fps = Math.round((frameCount * 1000) / (t - lastFpsT));
      frameCount = 0; lastFpsT = t;
      if (state.step === 'preview') updateStat();
    }
    if (state.step === 'preview') {
      if (state.buildProgress < 1) {
        if (state.buildStart === 0) state.buildStart = t;
        const dt = t - state.buildStart;
        state.buildProgress = Math.min(1, dt / 1400);
        genBar.style.width = (state.buildProgress * 100).toFixed(1) + '%';
        state.dirty = true;
        if (state.buildProgress >= 1) { genOverlay.classList.add('is-hidden'); stageHint.style.opacity = '1'; }
      }
      // 类苹果 3D 照片：光标靠近时整团朝光标一侧倾斜 + 轻微放大
      const W = canvas.width / dpr, H = canvas.height / dpr;
      if (state.spatial) {
        if (state.pointerInside && !state.dragging) {
          const tiltMax = 0.55;
          const ty = (state.pointerX / W - 0.5) * 2 * tiltMax;
          const tp = (state.pointerY / H - 0.5) * 2 * tiltMax;
          state.view.yaw += (ty - state.view.yaw) * 0.15;
          state.view.pitch += (tp - state.view.pitch) * 0.15;
          state.hoverScale += (1.06 - state.hoverScale) * 0.12;
        } else {
          state.view.yaw += (0 - state.view.yaw) * state.pullback;
          state.view.pitch += (0 - state.view.pitch) * state.pullback;
          state.hoverScale += (1 - state.hoverScale) * 0.12;
        }
        state.dirty = true;
      } else {
        state.hoverScale += (1 - state.hoverScale) * 0.12;
      }
      if (state.view.autoRotate) { state.view.yaw += state.rotSpeed; state.dirty = true; }
      if (state.dirty) { render(); state.dirty = false; }
    }
    requestAnimationFrame(loop);
  }

  // ---- 预览交互 ----
  function setView(prop, val) { state.view[prop] = val; state.dirty = true; }

  autoRotateBtn.addEventListener('click', () => {
    state.view.autoRotate = !state.view.autoRotate;
    autoRotateBtn.classList.toggle('is-on', state.view.autoRotate);
    autoRotateBtn.setAttribute('aria-pressed', String(state.view.autoRotate));
    state.dirty = true;
  });
  repelToggle.addEventListener('click', () => {
    state.repel = !state.repel;
    repelToggle.classList.toggle('is-on', state.repel);
    repelToggle.setAttribute('aria-pressed', String(state.repel));
    repelToggle.textContent = state.repel ? '开' : '关';
    state.dirty = true;
  });
  spatialToggle.addEventListener('click', () => {
    state.spatial = !state.spatial;
    spatialToggle.classList.toggle('is-on', state.spatial);
    spatialToggle.setAttribute('aria-pressed', String(state.spatial));
    if (state.spatial) {
      state.view.autoRotate = false;
      autoRotateBtn.classList.remove('is-on');
      autoRotateBtn.setAttribute('aria-pressed', 'false');
    }
    stageHint.textContent = state.spatial ? '移动鼠标倾斜 · 按住拖动旋转 · 滚轮缩放' : '拖动旋转 · 滚轮缩放';
    state.dirty = true;
  });
  resetTiltBtn.addEventListener('click', () => {
    state.spatial = false;
    spatialToggle.classList.remove('is-on');
    spatialToggle.setAttribute('aria-pressed', 'false');
    state.view.yaw = 0; state.view.pitch = 0;
    state.view.autoRotate = true;
    autoRotateBtn.classList.add('is-on');
    autoRotateBtn.setAttribute('aria-pressed', 'true');
    state.hoverScale = 1; state.dirty = true;
  });
  resetViewBtn.addEventListener('click', () => {
    setView('yaw', 0); setView('pitch', 0); setView('zoom', 1);
    zoomRange.value = '1'; zoomVal.textContent = '1.0×';
  });

  sizeRange.addEventListener('input', (e) => { const v = parseFloat(e.target.value); sizeVal.textContent = v.toFixed(1); setView('size', v); });
  zoomRange.addEventListener('input', (e) => { const v = parseFloat(e.target.value); zoomVal.textContent = v.toFixed(1) + '×'; setView('zoom', v); });
  depthRange.addEventListener('input', (e) => { const v = parseFloat(e.target.value); depthVal.textContent = v.toFixed(2); setView('depth', v); });

  // 排斥精细参数
  repelRadius.addEventListener('input', (e) => { state.repelRadius = +e.target.value; repelRadiusVal.textContent = e.target.value; state.dirty = true; });
  repelStrength.addEventListener('input', (e) => { state.repelStrength = +e.target.value; repelStrengthVal.textContent = e.target.value; state.dirty = true; });
  repelGrow.addEventListener('input', (e) => { state.repelGrow = +e.target.value; repelGrowVal.textContent = (+e.target.value).toFixed(1); state.dirty = true; });

  // 旋转速度（滑块 0–2，1.0 ≈ 原默认；实际 yaw 增量 = 值 × 0.01）
  rotSpeedRange.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state.rotSpeed = v * 0.01;
    rotSpeedVal.textContent = v.toFixed(1);
  });
  // 3D 照片拉回速度（鼠标离开后回正快慢）
  pullbackRange.addEventListener('input', (e) => {
    state.pullback = parseFloat(e.target.value);
    pullbackVal.textContent = state.pullback.toFixed(2);
  });

  // 词云配色
  wcPalette.addEventListener('change', () => { state.wcPalette = wcPalette.value; wcCustom.hidden = wcPalette.value !== 'custom'; });
  // 深度图
  useDepthMap.addEventListener('change', () => {
    const on = useDepthMap.checked;
    depthInputRow.hidden = !on;
    aiPromptBox.hidden = !on;
    if (!on) state.depthImage = null;
  });
  const AI_PROMPTS = [
    'A detailed scene with strong depth, clear foreground subject and distant background, soft volumetric lighting, cinematic composition, high detail, photorealistic --ar 3:2',
    'A misty mountain landscape, layered ridges fading into fog, vast depth, dramatic sky, ultra detailed, nature photography --ar 3:2',
    'A futuristic city street, towering buildings in foreground, glowing lights receding into distance, neon, depth, cyberpunk --ar 3:2',
    'A cozy forest path, large tree in front, smaller trees and light beams deeper back, magical atmosphere, intricate detail --ar 3:2',
    'A still life on a table, single object close, blurred room behind, studio lighting, sharp focus foreground, product render --ar 3:2',
    'An underwater scene, coral reef foreground, fish swimming into the blue distance, god rays, vivid colors, high detail --ar 3:2'
  ];
  $('aiPromptRandom').addEventListener('click', () => {
    const cur = aiPromptText.value.trim();
    let next;
    do { next = AI_PROMPTS[Math.floor(Math.random() * AI_PROMPTS.length)]; } while (next === cur && AI_PROMPTS.length > 1);
    aiPromptText.value = next;
  });
  $('aiPromptCopy').addEventListener('click', async () => {
    const btn = $('aiPromptCopy');
    try {
      await navigator.clipboard.writeText(aiPromptText.value);
      const old = btn.textContent; btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.textContent = old; }, 1400);
    } catch (e) {
      aiPromptText.select(); document.execCommand && document.execCommand('copy');
    }
  });
  depthFileInput.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => { state.depthImage = img; };
    img.onerror = () => showError('深度图解析失败');
    img.src = URL.createObjectURL(f);
  });

  // 自定义精度
  customPrec.addEventListener('input', () => {
    if (state.precisionKey === 'custom') {
      state.target = Math.max(32, Math.min(800, parseInt(customPrec.value, 10) || 300));
      updateCustomCount();
    }
  });
  // 厚度（3D 立体）：预览中改动即时重建
  thicknessRange.addEventListener('input', (e) => {
    state.thickness = +e.target.value;
    thicknessVal.textContent = e.target.value;
    if (state.step === 'preview') {
      buildParticles();
      state.buildProgress = 1;
      genOverlay.classList.add('is-hidden');
      state.dirty = true;
    }
  });

  // 指针位置
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    state.pointerX = e.clientX - rect.left; state.pointerY = e.clientY - rect.top;
    state.pointerInside = true; state.dirty = true;
  });
  canvas.addEventListener('pointerleave', () => { state.pointerInside = false; state.dirty = true; });

  // 拖拽旋转
  canvas.addEventListener('pointerdown', (e) => {
    state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
    state.lastX = e.clientX; state.lastY = e.clientY;
    state.view.yaw += dx * 0.01; state.view.pitch += dy * 0.01;
    state.view.pitch = Math.max(-1.45, Math.min(1.45, state.view.pitch));
    state.dirty = true;
  });
  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const z = Math.max(0.3, Math.min(4, state.view.zoom * Math.exp(-e.deltaY * 0.0012)));
    setView('zoom', z);
    zoomRange.value = String(z); zoomVal.textContent = z.toFixed(1) + '×';
  }, { passive: false });

  // 导出
  exportBtn.addEventListener('click', () => {
    state.dirty = true; render();
    const link = document.createElement('a');
    link.download = `particles_${state.imageName.replace(/\.[^.]+$/, '') || state.mode}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
  reImportBtn.addEventListener('click', () => {
    state.particles = []; state.buildProgress = 0;
    genOverlay.classList.remove('is-hidden');
    goStep('import'); fileInput.value = '';
  });

  // ---- 全窗口拖拽上传 ----
  const dropOverlay = $('dropOverlay');
  let dragDepth = 0;
  function isFileDrag(e) {
    return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1);
  }
  window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; dropOverlay.classList.add('is-visible'); });
  window.addEventListener('dragover', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) dropOverlay.classList.remove('is-visible'); });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return; e.preventDefault();
    dragDepth = 0; dropOverlay.classList.remove('is-visible');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });

  // ---- 启动 ----
  setMode('image');
  resize();
  requestAnimationFrame(loop);
})();
