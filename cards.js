import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { CONFIG } from "./config.js";

// ---------- Building blocks ----------
function makeCardMesh(w=0.16, h=0.10, text="", bg=0x243b2f) {
  const group = new THREE.Group();

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      color: bg,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  plane.name = "cardPlane";

  // Text als Canvas-Texture
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 640;
  const ctx = canvas.getContext("2d");
  const drawText = (label) => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#10241b";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = "#9ad1b1"; ctx.lineWidth = 12;
    ctx.strokeRect(8,8,canvas.width-16,canvas.height-16);
    ctx.fillStyle = "#e8ffe6";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let fs = 190;
    ctx.font = `800 ${fs}px system-ui, Segoe UI, Arial`;
    while (ctx.measureText(label).width > canvas.width*0.86 && fs>60) {
      fs--; ctx.font = `800 ${fs}px system-ui, Segoe UI, Arial`;
    }
    ctx.fillText(label, canvas.width/2, canvas.height/2);
  };
  drawText(text);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;

  const txt = new THREE.Mesh(
    new THREE.PlaneGeometry(w*0.98, h*0.98),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  txt.position.set(0, 0, 0.001);

  group.add(plane, txt);
  group.userData.canvas = canvas;
  group.userData.tex = tex;
  group.userData.drawText = drawText;

  // Meta
  group.userData.label = text;

  return group;
}

function makeHintMesh(w=0.18, h=0.14, hint="", de="") {
  const group = new THREE.Group();

  const canvas = document.createElement("canvas");
  canvas.width = 1400; canvas.height = 900;
  const ctx = canvas.getContext("2d");

  const draw = (hintSym, deText) => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#0b1320"; ctx.globalAlpha = 0.96;
    ctx.fillRect(0,0,canvas.width,canvas.height); ctx.globalAlpha = 1.0;
    ctx.strokeStyle = "#90caf9"; ctx.lineWidth = 12;
    ctx.strokeRect(8,8,canvas.width-16,canvas.height-16);

    // Symbol (Emoji) groß
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#e3f2fd";
    let fs1 = 420; ctx.font = `${fs1}px Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, system-ui`;
    // Kein Auto-Shrink hier – Emojis passen in der Regel
    ctx.fillText(hintSym || "", canvas.width/2, canvas.height*0.40);

    // Deutsches Wort
    ctx.fillStyle = "#bbdefb";
    let fs2 = 180; ctx.font = `800 ${fs2}px system-ui, Segoe UI, Arial`;
    const line = deText || "";
    while (ctx.measureText(line).width > canvas.width*0.9 && fs2>70) {
      fs2--; ctx.font = `800 ${fs2}px system-ui, Segoe UI, Arial`;
    }
    ctx.fillText(line, canvas.width/2, canvas.height*0.78);
  };
  draw(hint, de);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  group.add(plane);
  group.userData.canvas = canvas;
  group.userData.tex = tex;
  group.userData.draw = draw;

  return group;
}

// ---------- Public API ----------
export function makeAnswerCards(labels) {
  const g = new THREE.Group();
  labels.forEach(lbl => {
    const m = makeCardMesh(CONFIG.cards?.answer?.w ?? 0.18, CONFIG.cards?.answer?.h ?? 0.11, lbl);
    g.add(m);
  });
  return g;
}

export function makeImageCard({ hint, de }) {
  const w = CONFIG.cards?.prompt?.w ?? 0.22;
  const h = CONFIG.cards?.prompt?.h ?? 0.16;
  return makeHintMesh(w, h, hint || "", de || "");
}

// Hover-Effekt (sanft)
export function updateHoverEffect(hits) {
  const hitSet = new Set(hits.map(h => h.object));
  return (answersGroup) => {
    answersGroup.children.forEach(card => {
      const plane = card.getObjectByName("cardPlane");
      if (hitSet.has(card)) {
        plane.material.color.set(0x356b52);
      } else {
        plane.material.color.set(0x243b2f);
      }
    });
  };
}

// Feedback Blinken
export function flashFeedback(card, ok, ms=380) {
  const plane = card.getObjectByName("cardPlane");
  const orig = plane.material.color.getHex();
  plane.material.color.set(ok ? 0x2e7d32 : 0xb71c1c);
  setTimeout(()=> plane.material.color.set(orig), ms);
}

// LAYOUT in lokalen Tisch-Koordinaten
export function layoutQuestionAdaptive(tableLocalGroup, tbounds, imageCard, answersGroup) {
  if (!tableLocalGroup || !tbounds) return;
  const W = tbounds.size.x;
  const H = tbounds.size.y;
  const y = 0.002; // knapp über der Platte (lokal)
  const flatCardRotation = new THREE.Euler(-Math.PI / 2, 0, 0);

  // Prompt oben (entlang -Z in Tisch-Koordinaten, Richtung HUD)
  const pW = CONFIG.cards?.prompt?.w ?? 0.22;
  const pH = CONFIG.cards?.prompt?.h ?? 0.16;

  const margin = Math.max(0.03, Math.min(W,H) * 0.04);

  const qZ = -(H/2) + margin + (pH/2);
  if (imageCard) {
    imageCard.position.set(0, y, qZ); // oben Richtung HUD (lokal -Z)
  }

  // Antworten unten als 2x2 Gitter
  if (answersGroup) {
    const aW = CONFIG.cards?.answer?.w ?? 0.18;
    const aH = CONFIG.cards?.answer?.h ?? 0.11;
    const gapX = Math.max(0.04, W * 0.08);
    const gapZ = Math.max(0.03, H * 0.06);
    const gapPrompt = Math.max(0.02, H * 0.035);

    const topRowZ = qZ + (pH/2) + gapPrompt + (aH/2);
    const bottomRowZ = topRowZ + aH + gapZ;

    const colXLeft  = -(aW/2) - gapX/2;
    const colXRight = +(aW/2) + gapX/2;

    const slots = [
      [colXLeft,  topRowZ],
      [colXRight, topRowZ],
      [colXLeft,  bottomRowZ],
      [colXRight, bottomRowZ],
    ];
    answersGroup.children.forEach((card, i) => {
      const s = slots[i] || slots[slots.length-1];
      card.position.set(s[0], y, s[1]);
      card.rotation.copy(flatCardRotation); // liegend, Text zu Spieler*in
    });
  }

  // Sicherstellen, dass alles exakt auf dem Tisch liegt (lokal Y)
  if (imageCard) imageCard.rotation.copy(flatCardRotation);
  if (answersGroup) answersGroup.rotation.set(0,0,0);
}
