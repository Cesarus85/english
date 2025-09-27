import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import {
  addARButton,
  createCamera,
  createRenderer,
  createScene,
  setupXRSession,
  createHitTestSource,
  getLocalReferenceSpace,
  getHands,
  detectPinch
} from "./xr-setup.js";
import { TablePlacer } from "./placement.js";
import { CONFIG } from "./config.js";
import {
  makeAnswerCards,
  makeImageCard,
  layoutQuestionAdaptive,
  updateHoverEffect,
  flashFeedback
} from "./cards.js";
import {
  loadWords, buildQuestion, getTopics,
  updateWordStats, getHardestWords
} from "./data.js";
import { HUD } from "./hud.js";
import { playCorrect, playWrong, hapticOk, hapticBad, confetti } from "./fx.js";

const INPUT = (() => {
  const def = {
    hoverThrottleMs: 60,
    controller: { selectDebounceMs: 220, maxSelectDistance: 3.0 },
    hands:      { pinchOn: 0.018, pinchOff: 0.028, selectDebounceMs: 280, maxSelectDistance: 2.5 }
  };
  const ci = (CONFIG && CONFIG.input) ? CONFIG.input : {};
  return {
    hoverThrottleMs: ci.hoverThrottleMs ?? def.hoverThrottleMs,
    controller: { ...def.controller, ...(ci.controller || {}) },
    hands:      { ...def.hands,      ...(ci.hands || {}) }
  };
})();

const AUTO_ADV_MS = (CONFIG?.gameplay?.autoAdvanceMs ?? 1200);
const ADAPT = {
  enabled: CONFIG?.adaptive?.enabled !== false,
  retryAfter: CONFIG?.adaptive?.retryAfter ?? 3,
  maxRetries: CONFIG?.adaptive?.maxRetries ?? 2,
  weightFactor: CONFIG?.adaptive?.weightFactor ?? 1.2,
  reviewMax: CONFIG?.adaptive?.reviewMax ?? 5
};

let renderer, scene, camera;
let referenceSpace = null, hitTestSource = null;
let tablePlacer;
let controllers = [];
let hands = [];
let placingDone = false;

let wordsPkg = null;
let currentQ = null;
let answersGroup = null;
let imageCard = null;

let acceptingAnswers = false;
let autoTimer = null;

const gameState = {
  score: 0,
  streak: 0,
  bestStreak: 0,
  round: 0,
  selectedTopic: null,
  roundSize: 10,
  questionsAsked: 0,
  correctCount: 0,
  phase: "idle"
};

let hud = null;
const raycaster = new THREE.Raycaster();
let activeCtrl = null;

// Adaptive
let adaptiveOn = ADAPT.enabled;
let retryQueue = [];
let reviewMode = { active: false, pool: [], index: 0 };
let lastHardWords = [];

/* ------------ TTS Robustheit ------------ */
let ttsVoice = null;
let ttsReady = false;
let lastUtterance = null;

function initTTS() {
  try {
    if (!CONFIG.tts?.enabled || !("speechSynthesis" in window)) {
      console.warn("[TTS] speechSynthesis nicht verfügbar oder deaktiviert.");
      return;
    }
    const pick = () => {
      const vs = window.speechSynthesis.getVoices?.() || [];
      ttsVoice = vs.find(v => v.lang?.toLowerCase().startsWith("en-")) || vs[0] || null;
      ttsReady = !!ttsVoice || vs.length > 0;
      console.log("[TTS] voices:", vs.length, "selected:", ttsVoice?.name || "(none)");
    };
    pick();
    window.speechSynthesis.addEventListener?.("voiceschanged", pick);
  } catch (e) {
    console.warn("[TTS] init error:", e);
  }
}

function resumeTTS() {
  try {
    if (window?.speechSynthesis?.resume) window.speechSynthesis.resume();
  } catch {}
}

function speak(text) {
  try {
    if (!CONFIG.tts?.enabled || !window?.speechSynthesis || !text) return;
    resumeTTS();
    if (!ttsReady) {
      const vs = window.speechSynthesis.getVoices?.() || [];
      if (vs.length) {
        ttsVoice = vs.find(v => v.lang?.toLowerCase().startsWith("en-")) || vs[0] || null;
        ttsReady = !!ttsVoice;
      }
    }
    if (lastUtterance) {
      window.speechSynthesis.cancel();
      lastUtterance = null;
    }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-US";
    utt.rate = CONFIG.tts.rate ?? 1.0;
    utt.pitch = CONFIG.tts.pitch ?? 1.0;
    utt.volume = CONFIG.tts.volume ?? 1.0;
    if (ttsVoice) utt.voice = ttsVoice;
    utt.onstart = () => console.log("[TTS] speaking:", text);
    utt.onerror = (e) => console.warn("[TTS] error:", e.error);
    lastUtterance = utt;
    window.speechSynthesis.speak(utt);
  } catch (e) {
    console.warn("[TTS] speak error:", e);
  }
}

init();

/* -------------------- Stats Persistence (Round) -------------------- */
function statsKey(topic) {
  const t = topic || "All";
  return `vocabxr:stats:${t}`;
}
function loadStats(topic) {
  try {
    const raw = localStorage.getItem(statsKey(topic));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveStats(topic, obj) {
  try {
    localStorage.setItem(statsKey(topic), JSON.stringify(obj));
  } catch {}
}
function updateStatsOnGameOver(topic, { score, correct, total, bestStreak }) {
  const now = new Date().toISOString();
  const old = loadStats(topic) || {
    plays: 0, totalQuestions: 0, totalCorrect: 0,
    bestScore: 0, bestStreak: 0, bestAccuracyPct: 0, lastPlayed: null
  };
  const accPct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const next = {
    ...old,
    plays: old.plays + 1,
    totalQuestions: old.totalQuestions + total,
    totalCorrect: old.totalCorrect + correct,
    bestScore: Math.max(old.bestScore, score),
    bestStreak: Math.max(old.bestStreak, bestStreak),
    bestAccuracyPct: Math.max(old.bestAccuracyPct, accPct),
    lastPlayed: now
  };
  saveStats(topic, next);
  return next;
}

/* -------------------- Utility -------------------- */
function rayOnPlaneY(ctrlObj, y) {
  if (!ctrlObj) return null;
  const origin = new THREE.Vector3().setFromMatrixPosition(ctrlObj.matrixWorld);
  const dir = new THREE.Vector3(0,0,-1)
    .applyMatrix4(new THREE.Matrix4().extractRotation(ctrlObj.matrixWorld))
    .normalize();
  const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -y);
  const ray = new THREE.Ray(origin, dir);
  const hit = new THREE.Vector3();
  const ok = ray.intersectPlane(plane, hit);
  return ok ? hit : null;
}
function pointInFrontOfController(ctrlObj, distance) {
  const m = ctrlObj.matrixWorld;
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(m)).normalize();
  return origin.clone().add(dir.multiplyScalar(distance));
}

function elevateVisuals(obj, baseOrder = 20) {
  if (!obj) return;
  obj.renderOrder = baseOrder;
  obj.traverse((n) => {
    if (n.material) {
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (m) {
          m.depthTest = false;
          m.depthWrite = false;
          n.renderOrder = baseOrder;
        }
      });
    }
  });
}

/* -------------------- Init -------------------- */
async function init() {
  renderer = createRenderer();
  scene = createScene();
  camera = createCamera();
  addARButton(renderer);

  tablePlacer = new TablePlacer(scene);

  await setupXRSession(renderer);
  referenceSpace = getLocalReferenceSpace(renderer);

  try { hitTestSource = await createHitTestSource(renderer, referenceSpace); }
  catch (e) { console.warn("HitTestSource konnte nicht erstellt werden:", e); }

  setupControllersDual();
  hands = getHands(renderer, scene);

  // TTS initialisieren
  initTTS();

  try {
    wordsPkg = await loadWords("./words.de5.json");
    console.log("[Data] Wörter geladen:", wordsPkg?.entries?.length || 0);
  } catch (e) { console.error("[Data] Laden fehlgeschlagen:", e); }

  const topics = getTopics(wordsPkg);
  gameState.selectedTopic = topics?.length ? topics[0] : null;
  gameState.roundSize = 10;
  gameState.questionsAsked = 0;
  gameState.phase = "idle";

  hud = new HUD(scene);
  hud.updateControls({
    topic: gameState.selectedTopic || "All",
    roundSize: gameState.roundSize,
    phase: gameState.phase,
    autoAdvance: AUTO_ADV_MS,
    adaptiveEnabled: adaptiveOn
  });

  renderer.setAnimationLoop(onXRFrame);
}

/* -------------------- Controllers -------------------- */
function setupControllersDual() {
  const c0 = renderer.xr.getController(0);
  const c1 = renderer.xr.getController(1);

  [c0, c1].forEach((ctrlObj, idx) => {
    if (!ctrlObj) return;

    ctrlObj.addEventListener("selectstart", onSelectStart);
    ctrlObj.addEventListener("selectend", onSelectEnd);

    ctrlObj.addEventListener("squeezestart", onSqueezeStart);
    ctrlObj.addEventListener("squeezeend", onSqueezeEnd);

    scene.add(ctrlObj);

    const pointer = makePointerVisual(idx === 0 ? 0x00c8ff : 0xff00cc);
    ctrlObj.add(pointer.line, pointer.dot);

    controllers.push({
      obj: ctrlObj,
      handedness: "unknown",
      lastSelectTs: 0,
      pointer
    });
  });

  const session = renderer.xr.getSession?.();
  if (session) {
    const updateHands = () => {
      const sources = Array.from(session.inputSources || []);
      controllers.forEach((c, i) => {
        const src = sources[i];
        if (src && src.handedness) c.handedness = src.handedness;
      });
    };
    updateHands();
    session.addEventListener("inputsourceschange", updateHands);
  }
}

function makePointerVisual(color = 0x00c8ff) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array([0,0,0, 0,0,-1]);
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.15 });
  const line = new THREE.Line(geom, mat);
  line.frustumCulled = false;

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 12, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0 })
  );
  dot.position.set(0, 0, -1);
  dot.frustumCulled = false;

  return { line, dot, maxLen: 2.0, baseColor: color, highlight: 0xffd54f };
}
function setPointer(ptr, len, color, lineOpacity = 0.95, dotOpacity = 0.95) {
  const pos = ptr.line.geometry.getAttribute("position");
  pos.setXYZ(0, 0, 0, 0);
  pos.setXYZ(1, 0, 0, -len);
  pos.needsUpdate = true;
  ptr.dot.position.set(0, 0, -len);
  ptr.line.material.color.set(color);
  ptr.dot.material.color.set(color);
  ptr.line.material.opacity = lineOpacity;
  ptr.dot.material.opacity = dotOpacity;
}

function controllerFromEvent(ev) {
  const obj = ev?.target;
  return controllers.find(c => c.obj === obj) || null;
}

/* -------------------- Controller Input -------------------- */
function onSelectStart(ev) {
  // TTS-Entsperren bei User-Geste
  resumeTTS();

  const ctrl = controllerFromEvent(ev);
  if (!ctrl) return;
  const now = performance.now();

  // UI hat Vorrang
  const uiHit = intersectUIFromController(ctrl.obj);
  if (uiHit) {
    console.log("[UI] Button:", uiHit.object.userData.action);
    handleUIButton(uiHit.object.userData.action);
    return;
  }

  if (!placingDone) {
    activeCtrl = ctrl.obj;
    const anchor = pointInFrontOfController(ctrl.obj, CONFIG.placement.airDistance ?? 1.0);
    tablePlacer.beginDrag(anchor);
    console.log("[Place] Begin drag at", anchor);
    return;
  }

  if (acceptingAnswers) {
    const aHit = intersectAnswersFromController(ctrl.obj);
    if (aHit && withinDistance(aHit.point, camera, INPUT.controller.maxSelectDistance)) {
      if (now - ctrl.lastSelectTs >= INPUT.controller.selectDebounceMs) {
        ctrl.lastSelectTs = now;
        console.log("[Answer] Selected:", aHit.object?.userData?.label || aHit.object?.name);
        evaluateAnswer(aHit.object, { via: "controller", controllerObj: ctrl.obj });
        return;
      }
    }
  }

  const hitRotate = intersectRotateFromController(ctrl.obj);
  if (hitRotate) {
    activeCtrl = ctrl.obj;
    const y = tablePlacer.surfaceY;
    const cursor = rayOnPlaneY(ctrl.obj, y) || pointInFrontOfController(ctrl.obj, 1.0);
    tablePlacer.beginRotate(cursor);
    console.log("[Place] Begin rotate");
    return;
  }
  const hitResize = intersectResizeFromController(ctrl.obj);
  if (hitResize) {
    activeCtrl = ctrl.obj;
    tablePlacer.beginResize(hitResize.object);
    console.log("[Place] Begin resize");
    return;
  }
}

function onSelectEnd(ev) {
  const ctrl = controllerFromEvent(ev);
  if (!ctrl) return;

  if (!placingDone && tablePlacer.dragging) {
    const tb = tablePlacer.endDrag();
    placingDone = true;
    activeCtrl = null;
    tablePlacer.setVisible(true);
    tablePlacer.enableHandles(true);

    console.log("[Place] End drag. Bounds:", tb);

    hud.attachToTable(tb, { side: "cameraOpposite", camera });
    hud.setVisible(true);
    hud.updateControls({
      topic: gameState.selectedTopic || "All",
      roundSize: gameState.roundSize,
      phase: gameState.phase,
      autoAdvance: AUTO_ADV_MS,
      adaptiveEnabled: adaptiveOn
    });
    return;
  }

  if (tablePlacer.rotating) {
    const tb = tablePlacer.endRotate();
    activeCtrl = null;
    hud.attachToTable(tb, { side: "cameraOpposite", camera });
    hud.update(gameState, null, progressValue());
    console.log("[Place] End rotate");
    return;
  }

  if (tablePlacer.resizing) {
    const tb = tablePlacer.endResize();
    activeCtrl = null;
    relayoutLocal(tb);
    console.log("[Place] End resize. New size:", tb.size);
    return;
  }
}

function onSqueezeStart(ev) {
  // TTS-Entsperren auch hier
  resumeTTS();

  const ctrl = controllerFromEvent(ev);
  if (!ctrl || !placingDone) return;

  const aHit = intersectAnswersFromController(ctrl.obj);
  const hHit = intersectResizeFromController(ctrl.obj) || intersectRotateFromController(ctrl.obj);
  const uiHit = intersectUIFromController(ctrl.obj);
  if (aHit || hHit || uiHit) return;

  const pHit = intersectPlateFromController(ctrl.obj);
  if (pHit) {
    activeCtrl = ctrl.obj;
    tablePlacer.beginMove();
    console.log("[Place] Begin move");
  }
}

function onSqueezeEnd(ev) {
  const ctrl = controllerFromEvent(ev);
  if (!ctrl) return;

  if (tablePlacer.moving) {
    const tb = tablePlacer.endMove();
    activeCtrl = null;
    hud.attachToTable(tb, { side: "cameraOpposite", camera });
    console.log("[Place] End move");
  }
}

/* -------------------- UI -------------------- */
function handleUIButton(action) {
  const topics = getTopics(wordsPkg);
  switch (action) {
    case "topicPrev": {
      if (!topics.length) { gameState.selectedTopic = null; break; }
      const idx = Math.max(0, topics.findIndex(t => t === gameState.selectedTopic));
      const prev = (idx - 1 + topics.length) % topics.length;
      gameState.selectedTopic = topics[prev];
      break;
    }
    case "topicNext": {
      if (!topics.length) { gameState.selectedTopic = null; break; }
      const idx = Math.max(0, topics.findIndex(t => t === gameState.selectedTopic));
      const next = (idx + 1) % topics.length;
      gameState.selectedTopic = topics[next];
      break;
    }
    case "roundMinus": {
      gameState.roundSize = Math.max(3, gameState.roundSize - 1);
      break;
    }
    case "roundPlus": {
      gameState.roundSize = Math.min(20, gameState.roundSize + 1);
      break;
    }
    case "adaptiveToggle": {
      adaptiveOn = !adaptiveOn;
      break;
    }
    case "startOrNext": {
      // TTS-Entsperren bei Button
      resumeTTS();

      console.log("[Game] Start/Next pressed. Phase:", gameState.phase);
      hud.hideSummary();
      hud.hideSolution();
      reviewMode.active = false;
      if (gameState.phase === "idle" || gameState.phase === "finished") {
        resetRoundState();
        startQuestionRound(tablePlacer.getBounds());
      } else if (gameState.phase === "awaitAnswer") {
        // keine Aktion
      } else if (gameState.phase === "showFeedback") {
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        startQuestionRound(tablePlacer.getBounds());
      }
      break;
    }
    case "restartRound": {
      resumeTTS();
      reviewMode.active = false;
      resetRoundState();
      hud.hideSummary();
      hud.hideSolution();
      startQuestionRound(tablePlacer.getBounds());
      break;
    }
    case "reviewOnly": {
      resumeTTS();
      const topic = gameState.selectedTopic || "All";
      const top = lastHardWords?.map(w => w.en) || [];
      const pool = top.slice(0, ADAPT.reviewMax);
      if (pool.length) {
        reviewMode = { active: true, pool, index: 0 };
        resetRoundState();
        gameState.roundSize = pool.length;
        hud.hideSummary();
        hud.hideSolution();
        startQuestionRound(tablePlacer.getBounds());
      }
      break;
    }
    case "chooseTopic": {
      hud.hideSummary();
      hud.hideSolution();
      reviewMode.active = false;
      gameState.phase = "idle";
      break;
    }
  }
  hud.updateControls({
    topic: gameState.selectedTopic || "All",
    roundSize: gameState.roundSize,
    phase: gameState.phase,
    autoAdvance: AUTO_ADV_MS,
    adaptiveEnabled: adaptiveOn
  });
}

function resetRoundState() {
  gameState.score = 0;
  gameState.streak = 0;
  gameState.bestStreak = 0;
  gameState.questionsAsked = 0;
  gameState.correctCount = 0;
  gameState.round = 0;
  gameState.phase = "idle";
  retryQueue = [];
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}

function progressValue() {
  const total = Math.max(1, gameState.roundSize);
  return Math.min(1, Math.max(0, gameState.questionsAsked / total));
}

/* -------------------- Rundenfluss -------------------- */
function startQuestionRound(tbounds) {
  if (!wordsPkg) { console.warn("[Game] Keine Wörter geladen."); return; }
  if (!tbounds)  { console.warn("[Game] Keine Table-Bounds."); return; }

  hud.hideSolution();

  if (gameState.questionsAsked >= gameState.roundSize) {
    gameOver();
    return;
  }

  gameState.questionsAsked += 1;
  gameState.round = gameState.questionsAsked;

  let onlyPool = null;

  if (reviewMode.active) {
    if (reviewMode.index >= reviewMode.pool.length) {
      gameOver(); return;
    }
    onlyPool = [reviewMode.pool[reviewMode.index]];
    reviewMode.index += 1;
  } else if (adaptiveOn && retryQueue.length) {
    const due = retryQueue.find(it => it.dueAt <= gameState.questionsAsked);
    if (due) onlyPool = [due.en];
  }

  const options = {
    topic: gameState.selectedTopic,
    maxOptions: 4,
    onlyPool,
    adaptive: adaptiveOn && !onlyPool,
    weightFactor: ADAPT.weightFactor
  };

  currentQ = buildQuestion(wordsPkg, options);
  if (!currentQ || !currentQ.options?.length) {
    console.warn("[Game] buildQuestion lieferte nichts. Topic:", gameState.selectedTopic, "opts:", options);
    return;
  }

  if (answersGroup && answersGroup.parent) answersGroup.parent.remove(answersGroup);
  if (imageCard && imageCard.parent) imageCard.parent.remove(imageCard);

  answersGroup = makeAnswerCards(currentQ.options.map(o => o.en));
  imageCard = makeImageCard({ hint: currentQ.prompt.hint, de: currentQ.prompt.de });

  answersGroup.children.forEach((card, idx) => {
    card.userData.correct = (idx === currentQ.correctIndex);
  });
  elevateVisuals(answersGroup, 30);
  elevateVisuals(imageCard, 30);

  layoutQuestionAdaptive(tablePlacer.table, tbounds, imageCard, answersGroup);

  gameState.phase = "awaitAnswer";
  hud.attachToTable(tbounds, { side: "cameraOpposite", camera });
  hud.update(gameState, null, progressValue());
  hud.updateControls({
    topic: gameState.selectedTopic || "All",
    roundSize: gameState.roundSize,
    phase: gameState.phase,
    autoAdvance: AUTO_ADV_MS,
    adaptiveEnabled: adaptiveOn
  });

  // 🔧 WICHTIG: Antworten jetzt zulassen
  acceptingAnswers = true;

  console.log("[Game] Q", gameState.round, "topic:", gameState.selectedTopic, "prompt:", currentQ.prompt?.en, "/", currentQ.prompt?.de, options.onlyPool ? "(forced)" : "");
}

function relayoutLocal(tbounds) {
  layoutQuestionAdaptive(tablePlacer.table, tbounds, imageCard, answersGroup);
  hud.updateControls({
    topic: gameState.selectedTopic || "All",
    roundSize: gameState.roundSize,
    phase: gameState.phase,
    autoAdvance: AUTO_ADV_MS,
    adaptiveEnabled: adaptiveOn
  });
  hud.update(gameState, null, progressValue());
}

/* -------------------- Bewertung -------------------- */
function evaluateAnswer(mesh, { via, controllerObj } = {}) {
  if (!acceptingAnswers) return;
  acceptingAnswers = false;

  const ok = !!mesh.userData.correct;
  flashFeedback(mesh, ok, 380);

  if (ok) {
    const mult = 1 + gameState.streak * CONFIG.scoring.streakBonus;
    const gained = Math.round(CONFIG.scoring.correctPoints * mult);
    gameState.score += gained;
    gameState.streak += 1;
    gameState.bestStreak = Math.max(gameState.bestStreak, gameState.streak);
    gameState.correctCount += 1;
    playCorrect();
    if (via === "controller" && controllerObj) hapticOk(controllerObj);
    confetti(scene, mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0)), true);

    const en = currentQ?.prompt?.en || "";
    speak(en);
  } else {
    gameState.streak = 0;
    playWrong();
    if (via === "controller" && controllerObj) hapticBad(controllerObj);
    confetti(scene, mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0)), false);
  }

  const topic = currentQ?.prompt?.topic || gameState.selectedTopic || "All";
  const enPrompt = currentQ?.prompt?.en || "";
  updateWordStats(topic, enPrompt, ok);

  if (adaptiveOn && !reviewMode.active) {
    const idx = retryQueue.findIndex(it => it.en === enPrompt);
    if (ok) {
      if (idx >= 0) retryQueue.splice(idx, 1);
    } else {
      if (idx >= 0) {
        const item = retryQueue[idx];
        if (item.attempts < ADAPT.maxRetries) {
          item.attempts += 1;
          item.dueAt = gameState.questionsAsked + ADAPT.retryAfter;
        } else {
          retryQueue.splice(idx, 1);
        }
      } else {
        retryQueue.push({
          en: enPrompt, topic,
          dueAt: gameState.questionsAsked + ADAPT.retryAfter,
          attempts: 1
        });
      }
    }
  }

  // Lösungs-Overlay
  const tb = tablePlacer.getBounds();
  const de = currentQ?.prompt?.de || "";
  hud.showSolution({ en: enPrompt, de }, tb, camera);

  hud.update(gameState, ok, progressValue());
  gameState.phase = "showFeedback";
  hud.updateControls({
    topic: gameState.selectedTopic || "All",
    roundSize: gameState.roundSize,
    phase: gameState.phase,
    autoAdvance: AUTO_ADV_MS,
    adaptiveEnabled: adaptiveOn
  });

  const showMs = Math.min(CONFIG.hud.solution.showMs || 1000, AUTO_ADV_MS || 1000);

  if (AUTO_ADV_MS > 0) {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      autoTimer = null;
      hud.hideSolution();
      if (gameState.questionsAsked >= gameState.roundSize) gameOver();
      else startQuestionRound(tablePlacer.getBounds());
    }, Math.max(showMs, 300));
  }
}

/* -------------------- Game Over -------------------- */
function gameOver() {
  gameState.phase = "finished";
  acceptingAnswers = false;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }

  const total = gameState.roundSize;
  const acc = total > 0 ? Math.round((gameState.correctCount / total) * 100) : 0;

  hud.updateControls({
    topic: gameState.selectedTopic || "All",
    roundSize: gameState.roundSize,
    phase: gameState.phase,
    autoAdvance: AUTO_ADV_MS,
    adaptiveEnabled: adaptiveOn
  });
  hud.update(gameState, null, 1);

  const topic = gameState.selectedTopic || "All";
  const best = updateStatsOnGameOver(topic, {
    score: gameState.score,
    correct: gameState.correctCount,
    total,
    bestStreak: gameState.bestStreak
  });

  lastHardWords = getHardestWords(wordsPkg, topic, 3);

  hud.showSummary({
    score: gameState.score,
    correct: gameState.correctCount,
    total,
    accuracyPct: acc,
    bestStreak: gameState.bestStreak
  }, {
    bestScore: best.bestScore,
    bestStreak: best.bestStreak,
    bestAccuracyPct: best.bestAccuracyPct
  }, lastHardWords);

  console.log("[Game] Runde beendet. Score:", gameState.score, "Accuracy:", acc+"%", "BestStreak:", gameState.bestStreak, "Hard:", lastHardWords.map(w=>w.en).join(", "));
}

/* -------------------- Intersections -------------------- */
function intersectObjectsFromController(ctrlObj, objects) {
  if (!objects?.length || !ctrlObj) return null;
  const m = ctrlObj.matrixWorld;
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(m));
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(objects, true);
  return hits[0] || null;
}
function intersectUIFromController(ctrlObj) {
  if (!hud) return null;
  const uiObjs = hud.getUIObjects().filter(Boolean);
  const hit = intersectObjectsFromController(ctrlObj, uiObjs);

  if (uiObjs?.length) {
    const btns = uiObjs.filter(o => o.userData?.uiButton);
    btns.forEach(b => hud.setButtonHover(b, false));
    if (hit) {
      const action = hit.object?.userData?.action;
      const matchBtn = btns.find(b => (b.userData?.uiButton && b.userData?.action === action)) ||
                       btns.find(b => b === hit.object);
      if (matchBtn) hud.setButtonHover(matchBtn, true);
    }
  }

  if (hit && (hit.object?.userData?.action || hit.object?.userData?.uiButton)) {
    const action = hit.object.userData.action ||
                   (hit.object.userData.uiButton && hit.object.userData.action);
    if (action) {
      hit.object.userData.action = action;
      return hit;
    }
  }
  return null;
}
function intersectAnswersFromController(ctrlObj) {
  if (!answersGroup || !ctrlObj) return null;
  return intersectObjectsFromController(ctrlObj, answersGroup.children);
}
function intersectResizeFromController(ctrlObj) {
  const g = tablePlacer?.handleGroup;
  if (!g || !g.visible || !ctrlObj) return null;
  return intersectObjectsFromController(ctrlObj, g.children);
}
function intersectRotateFromController(ctrlObj) {
  const h = tablePlacer?.rotateHandle;
  if (!h || !h.visible || !ctrlObj) return null;
  const m = ctrlObj.matrixWorld;
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(m));
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObject(h, true);
  return hits[0] || null;
}
function intersectPlateFromController(ctrlObj) {
  const plate = tablePlacer?.plate;
  if (!plate || !ctrlObj) return null;
  return intersectObjectsFromController(ctrlObj, [plate]);
}
function withinDistance(point, cam, maxDist) {
  if (!point || !cam || !maxDist) return true;
  const camPos = new THREE.Vector3(); cam.getWorldPosition(camPos);
  return camPos.distanceTo(point) <= maxDist;
}

/* -------------------- Frame -------------------- */
function updateReticles() {
  let any = false;
  controllers.forEach((c) => {
    if (!c?.obj) return;
    const pos = pointInFrontOfController(c.obj, CONFIG.placement.airDistance ?? 1.0);
    const handed = c.handedness || "right";
    tablePlacer.showReticleAtFor(handed, pos);
    any = true;
  });
  if (!any) tablePlacer.hideReticles();
}

function onXRFrame(time, frame) {
  const session = renderer.xr.getSession?.();
  if (!session) return;

  updateReticles();

  if (tablePlacer.dragging && activeCtrl) {
    const cursor = pointInFrontOfController(activeCtrl, CONFIG.placement.airDistance ?? 1.0);
    tablePlacer.updateDrag(cursor);
  }

  if (tablePlacer.resizing && activeCtrl) {
    const y = tablePlacer.surfaceY;
    const cursor = rayOnPlaneY(activeCtrl, y) || pointInFrontOfController(activeCtrl, 1.0);
    tablePlacer.updateResize(cursor);
    const tb = tablePlacer.getBounds();
    relayoutLocal(tb);
    hud.attachToTable(tb, { side: "cameraOpposite", camera });
  }

  if (tablePlacer.moving && activeCtrl) {
    const y = tablePlacer.surfaceY;
    const cursor = rayOnPlaneY(activeCtrl, y) || pointInFrontOfController(activeCtrl, 1.0);
    tablePlacer.updateMove(cursor);
    const tb = tablePlacer.getBounds();
    hud.attachToTable(tb, { side: "cameraOpposite", camera });
  }

  if (tablePlacer.rotating && activeCtrl) {
    const y = tablePlacer.surfaceY;
    const cursor = rayOnPlaneY(activeCtrl, y) || pointInFrontOfController(activeCtrl, 1.0);
    tablePlacer.updateRotate(cursor);
    const tb = tablePlacer.getBounds();
    hud.attachToTable(tb, { side: "cameraOpposite", camera });
  }

  updateControllerPointersAndHover();
  renderer.render(scene, camera);
}

function updateControllerPointersAndHover() {
  const targets = [];
  if (answersGroup) targets.push(...answersGroup.children);
  const handles = tablePlacer?.handleGroup?.children || [];
  if (handles.length) targets.push(...handles);
  if (tablePlacer?.rotateHandle) targets.push(tablePlacer.rotateHandle);
  const uiTargets = hud?.getUIObjects?.() || [];
  if (uiTargets.length) targets.push(...uiTargets);

  const extraTargets = [tablePlacer?.plate].filter(Boolean);

  let hoverHit = null;

  controllers.forEach((c) => {
    const m = c.obj.matrixWorld;
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(m)).normalize();

    raycaster.set(origin, dir);
    let hits = targets.length ? raycaster.intersectObjects(targets, true) : [];

    let color = c.pointer.baseColor;
    let length = c.pointer.maxLen;
    let lineOpacity = 0.12;
    let dotOpacity = 0.0;

    if (hits.length) {
      const h = hits[0];
      length = Math.min(length, h.distance);
      color = c.pointer.highlight;
      lineOpacity = 0.95;
      dotOpacity = 0.95;

      if (placingDone && acceptingAnswers && answersGroup && answersGroup.children.includes(h.object)) {
        if (!hoverHit || h.distance < hoverHit.distance) hoverHit = h;
      }
    } else {
      const hits2 = extraTargets.length ? raycaster.intersectObjects(extraTargets, true) : [];
      if (hits2.length) {
        length = Math.min(length, hits2[0].distance);
        lineOpacity = 0.35;
        dotOpacity = 0.0;
      } else {
        length = 0.6;
        lineOpacity = 0.12;
        dotOpacity = 0.0;
      }
    }

    setPointer(c.pointer, length, color, lineOpacity, dotOpacity);
  });

  const list = hoverHit ? [{ object: hoverHit.object, point: hoverHit.point }] : [];
  if (answersGroup) {
    const resetFn = updateHoverEffect(list);
    resetFn(answersGroup);
  }
}
