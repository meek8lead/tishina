import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const fxPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uUnderwater: { value: 0 },
      uDanger: { value: 0 },
      uScreenShake: { value: 0 },
      uFlash: { value: 0 },
      uTint: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uUnderwater;
      uniform float uDanger;
      uniform float uScreenShake;
      uniform float uFlash;
      uniform float uTint;
      varying vec2 vUv;

      float rand(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 uv = vUv;
        if (uUnderwater > 0.5) {
          uv.x += sin(uv.y * 45.0 + uTime * 2.0) * 0.0028;
          uv.y += cos(uv.x * 38.0 + uTime * 1.8) * 0.0028;
        }
        if (uScreenShake > 0.0) {
          uv.x += (rand(vec2(uTime, 0.1)) - 0.5) * uScreenShake * 0.05;
          uv.y += (rand(vec2(uTime, 0.5)) - 0.5) * uScreenShake * 0.05;
        }
        vec2 caDir = uv - 0.5;
        float caStrength = uUnderwater > 0.5 ? 0.0028 : 0.001;
        caStrength += uDanger * 0.006 + uScreenShake * 0.012;
        float r = texture2D(tDiffuse, uv + caDir * caStrength).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - caDir * caStrength).b;
        vec3 col = vec3(r, g, b);

        float grain = (rand(uv * uTime + 0.3) - 0.5) * 0.085;
        col += grain * (0.6 + uDanger * 1.5);

        float d = length(vUv - 0.5);
        float vig = smoothstep(0.35, 0.88, d);
        vec3 vigColor = uDanger > 0.5 ? vec3(0.32, 0.0, 0.0) : vec3(0.0);
        col = mix(col, vigColor, vig * 0.75);

        if (uDanger > 0.0) {
          float pulse = (sin(uTime * 6.0) * 0.5 + 0.5) * uDanger * 0.16;
          col.r += pulse;
        }

        col = mix(col, vec3(1.0, 0.95, 0.92), uFlash);
        col = mix(col, col * vec3(1.1, 0.85, 0.85), uTint);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  composer.addPass(fxPass);
  return { composer, fxPass };
}