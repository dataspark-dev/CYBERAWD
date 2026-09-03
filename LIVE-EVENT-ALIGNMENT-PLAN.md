# Live Event Module Alignment Plan
## 90-Minute Cybersecurity + AI Awareness Session

---

## Agenda → Module Mapping

| Time | Agenda Activity | Current Module | Status | Action Required |
|------|----------------|----------------|--------|-----------------|
| 5 min | 🎬 Welcome & Cybersecurity Introduction | — | **Gap** | Facilitator script only (no module needed) |
| 10 min | 🌐 Cyber Threats in the AI Era | — | **Gap** | Facilitator-led PPT + poll (no module) |
| 15 min | 🎯 **Spot the Phish – AI Phishing Challenge** | `fault-finding` | ✅ Exists | **Refine** — Already updated for full-screen compare |
| 10 min | 🤖 **Real or AI? – Deepfake Challenge** | `live-simulation` | ⚠️ Partial | **Refine** — Add deepfake video/image/audio identification |
| 10 min | 🎙️ **Voice Clone Challenge** | `live-simulation` | ⚠️ Partial | **Refine** — Add voice cloning scenario to live-simulation |
| 10 min | 🕵️ **AI-Powered Social Engineering Challenge** | `incident-response` | ⚠️ Partial | **Refine** — Re-theme as social engineering decision tree |
| 10 min | 💻 **Secure or Risky? – AI Edition** | — | **Gap** | **Create new** — Rapid-fire binary choice game |
| 10 min | 📱 **QR / USB / AI Scam Challenge** | — | **Gap** | **Create new** — Physical prop + digital reveal module |
| 10 min | 🧠 **Cyber + AI Quiz** | `closing-quiz` | ✅ Exists | **Refine** — Add AI-specific questions, pledge screen |
| 5 min | 🏆 Winner Announcement | `closing-quiz` | ✅ Partial | **Refine** — Add scoreboard/winner reveal |
| 5 min | 🛡️ Cybersecurity & AI Safety Pledge | `closing-quiz` | ⚠️ Partial | **Refine** — Add pledge screen at end |

---

## Module Refactoring Priority

### Phase 1: High-Impact Refinements (Existing Modules)

#### 1. fault-finding → "Spot the Phish" (15 min) ✅ **DONE**
- Full-screen side-by-side compare view
- Keyboard-driven: Space=reveal, →=next, ←=prev
- 5 scenarios covering: domain spoofing, external URLs, context/body, attachments, display name spoofing
- **Content update needed**: Add 2-3 AI-generated phishing examples to `fault-finding.json`

#### 2. live-simulation → "Deepfake + Voice Clone" (20 min combined)
**Current**: LinkedIn recon → external message → social engineering → attachment → USB
**Target**: 
- Round 1: Deepfake video identification (CEO announcement)
- Round 2: Deepfake image (fake badge/ID)
- Round 3: Voice clone audio (CEO "urgent transfer" call)
- Round 4: AI-generated phishing email (from fault-finding pool)
- **Changes**: Update `live-simulation.json` with 4 beats, add audio player, video player components

#### 3. incident-response → "AI Social Engineering Challenge" (10 min)
**Current**: Drag-and-drop response steps race
**Target**: Scenario-based decision tree
- Present AI social engineering scenario (vishing + email + deepfake combo)
- Teams choose response path at 3 decision points
- Reveal correct path + why
- **Changes**: New HTML/JS for decision-tree format, new content JSON

#### 4. closing-quiz → "Cyber+AI Quiz + Pledge + Winner" (15 min)
**Current**: 5-question MCQ + STOP→VERIFY→REPORT recap
**Target**: 
- 8 questions (5 cyber basics + 3 AI-specific)
- Team scoring display
- Winner announcement screen
- Interactive pledge (facilitator reads, room responds)
- **Changes**: Update `closing-quiz.json`, add pledge screen, winner reveal animation

---

### Phase 2: New Modules (Gaps)

#### 5. secure-or-risky → "Secure or Risky? – AI Edition" (10 min)
**Format**: Rapid-fire binary choice
- 10 scenarios, 10 seconds each
- Facilitator reads → room votes (hands/voice) → reveal → 1-line explanation
- Scenarios: AI-generated code, ChatGPT data paste, AI meeting notes, deepfake verification, etc.
- **New files**: `secure-or-risky.html`, `secure-or-risky.js`, `secure-or-risky.json`

#### 6. qr-usb-scam → "QR / USB / AI Scam Challenge" (10 min)
**Format**: Physical + digital hybrid
- Facilitator shows physical props (QR code poster, USB drive, NFC tag)
- Room identifies threat → facilitator taps "Reveal" → digital explanation
- 3 stations: QR phishing, USB drop, AI voice QR scam
- **New files**: `qr-usb-scam.html`, `qr-usb-scam.js`, `qr-usb-scam.json`

---

## Console Index Reordering

New module sequence for `live-event/index.html`:

```javascript
const MODULE_ORDER = [
  { key: 'faultFinding',       label: 'Module 1 — Spot the Phish (AI Edition)',       time: '15 min', color: 'v-cyan' },
  { key: 'liveSimulation',     label: 'Module 2 — Deepfake & Voice Clone Challenge',  time: '20 min', color: 'v-red' },
  { key: 'incidentResponse',   label: 'Module 3 — AI Social Engineering Challenge',   time: '10 min', color: 'v-blue' },
  { key: 'secureOrRisky',      label: 'Module 4 — Secure or Risky? AI Edition',       time: '10 min', color: 'v-purple' },
  { key: 'qrUsbScam',          label: 'Module 5 — QR / USB / AI Scam Challenge',      time: '10 min', color: 'v-amber' },
  { key: 'closingQuiz',        label: 'Module 6 — Cyber+AI Quiz, Winner & Pledge',    time: '15 min', color: 'v-green' },
];
```

---

## Content Updates Needed

### fault-finding.json
- Add 2-3 AI-generated phishing examples (ChatGPT-written, perfect grammar, contextual)

### live-simulation.json
- Replace 5-beat chain with 4 deepfake/voice scenarios
- Add `mediaType: 'video'|'audio'|'image'` field
- Add `mediaUrl` for each beat

### incident-response.json (or new social-engineering.json)
- 3 decision-point scenarios
- Each: situation → 3 choices → correct answer + explanation

### closing-quiz.json
- 8 questions (mix of existing + new AI questions)
- Add `category: 'cyber'|'ai'` for scoring breakdown

### secure-or-risky.json (NEW)
```json
{
  "items": [
    { "scenario": "Paste proprietary code into ChatGPT to debug", "answer": "RISKY", "explanation": "Data leaves your environment; use local AI or sanctioned tools." },
    { "scenario": "Verify a CEO voice message by calling back on known number", "answer": "SECURE", "explanation": "Out-of-band verification defeats voice cloning." },
    ...
  ]
}
```

### qr-usb-scam.json (NEW)
```json
{
  "stations": [
    { "id": "qr-phish", "prop": "QR code on poster", "threat": "Redirects to credential harvester", "explanation": "..." },
    { "id": "usb-drop", "prop": "USB labeled 'Payroll 2024'", "threat": "Auto-runs malware", "explanation": "..." },
    { "id": "ai-voice-qr", "prop": "QR + 'Scan to verify your voice ID'", "threat": "Enrolls attacker's voice as yours", "explanation": "..." }
  ]
}
```

---

## CSS/Component Reuse

| Component | Used By | Status |
|-----------|---------|--------|
| `.le-timer` | live-simulation, incident-response, secure-or-risky, qr-usb-scam | ✅ Exists |
| `.ff-compare-frame` | fault-finding | ✅ Refined |
| `.ir-steps` (drag-drop) | incident-response (old) | ⚠️ Replace with decision cards |
| `.qz-choices` | closing-quiz | ✅ Exists |
| `.le-btn-row` | All modules | ✅ Hidden in fault-finding, keep for others |

---

## Execution Sequence

1. **Update index.html** — Reorder module cards, update labels/times
2. **Refine fault-finding.json** — Add AI phishing examples
3. **Refactor live-simulation** — New beats, media players, 20-min flow
4. **Refactor incident-response** — Decision tree format, 10-min flow
5. **Create secure-or-risky** — New rapid-fire module
6. **Create qr-usb-scam** — New hybrid module
7. **Refine closing-quiz** — AI questions, winner screen, pledge
8. **Test full 90-min run-through** — Timing, transitions, keyboard flow

---

## Keyboard Shortcuts Consistency (All Modules)

| Key | Action |
|-----|--------|
| Space / Enter | Primary action (reveal, next, start timer) |
| R | Reveal answer/explanation |
| → / N | Next item/round |
| ← / P | Previous item/round |
| Esc | Return to console |
| F | Toggle fullscreen |

---

## Estimated Effort

| Task | Hours |
|------|-------|
| Index reorder + labels | 0.5 |
| fault-finding content update | 0.5 |
| live-simulation refactor | 3 |
| incident-response refactor | 2 |
| secure-or-risky (new) | 2 |
| qr-usb-scam (new) | 2 |
| closing-quiz refine | 1.5 |
| Integration testing | 1.5 |
| **Total** | **~13 hours** |