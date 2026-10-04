// GLSL for the knowledge terrain. three.js compiles these as GLSL ES 3.0
// (varying/gl_FragColor are mapped for us), so texelFetch and fwidth are available.

export const MAX_ITEMS = 192;
export const MAX_MARKERS = 16;

export const vertexShader = /* glsl */ `
  uniform sampler2D uItems;   // row 0: x, y, weight, memoryShare · row 1: sigma, -, -, -
  uniform int uCount;
  uniform float uNorm;        // 1 / tallest peak
  uniform float uHeight;      // world-space height scale (0 = flat map)

  varying float vH;
  varying float vMem;
  varying vec2 vP;
  varying vec3 vWorld;

  void main() {
    vec2 p = position.xy;
    float h = 0.0;
    float hm = 0.0;
    for (int i = 0; i < ${MAX_ITEMS}; i++) {
      if (i >= uCount) break;
      vec4 a = texelFetch(uItems, ivec2(i, 0), 0);
      if (a.z <= 0.0005) continue;
      float s = texelFetch(uItems, ivec2(i, 1), 0).x;
      vec2 d = p - a.xy;
      float k = a.z * exp(-dot(d, d) / (2.0 * s * s));
      h += k;
      hm += k * a.w;
    }
    float hn = h * uNorm;
    vH = hn;
    vMem = h > 1e-4 ? hm / h : 0.0;
    vP = p;
    vec4 world = modelMatrix * vec4(p, hn * uHeight, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const fragmentShader = /* glsl */ `
  uniform vec3 uDoc;
  uniform vec3 uMem;
  uniform vec3 uNeutral;
  uniform vec3 uPingColor;
  uniform vec3 uFlare;
  uniform vec3 uGround;
  uniform vec3 uRaised;
  uniform float uTime;        // ambient clock (stops under reduced motion)
  uniform float uClock;       // event clock (always runs)
  uniform float uLevels;
  uniform float uSolid;       // 0 = lines only (map), 1 = shaded relief
  uniform float uFlat;        // 1 = top-down map (draws the plot grid)
  uniform float uLineW;
  uniform vec2 uExtent;
  uniform vec4 uPing;         // x, y, startClock, strength
  uniform vec3 uProbe;        // x, y, strength
  uniform vec4 uMarkers[${MAX_MARKERS}]; // x, y, type, intensity/progress

  varying float vH;
  varying float vMem;
  varying vec2 vP;
  varying vec3 vWorld;

  float iso(float f, float w) {
    float g = fwidth(f);
    float d = abs(fract(f - 0.5) - 0.5);
    return 1.0 - smoothstep(0.0, g * w, d);
  }

  float ring(float d, float r, float w) {
    float g = fwidth(d);
    return 1.0 - smoothstep(0.0, w + g, abs(d - r));
  }

  void main() {
    // ---- diverging colour: documents ↔ neutral ↔ learned memory
    vec3 tint = vMem < 0.5 ? mix(uDoc, uNeutral, vMem * 2.0) : mix(uNeutral, uMem, (vMem - 0.5) * 2.0);

    // ---- contour lines (slowly drifting so the map never looks frozen)
    float drift = uTime * 0.03;
    float f = vH * uLevels - drift;
    float strength = smoothstep(0.015, 0.85, vH);
    float minor = iso(f, uLineW) * (0.12 + 0.78 * strength);
    float major = iso(f / 4.0, uLineW * 1.35) * (0.25 + 0.6 * strength);
    float lineA = clamp(max(minor, major) * smoothstep(0.004, 0.03, vH), 0.0, 1.0);

    // ---- shaded relief (3-D modes)
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 L = normalize(vec3(-0.45, -0.35, 0.82));
    float lambert = clamp(dot(n, L), 0.0, 1.0);
    vec3 fill = mix(uGround, uRaised, 0.25 + 0.75 * lambert);
    fill += tint * 0.16 * smoothstep(0.12, 1.0, vH);

    vec3 col = fill;
    float alpha = uSolid * (0.55 + 0.4 * smoothstep(0.0, 0.25, vH));

    // map mode: a faint wash under the peaks instead of a solid fill
    float wash = 0.10 * smoothstep(0.08, 0.9, vH) * (1.0 - uSolid);
    col = mix(col, tint, wash / max(alpha + wash, 1e-3));
    alpha = max(alpha, wash);

    // lines on top
    col = mix(col, tint, lineA);
    alpha = max(alpha, lineA);

    // plot grid in the flat map
    if (uFlat > 0.01) {
      float gx = iso(vP.x * 4.0, 1.0);
      float gy = iso(vP.y * 4.0, 1.0);
      float g = max(gx, gy) * 0.07 * uFlat;
      col = mix(col, uNeutral, g / max(alpha + g, 1e-3) * (1.0 - lineA));
      alpha = max(alpha, g);
    }

    // ---- query ping: two rings sweep out from where the question lands
    if (uPing.w > 0.0) {
      float age = uClock - uPing.z;
      if (age > 0.0) {
        float d = distance(vP, uPing.xy);
        float r1 = ring(d, age * 0.85, 0.012) * (1.0 - smoothstep(0.2, 1.5, age));
        float r2 = ring(d, max(age - 0.28, 0.0) * 0.85, 0.008) * (1.0 - smoothstep(0.5, 1.8, age)) * step(0.28, age);
        float glow = exp(-d * d / 0.0035) * (0.55 - 0.35 * smoothstep(0.0, 4.0, age));
        float p = clamp(max(r1, r2) + glow, 0.0, 1.0) * uPing.w;
        col = mix(col, uPingColor, p);
        alpha = max(alpha, p);
      }
    }

    // ---- cursor probe (landing page)
    if (uProbe.z > 0.0) {
      float d = distance(vP, uProbe.xy);
      float p = (exp(-d * d / 0.012) * 0.35 + ring(d, 0.13, 0.004) * 0.65) * uProbe.z;
      col = mix(col, uPingColor, p);
      alpha = max(alpha, p);
    }

    // ---- markers
    for (int i = 0; i < ${MAX_MARKERS}; i++) {
      vec4 m = uMarkers[i];
      if (m.z < 0.5) continue;
      float d = distance(vP, m.xy);
      float a = 0.0;
      vec3 c = uNeutral;
      if (m.z < 1.5) {            // retrieved: amber ring
        a = ring(d, 0.062, 0.006) * m.w;
        c = uPingColor;
      } else if (m.z < 2.5) {     // outdated: dashed outline where the peak used to be
        float ang = atan(vP.y - m.y, vP.x - m.x);
        float dash = step(0.45, fract(ang * 3.8197));
        a = (ring(d, 0.07, 0.004) * dash + ring(d, 0.012, 0.004) * 0.6) * m.w * 0.85;
        c = uNeutral;
      } else if (m.z < 3.5) {     // hovered / selected
        a = ring(d, 0.08, 0.005) * m.w;
        c = uNeutral;
      } else {                    // ripples: progress in m.w
        float r = 0.03 + m.w * 0.26;
        a = ring(d, r, 0.01) * (1.0 - m.w);
        c = m.z < 4.5 ? uMem : m.z < 5.5 ? uFlare : m.z < 6.5 ? uDoc : uNeutral * 0.8;
      }
      col = mix(col, c, a);
      alpha = max(alpha, a);
    }

    // ---- fade the plane's edges into the page
    vec2 q = vP / uExtent;
    float edge = 1.0 - smoothstep(0.6, 1.0, length(q));
    gl_FragColor = vec4(col, alpha * edge);
  }
`;
