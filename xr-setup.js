// xr-setup.js
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// --------- Defaults for XR session features ---------
const DEFAULT_FEATURES = {
  requiredFeatures: ["local-floor", "hit-test"],
  optionalFeatures: ["hand-tracking", "layers", "dom-overlay"]
};

// --------- Basic Three.js helpers ----------
export function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();

  // soft ambient
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0.5, 1, 0.4);
  scene.add(dir);

  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  return camera;
}

// --------- AR Button (UI only; requests session on click) ----------
export async function addARButton(renderer, features) {
  const opts = normalizeFeatures(features);

  const btn = document.createElement("button");
  btn.style.position = "absolute";
  btn.style.bottom = "20px";
  btn.style.left = "50%";
  btn.style.transform = "translateX(-50%)";
  btn.style.padding = "12px 16px";
  btn.style.font = "600 14px system-ui, Segoe UI, Arial";
  btn.style.background = "#0b1320";
  btn.style.color = "#e3f2fd";
  btn.style.border = "1px solid #90caf9";
  btn.style.borderRadius = "10px";
  btn.style.cursor = "pointer";
  btn.style.zIndex = "999";
  btn.textContent = "Enter AR";

  if (!navigator.xr) {
    btn.textContent = "WebXR not available";
    btn.disabled = true;
    document.body.appendChild(btn);
    return;
  }

  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    supported = false;
  }

  if (!supported) {
    btn.textContent = "AR not supported";
    btn.disabled = true;
    document.body.appendChild(btn);
    return;
  }

  btn.addEventListener("click", async () => {
    try {
      const session = await navigator.xr.requestSession("immersive-ar", opts);
      await renderer.xr.setSession(session);
      btn.style.display = "none";
    } catch (e) {
      console.error("requestSession failed:", e);
      btn.textContent = "AR permission denied";
      btn.disabled = false;
    }
  });

  document.body.appendChild(btn);
}

// Normalize and guard feature object
function normalizeFeatures(features) {
  const f = features && typeof features === "object" ? features : {};
  const required = Array.isArray(f.requiredFeatures) ? f.requiredFeatures.slice() : DEFAULT_FEATURES.requiredFeatures.slice();
  const optional = Array.isArray(f.optionalFeatures) ? f.optionalFeatures.slice() : DEFAULT_FEATURES.optionalFeatures.slice();

  // Deduplicate and keep strings only
  const dedup = (arr) => Array.from(new Set(arr.filter(x => typeof x === "string" && x.length)));
  return { requiredFeatures: dedup(required), optionalFeatures: dedup(optional) };
}

// --------- Session / Reference space ----------
export async function setupXRSession(renderer, features) {
  // If session already started via button, nothing to do.
  if (renderer.xr.getSession && renderer.xr.getSession()) return;

  if (!navigator.xr) return; // can't auto-start without WebXR

  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    supported = false;
  }
  if (!supported) return;

  // Try to start without UI as fallback (some browsers require user gesture; may fail silently)
  const opts = normalizeFeatures(features);
  try {
    const session = await navigator.xr.requestSession("immersive-ar", opts);
    await renderer.xr.setSession(session);
  } catch (e) {
    // ignore; user can still click the button
    console.warn("setupXRSession fallback request failed (likely no user gesture):", e);
  }
}

export async function getLocalReferenceSpace(renderer) {
  const session = renderer.xr.getSession ? renderer.xr.getSession() : null;
  if (!session) return null;

  // If three.js already has a reference space, return it
  if (renderer.xr.getReferenceSpace) {
    const rs = renderer.xr.getReferenceSpace();
    if (rs) return rs;
  }

  // Else request one
  try {
    const ref = await session.requestReferenceSpace("local-floor");
    return ref;
  } catch {
    try {
      return await session.requestReferenceSpace("local");
    } catch (e) {
      console.warn("requestReferenceSpace failed:", e);
      return null;
    }
  }
}

// --------- Hit-test ----------
export async function createHitTestSource(renderer, referenceSpace) {
  const session = renderer.xr.getSession ? renderer.xr.getSession() : null;
  if (!session) throw new Error("No XRSession");

  if (!("requestHitTestSource" in session) && !("requestHitTestSourceForTransientInput" in session)) {
    // WebXR Hit Test API polyfill may expose via XRFrame.getHitTestResults etc.
    // We create viewer-space source instead if supported.
    let viewer;
    try {
      viewer = await session.requestReferenceSpace("viewer");
    } catch (e) {
      console.warn("viewer reference space not available", e);
      return null;
    }

    if (!session.requestHitTestSource) {
      console.warn("HitTestSource not supported on this session.");
      return null;
    }

    return await session.requestHitTestSource({ space: viewer });
  }

  // Preferred: viewer space hit-test source
  let viewerSpace = null;
  try {
    viewerSpace = await session.requestReferenceSpace("viewer");
  } catch (e) {
    console.warn("viewer reference space not available", e);
  }

  if (viewerSpace && session.requestHitTestSource) {
    return await session.requestHitTestSource({ space: viewerSpace });
  }

  // Fallback: if only transient input supported (rare)
  return null;
}

// --------- Hands (lightweight stubs; safe to use) ----------
export function getHands(renderer, scene) {
  // Keep a simple array for compatibility; real hand meshes are not required in this app.
  return [];
}

export function detectPinch(hand) {
  // Stub: return false; app uses controllers primarily.
  return false;
}
