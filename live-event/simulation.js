const TrainingState = {
  score: 0,
  currentModule: null,
  step: 0,
  answers: [],
  timer: null,
  completedModules: []
};

const TRAINING_STORAGE_KEY = 'cyberTrainingState_v1';

function loadTrainingState() {
  try {
    const raw = localStorage.getItem(TRAINING_STORAGE_KEY);
    if (!raw) {
      return {
        score: 0,
        currentModule: null,
        step: 0,
        answers: [],
        timer: null,
        completedModules: []
      };
    }

    const parsed = JSON.parse(raw);
    return {
      score: Number(parsed.score) || 0,
      currentModule: typeof parsed.currentModule === 'string' ? parsed.currentModule : null,
      step: Number(parsed.step) || 0,
      answers: Array.isArray(parsed.answers) ? parsed.answers : [],
      timer: null,
      completedModules: Array.isArray(parsed.completedModules) ? parsed.completedModules : []
    };
  } catch (error) {
    console.warn('Training state could not be loaded:', error);
    return {
      score: 0,
      currentModule: null,
      step: 0,
      answers: [],
      timer: null,
      completedModules: []
    };
  }
}

Object.assign(TrainingState, loadTrainingState());
window.TrainingState = TrainingState;

function persistTrainingState() {
  try {
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify({
      score: TrainingState.score,
      currentModule: TrainingState.currentModule,
      step: TrainingState.step,
      answers: TrainingState.answers,
      completedModules: TrainingState.completedModules
    }));
  } catch (error) {
    console.warn('Training state could not be saved:', error);
  }
}

const SimulationApp = {
  init() {
    const root = document.getElementById('simulation-root');
    if (!root) return;

    document.body.classList.add('simulation-active');
    root.classList.remove('hidden');

    const consoleWrap = document.querySelector('.le-modules-wrap');
    const sessionBar = document.querySelector('.le-session-bar');
    const hero = document.querySelector('.le-home-hero');
    const footer = document.querySelector('.le-home-footer');
    const widget = document.getElementById('scoreboardWidget');

    if (consoleWrap) consoleWrap.style.display = 'none';
    if (sessionBar) sessionBar.style.display = 'none';
    if (hero) hero.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (widget) widget.classList.add('le-hidden');

    root.innerHTML = '';
    this.startModule('attack-sim');
  },

  startModule(name) {
    const root = document.getElementById('simulation-root');
    if (!root) return;

    const normalizedName = typeof name === 'string' ? name : 'attack-sim';
    TrainingState.currentModule = normalizedName;
    TrainingState.step = 0;

    if (TrainingState.timer) {
      clearTimeout(TrainingState.timer);
      TrainingState.timer = null;
    }

    root.innerHTML = '';

    const registry = window.SimulationModules || {};
    const module = registry[normalizedName];

    if (!module) {
      root.innerHTML = `
        <div class="sim-panel sim-error-panel">
          <h3>Module unavailable</h3>
          <p>The simulation module "${normalizedName}" could not be loaded.</p>
        </div>
      `;
      persistTrainingState();
      return;
    }

    if (typeof module.render === 'function') {
      module.render(root, this);
    } else if (typeof module === 'function') {
      module(root, this);
    }

    if (!TrainingState.completedModules.includes(normalizedName)) {
      TrainingState.completedModules.push(normalizedName);
    }

    persistTrainingState();
  },

  nextStep() {
    const order = ['attack-sim', 'deepfake', 'defense-lab', 'quiz', 'scoreboard'];
    const currentIndex = order.indexOf(TrainingState.currentModule || 'attack-sim');

    if (currentIndex >= 0 && currentIndex < order.length - 1) {
      this.startModule(order[currentIndex + 1]);
      return;
    }

    this.finish();
  },

  updateScore(points) {
    const value = Number(points) || 0;
    TrainingState.score = Math.max(0, TrainingState.score + value);
    persistTrainingState();
  },

  finish() {
    TrainingState.currentModule = 'scoreboard';
    this.startModule('scoreboard');
  },

  reset() {
    TrainingState.score = 0;
    TrainingState.currentModule = null;
    TrainingState.step = 0;
    TrainingState.answers = [];
    TrainingState.completedModules = [];

    if (TrainingState.timer) {
      clearTimeout(TrainingState.timer);
      TrainingState.timer = null;
    }

    const root = document.getElementById('simulation-root');
    if (root) {
      root.innerHTML = '';
      root.classList.add('hidden');
    }

    document.body.classList.remove('simulation-active');

    const consoleWrap = document.querySelector('.le-modules-wrap');
    const sessionBar = document.querySelector('.le-session-bar');
    const hero = document.querySelector('.le-home-hero');
    const footer = document.querySelector('.le-home-footer');
    const widget = document.getElementById('scoreboardWidget');

    if (consoleWrap) consoleWrap.style.display = '';
    if (sessionBar) sessionBar.style.display = '';
    if (hero) hero.style.display = '';
    if (footer) footer.style.display = '';
    if (widget) widget.classList.add('le-hidden');

    persistTrainingState();
  }
};

window.TrainingState = TrainingState;
window.SimulationApp = SimulationApp;

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startSimulationBtn');
    if (startButton) {
      startButton.addEventListener('click', () => {
        SimulationApp.init();
      });
    }
  });
}
