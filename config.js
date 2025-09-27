export const CONFIG = {
  table: {
    defaultWidth: 0.9,
    defaultHeight: 0.6,
    minWidth: 0.6,
    minHeight: 0.4,
    maxWidth: 1.8,
    maxHeight: 1.2,
    color: 0x2e7d32
  },

  placement: {
    airDistance: 1.0
  },

  input: {
    hoverThrottleMs: 60,
    controller: { selectDebounceMs: 220, maxSelectDistance: 3.0 },
    hands:      { pinchOn: 0.018, pinchOff: 0.028, selectDebounceMs: 280, maxSelectDistance: 2.5 }
  },

  scoring: {
    correctPoints: 100,
    streakBonus: 0.15
  },

  gameplay: {
    autoAdvanceMs: 1200
  },

  cards: {
    answer: { width: 0.20, height: 0.10, ppm: 2000, fontPx: 180, pad: 28, minFontPx: 70 },
    image:  { width: 0.24, height: 0.24, ppm: 1800, emojiPx: 220, dePx: 96, pad: 30, minDePx: 50, minEmojiPx: 120 },
    colors: {
      bg: "#13212f",
      fg: "#e3f2fd",
      stroke: "#90caf9",
      hover: "#bbdefb",
      correct: "#2e7d32",
      wrong: "#b71c1c"
    },
    layout: {
      padEdge: 0.05,
      gap: 0.04,
      imageSide: "top",
      gridCols: 2,
      tiltDeg: 0
    }
  },

  hud: {
    panel: {
      height: 0.12,
      widthRelativeToTable: 0.34,
      minWidth: 0.42,
      maxWidth: 0.95,
      ppm: 1600,
      minCanvas: 1024,
      maxCanvas: 3072
    },
    bg: "#0b1320",
    fg: "#e3f2fd",
    accentOk: "rgba(46,125,50,0.6)",
    accentBad: "rgba(183,28,28,0.6)",
    marginZ: 0.05,
    outsideOffset: 0.06,
    yOffset: 0.02,
    tiltDeg: 8,
    // Menü etwas höher:
    controls: {
      lift: 0.30,          // vorher 0.22 – jetzt höher
      frontOffsetZ: 0.04   // leicht vorziehen
    },
    summary: {
      lift: 0.50,
      frontOffsetZ: 0.06
    },
    // höhere Render-Ordnung für die Summary, damit sie sicher oben liegt
    zorder: {
      base: 10,
      controls: 40,
      panels: 50,
      solution: 80,
      summary: 200
    },
    solution: {
      width: 0.44,
      height: 0.20,
      yLift: 0.18,
      tiltDeg: 12,
      showMs: 1000,
      colors: {
        bg: "#0e2236",
        border: "#90caf9",
        en: "#ffffff",
        de: "#bbdefb"
      }
    }
  },

  tts: {
    enabled: true,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0
  },

  adaptive: {
    enabled: true,
    retryAfter: 3,
    maxRetries: 2,
    weightFactor: 1.2,
    reviewMax: 5
  }
};
