import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { CONFIG } from "./config.js";

function makePanelCanvas(widthPx, heightPx) {
  const c = document.createElement("canvas");
  c.width = widthPx; c.height = heightPx;
  return { c, ctx: c.getContext("2d") };
}

function drawLeft(ctx, w, h, score) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = CONFIG.hud.bg; ctx.fillRect(0, 0, w, h);
  const pad = Math.round(h * 0.18);
  ctx.fillStyle = CONFIG.hud.fg;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(h * 0.58)}px system-ui, Segoe UI, Arial`;
  ctx.fillText(`Score: ${score}`, pad, h/2);
}

function drawRight(ctx, w, h, round, streak, flash, progress) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = CONFIG.hud.bg; ctx.fillRect(0, 0, w, h);
  const pad = Math.round(h * 0.18);
  ctx.fillStyle = CONFIG.hud.fg;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(h * 0.40)}px system-ui, Segoe UI, Arial`;
  ctx.fillText(`Q: ${round}`, pad, h*0.36);
  ctx.font = `700 ${Math.round(h * 0.36)}px system-ui, Segoe UI, Arial`;
  ctx.fillText(`Streak: ${streak}`, pad, h*0.72);

  const barW = Math.round(w * 0.52);
  const barH = Math.round(h * 0.16);
  const barX = w - barW - pad;
  const barY = (h - barH) / 2;
  ctx.lineWidth = Math.max(4, Math.round(h * 0.04));
  ctx.strokeStyle = "#90caf9";
  ctx.strokeRect(barX, barY, barW, barH);

  const p = Math.max(0, Math.min(1, progress ?? 0));
  ctx.fillStyle = "#2e7d32";
  ctx.fillRect(barX, barY, Math.round(barW * p), barH);

  if (flash != null) {
    ctx.fillStyle = flash ? CONFIG.hud.accentOk : CONFIG.hud.accentBad;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1.0;
  }
}

function makeButton(label, w=0.12, h=0.05) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 200;
  const ctx = c.getContext("2d");
  const draw = (txt, active=true) => {
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle = active ? "#263238" : "#111";
    ctx.fillRect(0,0,c.width,c.height);
    ctx.strokeStyle = active ? "#bbdefb" : "#90caf9";
    ctx.lineWidth = 6;
    ctx.strokeRect(4,4,c.width-8,c.height-8);
    ctx.fillStyle = "#e3f2fd";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 90px system-ui, Segoe UI, Arial`;
    ctx.fillText(txt, c.width/2, c.height/2);
  };
  draw(label, true);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true,
    depthTest: false, depthWrite: false,
    side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.uiButton = { label, w, h, canvas: c, ctx, tex, draw, active: true };
  return m;
}

function makeTag(label, w=0.18, h=0.05) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const ctx = c.getContext("2d");
  const draw = (txt) => {
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle = "#0b1320";
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = "#bbdefb";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 100px system-ui, Segoe UI, Arial`;
    ctx.fillText(txt, c.width/2, c.height/2);
  };
  draw(label);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true,
    depthTest: false, depthWrite: false,
    side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.uiTag = { label, w, h, canvas: c, ctx, tex, draw };
  return m;
}

function makeHit(w, h, action, scale=1.25) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ffff, transparent: true, opacity: 0.001,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w*scale, h*scale), mat);
  mesh.userData.action = action;
  return mesh;
}

export class HUD {
  constructor(scene) {
    this.scene = scene;

    const Z = CONFIG.hud.zorder || {};
    const zBase = Z.base ?? 10;
    const zPanels = Z.panels ?? 50;
    const zControls = Z.controls ?? 40;
    const zSolution = Z.solution ?? 80;
    const zSummary = Z.summary ?? 200;

    // Panels
    this.left = this._makePanelMesh("HUDLeft");
    this.right = this._makePanelMesh("HUDRight");

    this.group = new THREE.Group();
    this.group.name = "HUDGroup";
    this.group.add(this.left.mesh, this.right.mesh);
    this.group.renderOrder = zBase;

    // Controls (Kategorien-Menü)
    this.controls = new THREE.Group();
    this.controls.name = "HUDControls";
    this.controls.renderOrder = zControls;
    this.group.add(this.controls);

    this.btnTopicPrev = makeButton("◀", 0.08, 0.05);
    this.topicTag     = makeTag("Topic", 0.26, 0.05);
    this.btnTopicNext = makeButton("▶", 0.08, 0.05);
    this.btnTopicPrev.userData.action = "topicPrev";
    this.btnTopicNext.userData.action = "topicNext";
    this.hitTopicPrev = makeHit(0.08, 0.05, "topicPrev", 1.8);
    this.hitTopicNext = makeHit(0.08, 0.05, "topicNext", 1.8);

    this.btnRoundMinus = makeButton("−", 0.08, 0.05);
    this.roundTag      = makeTag("10", 0.20, 0.05);
    this.btnRoundPlus  = makeButton("+", 0.08, 0.05);
    this.btnRoundMinus.userData.action = "roundMinus";
    this.btnRoundPlus.userData.action  = "roundPlus";
    this.hitRoundMinus = makeHit(0.08, 0.05, "roundMinus", 1.8);
    this.hitRoundPlus  = makeHit(0.08, 0.05, "roundPlus", 1.8);

    this.btnStartNext = makeButton("Start", 0.22, 0.065);
    this.btnStartNext.userData.action = "startOrNext";
    this.hitStartNext = makeHit(0.22, 0.065, "startOrNext", 2.0);

    this.btnAdaptive = makeButton("Adaptiv: AN", 0.26, 0.055);
    this.btnAdaptive.userData.action = "adaptiveToggle";
    this.hitAdaptive = makeHit(0.26, 0.055, "adaptiveToggle", 1.8);

    const rowGap = 0.065;
    const y0 = 0;
    this.btnTopicPrev.position.set(-0.20, y0, 0);
    this.topicTag.position.set(0.0, y0, 0);
    this.btnTopicNext.position.set(+0.20, y0, 0);
    this.hitTopicPrev.position.copy(this.btnTopicPrev.position);
    this.hitTopicNext.position.copy(this.btnTopicNext.position);

    this.btnRoundMinus.position.set(-0.14, y0 - rowGap, 0);
    this.roundTag.position.set(0.0, y0 - rowGap, 0);
    this.btnRoundPlus.position.set(+0.14, y0 - rowGap, 0);
    this.hitRoundMinus.position.copy(this.btnRoundMinus.position);
    this.hitRoundPlus.position.copy(this.btnRoundPlus.position);

    this.btnStartNext.position.set(0.0, y0 - rowGap*2.1, 0);
    this.hitStartNext.position.copy(this.btnStartNext.position);

    this.btnAdaptive.position.set(0.0, y0 - rowGap*3.2, 0);
    this.hitAdaptive.position.copy(this.btnAdaptive.position);

    this.controls.add(
      this.btnTopicPrev, this.topicTag, this.btnTopicNext,
      this.btnRoundMinus, this.roundTag, this.btnRoundPlus,
      this.btnStartNext, this.btnAdaptive,
      this.hitTopicPrev, this.hitTopicNext,
      this.hitRoundMinus, this.hitRoundPlus,
      this.hitStartNext, this.hitAdaptive
    );

    // Panels Render-Order
    this.left.mesh.renderOrder = zPanels;
    this.right.mesh.renderOrder = zPanels;

    // Summary (Abschluss-Overlay + Buttons)
    this.summary = new THREE.Group();
    this.summary.name = "HUDSummary";
    this.summary.visible = false;
    this.summary.renderOrder = zSummary;
    this.group.add(this.summary);

    const sumW = 0.7, sumH = 0.42;
    const sumGeom = new THREE.PlaneGeometry(sumW, sumH);
    const sumCanvas = document.createElement("canvas");
    sumCanvas.width = 1600; sumCanvas.height = 950;
    const sumTex = new THREE.CanvasTexture(sumCanvas);
    const sumMat = new THREE.MeshBasicMaterial({
      map: sumTex, transparent: true, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false
    });
    this.summaryPanel = new THREE.Mesh(sumGeom, sumMat);
    this.summaryPanel.userData.canvas = sumCanvas;
    this.summaryPanel.userData.ctx = sumCanvas.getContext("2d");
    this.summaryPanel.userData.tex = sumTex;
    // Panel wird bewusst niedriger gezeichnet
    this.summaryPanel.renderOrder = (CONFIG.hud.zorder?.summary ?? 200);
    this.summary.add(this.summaryPanel);

    // Buttons UNTERHALB des Overlays
    this.btnRestart = makeButton("Restart", 0.20, 0.065);
    this.btnRestart.userData.action = "restartRound";
    this.hitRestart = makeHit(0.20, 0.065, "restartRound", 1.8);

    this.btnReviewOnly = makeButton("Nur diese üben", 0.28, 0.065);
    this.btnReviewOnly.userData.action = "reviewOnly";
    this.hitReviewOnly = makeHit(0.28, 0.065, "reviewOnly", 1.8);

    this.btnChangeTopic = makeButton("Thema ändern", 0.28, 0.065);
    this.btnChangeTopic.userData.action = "chooseTopic";
    this.hitChangeTopic = makeHit(0.28, 0.065, "chooseTopic", 1.8);

    // Positionen relativ zur unteren Panelkante + deutlicher Z-Versatz vor dem Panel
    const gapBelow = (CONFIG?.hud?.summary?.buttonGap ?? 0.10); // Abstand unter dem Overlay
    const belowY   = (-sumH / 2) - gapBelow;
    const btnZ = 0.02;       // klar vor dem Panel
    const hitZ = btnZ - 0.002;

    this.btnRestart.position.set(-0.22, belowY, btnZ);
    this.hitRestart.position.set(-0.22, belowY, hitZ);

    this.btnReviewOnly.position.set(0.00, belowY, btnZ);
    this.hitReviewOnly.position.set(0.00, belowY, hitZ);

    this.btnChangeTopic.position.set(+0.22, belowY, btnZ);
    this.hitChangeTopic.position.set(+0.22, belowY, hitZ);

    // Buttons bekommen höhere renderOrder als das Panel
    const zButtons = (CONFIG.hud.zorder?.summary ?? 200) + 10;
    [
      this.btnRestart, this.hitRestart,
      this.btnReviewOnly, this.hitReviewOnly,
      this.btnChangeTopic, this.hitChangeTopic
    ].forEach(m => { m.renderOrder = zButtons; });

    this.summary.add(
      this.btnRestart, this.hitRestart,
      this.btnReviewOnly, this.hitReviewOnly,
      this.btnChangeTopic, this.hitChangeTopic
    );

    // Lösungsoverlay (EN+DE nach Antwort)
    this.solution = new THREE.Group();
    this.solution.visible = false;
    this.solution.renderOrder = zSolution;
    const sW = CONFIG.hud.solution.width;
    const sH = CONFIG.hud.solution.height;
    const sGeom = new THREE.PlaneGeometry(sW, sH);
    const sCanvas = document.createElement("canvas");
    sCanvas.width = 1400; sCanvas.height = 640;
    const sTex = new THREE.CanvasTexture(sCanvas);
    const sMat = new THREE.MeshBasicMaterial({
      map: sTex, transparent: true, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false
    });
    this.solutionPanel = new THREE.Mesh(sGeom, sMat);
    this.solutionPanel.userData.canvas = sCanvas;
    this.solutionPanel.userData.ctx = sCanvas.getContext("2d");
    this.solutionPanel.userData.tex = sTex;
    this.solutionPanel.renderOrder = zSolution;
    this.solution.add(this.solutionPanel);

    this.scene.add(this.group);
    this.scene.add(this.solution);

    this.currentPanelWidth = 0.6;
    this.currentPanelHeight = CONFIG.hud.panel.height;
    this.surfaceY = 0;

    this.setVisible(false);
    this.update({ score: 0, round: 0, streak: 0 }, null, 0);
  }

  _makePanelMesh(name) {
    const { c, ctx } = makePanelCanvas(1024, 340);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;

    const geom = new THREE.PlaneGeometry(1, CONFIG.hud.panel.height);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = name;
    return { c, ctx, tex, geom, mat, mesh, pxW: 1024, pxH: 340 };
  }

  _ensureRes(panel, physicalWidth) {
    const ppm = CONFIG.hud.panel.ppm ?? 1600;
    const minW = CONFIG.hud.panel.minCanvas ?? 1024;
    const maxW = CONFIG.hud.panel.maxCanvas ?? 3072;
    const targetPxW = Math.max(minW, Math.min(maxW, Math.round(physicalWidth * ppm)));
    const targetPxH = Math.round(targetPxW * (CONFIG.hud.panel.height / 1));
    if (!panel.c.width || Math.abs(targetPxW - panel.c.width) / panel.c.width > 0.1) {
      panel.c.width = targetPxW;
      panel.c.height = targetPxH;
      panel.tex.image = panel.c;
      panel.tex.needsUpdate = true;
    }
  }

  attachToTable(tableBounds, opts = {}) {
    if (!tableBounds) return;
    const { center, size, surfaceY } = tableBounds;
    const cam = opts.camera || null;
    const sideMode = opts.side || "cameraOpposite";

    this.surfaceY = surfaceY ?? (center.y + CONFIG.table.defaultHeight * 0.5);

    const rel = CONFIG.hud.panel.widthRelativeToTable ?? 0.34;
    const minW = CONFIG.hud.panel.minWidth ?? 0.42;
    const maxW = CONFIG.hud.panel.maxWidth ?? 0.95;
    const targetW = THREE.MathUtils.clamp(size.x * rel, minW, maxW);
    this.currentPanelWidth = targetW;
    this.currentPanelHeight = CONFIG.hud.panel.height;

    const sx = targetW / 1.0;
    this.left.mesh.scale.set(sx, 1, 1);
    this.right.mesh.scale.set(sx, 1, 1);
    this._ensureRes(this.left, targetW);
    this._ensureRes(this.right, targetW);

    let placeOnFront = false;
    if ((sideMode === "camera" || sideMode === "cameraOpposite") && cam) {
      const camPos = new THREE.Vector3(); cam.getWorldPosition(camPos);
      const dz = camPos.z - center.z;
      const cameraSideIsFront = dz > 0;
      placeOnFront = (sideMode === "camera") ? cameraSideIsFront : !cameraSideIsFront;
    }

    const panelLift = Math.max(0.06, CONFIG.hud.yOffset ?? 0.02);
    const y = this.surfaceY + panelLift + this.currentPanelHeight * 0.5;

    const baseZ = placeOnFront
      ? center.z + size.y/2 + (CONFIG.hud.marginZ ?? 0.05)
      : center.z - size.y/2 - (CONFIG.hud.marginZ ?? 0.05);
    const pushOutZ = Math.max(CONFIG.hud.outsideOffset ?? 0.06, size.x * 0.04);
    const z = baseZ + (placeOnFront ? +pushOutZ : -pushOutZ);

    const minGap = Math.max(0.36, size.x * 0.22);
    const marginX = Math.max(0.24, size.x * 0.12);
    const panelHalf = this.currentPanelWidth / 2;

    let leftX  = center.x - size.x/2 + marginX + panelHalf;
    let rightX = center.x + size.x/2 - marginX - panelHalf;
    const currentGap = rightX - leftX;

    if (currentGap < minGap) {
      const extraOut = Math.max(0.12, (minGap - currentGap) * 0.65);
      leftX  = center.x - size.x/2 - (panelHalf + extraOut);
      rightX = center.x + size.x/2 + (panelHalf + extraOut);
    }

    this.left.mesh.position.set(leftX, y, z);
    this.right.mesh.position.set(rightX, y, z);

    // Controls höher & leicht nach vorne
    const ctrlConf = CONFIG.hud.controls || {};
    const lift = (typeof ctrlConf.lift === "number")
      ? ctrlConf.lift
      : Math.max(0.14, size.y * 0.25);
    const ctrlY = this.surfaceY + lift;
    const ctrlZ = z + (placeOnFront ? +(CONFIG.hud.controls?.frontOffsetZ ?? 0.04)
                                    : -(CONFIG.hud.controls?.frontOffsetZ ?? 0.04));
    this.controls.position.set(center.x, ctrlY, ctrlZ);

    // Summary: höher & weiter vorn (konfigurierbar)
    const sLift  = CONFIG?.hud?.summary?.lift ?? 0.32;
    const sZOff  = CONFIG?.hud?.summary?.frontOffsetZ ?? 0.22;
    const summaryZ = ctrlZ + (placeOnFront ?  sZOff : -sZOff);
    const summaryY = ctrlY + sLift;
    this.summary.position.set(center.x, summaryY, summaryZ);

    // Lösungsoverlay über Mitte
    this.solution.position.set(center.x, this.surfaceY + (CONFIG.hud.solution.yLift || 0.16), center.z);

    if (cam) {
      const look = new THREE.Vector3(); cam.getWorldPosition(look);
      look.y = ctrlY;
      this.controls.lookAt(look);
      this.left.mesh.lookAt(look);
      this.right.mesh.lookAt(look);

      const lookSum = new THREE.Vector3(); cam.getWorldPosition(lookSum);
      lookSum.y = summaryY;
      this.summary.lookAt(lookSum);

      const tilt = THREE.MathUtils.degToRad(CONFIG.hud.tiltDeg ?? 8);
      this.controls.rotateX(-tilt);
      this.left.mesh.rotateX(-tilt);
      this.right.mesh.rotateX(-tilt);
      this.summary.rotateX(-tilt);

      const sLook = new THREE.Vector3(); cam.getWorldPosition(sLook);
      sLook.y = this.solution.position.y;
      this.solution.lookAt(sLook);
      this.solution.rotateX(-THREE.MathUtils.degToRad(CONFIG.hud.solution.tiltDeg || 12));
    } else {
      this.controls.rotation.set(0,0,0);
      this.left.mesh.rotation.set(0,0,0);
      this.right.mesh.rotation.set(0,0,0);
      this.summary.rotation.set(0,0,0);
      this.solution.rotation.set(0,0,0);
    }
  }

  update(state, flash = null, progress = 0) {
    drawLeft(this.left.ctx, this.left.c.width, this.left.c.height, state.score ?? 0);
    this.left.tex.needsUpdate = true;

    drawRight(
      this.right.ctx, this.right.c.width, this.right.c.height,
      state.round ?? 0, state.streak ?? 0, flash, progress
    );
    this.right.tex.needsUpdate = true;
  }

  updateControls({ topic, roundSize, phase, autoAdvance, adaptiveEnabled }) {
    this.topicTag.userData.uiTag.draw(topic || "All");
    this.topicTag.material.map.needsUpdate = true;

    this.roundTag.userData.uiTag.draw(String(roundSize ?? 10));
    this.roundTag.material.map.needsUpdate = true;

    let label = "Start";
    if (phase === "finished") label = "Restart";
    else if (phase === "awaitAnswer") label = (autoAdvance > 0 ? "…" : "Next");
    else if (phase === "showFeedback") label = (autoAdvance > 0 ? "…" : "Next");

    this.btnStartNext.userData.uiButton.draw(label, true);
    this.btnStartNext.material.map.needsUpdate = true;

    const adaptLbl = adaptiveEnabled ? "Adaptiv: AN" : "Adaptiv: AUS";
    this.btnAdaptive.userData.uiButton.draw(adaptLbl, true);
    this.btnAdaptive.material.map.needsUpdate = true;
  }

  showSummary({ score, correct, total, accuracyPct, bestStreak }, topicBest = null, hardWords = null) {
    const c = this.summaryPanel.userData.canvas;
    const ctx = this.summaryPanel.userData.ctx;
    const tex = this.summaryPanel.userData.tex;
    const w = c.width, h = c.height;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#0b1320";
    ctx.globalAlpha = 0.96;
    ctx.fillRect(0,0,w,h);
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = "#bbdefb";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 ${Math.round(h*0.10)}px system-ui, Segoe UI, Arial`;
    ctx.fillText("Runde beendet!", w/2, h*0.16);

    ctx.font = `700 ${Math.round(h*0.072)}px system-ui, Segoe UI, Arial`;
    const line1 = `Score: ${score}`;
    const line2 = `Richtig: ${correct}/${total}  •  Accuracy: ${accuracyPct}%`;
    const line3 = `Beste Streak: ${bestStreak}`;
    ctx.fillText(line1, w/2, h*0.30);
    ctx.fillText(line2, w/2, h*0.40);
    ctx.fillText(line3, w/2, h*0.50);

    if (topicBest) {
      ctx.fillStyle = "#90caf9";
      ctx.font = `700 ${Math.round(h*0.055)}px system-ui, Segoe UI, Arial`;
      const b1 = `Topic-Best: Score ${topicBest.bestScore || 0}`;
      const b2 = `Best Streak ${topicBest.bestStreak || 0} • Best Accuracy ${topicBest.bestAccuracyPct ?? 0}%`;
      ctx.fillText(b1, w/2, h*0.60);
      ctx.fillText(b2, w/2, h*0.66);
    }

    if (Array.isArray(hardWords) && hardWords.length) {
      ctx.fillStyle = "#bbdefb";
      ctx.font = `800 ${Math.round(h*0.06)}px system-ui, Segoe UI, Arial`;
      ctx.fillText("Schwierig für dich:", w/2, h*0.75);

      ctx.fillStyle = "#e3f2fd";
      ctx.font = `700 ${Math.round(h*0.048)}px system-ui, Segoe UI, Arial`;
      const lines = hardWords.map((wrd, i) => `${i+1}. ${wrd.en} — ${wrd.de}`);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], w/2, h*(0.82 + i*0.055));
      }
    }

    tex.needsUpdate = true;
    this.summary.visible = true;
  }
  hideSummary() { this.summary.visible = false; }

  setButtonHover(btnMesh, hovered) {
    const ui = btnMesh?.userData?.uiButton;
    if (!ui) return;
    if (ui.active === hovered) return;
    ui.active = hovered;
    ui.draw(ui.label, hovered);
    ui.tex.needsUpdate = true;
  }

  getUIObjects() {
    const arr = [
      this.hitTopicPrev, this.hitTopicNext,
      this.hitRoundMinus, this.hitRoundPlus,
      this.hitStartNext, this.hitAdaptive,
      this.btnTopicPrev, this.btnTopicNext,
      this.btnRoundMinus, this.btnRoundPlus,
      this.btnStartNext, this.btnAdaptive
    ];
    if (this.summary.visible) {
      arr.push(
        this.hitRestart, this.hitChangeTopic, this.hitReviewOnly,
        this.btnRestart, this.btnChangeTopic, this.btnReviewOnly
      );
    }
    return arr;
  }

  showSolution({ en, de }, tableBounds, camera) {
    if (!tableBounds) return;
    const { center } = tableBounds;
    const lift = CONFIG.hud.solution.yLift || 0.16;
    this.solution.position.set(center.x, this.surfaceY + lift, center.z);

    const c = this.solutionPanel.userData.canvas;
    const ctx = this.solutionPanel.userData.ctx;
    const tex = this.solutionPanel.userData.tex;
    const w = c.width, h = c.height;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = CONFIG.hud.solution.colors.bg;
    ctx.globalAlpha = 0.97;
    ctx.fillRect(0,0,w,h);
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = CONFIG.hud.solution.colors.border;
    ctx.lineWidth = 10;
    ctx.strokeRect(6,6,w-12,h-12);

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = CONFIG.hud.solution.colors.en;
    ctx.font = `800 ${Math.round(h*0.36)}px system-ui, Segoe UI, Arial`;
    ctx.fillText(en || "", w/2, h*0.40);

    ctx.fillStyle = CONFIG.hud.solution.colors.de;
    ctx.font = `700 ${Math.round(h*0.22)}px system-ui, Segoe UI, Arial`;
    ctx.fillText(de || "", w/2, h*0.72);

    tex.needsUpdate = true;

    if (camera) {
      const look = new THREE.Vector3(); camera.getWorldPosition(look);
      look.y = this.solution.position.y;
      this.solution.lookAt(look);
      this.solution.rotateX(-THREE.MathUtils.degToRad(CONFIG.hud.solution.tiltDeg || 12));
    }

    this.solution.visible = true;
  }
  hideSolution() { this.solution.visible = false; }

  setVisible(v) { this.group.visible = v; }
}
