(function () {
  const moduleName = 'defense-lab';

  function buildStrongPassword(value) {
    const raw = (value || '').trim();
    const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'Secure';
    const prefix = cleaned.slice(0, 3).toUpperCase();
    const middle = cleaned.slice(3, 8) || 'Pass';
    const suffix = '2026!';
    return `${prefix}${middle}!${suffix}`;
  }

  function renderDefenseLab(root, app) {
    const shell = document.createElement('div');
    shell.className = 'sim-shell';
    root.innerHTML = '';

    const scenarios = [
      {
        prompt: 'A QR code is left on a shared printer and someone says, “Just scan it to see the updated access form.”',
        correct: 'RISKY',
        explanation: 'Risky. QR codes can hide malicious links. Verify the source before scanning and use trusted official channels.'
      },
      {
        prompt: 'A USB drive labeled “Quarterly Payroll” appears in the office kitchen. You plug it into a work laptop to check the files.',
        correct: 'RISKY',
        explanation: 'Risky. Unknown USB devices may deploy malware. Report and isolate them instead of plugging them into company devices.'
      },
      {
        prompt: 'Your system sends an OTP code to your phone after a login attempt you initiated yourself. You enter the code to continue.',
        correct: 'SAFE',
        explanation: 'Safe. A one-time code requested by your own login attempt is the correct validation flow when you initiated the sign-in.'
      },
      {
        prompt: 'You receive a suspicious email asking you to reset your password using a link sent in the same message.',
        correct: 'RISKY',
        explanation: 'Risky. Do not click password-reset links in emails. Open the official site directly and verify the request there.'
      }
    ];

    let scenarioIndex = 0;
    let answered = false;

    function renderSecurityCard() {
      const scenario = scenarios[scenarioIndex];
      const card = document.createElement('div');
      card.className = 'sim-panel';
      card.innerHTML = `
        <h3>Secure vs Risky</h3>
        <div class="scenario-option">
          <p>${scenario.prompt}</p>
          <div class="choice-row">
            <button class="sim-btn success" data-choice="SAFE" type="button">SAFE</button>
            <button class="sim-btn danger" data-choice="RISKY" type="button">RISKY</button>
          </div>
          <div class="explanation-box" id="securityExplanation" style="display:none;"></div>
          <div class="sim-actions" id="securityActions"></div>
        </div>
      `;

      const explanationBox = card.querySelector('#securityExplanation');
      const actionsBox = card.querySelector('#securityActions');

      card.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          if (answered) return;
          answered = true;

          const selected = button.dataset.choice;
          const isCorrect = selected === scenario.correct;
          app.updateScore(isCorrect ? 10 : -5);

          explanationBox.textContent = `${scenario.explanation} ${isCorrect ? 'Correct decision.' : 'Review the risk before acting.'}`;
          explanationBox.style.display = 'block';

          const status = document.createElement('button');
          status.type = 'button';
          status.className = isCorrect ? 'sim-btn success' : 'sim-btn danger';
          status.textContent = isCorrect ? 'Correct' : 'Incorrect';
          status.disabled = true;

          const nextButton = document.createElement('button');
          nextButton.type = 'button';
          nextButton.className = 'sim-btn primary';
          nextButton.textContent = scenarioIndex < scenarios.length - 1 ? 'Next' : 'Continue';
          nextButton.addEventListener('click', () => {
            if (scenarioIndex < scenarios.length - 1) {
              scenarioIndex += 1;
              answered = false;
              renderSecurityCard();
            } else {
              app.startModule('quiz');
            }
          });

          actionsBox.appendChild(status);
          actionsBox.appendChild(nextButton);
        });
      });

      const currentStage = shell.querySelector('#scenarioHost');
      if (currentStage) {
        currentStage.innerHTML = '';
        currentStage.appendChild(card);
      }
    }

    shell.innerHTML = `
      <header class="sim-header">
        <h2>Defense Lab</h2>
        <div class="score-pill">Score: <span id="labScoreValue">${window.TrainingState.score}</span></div>
      </header>
      <div class="password-builder">
        <div class="sim-panel">
          <h3>Password Builder</h3>
          <div class="password-box">
            <input id="passwordSource" type="text" placeholder="Type a sentence e.g. My dog likes the sea" />
            <button class="sim-btn primary" id="generatePasswordBtn" type="button">Transform</button>
          </div>
          <div class="password-output" id="generatedPassword">Example: MYD!likeSea2026!</div>
          <div class="explanation-box" id="passwordLogic" style="margin-top:14px;display:block;">
            <strong>Logic:</strong> Remove spaces, keep letters/numbers, capitalize first 3 characters, add a special symbol, then append the year.
          </div>
        </div>
        <div id="scenarioHost"></div>
      </div>
    `;

    shell.querySelector('#generatePasswordBtn').addEventListener('click', () => {
      const input = shell.querySelector('#passwordSource').value;
      const transformed = buildStrongPassword(input);
      shell.querySelector('#generatedPassword').textContent = transformed;
      const logic = shell.querySelector('#passwordLogic');
      if (logic) {
        logic.innerHTML = `<strong>Transformation:</strong> "${input || 'My dog likes the sea'}" → ${transformed}`;
      }
    });

    const host = document.createElement('div');
    host.id = 'scenarioHost';
    shell.querySelector('.password-builder').appendChild(host);
    renderSecurityCard();
    root.appendChild(shell);
  }

  window.SimulationModules = window.SimulationModules || {};
  window.SimulationModules[moduleName] = {
    render: renderDefenseLab
  };
})();
