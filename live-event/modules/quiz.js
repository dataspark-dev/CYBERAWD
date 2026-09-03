(function () {
  const moduleName = 'quiz';

  const questions = [
    {
      prompt: 'What is the safest action when you receive a message that creates urgency and requests immediate payment?',
      options: ['Reply immediately', 'Verify through a trusted channel', 'Click the attached link', 'Forward it to colleagues'],
      answer: 1,
      explanation: 'Verify through a trusted source before taking action. Urgency is a classic social-engineering trigger.'
    },
    {
      prompt: 'Which practice reduces account risk the most?',
      options: ['Use one password everywhere', 'Use a unique password with MFA', 'Share passwords with the team', 'Write passwords on a sticky note'],
      answer: 1,
      explanation: 'Unique passwords and MFA greatly reduce the chance of account compromise.'
    },
    {
      prompt: 'What should you do with an unexpected MFA push notification?',
      options: ['Approve it immediately', 'Ignore it and verify the login in the app', 'Send the code to a friend', 'Repeat the push three times'],
      answer: 1,
      explanation: 'Unexpected MFA requests should be denied and verified using a trusted sign-in path.'
    },
    {
      prompt: 'What is the best response to a suspicious QR code in a public area?',
      options: ['Scan it to test it', 'Ignore it and report it', 'Enter your password in the browser', 'Share it on your group chat'],
      answer: 1,
      explanation: 'Suspicious QR codes may hide malicious links. Avoid scanning and report them instead.'
    },
    {
      prompt: 'Which behavior is safest when a voice call asks for quick action?',
      options: ['Follow the caller immediately', 'Call back through a known number', 'Give your OTP to the caller', 'Forward the call to IT'],
      answer: 1,
      explanation: 'Always verify using a trusted number or internal process before acting on urgent phone requests.'
    },
    {
      prompt: 'What is the correct response to a password-reset email that you did not request?',
      options: ['Click the link to confirm you are safe', 'Ignore it and go directly to the official site', 'Reply with your password', 'Forward it to your manager'],
      answer: 1,
      explanation: 'Legitimate password resets are confirmed through the official site, not via a suspicious email link.'
    }
  ];

  function renderQuizModule(root, app) {
    const shell = document.createElement('div');
    shell.className = 'sim-shell';
    root.innerHTML = '';

    let index = 0;
    let answered = false;
    let countdownId = null;

    function updateScoreLabel() {
      const scoreNode = shell.querySelector('#quizScoreValue');
      if (scoreNode) scoreNode.textContent = String(window.TrainingState.score);
    }

    function clearTimer() {
      if (countdownId) {
        clearTimeout(countdownId);
        countdownId = null;
      }
    }

    function renderQuestion() {
      answered = false;
      const current = questions[index];
      const timeLimit = 10;
      let remaining = timeLimit;

      clearTimer();

      shell.innerHTML = `
        <header class="sim-header">
          <h2>Quiz Engine</h2>
          <div class="score-pill">Score: <span id="quizScoreValue">${window.TrainingState.score}</span></div>
        </header>
        <div class="sim-panel quiz-shell">
          <div class="sim-header" style="margin-bottom:8px;padding-bottom:8px;">
            <h3 style="font-size:1rem;letter-spacing:0.08em;">Question ${index + 1}/${questions.length}</h3>
            <div class="quiz-timer" id="quizTimer">10s</div>
          </div>
          <div class="scenario-card">
            <h3>Security Check</h3>
            <p>${current.prompt}</p>
            <div class="quiz-options" id="quizOptions"></div>
            <div class="explanation-box" id="quizExplanation" style="display:none;"></div>
          </div>
        </div>
      `;

      const timerNode = shell.querySelector('#quizTimer');
      const optionsNode = shell.querySelector('#quizOptions');
      const explanationNode = shell.querySelector('#quizExplanation');

      current.options.forEach((option, optionIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quiz-option-btn';
        button.textContent = option;

        button.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          clearTimer();

          const isCorrect = optionIndex === current.answer;
          if (isCorrect) {
            app.updateScore(10);
          }
          updateScoreLabel();

          explanationNode.textContent = `${current.explanation} ${isCorrect ? 'Correct answer.' : `Correct answer: ${current.options[current.answer]}`}`;
          explanationNode.style.display = 'block';

          const nextButton = document.createElement('button');
          nextButton.type = 'button';
          nextButton.className = 'sim-btn primary';
          nextButton.textContent = index < questions.length - 1 ? 'Next Question' : 'View Results';
          nextButton.addEventListener('click', () => {
            if (index < questions.length - 1) {
              index += 1;
              renderQuestion();
            } else {
              app.startModule('scoreboard');
            }
          });

          optionsNode.innerHTML = '';
          optionsNode.appendChild(nextButton);
        });

        optionsNode.appendChild(button);
      });

      const tick = () => {
        if (answered) return;
        remaining -= 1;
        timerNode.textContent = `${remaining}s`;

        if (remaining <= 0) {
          clearTimer();
          answered = true;
          explanationNode.textContent = `${current.explanation} Correct answer: ${current.options[current.answer]}`;
          explanationNode.style.display = 'block';

          const nextButton = document.createElement('button');
          nextButton.type = 'button';
          nextButton.className = 'sim-btn primary';
          nextButton.textContent = index < questions.length - 1 ? 'Next Question' : 'View Results';
          nextButton.addEventListener('click', () => {
            if (index < questions.length - 1) {
              index += 1;
              renderQuestion();
            } else {
              app.startModule('scoreboard');
            }
          });

          optionsNode.innerHTML = '';
          optionsNode.appendChild(nextButton);
          return;
        }

        countdownId = setTimeout(tick, 1000);
      };

      countdownId = setTimeout(tick, 1000);
    }

    renderQuestion();
    root.appendChild(shell);
  }

  window.SimulationModules = window.SimulationModules || {};
  window.SimulationModules[moduleName] = {
    render: renderQuizModule
  };
})();
