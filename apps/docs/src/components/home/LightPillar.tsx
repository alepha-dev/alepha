import type React from "react";
import { useEffect, useRef, useState } from "react";
import "./LightPillar.css";

interface LightPillarProps {
  topColor?: string;
  bottomColor?: string;
  intensity?: number;
  rotationSpeed?: number;
  interactive?: boolean;
  className?: string;
  glowAmount?: number;
  pillarWidth?: number;
  pillarHeight?: number;
  noiseIntensity?: number;
  mixBlendMode?: React.CSSProperties["mixBlendMode"];
  pillarRotation?: number;
}

// ============================================================================
// Performance Detection
// ============================================================================

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isWeakGPU(gl: WebGLRenderingContext): boolean {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return false;

  const renderer = gl
    .getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    ?.toLowerCase();
  if (!renderer) return false;

  // Known capable Intel GPUs - allow these
  const capableIntelPatterns = [
    "iris xe",        // Tiger Lake, Alder Lake - very capable
    "iris plus",      // Ice Lake - decent
    "intel arc",      // Discrete GPU - very capable
    "uhd graphics 6", // UHD 600 series (e.g., 620, 630)
    "uhd graphics 7", // UHD 700 series (e.g., 730, 770)
  ];

  if (renderer.includes("intel")) {
    // Check if it's a capable Intel GPU
    const isCapableIntel = capableIntelPatterns.some((pattern) =>
      renderer.includes(pattern),
    );
    if (isCapableIntel) {
      return false; // Allow capable Intel GPUs
    }
    // Block other Intel GPUs (HD 4000 and below, old integrated)
    return true;
  }

  // Block known weak/software GPUs
  const weakPatterns = [
    "llvmpipe",       // Software renderer
    "swiftshader",    // Software renderer
    "software",       // Generic software
    "microsoft basic",// Windows fallback
    "mali-4",         // Old Mali
    "mali-t6",        // Mali-T600 series - weak
    "adreno 3",       // Old Adreno
    "adreno 4",       // Older Adreno (4xx series)
    "powervr sgx",    // Old PowerVR
    "videocore",      // Raspberry Pi
  ];

  return weakPatterns.some((pattern) => renderer.includes(pattern));
}

// ============================================================================
// WebGL Utilities
// ============================================================================

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  // Shaders can be deleted after linking
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    Number.parseInt(result[1], 16) / 255,
    Number.parseInt(result[2], 16) / 255,
    Number.parseInt(result[3], 16) / 255,
  ];
}

// ============================================================================
// Shaders
// ============================================================================

const VERTEX_SHADER = /* glsl */ `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform vec3 uTopColor;
  uniform vec3 uBottomColor;
  uniform float uIntensity;
  uniform bool uInteractive;
  uniform float uGlowAmount;
  uniform float uPillarWidth;
  uniform float uPillarHeight;
  uniform float uNoiseIntensity;
  uniform float uPillarRotation;
  varying vec2 vUv;

  const float PI = 3.141592653589793;
  const float EPSILON = 0.001;
  const float E = 2.71828182845904523536;
  const float HALF = 0.5;

  mat2 rot(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  float noise(vec2 coord) {
    float G = E;
    vec2 r = G * sin(G * coord);
    return fract(r.x * r.y * (1.0 + coord.x));
  }

  vec3 applyWaveDeformation(vec3 pos, float timeOffset) {
    float frequency = 1.0;
    float amplitude = 1.0;
    vec3 deformed = pos;

    for (float i = 0.0; i < 4.0; i++) {
      deformed.xz *= rot(0.4);
      float phase = timeOffset * i * 2.0;
      vec3 oscillation = cos(deformed.zxy * frequency - phase);
      deformed += oscillation * amplitude;
      frequency *= 2.0;
      amplitude *= HALF;
    }
    return deformed;
  }

  float blendMin(float a, float b, float k) {
    float scaledK = k * 4.0;
    float h = max(scaledK - abs(a - b), 0.0);
    return min(a, b) - h * h * 0.25 / scaledK;
  }

  float blendMax(float a, float b, float k) {
    return -blendMin(-a, -b, k);
  }

  // tanh is not available in WebGL 1.0, implement manually
  vec3 tanhVec3(vec3 x) {
    vec3 e2x = exp(2.0 * x);
    return (e2x - 1.0) / (e2x + 1.0);
  }

  void main() {
    vec2 fragCoord = vUv * uResolution;
    vec2 uv = (fragCoord * 2.0 - uResolution) / uResolution.y;

    float rotAngle = uPillarRotation * PI / 180.0;
    uv *= rot(rotAngle);

    vec3 origin = vec3(0.0, 0.0, -10.0);
    vec3 direction = normalize(vec3(uv, 1.0));

    float maxDepth = 50.0;
    float depth = 0.1;

    mat2 rotX = rot(uTime * 0.3);
    if (uInteractive && length(uMouse) > 0.0) {
      rotX = rot(uMouse.x * PI * 2.0);
    }

    vec3 color = vec3(0.0);

    for (float i = 0.0; i < 50.0; i++) {
      vec3 pos = origin + direction * depth;
      pos.xz *= rotX;

      vec3 deformed = pos;
      deformed.y *= uPillarHeight;
      deformed = applyWaveDeformation(deformed + vec3(0.0, uTime, 0.0), uTime);

      vec2 cosinePair = cos(deformed.xz);
      float fieldDistance = length(cosinePair) - 0.2;

      float radialBound = length(pos.xz) - uPillarWidth;
      fieldDistance = blendMax(radialBound, fieldDistance, 1.0);
      fieldDistance = abs(fieldDistance) * 0.15 + 0.01;

      vec3 gradient = mix(uBottomColor, uTopColor, smoothstep(15.0, -15.0, pos.y));
      color += gradient * pow(1.0 / fieldDistance, 1.0);

      if (fieldDistance < EPSILON || depth > maxDepth) break;
      depth += fieldDistance;
    }

    float widthNormalization = uPillarWidth / 3.0;
    color = tanhVec3(color * uGlowAmount / widthNormalization);

    float rnd = noise(gl_FragCoord.xy);
    color -= rnd / 15.0 * uNoiseIntensity;

    gl_FragColor = vec4(color * uIntensity, 1.0);
  }
`;

// ============================================================================
// Uniform Locations Cache
// ============================================================================

interface Uniforms {
  uTime: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uMouse: WebGLUniformLocation | null;
  uTopColor: WebGLUniformLocation | null;
  uBottomColor: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uInteractive: WebGLUniformLocation | null;
  uGlowAmount: WebGLUniformLocation | null;
  uPillarWidth: WebGLUniformLocation | null;
  uPillarHeight: WebGLUniformLocation | null;
  uNoiseIntensity: WebGLUniformLocation | null;
  uPillarRotation: WebGLUniformLocation | null;
}

function getUniformLocations(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
): Uniforms {
  return {
    uTime: gl.getUniformLocation(program, "uTime"),
    uResolution: gl.getUniformLocation(program, "uResolution"),
    uMouse: gl.getUniformLocation(program, "uMouse"),
    uTopColor: gl.getUniformLocation(program, "uTopColor"),
    uBottomColor: gl.getUniformLocation(program, "uBottomColor"),
    uIntensity: gl.getUniformLocation(program, "uIntensity"),
    uInteractive: gl.getUniformLocation(program, "uInteractive"),
    uGlowAmount: gl.getUniformLocation(program, "uGlowAmount"),
    uPillarWidth: gl.getUniformLocation(program, "uPillarWidth"),
    uPillarHeight: gl.getUniformLocation(program, "uPillarHeight"),
    uNoiseIntensity: gl.getUniformLocation(program, "uNoiseIntensity"),
    uPillarRotation: gl.getUniformLocation(program, "uPillarRotation"),
  };
}

// ============================================================================
// Component
// ============================================================================

const LightPillar: React.FC<LightPillarProps> = ({
  topColor = "#5227FF",
  bottomColor = "#FF9FFC",
  intensity = 1.0,
  rotationSpeed = 0.3,
  interactive = false,
  className = "",
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  mixBlendMode = "screen",
  pillarRotation = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const uniformsRef = useRef<Uniforms | null>(null);
  const rafRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const timeRef = useRef(0);
  const isVisibleRef = useRef(true);
  const [webGLSupported, setWebGLSupported] = useState(true);
  const [performanceDisabled, setPerformanceDisabled] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check for reduced motion preference
    if (prefersReducedMotion()) {
      setPerformanceDisabled(true);
      return;
    }

    // Create canvas
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    container.appendChild(canvas);

    // Get WebGL context
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: true,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      console.warn("WebGL is not supported");
      setWebGLSupported(false);
      return;
    }

    // Check for weak GPU
    if (isWeakGPU(gl)) {
      setPerformanceDisabled(true);
      canvas.remove();
      return;
    }

    glRef.current = gl;

    // Create shader program
    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) {
      setWebGLSupported(false);
      return;
    }

    programRef.current = program;
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is WebGL API, not a React hook
    gl.useProgram(program);

    // Create fullscreen quad (triangle strip: 4 vertices)
    // Positions in clip space: -1 to 1
    const vertices = new Float32Array([
      -1,
      -1, // bottom-left
      1,
      -1, // bottom-right
      -1,
      1, // top-left
      1,
      1, // top-right
    ]);

    const buffer = gl.createBuffer();
    bufferRef.current = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Set up position attribute
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // Cache uniform locations
    const uniforms = getUniformLocations(gl, program);
    uniformsRef.current = uniforms;

    // Set static uniforms
    const [tr, tg, tb] = hexToRgb(topColor);
    const [br, bg, bb] = hexToRgb(bottomColor);

    gl.uniform3f(uniforms.uTopColor, tr, tg, tb);
    gl.uniform3f(uniforms.uBottomColor, br, bg, bb);
    gl.uniform1f(uniforms.uIntensity, intensity);
    gl.uniform1i(uniforms.uInteractive, interactive ? 1 : 0);
    gl.uniform1f(uniforms.uGlowAmount, glowAmount);
    gl.uniform1f(uniforms.uPillarWidth, pillarWidth);
    gl.uniform1f(uniforms.uPillarHeight, pillarHeight);
    gl.uniform1f(uniforms.uNoiseIntensity, noiseIntensity);
    gl.uniform1f(uniforms.uPillarRotation, pillarRotation);

    // Resize handler
    const updateSize = () => {
      if (!container || !gl || !canvas || !uniforms) return;

      const width = container.clientWidth;
      const height = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 1.5);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    };

    updateSize();

    // Mouse interaction (throttled)
    let mouseMoveTimeout: number | null = null;
    const handleMouseMove = (event: MouseEvent) => {
      if (!interactive) return;
      if (mouseMoveTimeout) return;

      mouseMoveTimeout = window.setTimeout(() => {
        mouseMoveTimeout = null;
      }, 16);

      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    if (interactive) {
      container.addEventListener("mousemove", handleMouseMove, {
        passive: true,
      });
    }

    // Visibility observer
    const observer = new IntersectionObserver(
      (entries) => {
        isVisibleRef.current = entries[0]?.isIntersecting ?? false;
      },
      { threshold: 0.1 },
    );
    observer.observe(container);

    // Animation loop (30 FPS target)
    let lastTime = performance.now();
    const frameTime = 1000 / 30;

    const animate = (currentTime: number) => {
      rafRef.current = requestAnimationFrame(animate);

      if (!isVisibleRef.current || !gl || !uniforms) return;

      const deltaTime = currentTime - lastTime;
      if (deltaTime < frameTime) return;

      timeRef.current += 0.033 * rotationSpeed;

      gl.uniform1f(uniforms.uTime, timeRef.current);
      gl.uniform2f(uniforms.uMouse, mouseRef.current.x, mouseRef.current.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      lastTime = currentTime - (deltaTime % frameTime);
    };

    rafRef.current = requestAnimationFrame(animate);

    // Debounced resize
    let resizeTimeout: number | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(updateSize, 150);
    };

    window.addEventListener("resize", handleResize, { passive: true });

    // Cleanup
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);

      if (interactive) {
        container.removeEventListener("mousemove", handleMouseMove);
      }

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      if (gl) {
        if (bufferRef.current) gl.deleteBuffer(bufferRef.current);
        if (programRef.current) gl.deleteProgram(programRef.current);

        // Force context loss to free GPU resources
        const loseContext = gl.getExtension("WEBGL_lose_context");
        loseContext?.loseContext();
      }

      if (canvasRef.current && container.contains(canvasRef.current)) {
        container.removeChild(canvasRef.current);
      }

      canvasRef.current = null;
      glRef.current = null;
      programRef.current = null;
      bufferRef.current = null;
      uniformsRef.current = null;
    };
  }, [
    topColor,
    bottomColor,
    intensity,
    rotationSpeed,
    interactive,
    glowAmount,
    pillarWidth,
    pillarHeight,
    noiseIntensity,
    pillarRotation,
  ]);

  if (!webGLSupported || performanceDisabled) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`light-pillar-container ${className}`}
      style={{ mixBlendMode }}
    />
  );
};

export default LightPillar;
