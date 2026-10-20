/* ------------------------------------------------------------------
   그림판 붓 — 탐험 그림판의 '판'(열·사건·눈금)을 실제로 칠하는 쪽

   zoom.js 는 무엇을 어디에 둘지만 정하고, 칠하기는 여기의 붓에 맡긴다.
   붓은 두 가지이고 쓰는 법(rect · line · circle · text …)이 같다.

     · GL 붓(Three.js, WebGL2) — 기본. 모든 도형과 글자를 GPU 에서 한 번에 그린다.
         - 도형: 둥근 네모 하나를 인스턴스로 여러 번(둥근 모서리·그림자·점선은 셰이더가)
         - 글자: 문자열을 한 번만 글자판(텍스처)에 써 두고 다시 쓴다(밉맵 → 멀리서도 고르게)
         - 눕히기: 판은 가만히 두고 원근 카메라를 기울인다(스타워즈 오프닝 각도)
     · 2D 붓(Canvas 2D) — WebGL2 가 없을 때. 눕히기는 zoom.js 가 CSS 3D 로 판을 기울인다.

   좌표는 모두 '판 좌표'(px, 왼쪽 위가 0, 아래로 +).
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  var FAR = 1e6;

  function fontCss(f) {
    return (f.weight ? f.weight + ' ' : '') + f.px + 'px ' + f.family;
  }

  // ------------------------------------------------------------ 2D 붓

  function create2D(canvas) {
    var ctx = canvas.getContext('2d');
    var pdpr = 1;
    var W = 0;
    var H = 0;

    function roundRect(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    return {
      kind: '2d',
      /** 판 크기(눕히면 길어진다). 판이 너무 크면 해상도를 조금 낮춰 메모리를 지킨다 */
      resize: function (w, h, hv, dpr) {
        W = w; H = h;
        pdpr = Math.min(dpr, Math.sqrt(14e6 / Math.max(1, w * h)));
        canvas.width = Math.round(w * pdpr);
        canvas.height = Math.round(h * pdpr);
        canvas.style.height = h + 'px';
      },
      begin: function () {
        ctx.setTransform(pdpr, 0, 0, pdpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, W, H);
      },
      rect: function (x, y, w, h, color, alpha, r) {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        if (r) { roundRect(x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      },
      /** 그림자 진 둥근 카드 바탕 */
      card: function (x, y, w, h, r, body, shadowColor, blur, dy) {
        ctx.save();
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = blur;
        ctx.shadowOffsetY = dy;
        ctx.fillStyle = body;
        roundRect(x, y, w, h, r);
        ctx.fill();
        ctx.restore();
      },
      /** 둥근 카드의 왼쪽 색 띠 — 카드 모양으로 잘린다 */
      strip: function (x, y, w, h, r, stripW, color) {
        ctx.save();
        roundRect(x, y, w, h, r);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(x, y, stripW, h);
        ctx.restore();
      },
      line: function (x1, y1, x2, y2, color, alpha, width, dash) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        ctx.lineWidth = width || 1;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if (dash) ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
      },
      circle: function (x, y, r, color, alpha) {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      },
      text: function (str, x, y, font, color, alpha, align) {
        if (!str) return;
        ctx.font = fontCss(font);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        ctx.textAlign = align || 'left';
        ctx.fillText(str, x, y);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      },
      measure: function (str, font) {
        ctx.font = fontCss(font);
        return ctx.measureText(str).width;
      },
      clip: function (x, y, w, h) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      },
      unclip: function () { ctx.restore(); },
      end: function () {},
      resetText: function () {}
    };
  }

  // ------------------------------------------------------------ GL 붓

  var VERT = [
    'attribute vec4 aRect;',    // x, y, w, h (판 좌표)
    'attribute vec4 aColor;',   // r, g, b, a
    'attribute vec4 aParam;',   // 종류(0 도형 · 1 글자 · 2 점선), 반지름, 번짐, 점선 주기
    'attribute vec4 aClip;',    // 자르기 x0, y0, x1, y1
    'attribute vec4 aUV;',      // 글자판 u0, v0, u1, v1 / 점선은 x 가 칠하는 길이
    'varying vec2 vLocal;',
    'varying vec2 vPlane;',
    'varying vec2 vSize;',
    'varying vec2 vTex;',
    'varying vec4 vColor;',
    'varying vec4 vParam;',
    'varying vec4 vClip;',
    'varying vec4 vUV;',
    'void main() {',
    '  float m = aParam.x < 0.5 ? aParam.z + 1.5 : 0.0;',   // 번짐·가장자리 다듬기만큼 넓혀 그린다
    '  vec2 p = aRect.xy - m + position.xy * (aRect.zw + 2.0 * m);',
    '  vLocal = p - aRect.xy;',
    '  vPlane = p;',
    '  vSize = aRect.zw;',
    '  vTex = mix(aUV.xy, aUV.zw, position.xy);',
    '  vColor = aColor;',
    '  vParam = aParam;',
    '  vClip = aClip;',
    '  vUV = aUV;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D uAtlas;',
    'uniform vec2 uFade;',      // 먼 끝 흐리기: 시작 y, 길이(0 이면 안 흐림)
    'varying vec2 vLocal;',
    'varying vec2 vPlane;',
    'varying vec2 vSize;',
    'varying vec2 vTex;',
    'varying vec4 vColor;',
    'varying vec4 vParam;',
    'varying vec4 vClip;',
    'varying vec4 vUV;',
    'float sdRound(vec2 p, vec2 b, float r) {',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;',
    '}',
    'void main() {',
    '  if (vPlane.x < vClip.x || vPlane.y < vClip.y || vPlane.x > vClip.z || vPlane.y > vClip.w) discard;',
    '  float a = vColor.a;',
    '  if (vParam.x < 0.5) {',
    '    vec2 hs = vSize * 0.5;',
    '    float d = sdRound(vLocal - hs, hs, min(vParam.y, min(hs.x, hs.y)));',
    '    float aa = max(fwidth(d), 1e-4) * 0.7;',
    '    float soft = vParam.z;',
    '    a *= 1.0 - smoothstep(-aa - soft, aa + soft, d);',
    '  } else if (vParam.x < 1.5) {',
    '    a *= texture2D(uAtlas, vTex).r;',
    '  } else {',
    '    if (mod(vLocal.x, vParam.w) > vUV.x) discard;',
    '  }',
    '  if (uFade.y > 0.0) a *= clamp((vPlane.y - uFade.x) / uFade.y, 0.0, 1.0);',
    '  if (a <= 0.002) discard;',
    '  gl_FragColor = vec4(vColor.rgb * a, a);',
    '}'
  ].join('\n');

  function createGL(canvas) {
    var THREE = global.THREE;
    if (!THREE || !THREE.WebGLRenderer) return null;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, alpha: true, antialias: false, premultipliedAlpha: true,
        powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false
      });
    } catch (err) {
      console.info('[plane] WebGL 을 쓸 수 없어 2D 로 그립니다.', err && err.message);
      return null;
    }
    var gl = renderer.getContext();
    renderer.setClearColor(0x000000, 0);

    // --- 글자판(문자열 → 텍스처 한 칸). 가득 차면 비우고 다시 쓴다
    var TS = 2;   // 판 1px 당 글자판 픽셀 — 화면 배율(dpr)에 맞춘다(resize). 납작할 때 1:1 이라 또렷하고 번지지 않는다
    var PAD = 6;  // 글자 칸 안쪽 여백(글자판 픽셀)
    var GAP = 12; // 칸과 칸 사이 — 멀리서(밉맵) 볼 때 이웃 칸이 섞이지 않을 만큼
    var maxTex = renderer.capabilities.maxTextureSize || 4096;
    var AW = Math.min(4096, maxTex);
    var AH = Math.min(2048, maxTex);
    // 빈 텍스처(GPU 에만 자리를 잡는다). 글자는 칸 단위로 texSubImage2D 로 올린다
    var atlas = new THREE.DataTexture(null, AW, AH, THREE.RedFormat, THREE.UnsignedByteType);   // 한 채널(R8) — 글자 모양만
    atlas.source.dataReady = false;   // 자리만 잡고(texStorage) 내용은 올리지 않게
    atlas.flipY = false;
    atlas.generateMipmaps = true;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    atlas.needsUpdate = true;
    var scratch = document.createElement('canvas');
    var sctx = scratch.getContext('2d', { willReadFrequently: true });
    var measureCtx = document.createElement('canvas').getContext('2d');
    var glyphs = {};
    var shelves = [];
    var shelfY = 0;
    var dirty = false;

    // 가득 차면 자리만 비운다 — 새 글자는 칸 전체(투명 여백 포함)를 덮어쓰므로 옛 글자를 지울 필요가 없다
    function resetAtlas() {
      glyphs = {};
      shelves = [];
      shelfY = 0;
    }

    function glTexture() {
      var props = renderer.properties.get(atlas);
      return props && props.__webglTexture;
    }

    function glyph(str, font) {
      var css = fontCss(font);
      var key = css + '\u0000' + str;
      var g = glyphs[key];
      if (g) return g;
      measureCtx.font = css;
      var w = measureCtx.measureText(str).width;
      var asc = Math.ceil(font.px * 0.95) + 2;
      var desc = Math.ceil(font.px * 0.3) + 2;
      var cw = Math.ceil(w * TS) + PAD * 3;   // 왼쪽 여백 PAD + 오른쪽 2PAD(밉맵에서 이웃 글자가 번지지 않게)
      var ch = Math.ceil((asc + desc) * TS);
      if (cw > AW) cw = AW;
      // 높이가 맞는 줄(선반)을 찾고, 없으면 새 줄
      var shelf = null;
      for (var i = 0; i < shelves.length; i += 1) {
        var s = shelves[i];
        if (s.h >= ch && s.h <= ch * 1.3 && s.x + cw <= AW) { shelf = s; break; }
      }
      if (!shelf) {
        if (shelfY + ch > AH) { resetAtlas(); return glyph(str, font); }
        shelf = { y: shelfY, h: ch, x: 0 };
        shelves.push(shelf);
        shelfY += ch + GAP;
      }
      var sx = shelf.x;
      var sy = shelf.y;
      shelf.x += cw + GAP;

      if (scratch.width < cw || scratch.height < ch) {
        scratch.width = Math.max(scratch.width, cw);
        scratch.height = Math.max(scratch.height, ch);
      }
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.setTransform(TS, 0, 0, TS, 0, 0);
      sctx.font = css;
      sctx.fillStyle = '#fff';
      sctx.textBaseline = 'alphabetic';
      sctx.fillText(str, PAD / TS, asc);
      upload(sx, sy, cw, ch);

      g = {
        w: w, asc: asc, h: ch / TS, pw: cw / TS,
        u0: sx / AW, v0: sy / AH, u1: (sx + cw) / AW, v1: (sy + ch) / AH
      };
      glyphs[key] = g;
      return g;
    }

    var uploadQueue = [];
    // 흰 글자의 알파만 한 채널로 떼어 올린다(RGBA 의 1/4)
    function upload(x, y, w, h) {
      var rgba = sctx.getImageData(0, 0, w, h).data;
      var a = new Uint8Array(w * h);
      for (var i = 0, j = 3; i < a.length; i += 1, j += 4) a[i] = rgba[j];
      uploadQueue.push({ x: x, y: y, w: w, h: h, data: a });
      dirty = true;
    }

    function flushAtlas() {
      if (!dirty) return;
      var tex = glTexture();
      if (!tex) { renderer.initTexture(atlas); tex = glTexture(); }
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (var i = 0; i < uploadQueue.length; i += 1) {
        var u = uploadQueue[i];
        gl.texSubImage2D(gl.TEXTURE_2D, 0, u.x, u.y, u.w, u.h, gl.RED, gl.UNSIGNED_BYTE, u.data);
      }
      gl.generateMipmap(gl.TEXTURE_2D);
      uploadQueue = [];
      dirty = false;
      renderer.resetState();   // 직접 만진 GL 상태를 Three.js 가 다시 알게
    }

    // --- 도형 인스턴스
    var cap = 0;
    var n = 0;
    var A = {};
    var NAMES = ['aRect', 'aColor', 'aParam', 'aClip', 'aUV'];
    var geom = new THREE.InstancedBufferGeometry();
    var quad = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    geom.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    geom.setIndex([0, 2, 1, 2, 3, 1]);   // 판 y 는 아래로 + 라 뒤집어 그리므로, 앞면이 카메라를 보게 감는 방향도 뒤집는다

    function grow(min) {
      var next = Math.max(1024, cap * 2);
      while (next < min) next *= 2;
      NAMES.forEach(function (name) {
        var arr = new Float32Array(next * 4);
        if (A[name]) arr.set(A[name].array);
        var attr = new THREE.InstancedBufferAttribute(arr, 4);
        attr.setUsage(THREE.DynamicDrawUsage);
        A[name] = attr;
        geom.setAttribute(name, attr);
      });
      cap = next;
    }
    grow(2048);

    var material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uAtlas: { value: atlas }, uFade: { value: new THREE.Vector2(0, 0) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor
    });
    var mesh = new THREE.Mesh(geom, material);
    mesh.frustumCulled = false;
    var scene = new THREE.Scene();
    scene.add(mesh);
    var camera = new THREE.Camera();

    // --- 색 문자열 → rgba(0~1)
    var colorCache = {};
    var cctx = document.createElement('canvas').getContext('2d');
    function rgba(str) {
      var c = colorCache[str];
      if (c) return c;
      cctx.fillStyle = '#000';
      cctx.fillStyle = str;
      var v = cctx.fillStyle;   // '#rrggbb' 또는 'rgba(r, g, b, a)' 로 정리돼 나온다
      if (v.charAt(0) === '#') {
        c = [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
      } else {
        var m = v.match(/[\d.]+/g) || [0, 0, 0, 1];
        c = [m[0] / 255, m[1] / 255, m[2] / 255, m[3] == null ? 1 : Number(m[3])];
      }
      colorCache[str] = c;
      return c;
    }

    // --- 자르기(열 영역 등)
    var clipStack = [];
    var clip = [-FAR, -FAR, FAR, FAR];

    function push(x, y, w, h, color, alpha, kind, r, soft, dashP, uv, itemClip) {
      if (n >= cap) grow(n + 1);
      var c = rgba(color);
      var i4 = n * 4;
      var R = A.aRect.array, Cc = A.aColor.array, Pm = A.aParam.array, Cl = A.aClip.array, U = A.aUV.array;
      R[i4] = x; R[i4 + 1] = y; R[i4 + 2] = w; R[i4 + 3] = h;
      Cc[i4] = c[0]; Cc[i4 + 1] = c[1]; Cc[i4 + 2] = c[2]; Cc[i4 + 3] = c[3] * (alpha == null ? 1 : alpha);
      Pm[i4] = kind; Pm[i4 + 1] = r || 0; Pm[i4 + 2] = soft || 0; Pm[i4 + 3] = dashP || 1;
      var k = itemClip || clip;
      Cl[i4] = Math.max(clip[0], k[0]); Cl[i4 + 1] = Math.max(clip[1], k[1]);
      Cl[i4 + 2] = Math.min(clip[2], k[2]); Cl[i4 + 3] = Math.min(clip[3], k[3]);
      if (uv) { U[i4] = uv[0]; U[i4 + 1] = uv[1]; U[i4 + 2] = uv[2]; U[i4 + 3] = uv[3]; }
      else { U[i4] = 0; U[i4 + 1] = 0; U[i4 + 2] = 0; U[i4 + 3] = 0; }
      n += 1;
    }

    var W = 0;
    var Hv = 0;

    return {
      kind: 'gl',
      resize: function (w, h, hv, dpr) {
        W = w; Hv = hv;
        var ts = Math.min(2, Math.max(1, dpr));
        if (ts !== TS) { TS = ts; resetAtlas(); }
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, hv, false);
        canvas.style.height = '';
      },
      begin: function () { n = 0; clipStack = []; clip = [-FAR, -FAR, FAR, FAR]; },
      rect: function (x, y, w, h, color, alpha, r) {
        push(x, y, w, h, color, alpha, 0, r || 0, 0);
      },
      card: function (x, y, w, h, r, body, shadowColor, blur, dy) {
        push(x, y + dy, w, h, shadowColor, 1, 0, r, blur * 0.5);
        push(x, y, w, h, body, 1, 0, r, 0);
      },
      strip: function (x, y, w, h, r, stripW, color) {
        push(x, y, w, h, color, 1, 0, r, 0, 0, null, [x - 2, y - 2, x + stripW, y + h + 2]);
      },
      line: function (x1, y1, x2, y2, color, alpha, width, dash) {
        var lw = width || 1;
        if (y1 === y2) {
          var xa = Math.min(x1, x2);
          if (dash) push(xa, y1 - lw / 2, Math.abs(x2 - x1), lw, color, alpha, 2, 0, 0, dash[0] + dash[1], [dash[0], 0, 0, 0]);
          else push(xa, y1 - lw / 2, Math.abs(x2 - x1), lw, color, alpha, 0, 0, 0);
        } else {
          push(x1 - lw / 2, Math.min(y1, y2), lw, Math.abs(y2 - y1), color, alpha, 0, 0, 0);
        }
      },
      circle: function (x, y, r, color, alpha) {
        push(x - r, y - r, r * 2, r * 2, color, alpha, 0, r, 0);
      },
      text: function (str, x, y, font, color, alpha, align) {
        if (!str) return;
        var g = glyph(str, font);
        var left = align === 'right' ? x - g.w : (align === 'center' ? x - g.w / 2 : x);
        push(left - PAD / TS, y - g.asc, g.pw, g.h, color, alpha, 1, 0, 0, 0, [g.u0, g.v0, g.u1, g.v1]);
      },
      measure: function (str, font) {
        measureCtx.font = fontCss(font);
        return measureCtx.measureText(str).width;
      },
      clip: function (x, y, w, h) {
        clipStack.push(clip);
        clip = [Math.max(clip[0], x), Math.max(clip[1], y), Math.min(clip[2], x + w), Math.min(clip[3], y + h)];
      },
      unclip: function () { clip = clipStack.pop() || [-FAR, -FAR, FAR, FAR]; },
      /**
       * 원근 카메라로 그린다. v = { th(눕힌 각), P(원근 거리), yP(회전축의 화면 y), pivot(회전축의 판 y), fade }
       * 회전축(판의 가로선)을 중심으로 카메라를 돌린다 — CSS 의 perspective + rotateX 와 같은 그림.
       */
      end: function (v) {
        flushAtlas();
        NAMES.forEach(function (name) {
          var attr = A[name];
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, n * 4);
          attr.needsUpdate = true;
        });
        geom.instanceCount = n;

        var near = 1;
        var P = v.P;
        camera.projectionMatrix.makePerspective(
          -(W / 2) / P * near, (W / 2) / P * near,
          v.yP / P * near, -(Hv - v.yP) / P * near,
          near, FAR
        );
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        var s = Math.sin(v.th);
        var c = Math.cos(v.th);
        camera.position.set(W / 2, -v.pivot - P * s, P * c);
        camera.rotation.set(v.th, 0, 0);
        camera.updateMatrixWorld(true);
        material.uniforms.uFade.value.set(v.fade ? v.fade[0] : 0, v.fade ? v.fade[1] : 0);
        renderer.render(scene, camera);
      },
      /** 글꼴이 늦게 도착했을 때 — 대체 글꼴로 써 둔 글자를 버린다 */
      resetText: function () { resetAtlas(); }
    };
  }

  /**
   * 쓸 수 있는 붓을 고른다 — WebGL2(Three.js)가 되면 GL, 아니면 2D.
   * 한 캔버스에서 WebGL 을 한 번 잡으면 2D 로 바꿀 수 없으므로 여기서 한 번만 정한다.
   */
  function create(canvas, opts) {
    var want = !(opts && opts.force2d);
    var p = want ? createGL(canvas) : null;
    return p || create2D(canvas);
  }

  global.BigHistoryPlane = { create: create };
})(window);
