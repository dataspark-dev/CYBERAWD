(function () {
  const moduleName = 'attack-sim';

  function renderDecisionButtons(root, app) {
    const actions = [
      { label: 'Proceed', type: 'danger', points: -25 },
      { label: 'Verify', type: 'success', points: 30 },
      { label: 'Ignore', type: 'warning', points: -10 }
    ];

    const actionWrap = document.createElement('div');
    actionWrap.className = 'sim-actions';

    actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sim-btn ${action.type}`;
      button.textContent = action.label;

      button.addEventListener('click', () => {
        if (button.disabled) return;

        const isCorrect = action.label === 'Verify';
        app.updateScore(isCorrect ? 30 : -25);

        const resultPanel = document.createElement('div');
        resultPanel.className = `sim-panel result-panel ${isCorrect ? 'success' : 'danger'}`;

        if (isCorrect) {
          resultPanel.innerHTML = `
            <h2>Attack prevented</h2>
            <div class="result-amount">+30 pts</div>
            <p>You verified the payment request before releasing funds.</p>
          `;
        } else {
          resultPanel.innerHTML = `
            <h2>Payment approved</h2>
            <div class="result-amount">₹4,85,000 lost</div>
            <p>Urgent payment request was not verified and the transfer went through.</p>
          `;
        }

        root.innerHTML = '';
        root.appendChild(resultPanel);

        const nextButton = document.createElement('button');
        nextButton.type = 'button';
        nextButton.className = 'sim-btn primary';
        nextButton.textContent = 'Continue';
        nextButton.addEventListener('click', () => app.nextStep());

        const buttonsWrap = document.createElement('div');
        buttonsWrap.className = 'sim-actions';
        buttonsWrap.appendChild(nextButton);
        root.appendChild(buttonsWrap);
      });

      actionWrap.appendChild(button);
    });

    root.appendChild(actionWrap);
  }

  function renderAttackModule(root, app) {
    const shell = document.createElement('div');
    shell.className = 'sim-shell';

    shell.innerHTML = `
      <header class="sim-header">
        <h2>Attack Simulation</h2>
        <div class="score-pill">Score: <span id="attackScoreValue">${window.TrainingState.score}</span></div>
      </header>
      <div class="sim-grid">
        <div class="sim-panel email-panel">
          <div class="email-header">
            <span>From: finance@onesecurepay.com</span>
            <span>Urgent</span>
          </div>
          <div class="email-subject">Subject: Vendor payment release — confirmation required</div>
          <div class="email-body">
            <p><strong>Hello Team,</strong></p>
            <p>This is a priority payment for the vendor approval list. We need a same-day release for the outstanding invoice before the 6 PM cut-off.</p>
            <p>Please confirm the bank details below and approve the transfer of <strong>₹4,85,000</strong> for this order completion.</p>
            <p>Regards,<br>Accounts Team<br>Vendor Support Portal</p>
          </div>
        </div>
        <div class="sim-panel chat-panel">
          <h3>Chat</h3>
          <div class="chat-thread" id="attackChatThread"></div>
        </div>
        <div class="sim-panel detail-panel">
          <h3>Threat Watch</h3>
          <div class="sim-detail-box" id="attackDetailBox">
            New message received. Review the payment request carefully before acting.
          </div>
        </div>
      </div>
    `;

    root.appendChild(shell);

    const chatThread = shell.querySelector('#attackChatThread');
    let detailBox = shell.querySelector('#attackDetailBox');
    const scoreValue = shell.querySelector('#attackScoreValue');

    function updateScoreLabel() {
      scoreValue.textContent = String(window.TrainingState.score);
    }

    const defaultThread = [
      { text: 'Hi, we need the funds released immediately to avoid shipment delay.', type: 'other' },
      { text: 'Can you confirm the supplier bank details before 5 PM?', type: 'other' }
    ];

    defaultThread.forEach((msg) => {
      const node = document.createElement('div');
      node.className = `chat-message ${msg.type === 'other' ? '' : 'self'}`;
      node.textContent = msg.text;
      chatThread.appendChild(node);
    });

    setTimeout(() => {
      const node = document.createElement('div');
      node.className = 'chat-message alert';
      node.textContent = 'Urgent: payment request received from a non-standard source link.';
      chatThread.appendChild(node);
      detailBox.innerHTML = '<strong>Suspicious signal:</strong> The request is time-pressured and uses a non-standard sender identity.';
    }, 9000);

    setTimeout(() => {
      const notification = document.createElement('div');
      notification.className = 'sim-detail-box';
      notification.innerHTML = '<strong>Notification:</strong> The sender claimed to be the same vendor but the payment link does not match the approved vendor portal.';
      detailBox.replaceWith(notification);
      detailBox = notification;

      const voiceButton = document.createElement('button');
      voiceButton.type = 'button';
      voiceButton.className = 'sim-btn primary';
      voiceButton.textContent = 'Play Voice';
      voiceButton.addEventListener('click', () => {
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance('Hi, this is the vendor manager. Please release the funds now before the shipment is delayed.');
          utterance.rate = 1.05;
          utterance.pitch = 1.1;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
        if (detailBox) {
          detailBox.innerHTML = '<strong>Voice check:</strong> The request sounds rushed and pressure-driven, which is a classic social engineering cue.';
        }
      });

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'sim-actions';
      actionsWrap.appendChild(voiceButton);
      const target = shell.querySelector('.sim-grid');
      target.parentNode.appendChild(actionsWrap);

      const decisionWrap = document.createElement('div');
      decisionWrap.className = 'sim-actions';

      const actions = [
        { label: 'Proceed', kind: 'danger', points: -25 },
        { label: 'Verify', kind: 'success', points: 30 },
        { label: 'Ignore', kind: 'warning', points: -10 }
      ];

      actions.forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `sim-btn ${action.kind}`;
        button.textContent = action.label;

        button.addEventListener('click', () => {
          const isCorrect = action.label === 'Verify';
          app.updateScore(isCorrect ? 30 : -25);
          updateScoreLabel();

          const result = document.createElement('div');
          result.className = `sim-panel result-panel ${isCorrect ? 'success' : 'danger'}`;
          result.innerHTML = isCorrect
            ? `
              <h2>Attack prevented</h2>
              <div class="result-amount">+30 pts</div>
              <p>You verified the payment request before releasing funds.</p>
            `
            : `
              <h2>Payment approved</h2>
              <div class="result-amount">₹4,85,000 lost</div>
              <p>You acted on an urgent request without validating it.</p>
            `;

          shell.innerHTML = '';
          shell.appendChild(result);

          const continueWrap = document.createElement('div');
          continueWrap.className = 'sim-actions';
          const nextButton = document.createElement('button');
          nextButton.type = 'button';
          nextButton.className = 'sim-btn primary';
          nextButton.textContent = 'Continue';
          nextButton.addEventListener('click', () => app.nextStep());
          continueWrap.appendChild(nextButton);
          shell.appendChild(continueWrap);
        });

        decisionWrap.appendChild(button);
      });

      shell.appendChild(decisionWrap);
    }, 12000);
  }

  window.SimulationModules = window.SimulationModules || {};
  window.SimulationModules[moduleName] = {
    render: renderAttackModule
  };
})();
