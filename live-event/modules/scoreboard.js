(function () {
  const moduleName = 'scoreboard';

  function getScoreTier(score) {
    if (score >= 90) return { label: 'Cyber Champion', tone: 'success' };
    if (score >= 60) return { label: 'Aware', tone: 'primary' };
    return { label: 'Beginner', tone: 'danger' };
  }

  function renderScoreboard(root, app) {
    const shell = document.createElement('div');
    shell.className = 'sim-shell scoreboard-shell';

    const total = window.TrainingState.score;
    const tier = getScoreTier(total);

    shell.innerHTML = `
      <header class="sim-header" style="justify-content:center;border-bottom:none;">
        <h2>Final Results</h2>
      </header>
      <div class="sim-panel scoreboard-shell">
        <div class="score-tier">${tier.label}</div>
        <div class="scoreboard-score">${total}</div>
        <div class="score-meta">
          You completed the full cybersecurity simulation. Your response pattern indicates ${tier.label.toLowerCase()} awareness.
        </div>
      </div>
      <div class="sim-actions">
        <button class="sim-btn primary" id="restartTrainingBtn" type="button">Restart</button>
      </div>
    `;

    shell.querySelector('#restartTrainingBtn').addEventListener('click', () => {
      app.reset();
      const rootEl = document.getElementById('simulation-root');
      if (rootEl) rootEl.innerHTML = '';
    });

    root.appendChild(shell);
  }

  window.SimulationModules = window.SimulationModules || {};
  window.SimulationModules[moduleName] = {
    render: renderScoreboard
  };
})();
