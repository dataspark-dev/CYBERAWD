(function () {
  const moduleName = 'deepfake';

  const scenarios = [
    {
      type: 'Text',
      title: 'Invoice impersonation',
      prompt: 'A message says the supplier bank details changed and asks you to approve a quick payment before the 4 PM cutoff. Is this message real or AI-generated?',
      correct: 'AI',
      explanation: 'The message uses urgency and a changed payment destination, which is a common social-engineering pattern. It should be verified through the approved supplier contact path.'
    },
    {
      type: 'Video',
      title: 'CEO video call',
      prompt: 'A short video call appears to be your senior executive asking for immediate access approval. Is the video real or AI-generated?',
      correct: 'AI',
      explanation: 'Deepfake video often shows subtle facial mismatch, unnatural blinking, or inconsistent lip-sync. Always confirm with a trusted channel before taking action.'
    },
    {
      type: 'Audio',
      title: 'Voicemail verification',
      prompt: 'An audio clip says, “Please ignore the security alert and continue the transfer.” Is the voice authentic or AI-generated?',
      correct: 'AI',
      explanation: 'Cloned voice messages are designed to trigger emotion and bypass verification. Confirm the caller through a known number or secure internal process.'
    }
  ];

  function renderDeepfakeModule(root, app) {
    const shell = document.createElement('div');
    shell.className = 'sim-shell';
    root.innerHTML = '';

    let index = 0;
    let answered = false;

    function updateScoreLabel() {
      const scoreNode = shell.querySelector('#deepfakeScoreValue');
      if (scoreNode) {
        scoreNode.textContent = String(window.TrainingState.score);
      }
    }

    function renderScenario() {
      answered = false;
      const step = scenarios[index];

      shell.innerHTML = `
        <header class="sim-header">
          <h2>Deepfake Challenge</h2>
          <div class="score-pill">Score: <span id="deepfakeScoreValue">${window.TrainingState.score}</span></div>
        </header>
        <div class="sim-panel" style="max-width:900px;margin:0 auto;">
          <div class="scenario-card">
            <h3>${step.type} Scenario</h3>
            <p><strong>${step.title}</strong></p>
            <p>${step.prompt}</p>
            <div class="choice-row" style="justify-content:center;">
              <button class="sim-btn warning" data-choice="REAL" type="button">REAL</button>
              <button class="sim-btn primary" data-choice="AI" type="button">AI</button>
            </div>
            <div class="explanation-box" id="deepfakeExplanation" style="display:none;"></div>
            <div class="sim-actions" id="deepfakeActions"></div>
          </div>
        </div>
      `;

      updateScoreLabel();

      const explanationBox = shell.querySelector('#deepfakeExplanation');
      const actionBox = shell.querySelector('#deepfakeActions');

      shell.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          if (answered) return;
          answered = true;

          const selected = button.dataset.choice;
          const isCorrect = selected === step.correct;

          if (isCorrect) {
            app.updateScore(10);
          } else {
            app.updateScore(-5);
          }

          updateScoreLabel();

          explanationBox.textContent = `${step.explanation} ${isCorrect ? 'Correct — the content was manipulated.' : 'Incorrect — verify using a trusted source.'}`;
          explanationBox.style.display = 'block';

          const resultRow = document.createElement('div');
          resultRow.className = 'sim-actions';

          const status = document.createElement('button');
          status.type = 'button';
          status.className = isCorrect ? 'sim-btn success' : 'sim-btn danger';
          status.textContent = isCorrect ? 'Correct' : 'Wrong';
          status.disabled = true;
          resultRow.appendChild(status);

          const nextButton = document.createElement('button');
          nextButton.type = 'button';
          nextButton.className = 'sim-btn primary';
          nextButton.textContent = index < scenarios.length - 1 ? 'Next' : 'Continue';
          nextButton.addEventListener('click', () => {
            if (index < scenarios.length - 1) {
              index += 1;
              renderScenario();
            } else {
              window.SimulationApp.startModule('defense-lab');
            }
          });

          resultRow.appendChild(nextButton);
          actionBox.appendChild(resultRow);
        });
      });
    }

    renderScenario();
    root.appendChild(shell);
  }

  window.SimulationModules = window.SimulationModules || {};
  window.SimulationModules[moduleName] = {
    render: renderDeepfakeModule
  };
})();
