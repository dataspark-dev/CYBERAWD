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

## Console Index Reordering

New module sequence for `live-event/index.html`:

```javascript
const MODULE_ORDER = [
  { key: 'faultFinding',       label: 'Module 1 — Spot the Phish (AI Edition)',       time: '15 min', color: 'v-cyan' },
  { key: 'liveSimulation',     label: 'Module 2 — Deepfake & Voice Clone Challenge',  time: '20 min', color: 'v-red' },
  { key: 'incidentResponse',   label: 'Module 3 — AI Social Engineering Challenge',   time: '10 min', color: 'v-blue' },
  { key: 'closingQuiz',        label: 'Module 4 — Cyber+AI Quiz, Winner & Pledge',    time: '15 min', color: 'v-green' },
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

---

## CSS/Component Reuse

| Component | Used By | Status |
|-----------|---------|--------|
| `.le-timer` | live-simulation, incident-response | ✅ Exists |
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
5. **Refine closing-quiz** — AI questions, winner screen, pledge
6. **Test full 90-min run-through** — Timing, transitions, keyboard flow

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
| closing-quiz refine | 1.5 |
| Integration testing | 1.5 |
| **Total** | **~9 hours** |