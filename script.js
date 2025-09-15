// ===== VARIABLES GLOBALES =====
let audioElements = {};
let activeAudios = new Set();
let globalVolume = 0.5;
// === WebAudio mixeur ===
let audioCtx = null;          // AudioContext
let masterGain = null;        // gain global
const gainNodes = {};         // { pluie: GainNode, mer: GainNode, ... }
let audioUnlocked = false;    // iOS: déverrouiller le contexte au 1er geste

// Empêche les raccourcis de s'activer quand on tape dans un champ
function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

let perSoundGains = {};  // { pluie: 1.0, ... }
let perSoundMutes = {};  // { pluie: false, ... }

// ===== INITIALISATION =====
document.addEventListener('DOMContentLoaded', function() {
    initializeAudio();
    setupAudioGraph();        // câble les <audio> dans le mixeur WebAudio
unlockAudioContextOnce(); // déverrouillage iOS au 1er geste
    initializeParticles();
    initializeSoundButtons();
    initializeVolumeControl();
    initializeStopButton();
    initializeCursor();
    initializePerTileMixers(); // mini-mixers sous chaque son
    initializeNotes(); // // INSERT: active le Bloc Notes
    initializeTodo(); // // INSERT: active la To-Do list
    initializeTimer(); // // INSERT: active le timer
        initializeStarfield(); // // INSERT: fond spatial (étoiles + filantes)
const yn = document.getElementById('yearNow');
if (yn) yn.textContent = new Date().getFullYear();
    
    console.log('🎵 NeuroFocus initialized - Ready for immersive focus!');
});


// ===== GESTION DU CURSEUR PERSONNALISÉ =====
function initializeCursor() {
  // valeurs par défaut (hors écran au chargement)
  document.documentElement.style.setProperty('--cursor-x', '-100px');
  document.documentElement.style.setProperty('--cursor-y', '-100px');

  const handler = (e) => {
    // ⚠️ bien 2 tirets (--) et sur documentElement (robuste)
    document.documentElement.style.setProperty('--cursor-x', e.clientX + 'px');
    document.documentElement.style.setProperty('--cursor-y', e.clientY + 'px');
  };

  // écouteur global (plus fiable que 'document' selon overlays)
  window.addEventListener('mousemove', handler, { passive: true });

  // petit log pour vérifier que la fonction est bien appelée
  console.log('[cursor] init OK');
}

// ===== INITIALISATION AUDIO =====
function initializeAudio() {
  const soundTypes = [
    'pluie','mer','cafe','feu','vent','bibliotheque','foret','synthwave',
    'lofi','casino','oiseaux','cigales','cheminee','jazz','classique','bruitblanc','temple','nuit'
  ];

  soundTypes.forEach(sound => {
    const audioElement = document.getElementById(`audio-${sound}`);
    if (audioElement) {
      audioElements[sound] = audioElement;
      audioElement.volume = globalVolume;

      // Logs/erreurs (facultatif)
      audioElement.addEventListener('error', function() {
        console.warn(`⚠️ Audio file not found: sons/${sound}.mp3`);
      });
      audioElement.addEventListener('loadstart', function() {
        console.log(`🎵 Loading audio: ${sound}`);
      });
    }
  });
}

// ===== MIXEUR PAR SON =====
function initializeMixer() {
    const grid = document.getElementById('mixerGrid');
    if (!grid) return;

    // Prépare les gains/mutes pour chaque son connu
    Object.keys(audioElements).forEach((key) => {
        if (perSoundGains[key] === undefined) perSoundGains[key] = 1.0;
        if (perSoundMutes[key] === undefined) perSoundMutes[key] = false;
    });

    // Construit l'UI
    grid.innerHTML = '';
    Object.keys(audioElements).forEach((key) => {
        const row = document.createElement('div');
        row.className = 'mixer-row';

        const label = document.createElement('div');
        label.className = 'mixer-name';
        label.textContent = getSoundDisplayName(key);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.value = String(Math.round((perSoundGains[key] ?? 1) * 100));
        slider.className = 'mixer-slider';
        slider.setAttribute('data-sound', key);

        const value = document.createElement('div');
        value.className = 'mixer-value';
        value.textContent = `${slider.value}%`;

        const mute = document.createElement('button');
        mute.className = 'mute-btn' + ((perSoundMutes[key] ?? false) ? ' active' : '');
        mute.textContent = (perSoundMutes[key] ?? false) ? 'Muet' : 'Mute';
        mute.setAttribute('data-sound', key);

        // Events
        slider.addEventListener('input', (e) => {
            const s = e.target.getAttribute('data-sound');
            const v = parseInt(e.target.value, 10) / 100;
            perSoundGains[s] = v;
            value.textContent = `${e.target.value}%`;
            applyVolumeForSound(s);
        });

        mute.addEventListener('click', (e) => {
            const s = e.target.getAttribute('data-sound');
            perSoundMutes[s] = !perSoundMutes[s];
            e.target.classList.toggle('active', perSoundMutes[s]);
            e.target.textContent = perSoundMutes[s] ? 'Muet' : 'Mute';
            applyVolumeForSound(s);
        });

        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(value);
        row.appendChild(mute);
        grid.appendChild(row);
    });
}

function effectiveGain(soundKey) {
    const base = perSoundGains[soundKey] ?? 1.0;
    const muted = perSoundMutes[soundKey] ?? false;
    return muted ? 0 : base;
}

function applyVolumeForSound(soundKey) {
  const g = gainNodes[soundKey];
  if (!g) return;
  const base = perSoundGains[soundKey] ?? 1.0;
  const muted = perSoundMutes[soundKey] ?? false;
  const per = muted ? 0 : Math.max(0, Math.min(1, base));
  g.gain.value = per; // gain par son (0..1)
}

function applyGlobalVolume() {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, globalVolume));
}


/// // INSERT START: BLOC NOTES (textarea + Enregistrer + Historique, sans limite)
function initializeNotes() {
  const textarea   = document.getElementById('notesTextarea');
  const clearBtn   = document.getElementById('notesClearBtn');
  const saveBtn    = document.getElementById('notesSaveBtn');
  const historyBox = document.getElementById('notesHistory');

  // Compteur facultatif : on l'utilise seulement s'il existe déjà dans ton HTML
  const counter    = document.getElementById('notesCounter');

  if (!textarea || !clearBtn || !saveBtn || !historyBox) return;

  const DRAFT_KEY   = 'notes:draft';
  const HISTORY_KEY = 'notes:history';

  // Helpers localStorage
  const loadHistory = () => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  };
  const saveHistory = (arr) => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch {}
  };

  // Rendu de l'historique
  const renderHistory = () => {
    const items = loadHistory().slice().reverse(); // plus récent en haut
    historyBox.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-item';
      empty.innerHTML = '<div class="history-text" style="opacity:.8">Aucune note enregistrée pour le moment.</div>';
      historyBox.appendChild(empty);
      return;
    }

    items.forEach((it) => {
      const wrap = document.createElement('div');
      wrap.className = 'history-item';

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      meta.textContent = new Date(it.ts).toLocaleString();

      const text = document.createElement('div');
      text.className = 'history-text';
      text.textContent = it.text;

      const left = document.createElement('div');
      left.appendChild(meta);
      left.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'history-actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'history-btn';
      loadBtn.textContent = 'Charger';
      loadBtn.setAttribute('data-action', 'load');
      loadBtn.setAttribute('data-id', String(it.id));

      const delBtn = document.createElement('button');
      delBtn.className = 'history-btn';
      delBtn.textContent = 'Supprimer';
      delBtn.setAttribute('data-action', 'delete');
      delBtn.setAttribute('data-id', String(it.id));

      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);

      wrap.appendChild(left);
      wrap.appendChild(actions);
      historyBox.appendChild(wrap);
    });
  };

  // Compteur facultatif
  const updateCount = () => {
    if (!counter) return;
    counter.textContent = `${textarea.value.length} caractère(s)`;
  };

  // Charger le brouillon
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) textarea.value = draft;
  } catch {}

  // Sauvegarde du brouillon à la frappe + compteur
  textarea.addEventListener('input', () => {
    updateCount();
    try { localStorage.setItem(DRAFT_KEY, textarea.value); } catch {}
  });

  // Effacer la note courante
  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    textarea.value = '';
    updateCount();
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    // notifier les autres listeners éventuels
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // feedback visuel
    clearBtn.style.transform = 'scale(0.96)';
    setTimeout(() => (clearBtn.style.transform = ''), 120);
    // showNotification && showNotification('🧹 Note effacée', 'info');
  });

  // Enregistrer -> ajoute au historique
  saveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = textarea.value;
    if (!text || !text.trim()) {
      saveBtn.style.transform = 'scale(0.96)';
      setTimeout(() => (saveBtn.style.transform = ''), 120);
      return;
    }
    const entry = { id: Date.now(), ts: Date.now(), text };
    const arr = loadHistory();
    arr.push(entry);
    saveHistory(arr);
    renderHistory();
    // feedback
    saveBtn.style.transform = 'scale(0.96)';
    setTimeout(() => (saveBtn.style.transform = ''), 120);
    // showNotification && showNotification('💾 Note enregistrée', 'success');
  });

  // Délégation des clics sur l'historique (Charger / Supprimer)
  historyBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.history-btn');
    if (!btn) return;

    const id = Number(btn.getAttribute('data-id'));
    const action = btn.getAttribute('data-action');
    const arr = loadHistory();

    if (action === 'load') {
      const found = arr.find(x => x.id === id);
      if (found) {
        textarea.value = found.text;
        updateCount();
        try { localStorage.setItem(DRAFT_KEY, textarea.value); } catch {}
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (action === 'delete') {
      const next = arr.filter(x => x.id !== id);
      saveHistory(next);
      renderHistory();
    }
  });

  // Init
  updateCount();
  renderHistory();
}
// // INSERT END

// ===== MINI-MIXERS SOUS CHAQUE SON =====
// Transforme la grille: enveloppe chaque .sound-btn dans un "cell" avec slider+mute
function initializePerTileMixers() {
  const grid = document.querySelector('.sound-grid');
  if (!grid) return;

  // Liste figée, car on va réorganiser le DOM
  const buttons = Array.from(grid.querySelectorAll('.sound-btn'));

  buttons.forEach((btn) => {
    const sound = btn.getAttribute('data-sound');
    if (!sound) return;

    // Valeurs par défaut
    if (perSoundGains[sound] === undefined) perSoundGains[sound] = 1.0;
    if (perSoundMutes[sound] === undefined) perSoundMutes[sound] = false;

    // Crée un conteneur "carte"
    const cell = document.createElement('div');
    cell.className = 'sound-cell';

    // Insère le conteneur à la place du bouton et y déplace le bouton
    grid.insertBefore(cell, btn);
    cell.appendChild(btn);

    // Ajoute le mini-mixer
    const controls = document.createElement('div');
    controls.className = 'tile-mixer';
    controls.innerHTML = `
  <input type="range" min="0" max="100"
         value="${Math.round((perSoundGains[sound] ?? 1) * 100)}"
         class="tile-slider" data-sound="${sound}"
         aria-label="Volume ${sound}">
`;

    cell.appendChild(controls);

    // Wiring événements
    const slider = controls.querySelector('.tile-slider');

slider.addEventListener('input', () => {
  const v = parseInt(slider.value, 10) / 100;
  perSoundGains[sound] = v;
  applyVolumeForSound(sound);
});
// iOS déclenche surtout 'change'
slider.addEventListener('change', () => {
  const v = parseInt(slider.value, 10) / 100;
  perSoundGains[sound] = v;
  applyVolumeForSound(sound);
});

// éviter que le tap sur le slider clique la tuile au-dessus (mobile)
slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
slider.addEventListener('pointerdown', (e) => e.stopPropagation());

  });
}

// // INSERT START: To-Do Onglets (× à gauche, + à droite, messages centraux)
function initializeTodo() {
  const list = document.getElementById('todoList');
  if (!list) return;

  const KEY = 'todo:items';

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  };
  const save = (arr) => {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {}
  };

  let items = load();

  function createOnglet({ text, id, type }) {
    // type: 'item' | 'adder-empty' | 'adder'
    const li = document.createElement('li');
    li.className = 'todo-onglet';

    // bouton gauche (croix)
    const left = document.createElement('button');
    left.className = 'onglet-btn del';
    left.textContent = '×';

    // centre (texte)
    const center = document.createElement('div');
    center.className = 'onglet-text';
    center.textContent = text;

    // bouton droit (plus)
    const right = document.createElement('button');
    right.className = 'onglet-btn add';
    right.textContent = '+';

    // wiring selon type
    if (type === 'item') {
      // croix = supprimer CETTE tâche
      left.setAttribute('aria-label', 'Supprimer cette tâche');
      left.addEventListener('click', () => {
        items = items.filter(x => x.id !== id);
        save(items);
        render();
      });
      // pas d'action sur le plus pour les items (ou on peut l’utiliser pour dupliquer)
      right.style.display = 'none';
    } else if (type === 'adder-empty') {
      // état vide : center = "Aucune tâche, ajoute la première ci-dessus"
      left.setAttribute('aria-label', 'Vider la liste');
      left.addEventListener('click', () => {
        items = [];
        save(items);
        render();
      });
      right.setAttribute('aria-label', 'Ajouter la première tâche');
      right.addEventListener('click', () => addTaskFlow());
    } else if (type === 'adder') {
      // adder bas de liste (après au moins 1 tâche) : "Ajouter une autre tâche"
      left.setAttribute('aria-label', 'Effacer toutes les tâches');
      left.addEventListener('click', () => {
        items = [];
        save(items);
        render();
      });
      right.setAttribute('aria-label', 'Ajouter une autre tâche');
      right.addEventListener('click', () => addTaskFlow());
    }

    li.appendChild(left);
    li.appendChild(center);
    li.appendChild(right);
    return li;
  }

  function addTaskFlow() {
    // flux simple : prompt (rapide). Si tu veux un input inline, je peux le coder.
    const txt = window.prompt('Nouvelle tâche :');
    if (!txt) return;
    const trimmed = txt.trim();
    if (!trimmed) return;

    items.push({ id: Date.now(), text: trimmed });
    save(items);
    render();
  }

  function render() {
    list.innerHTML = '';

    if (items.length === 0) {
      // État vide : un seul onglet "Aucune tâche…" avec + à droite et × à gauche
      list.appendChild(createOnglet({
        type: 'adder-empty',
        text: 'Aucune tâche, ajoute la première ci-dessus'
      }));
      return;
    }

    // Tâches existantes -> un onglet par tâche
    items.forEach(it => {
      list.appendChild(createOnglet({
        type: 'item',
        id: it.id,
        text: it.text
      }));
    });

    // Onglet "Ajouter une autre tâche" en bas
    list.appendChild(createOnglet({
      type: 'adder',
      text: 'Ajouter une autre tâche'
    }));
  }

  render();
}
// // INSERT END: To-Do Onglets

// // INSERT START: Starfield (sobre & épuré — étoiles + étoiles filantes)
function initializeStarfield() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Densités (tu peux ajuster)
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const BASE_STARS = window.innerWidth >= 1024 ? 220 : 140; // nombre d'étoiles statiques
  const SHOOTING_MIN_DELAY = 2000; // ms
  const SHOOTING_MAX_DELAY = 6000; // ms
  const SHOOTING_SPEED = 900;      // px/s (à 1x DPR)
  const TRAIL_FADE = 0.075;        // 0.05–0.12 : persistance de la traînée

  let W = 0, H = 0, stars = [], shots = [];
  let lastTs = 0, timerNextShot = 0;

  function resize() {
    W = canvas.width  = Math.floor(window.innerWidth  * DPR);
    H = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width  = '100%';
    canvas.style.height = '100%';
    // (re)génère les étoiles
    stars = Array.from({ length: BASE_STARS }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: (Math.random() * 1.2 + 0.3) * DPR,     // rayon small
      a: Math.random() * 0.5 + 0.4,             // alpha base
      tw: (Math.random() * 0.8 + 0.4) * 0.6     // vitesse de scintillement
    }));
  }

  function scheduleNextShot(now) {
    const delay = SHOOTING_MIN_DELAY + Math.random() * (SHOOTING_MAX_DELAY - SHOOTING_MIN_DELAY);
    timerNextShot = now + delay;
  }

  function spawnShot() {
    // point de départ: bord haut-gauche (hors écran), direction diagonale
    const startEdge = Math.random() < 0.5 ? 'top' : 'left';
    let x, y, vx, vy;
    if (startEdge === 'top') {
      x = Math.random() * (W * 0.6);
      y = -30 * DPR;
    } else {
      x = -30 * DPR;
      y = Math.random() * (H * 0.5);
    }
    const angle = (15 + Math.random() * 20) * (Math.PI / 180); // 15–35°
    const speed = SHOOTING_SPEED * DPR * (0.9 + Math.random() * 0.2);
    // direction vers bas-droite
    vx = Math.cos(angle) * speed;
    vy = Math.sin(angle) * speed;

    shots.push({
      x, y, vx, vy,
      life: 0,
      maxLife: 900 + Math.random() * 700, // durée (ms)
      width: 1.2 * DPR
    });
  }

  function drawStars(dt) {
    // scintillement discret
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = (Math.sin((performance.now() * 0.001 + i) * s.tw) * 0.25 + 0.75) * s.a;
      ctx.globalAlpha = tw;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = '#dfe7ff';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i];
      sh.life += dt;
      sh.x += sh.vx * (dt / 1000);
      sh.y += sh.vy * (dt / 1000);

      // tête de l'étoile filante
      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.95;
      ctx.arc(sh.x, sh.y, 1.6 * DPR, 0, Math.PI * 2);
      ctx.fill();

      // traînée
      const trailLen = 120 * DPR;
      const tailX = sh.x - (sh.vx / SHOOTING_SPEED) * trailLen;
      const tailY = sh.y - (sh.vy / SHOOTING_SPEED) * trailLen;
      const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0.0)');

      ctx.strokeStyle = grad;
      ctx.lineWidth = sh.width;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // fin de vie / sortie d'écran
      if (sh.life > sh.maxLife || sh.x > W + 50 * DPR || sh.y > H + 50 * DPR) {
        shots.splice(i, 1);
      }
    }
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(50, ts - lastTs); // clamp pour stabilité
    lastTs = ts;

    // léger “ghost clear” pour des traînées douces sans tout effacer
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(7,11,20,${TRAIL_FADE})`; // très sombre + alpha faible
    ctx.fillRect(0, 0, W, H);

    // étoiles statiques
    drawStars(dt);

    // shots
    drawShots(dt);

    // planifier un prochain tir
    if (ts >= timerNextShot) {
      spawnShot();
      scheduleNextShot(ts);
    }

    requestAnimationFrame(loop);
  }

  // init
  resize();
  scheduleNextShot(performance.now() + 1000);
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);

  window.addEventListener('resize', resize, { passive: true });
  requestAnimationFrame(loop);
}
// // INSERT END: Starfield

// // INSERT START: Timer (editable, start/pause/reset + presets)
function initializeTimer() {
  const panel   = document.querySelector('.timer-panel');
  const input   = document.getElementById('timerInput');
  const startBt = document.getElementById('timerStartBtn');
  const pauseBt = document.getElementById('timerPauseBtn');
  const resetBt = document.getElementById('timerResetBtn');
  const display = document.getElementById('timerDisplay');
  const chips   = Array.from(document.querySelectorAll('.timer-chip'));
  if (!panel || !input || !startBt || !pauseBt || !resetBt || !display) return;

  const KEY = 'timer:last';
  let totalMs = 0;
  let leftMs  = 0;
  let running = false;
  let rafId   = null;
  let lastTs  = 0;

  // Empêcher que la barre d’espace/Echap/Flèches déclenchent les raccourcis globaux quand on agit dans le timer
  panel.addEventListener('keydown', (e) => {
    const k = e.key || e.code;
    if (k === ' ' || k === 'Space' || k === 'Escape' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.stopPropagation();
    }
  });

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function parseTime(str) {
    // formats: "mm:ss" ou "hh:mm:ss" ou "m" (minutes)
    if (!str) return 0;
    const s = String(str).trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) { // minutes seules
      return parseInt(s, 10) * 60 * 1000;
    }
    const parts = s.split(':').map(x => parseInt(x, 10) || 0);
    let h=0,m=0,sec=0;
    if (parts.length === 2) { [m,sec] = parts; }
    else if (parts.length === 3) { [h,m,sec] = parts; }
    else return 0;
    m = clamp(m, 0, 59); sec = clamp(sec, 0, 59);
    return ((h*3600)+(m*60)+sec)*1000;
  }

  function fmt(ms) {
    ms = Math.max(0, ms|0);
    let s = Math.floor(ms/1000);
    const h = Math.floor(s/3600); s -= h*3600;
    const m = Math.floor(s/60);   s -= m*60;
    const pad = (n)=> (n<10?'0':'')+n;
    return h>0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function setButtons() {
    startBt.textContent = running ? 'Reprendre' : 'Démarrer';
    startBt.disabled = running;          // quand ça tourne, on ne peut pas redémarrer
    pauseBt.disabled = !running;         // pause active uniquement en cours
  }

  function updateDisplay() {
    display.textContent = fmt(leftMs);
    document.title = `${fmt(leftMs)} • NeuroFocus`; // petit rappel dans l’onglet
  }

  function tick(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    leftMs = Math.max(0, leftMs - dt);
    updateDisplay();

    if (leftMs <= 0) {
      running = false;
      setButtons();
      showNotification && showNotification('⏰ Timer terminé', 'success');
      // petit feedback visuel
      display.style.transform = 'scale(1.03)';
      setTimeout(()=> display.style.transform = '', 160);
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function startFromInput() {
    const ms = parseTime(input.value);
    if (ms <= 0) {
      showNotification && showNotification('Entrez une durée valide (hh:mm:ss ou mm:ss)', 'warning');
      return;
    }
    totalMs = leftMs = ms;
    try { localStorage.setItem(KEY, input.value.trim()); } catch {}
    lastTs = 0;
    running = true;
    setButtons();
    updateDisplay();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  // Events
  startBt.addEventListener('click', () => {
    if (!running) {
      if (leftMs <= 0) startFromInput();
      else { // reprise si il reste du temps
        running = true; setButtons(); lastTs = 0;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(tick);
      }
    }
  });

  pauseBt.addEventListener('click', () => {
    if (running) {
      running = false; setButtons();
      cancelAnimationFrame(rafId);
      lastTs = 0;
    }
  });

  resetBt.addEventListener('click', () => {
    running = false; setButtons();
    cancelAnimationFrame(rafId);
    leftMs = totalMs = parseTime(input.value) || 0;
    lastTs = 0;
    updateDisplay();
  });

  input.addEventListener('change', () => {
    // Met à jour la durée par défaut sans démarrer
    const ms = parseTime(input.value);
    totalMs = leftMs = ms;
    try { localStorage.setItem(KEY, input.value.trim()); } catch {}
    updateDisplay();
  });

  chips.forEach(ch => {
    ch.addEventListener('click', () => {
      const v = ch.getAttribute('data-preset');
      input.value = v;
      const ms = parseTime(v);
      totalMs = leftMs = ms;
      try { localStorage.setItem(KEY, v); } catch {}
      updateDisplay();
      // petit feedback
      ch.style.transform = 'scale(0.97)';
      setTimeout(()=> ch.style.transform = '', 120);
    });
  });

  // Init (charge la dernière durée si présente)
  try {
    const last = localStorage.getItem(KEY);
    if (last) input.value = last;
  } catch {}
  if (!input.value) input.value = '25:00';
  leftMs = totalMs = parseTime(input.value);
  updateDisplay();
  setButtons();
}
// // INSERT END: Timer

// Crée l'AudioContext et un GainNode pour chaque <audio>
function setupAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.gain.value = globalVolume;   // 0..1
    masterGain.connect(audioCtx.destination);
  }
  // câble chaque <audio> -> gain par son -> master
  Object.entries(audioElements).forEach(([sound, el]) => {
    if (gainNodes[sound]) return;
    try {
      const src = audioCtx.createMediaElementSource(el);
      const g = audioCtx.createGain();
      g.gain.value = 1.0;
      src.connect(g).connect(masterGain);
      gainNodes[sound] = g;
    } catch (e) {
      console.debug('MediaElementSource déjà créé pour', sound);
    }
  });
}

// iOS: activer le contexte au 1er geste
function unlockAudioContextOnce() {
  if (audioUnlocked || !audioCtx) return;
  const resume = () => {
    audioCtx.resume().finally(() => {
      audioUnlocked = true;
      window.removeEventListener('touchend', resume);
      window.removeEventListener('mousedown', resume);
      window.removeEventListener('keydown', resume);
    });
  };
  window.addEventListener('touchend', resume, { once: true, passive: true });
  window.addEventListener('mousedown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
}


// ===== PARTICULES FLOTTANTES =====
function initializeParticles() {
    const particlesContainer = document.getElementById('particles');
    const particleCount = 25;
    
    for (let i = 0; i < particleCount; i++) {
        createParticle(particlesContainer);
    }
    
    // Créer de nouvelles particules périodiquement
    setInterval(() => {
        if (particlesContainer.children.length < particleCount) {
            createParticle(particlesContainer);
        }
    }, 2000);
}

function createParticle(container) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    
    // Position et taille aléatoires
    const startX = Math.random() * window.innerWidth;
    const size = Math.random() * 3 + 1;
    
    particle.style.left = startX + 'px';
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.animationDelay = Math.random() * 20 + 's';
    
    container.appendChild(particle);
    
    // Supprimer la particule après l'animation
    setTimeout(() => {
        if (particle.parentNode) {
            particle.parentNode.removeChild(particle);
        }
    }, 25000);
}

// ===== BOUTONS DE SONS =====
function initializeSoundButtons() {
    const soundButtons = document.querySelectorAll('.sound-btn');
    
    soundButtons.forEach(button => {
        button.addEventListener('click', function() {
            const soundType = this.getAttribute('data-sound');
            toggleSound(soundType, this);
        });
        
        // Effet de hover avec son
        button.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-3px) scale(1.02)';
        });
        
        button.addEventListener('mouseleave', function() {
            if (!this.classList.contains('active')) {
                this.style.transform = 'translateY(0) scale(1)';
            }
        });
    });
}

// ===== TOGGLE SOUND =====
function toggleSound(soundType, buttonElement) {
    const audio = audioElements[soundType];
    
    if (!audio) {
        showNotification(`Son "${soundType}" non disponible`, 'error');
        return;
    }
    
    if (activeAudios.has(soundType)) {
        // Arrêter le son
        audio.pause();
        audio.currentTime = 0;
        activeAudios.delete(soundType);
        buttonElement.classList.remove('active');
        buttonElement.style.transform = 'translateY(0) scale(1)';
        
        showNotification(`${getSoundDisplayName(soundType)} arrêté`, 'info');
    } else {
        // Jouer le son
        audio.volume = Math.max(0, Math.min(1, globalVolume * effectiveGain(soundType)));
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                activeAudios.add(soundType);
                buttonElement.classList.add('active');
                buttonElement.style.transform = 'translateY(-2px) scale(1.05)';
                
                showNotification(`${getSoundDisplayName(soundType)} activé`, 'success');
            }).catch(error => {
                console.error('Erreur de lecture:', error);
                showNotification(`Erreur lors de la lecture de ${soundType}`, 'error');
            });
        }
    }
    
    updateActiveCounter();
}

// ===== BOUTON STOP ALL =====
function initializeStopButton() {
    const stopButton = document.getElementById('stopAllBtn');
    
    stopButton.addEventListener('click', function() {
        stopAllSounds();
        
        // Effet visuel
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = 'scale(1)';
        }, 150);
    });
}

function stopAllSounds() {
    let stoppedCount = 0;
    
    activeAudios.forEach(soundType => {
        const audio = audioElements[soundType];
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            stoppedCount++;
        }
        
        // Retirer la classe active du bouton
        const button = document.querySelector(`[data-sound="${soundType}"]`);
        if (button) {
            button.classList.remove('active');
            button.style.transform = 'translateY(0) scale(1)';
        }
    });
    
    activeAudios.clear();
    updateActiveCounter();
    
    if (stoppedCount > 0) {
        showNotification(`${stoppedCount} son(s) arrêté(s)`, 'info');
    } else {
        showNotification('Aucun son à arrêter', 'warning');
    }
}

// ===== CONTRÔLE DU VOLUME =====
function initializeVolumeControl() {
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    
    volumeSlider.addEventListener('input', function() {
        const volume = this.value / 100;
        globalVolume = volume;
        
        // Mettre à jour tous les audios actifs avec le gain par son
Object.entries(audioElements).forEach(([key, audio]) => {
    audio.volume = Math.max(0, Math.min(1, volume * effectiveGain(key)));
    volumeSlider.addEventListener('input', function() {
  const volume = this.value / 100;
  globalVolume = volume;
  // (facultatif) laisser ça pour desktop
  Object.values(audioElements).forEach(a => a.volume = volume);
  applyGlobalVolume(); // ← important pour mobile
  volumeValue.textContent = this.value + '%';
});

volumeSlider.addEventListener('change', function() {
  const volume = this.value / 100;
  globalVolume = volume;
  Object.values(audioElements).forEach(a => a.volume = volume);
  applyGlobalVolume();
  volumeValue.textContent = this.value + '%';
});

});

        
        // Mettre à jour l'affichage
        volumeValue.textContent = this.value + '%';
        
        // Effet visuel
        this.style.background = `linear-gradient(to right, #9b5de5 0%, #9b5de5 ${this.value}%, rgba(155, 93, 229, 0.3) ${this.value}%, rgba(155, 93, 229, 0.3) 100%)`;
    });
    
    // Initialiser l'apparence du slider
    volumeSlider.dispatchEvent(new Event('input'));
}

// ===== NOTIFICATIONS =====
function showNotification(message, type = 'info') {
    // Supprimer les notifications existantes
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    const colors = {
        success: '#00f5d4',
        error: '#f15bb5',
        warning: '#ffaa44',
        info: '#9b5de5'
    };
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        border: 2px solid ${colors[type]};
        border-radius: 10px;
        padding: 1rem 1.5rem;
        color: white;
        font-family: 'Orbitron', monospace;
        font-size: 0.9rem;
        z-index: 10000;
        box-shadow: 0 0 20px ${colors[type]}40;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    notification.style.pointerEvents = 'none';
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Suppression automatique
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// ===== UTILITAIRES =====
function getSoundDisplayName(soundType) {
    const displayNames = {
        'pluie': 'Pluie',
        'mer': 'Océan',
        'cafe': 'Café',
        'feu': 'Feu de camp',
        'vent': 'Vent',
        'bibliotheque': 'Bibliothèque',
        'foret': 'Forêt',
        'synthwave': 'Synthwave',
        'lofi': 'Lo-fi',
        'casino': 'Casino',
        'oiseaux': 'Oiseaux',
        'cigales': 'Cigales',
        'cheminee': 'Cheminée',
        'jazz': 'Jazz',
        'classique': 'Classique',
        'bruitblanc': 'Bruit blanc',
        'temple': 'Temple',
        'nuit': 'Nuit'
    };
    
    return displayNames[soundType] || soundType;
}

function updateActiveCounter() {
    const activeCount = activeAudios.size;
    const subtitle = document.querySelector('.subtitle');
    
    if (activeCount > 0) {
        subtitle.textContent = `${activeCount} ambiance(s) active(s) • Concentration en cours`;
        subtitle.style.color = '#00f5d4';
    } else {
        subtitle.textContent = 'Concentration Immersive • Sons Relaxants';
        subtitle.style.color = '#b0b0b0';
    }
}

// ===== GESTION DES ÉVÉNEMENTS CLAVIER =====
document.addEventListener('keydown', function(event) {
    // Ne pas activer les raccourcis quand on tape dans un champ (notes, inputs, contenteditable)
    if (isEditableTarget(event.target)) return;

    // Spacebar pour arrêter tous les sons
    if (event.code === 'Space') {
        event.preventDefault();
        stopAllSounds();
        return;
    }
    
    // Échap pour arrêter tous les sons
    if (event.code === 'Escape') {
        stopAllSounds();
        return;
    }
    
    // Contrôle volume avec flèches
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        const volumeSlider = document.getElementById('volumeSlider');
        const currentValue = parseInt(volumeSlider.value, 10);
        const step = 5;
        
        if (event.code === 'ArrowUp' && currentValue < 100) {
            volumeSlider.value = Math.min(100, currentValue + step);
        } else if (event.code === 'ArrowDown' && currentValue > 0) {
            volumeSlider.value = Math.max(0, currentValue - step);
        }
        
        volumeSlider.dispatchEvent(new Event('input'));
    }
});


// ===== GESTION RESPONSIVE =====
window.addEventListener('resize', function() {
    // Recalculer les particules si nécessaire
    const particles = document.querySelectorAll('.particle');
    particles.forEach(particle => {
        if (parseInt(particle.style.left) > window.innerWidth) {
            particle.style.left = Math.random() * window.innerWidth + 'px';
        }
    });
});

// ===== GESTION DE LA VISIBILITÉ =====
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Réduire le volume quand la page n'est pas visible
        Object.entries(audioElements).forEach(([key, audio]) => {
    if (!audio.paused) {
        audio.volume = Math.max(0, Math.min(1, (globalVolume * 0.3) * effectiveGain(key)));
    }
});
    } else {
        // Restaurer le volume
        Object.entries(audioElements).forEach(([key, audio]) => {
    if (!audio.paused) {
        audio.volume = Math.max(0, Math.min(1, globalVolume * effectiveGain(key)));
    }
});

    }
});

// ===== EASTER EGG - SÉQUENCE KONAMI =====
let konamiSequence = [];
const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

document.addEventListener('keydown', function(event) {
    konamiSequence.push(event.code);
    
    if (konamiSequence.length > konamiCode.length) {
        konamiSequence.shift();
    }
    
    if (JSON.stringify(konamiSequence) === JSON.stringify(konamiCode)) {
        activateEasterEgg();
        konamiSequence = [];
    }
});

function activateEasterEgg() {
    showNotification('🎊 Mode Cyberpunk Ultra activé!', 'success');
    
    // Effet spécial temporaire
    const body = document.body;
    body.style.animation = 'rainbow 2s ease-in-out';
    
    // Ajouter l'animation rainbow
    const style = document.createElement('style');
    style.textContent = `
        @keyframes rainbow {
            0% { filter: hue-rotate(0deg); }
            25% { filter: hue-rotate(90deg); }
            50% { filter: hue-rotate(180deg); }
            75% { filter: hue-rotate(270deg); }
            100% { filter: hue-rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    setTimeout(() => {
        body.style.animation = '';
        style.remove();
    }, 2000);
    
    // Créer des particules spéciales
    createSpecialParticles();
}

function createSpecialParticles() {
    const container = document.getElementById('particles');
    const colors = ['#00f5d4', '#9b5de5', '#f15bb5', '#ffaa44'];
    
    for (let i = 0; i < 10; i++) {
        setTimeout(() => {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: 6px;
                height: 6px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                border-radius: 50%;
                left: ${Math.random() * window.innerWidth}px;
                top: 100vh;
                box-shadow: 0 0 15px currentColor;
                animation: specialFloat 3s ease-out forwards;
            `;
            
            const specialAnimation = `
                @keyframes specialFloat {
                    0% {
                        transform: translateY(0) scale(1) rotate(0deg);
                        opacity: 1;
                    }
                    50% {
                        transform: translateY(-50vh) scale(2) rotate(180deg);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(-100vh) scale(0) rotate(360deg);
                        opacity: 0;
                    }
                }
            `;
            
            const styleSheet = document.createElement('style');
            styleSheet.textContent = specialAnimation;
            document.head.appendChild(styleSheet);
            
            container.appendChild(particle);
            
            setTimeout(() => {
                if (particle.parentNode) {
                    particle.parentNode.removeChild(particle);
                }
                if (styleSheet.parentNode) {
                    styleSheet.parentNode.removeChild(styleSheet);
                }
            }, 3000);
        }, i * 200);
    }
}

// ===== MESSAGE DE BIENVENUE =====
window.addEventListener('load', function() {
    setTimeout(() => {
        showNotification('🎵 Bienvenue sur NeuroFocus!', 'success');
        setTimeout(() => {
            showNotification('💡 Astuce: Utilisez Espace ou Échap pour tout arrêter', 'info');
        }, 3500);
    }, 1000);
});

console.log(`
    
🎵 NeuroFocus - Cyberpunk Focus App
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Contrôles disponibles:
   • Espace / Échap: Arrêter tous les sons
   • ↑/↓: Contrôler le volume
   • Code Konami: Easter egg secret!

🎧 Préparez-vous à une expérience immersive!
`);

// ===== DEBUG CURSEUR (temporaire) =====
(function () {
  const set = (x, y) => {
    document.documentElement.style.setProperty('--cursor-x', x + 'px');
    document.documentElement.style.setProperty('--cursor-y', y + 'px');
  };
  // Valeurs par défaut hors écran
  set(-100, -100);

  // Suivi du curseur
  window.addEventListener('mousemove', (e) => {
    set(e.clientX, e.clientY);
  }, { passive: true });

  console.log('[cursor-debug] prêt');
})();
