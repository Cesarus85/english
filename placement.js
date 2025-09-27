// placement.js
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { CONFIG } from "./config.js";

function cfg(path, fallback) {
  try {
    const parts = path.split(".");
    let cur = CONFIG;
    for (const p of parts) cur = cur[p];
    return (cur === undefined || cur === null) ? fallback : cur;
  } catch { return fallback; }
}

const DEF = {
  table: {
    w: 0.9, h: 0.6, minW: 0.6, minH: 0.4, maxW: 1.8, maxH: 1.2,
    color: 0x2e7d32
  },
  reticle: {
    radius: 0.08,
    tube: 0.012,
    colorLeft: 0x00c8ff,
    colorRight: 0xff00cc,
    yOffset: 0.002
  },
  handles: {
    radius: 0.018,
    color: 0xffeb3b
  },
  rotate: {
    radius: 0.04,
    tube: 0.007,
    lift: 0.01,
    color: 0xffd54f
  }
};

export class TablePlacer {
  constructor(scene) {
    this.scene = scene;

    // --- Größen aus CONFIG mit Fallbacks
    this.width  = cfg("table.defaultWidth",  DEF.table.w);
    this.height = cfg("table.defaultHeight", DEF.table.h);
    this.minW   = cfg("table.minWidth",      DEF.table.minW);
    this.minH   = cfg("table.minHeight",     DEF.table.minH);
    this.maxW   = cfg("table.maxWidth",      DEF.table.maxW);
    this.maxH   = cfg("table.maxHeight",     DEF.table.maxH);

    // Status
    this.dragging = false;
    this.moving = false;
    this.rotating = false;
    this.resizing = false;
    this.resizeCorner = null; // "tl","tr","bl","br"
    this.surfaceY = 0;

    // --- Platte (Spielfeld)
    this.table = new THREE.Group();
    this.table.name = "TableRoot";
    this.table.rotation.y = Math.PI;
    this.plate = this._makePlate(this.width, this.height);
    this.table.add(this.plate);

    // --- Griffe (Resize) + Rotate-Handle
    this.handleGroup = new THREE.Group();
    this.handleGroup.name = "ResizeHandles";
    this.table.add(this.handleGroup);
    this._rebuildHandles();

    this.rotateHandle = this._makeRotateHandle();
    this.rotateHandle.visible = false;
    this.table.add(this.rotateHandle);

    // Anfangs unsichtbar – wird nach Platzierung sichtbar
    this.table.visible = false;
    scene.add(this.table);

    // --- Reticles (links/rechts)
    this.reticleL = this._makeReticle({ color: cfg("placement.reticle.colorLeft", DEF.reticle.colorLeft) });
    this.reticleR = this._makeReticle({ color: cfg("placement.reticle.colorRight", DEF.reticle.colorRight) });
    this.hideReticles();

    scene.add(this.reticleL);
    scene.add(this.reticleR);
  }

  /* ----------------- Mesh-Helfer ----------------- */
  _makePlate(w, h) {
    const geom = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshStandardMaterial({
      color: cfg("table.color", DEF.table.color),
      roughness: 0.8, metalness: 0.05
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = "TablePlate";
    mesh.rotation.x = -Math.PI / 2; // flach in XZ
    mesh.receiveShadow = true;

    // dünner Rand
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.005, h * 1.005),
      new THREE.MeshBasicMaterial({ color: 0x1b5e20, transparent: true, opacity: 0.4 })
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.0005;
    const g = new THREE.Group();
    g.add(mesh, edge);
    return g;
  }

  _makeHandle() {
    const r = cfg("handles.radius", DEF.handles.radius);
    const color = cfg("handles.color", DEF.handles.color);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 18),
      new THREE.MeshBasicMaterial({ color })
    );
    m.userData.handle = true;
    return m;
  }

  _rebuildHandles() {
    this.handleGroup.clear();
    const offsX = this.width / 2;
    const offsZ = this.height / 2;
    const y = 0.01;

    const tl = this._makeHandle(); tl.name = "handle_tl"; tl.position.set(-offsX, y, -offsZ);
    const tr = this._makeHandle(); tr.name = "handle_tr"; tr.position.set(+offsX, y, -offsZ);
    const bl = this._makeHandle(); bl.name = "handle_bl"; bl.position.set(-offsX, y, +offsZ);
    const br = this._makeHandle(); br.name = "handle_br"; br.position.set(+offsX, y, +offsZ);

    this.handleGroup.add(tl, tr, bl, br);
    this.handleGroup.visible = false;
  }

  _makeRotateHandle() {
    const radius = cfg("rotate.radius", DEF.rotate.radius);
    const tube   = cfg("rotate.tube",   DEF.rotate.tube);
    const color  = cfg("rotate.color",  DEF.rotate.color);
    const donut = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 12, 32),
      new THREE.MeshBasicMaterial({ color })
    );
    donut.rotation.x = -Math.PI / 2;
    donut.position.set(0, cfg("rotate.lift", DEF.rotate.lift), -(this.height/2 + 0.06));
    donut.userData.rotateHandle = true;
    return donut;
  }

  _makeReticle({ color }) {
    // Sichere Defaults
    const radius = cfg("placement.reticle.radius", DEF.reticle.radius);
    const tube   = cfg("placement.reticle.tube",   DEF.reticle.tube);
    const yOff   = cfg("placement.reticle.yOffset", DEF.reticle.yOffset);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 10, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = yOff;

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.004, tube * 0.55), 10, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    );
    dot.position.set(0, yOff + 0.001, 0);

    const g = new THREE.Group();
    g.add(ring, dot);
    g.name = "Reticle";
    g.visible = false;
    return g;
  }

  /* ----------------- Sichtbarkeit ----------------- */
  setVisible(v) {
    this.table.visible = !!v;
  }
  enableHandles(v) {
    this.handleGroup.visible = !!v;
    this.rotateHandle.visible = !!v;
  }

  /* ----------------- Platzieren (Drag in der Luft) ----------------- */
  beginDrag(anchor) {
    this.dragging = true;
    this.surfaceY = anchor?.y ?? this.surfaceY;
    this.table.position.set(anchor?.x ?? 0, this.surfaceY, anchor?.z ?? 0);
  }
  updateDrag(cursor) {
    if (!this.dragging || !cursor) return;
    this.table.position.set(cursor.x, this.surfaceY, cursor.z);
  }
  endDrag() {
    this.dragging = false;
    // nach Platzierung Platte zeigen
    this.setVisible(true);
    this.enableHandles(true);
    return this.getBounds();
  }

  /* ----------------- Move (Grip) ----------------- */
  beginMove() {
    this.moving = true;
  }
  updateMove(cursor) {
    if (!this.moving || !cursor) return;
    this.table.position.set(cursor.x, this.surfaceY, cursor.z);
  }
  endMove() {
    this.moving = false;
    return this.getBounds();
  }

  /* ----------------- Rotate ----------------- */
  beginRotate(cursor) {
    this.rotating = true;
    this._rotStart = this.table.rotation.y;
    this._rotAnchor = this._angleFromCenter(cursor);
  }
  updateRotate(cursor) {
    if (!this.rotating || !cursor) return;
    const a = this._angleFromCenter(cursor);
    if (a == null || this._rotAnchor == null) return;
    const delta = a - this._rotAnchor;
    this.table.rotation.y = this._rotStart + delta;
  }
  endRotate() {
    this.rotating = false;
    return this.getBounds();
  }
  _angleFromCenter(p) {
    if (!p) return null;
    const c = this.table.position;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    return Math.atan2(dz, dx); // Winkel in XZ
  }

  /* ----------------- Resize ----------------- */
  beginResize(handleMesh) {
    if (!handleMesh) return;
    this.resizing = true;
    this.resizeCorner = handleMesh.name?.split("_")[1] || null; // tl/tr/bl/br
    this._resizeStart = {
      w: this.width, h: this.height,
      cx: this.table.position.x, cz: this.table.position.z,
      rotY: this.table.rotation.y
    };
  }
  updateResize(cursor) {
    if (!this.resizing || !cursor || !this.resizeCorner) return;

    // Cursor in Tisch-Lokalraum projizieren
    const inv = new THREE.Matrix4().getInverse(this.table.matrixWorld);
    const pLocal = new THREE.Vector3(cursor.x, this.surfaceY, cursor.z).applyMatrix4(inv);

    // gewünschte Ecke bewegen => Breite/Höhe anpassen
    // Handles liegen in XZ der Platte:
    const halfW = this._resizeStart.w / 2;
    const halfH = this._resizeStart.h / 2;

    // Ziel-X/Z aus Ecke
    let targetX = THREE.MathUtils.clamp(pLocal.x, -this.maxW, this.maxW);
    let targetZ = THREE.MathUtils.clamp(pLocal.z, -this.maxH, this.maxH);

    let newW = this._resizeStart.w;
    let newH = this._resizeStart.h;

    // Welche Ecke?
    const isLeft  = (this.resizeCorner === "tl" || this.resizeCorner === "bl");
    const isTop   = (this.resizeCorner === "tl" || this.resizeCorner === "tr");
    const isRight = (this.resizeCorner === "tr" || this.resizeCorner === "br");
    const isBottom= (this.resizeCorner === "bl" || this.resizeCorner === "br");

    if (isLeft)  newW = (halfW - targetX) + halfW; // Distanz von rechter Fix-Kante
    if (isRight) newW = (targetX + halfW) + halfW; // Distanz von linker Fix-Kante
    if (isTop)   newH = (halfH - targetZ) + halfH;
    if (isBottom)newH = (targetZ + halfH) + halfH;

    newW = THREE.MathUtils.clamp(newW, this.minW, this.maxW);
    newH = THREE.MathUtils.clamp(newH, this.minH, this.maxH);

    // Platte neu aufbauen (Geometrie ersetzen) und Handles neu positionieren
    if (Math.abs(newW - this.width) > 1e-4 || Math.abs(newH - this.height) > 1e-4) {
      this.width = newW; this.height = newH;
      // remove old plate children and rebuild
      this.table.remove(this.plate);
      this.plate = this._makePlate(this.width, this.height);
      this.table.add(this.plate);
      // rotate handle neu platzieren (an Vorderkante)
      this.rotateHandle.position.set(0, cfg("rotate.lift", DEF.rotate.lift), -(this.height/2 + 0.06));
      this._rebuildHandles();
    }
  }
  endResize() {
    this.resizing = false;
    this.resizeCorner = null;
    return this.getBounds();
  }

  /* ----------------- Reticles ----------------- */
  showReticleAtFor(handed, pos) {
    if (!pos) return;
    const g = (handed === "left") ? this.reticleL : this.reticleR;
    g.position.set(pos.x, pos.y, pos.z);
    g.visible = true;
  }
  hideReticles() {
    if (this.reticleL) this.reticleL.visible = false;
    if (this.reticleR) this.reticleR.visible = false;
  }

  /* ----------------- Bounds ----------------- */
  getBounds() {
    const center = this.table.position.clone();
    const size = new THREE.Vector2(this.width, this.height);
    return {
      center,
      size: new THREE.Vector2(size.x, size.y),
      surfaceY: this.surfaceY
    };
  }
}
