import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function beep(freq = 880, durMs = 130, type = "sine", gain = 0.06) {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(ctx.destination);
  const now = ctx.currentTime;
  osc.start(now);
  osc.stop(now + durMs / 1000);
}

export function playCorrect() {
  // kleine „up“ Tonfolge
  beep(740, 100, "triangle", 0.05);
  setTimeout(() => beep(980, 120, "triangle", 0.06), 90);
}

export function playWrong() {
  // kurzes „buzz“
  beep(180, 120, "sawtooth", 0.05);
}

export function hapticOk(controller) {
  if (!controller || !controller.gamepad) return;
  const act = controller.gamepad.hapticActuators?.[0];
  if (act?.pulse) act.pulse(0.6, 90);
}
export function hapticBad(controller) {
  if (!controller || !controller.gamepad) return;
  const act = controller.gamepad.hapticActuators?.[0];
  if (act?.pulse) act.pulse(0.8, 140);
}

// Minimal-Konfetti (optional, leichtgewichtig)
export function confetti(scene, origin, ok = true) {
  const n = 40;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3 + 0] = origin.x;
    positions[i * 3 + 1] = origin.y;
    positions[i * 3 + 2] = origin.z;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ size: 0.01, color: ok ? 0x66bb6a : 0xef5350 });
  const pts = new THREE.Points(geo, mat);
  pts.userData = { t0: performance.now(), life: 600 };
  scene.add(pts);

  // einfache Animation: radial auseinander + runterfallen
  pts.onBeforeRender = () => {
    const t = performance.now() - pts.userData.t0;
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const r = Math.min(0.3, (t / 600) * 0.3);
      a[i * 3 + 0] = origin.x + Math.cos(angle) * r;
      a[i * 3 + 2] = origin.z + Math.sin(angle) * r;
      a[i * 3 + 1] = origin.y + Math.max(0, 0.12 - (t / 600) * 0.18);
    }
    geo.attributes.position.needsUpdate = true;
    if (t > pts.userData.life) {
      scene.remove(pts);
      pts.geometry.dispose();
      pts.material.dispose();
    }
  };
}
