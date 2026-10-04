/* MediBridge AI — dependency-free browser application.
   The input interpreter is deliberately separate so a local AI model can replace it later. */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const scenarios = window.FIRST_AID_SCENARIOS || [];
  const translations = window.TRANSLATIONS || {};
  const SPEECH_LOCALES = { en: "en-IN", hi: "hi-IN", kn: "kn-IN", ur: "ur-PK" };
  // Chrome/Edge 139+ support on-device (offline-capable) speech RECOGNITION,
  // but only for the specific language tags they ship a local model for.
  // As of writing that list covers en-US and hi-IN (not en-IN, and not
  // Kannada or Urdu at all) - see MediBridge's testing notes for sources.
  const ON_DEVICE_STT_LOCALES = { en: "en-US", hi: "hi-IN" };
  // Keep country-specific emergency numbers in this one configuration object.
  const EMERGENCY_NUMBERS = { india: "emergencyNumberIndia", us: "emergencyNumberUS", uk: "emergencyNumberUK", other: "otherEmergencyNumber" };
  const MEDICATION_PATTERNS = ["medicine", "medication", "tablet", "pill", "dose", "drug", "दवा", "गोली", "ಔಷಧ", "ಮಾತ್ರೆ", "دوا", "گولی"];
  const state = { language: localStorage.getItem("medibridge-language") || "en", currentScenario: null, currentQuestion: 0, currentStep: 0, activeQuestion: null, conversationHistory: [], lastResponse: "", recognition: null, recognitionStarted: false, speechStatus: "idle", voiceUnavailableWarned: new Set(), conversationMode: false, voicePaused: false, voiceEntryPending: false, pendingClarification: false, thinking: false, responseTimer: null, activeView: "welcome", demoScenario: null, demoStep: 0, guideScenario: null, guideStep: 0, guideTimer: null };
  const offlineRecognitionReady = new Set();
  const stoppedRecognitions = new WeakSet();

  const situationForm = $("#situationForm");
  const situationInput = $("#situationInput");
  const conversation = $("#conversation");
  const languageSelect = $("#languageSelect");
  const connectionStatus = $("#connectionStatus");
  const emergencyDialog = $("#emergencyDialog");
  const settingsDialog = $("#settingsDialog");

  function t(key) { return (translations[state.language] && translations[state.language][key]) || translations.en[key] || key; }
  function localize(value) { if (!value) return ""; if (typeof value === "string") return value; return value[state.language] || value.en || ""; }
  function safeText(text) { const element = document.createElement("span"); element.textContent = text; return element.innerHTML; }
  function interpolate(text, values) { return text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""); }

  /* Future local model hook: replace only this function, retain the structured safety flow. */
  function interpretUserInput(userText) { return detectScenario(userText); }

  function normalizeText(text) {
    return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }

  function detectScenario(userText) {
    const text = normalizeText(userText);
    if (!text) return { type: "unknown", matches: [] };

    const scored = scenarios.map((scenario) => {
      let score = 0;
      const matched = [];
      scenario.keywords.forEach((keyword) => {
        const term = normalizeText(keyword);
        if (term && text.includes(term)) {
          // Multi-word evidence is more specific; a single exact term still counts.
          score += term.split(" ").length > 1 ? 3 : 1;
          matched.push(term);
        }
      });
      return { scenario, score, matched };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);

    // Check for a real emergency/scenario match FIRST. A message like "overdosed on
    // pills and not responding" must reach the poisoning/unconscious flow, not the
    // generic medication refusal, just because it also contains a medication word.
    if (scored.length && scored[0].score >= 1) {
      const top = scored[0];
      const closeMatches = scored.filter((entry) => entry.score >= top.score - 1 && entry.score > 0);
      // Do not guess where weak matching leaves multiple plausible situations.
      if (top.score === 1 && closeMatches.length > 1) return { type: "ambiguous", matches: closeMatches.slice(0, 4).map((entry) => entry.scenario) };
      return { type: "scenario", scenario: top.scenario, confidence: top.score, matches: closeMatches.map((entry) => entry.scenario) };
    }

    if (/\b(bleed|bleeding|blood loss)\b/.test(text) && !/\b(no|not|stopped|without)\b.{0,16}\b(bleed|bleeding|blood)\b/.test(text)) {
      const scenario = scenarios.find((item) => item.id === "severe_bleeding");
      if (scenario) return { type: "scenario", scenario, confidence: 1, matches: [scenario] };
    }

    // Only fall back to the medication refusal when nothing scenario-like matched.
    if (MEDICATION_PATTERNS.some((term) => text.includes(term))) return { type: "medication", matches: [] };
    return { type: "unknown", matches: [] };
  }

  function addMessage(kind, content, heading = "") {
    const article = document.createElement("article");
    article.className = `message ${kind}-message`;
    if (kind === "assistant") {
      article.innerHTML = `<span class="message-icon" aria-hidden="true">✚</span><div>${heading ? `<p class="message-heading">${safeText(heading)}</p>` : ""}<p>${safeText(content)}</p></div>`;
    } else {
      article.innerHTML = `<div><p>${safeText(content)}</p></div>`;
    }
    conversation.append(article);
    scrollToGuidance();
    return article;
  }

  function createCard(className, html) {
    const card = document.createElement("section");
    card.className = className;
    card.innerHTML = html;
    conversation.append(card);
    scrollToGuidance();
    return card;
  }

  function scrollToGuidance() {
    requestAnimationFrame(() => {
      $("#assistant").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function conversationPhase() {
    if (state.thinking) return "thinking";
    if (state.speechStatus === "speaking") return "speaking";
    if (state.recognition && state.recognitionStarted) return "listening";
    if (state.recognition) return "starting";
    if (state.voicePaused) return "paused";
    if (state.conversationMode) return "ready";
    return "idle";
  }

  function updateVoiceControls() {
    const supported = "speechSynthesis" in window;
    const enabled = Boolean(state.lastResponse && supported);
    $("#speakResponseButton").disabled = !enabled;
    $("#repeatSpeechButton").disabled = !enabled;
    $("#readAloudButton").disabled = !enabled;
    $("#pauseSpeechButton").disabled = !supported || state.speechStatus !== "speaking";
    $("#resumeSpeechButton").disabled = !supported || state.speechStatus !== "paused";
    $("#stopSpeechButton").disabled = !supported || (state.speechStatus === "idle" && !state.recognition);

    const phase = conversationPhase();
    const statusIndicator = $("#voiceStatusIndicator");
    if (statusIndicator) {
      statusIndicator.textContent = phase === "speaking" ? `🔊 ${t("speaking")}`
        : phase === "listening" ? `🎙️ ${t("listeningStatus")}`
        : phase === "thinking" ? `🧠 ${t("thinking")}`
        : phase === "starting" ? "Requesting microphone access…"
        : phase === "paused" ? "Voice paused"
        : phase === "ready" ? "Ready to listen"
        : "Voice is off";
    }

    const talkButton = $("#primaryTalkButton");
    const talkLabel = $("#primaryTalkLabel");
    if (talkButton && talkLabel) {
      ["is-idle", "is-starting", "is-listening", "is-thinking", "is-speaking", "is-ready", "is-paused"].forEach((cls) => talkButton.classList.remove(cls));
      talkButton.classList.add(`is-${phase}`);
      talkButton.setAttribute("aria-pressed", phase === "idle" ? "false" : "true");
      const micIcon = talkButton.querySelector(".mic-icon");
      if (micIcon) micIcon.textContent = phase === "listening" ? "🔴" : phase === "speaking" ? "🔊" : phase === "thinking" ? "🧠" : "🎤";
      talkLabel.textContent = phase === "listening" ? t("listeningStatus")
        : phase === "thinking" ? t("thinking")
        : phase === "speaking" ? t("mediBridgeSpeaking")
        : phase === "ready" ? "Voice is ready"
        : phase === "paused" ? "Resume voice"
        : t("talkToMediBridge");
    }

    const primaryStop = $("#primaryStopButton");
    if (primaryStop) primaryStop.disabled = phase === "idle";
    const welcomeStatus = $("#welcomeVoiceStatus");
    if (welcomeStatus && state.activeView === "welcome") {
      welcomeStatus.textContent = phase === "listening" ? "Listening… speak naturally."
        : phase === "starting" ? "Waiting for microphone permission…"
        : phase === "thinking" ? t("thinking")
        : phase === "speaking" ? t("mediBridgeSpeaking")
        : phase === "paused" ? "Voice paused"
        : "";
    } else if (welcomeStatus) welcomeStatus.textContent = "";
    const chatMic = $("#chatMicButton");
    if (chatMic) {
      chatMic.textContent = phase === "listening" ? "🔴" : "🎤";
      chatMic.setAttribute("aria-label", state.voicePaused ? "Resume voice conversation" : state.conversationMode || state.recognition ? "Pause voice conversation" : "Start voice conversation");
      chatMic.title = chatMic.getAttribute("aria-label");
      chatMic.classList.toggle("is-listening", phase === "listening");
      chatMic.setAttribute("aria-pressed", phase === "listening" ? "true" : "false");
    }
    const pauseButton = $("#voicePauseButton");
    if (pauseButton) {
      pauseButton.disabled = phase === "idle";
      pauseButton.querySelector("span").textContent = state.voicePaused ? "Resume" : "Pause";
      pauseButton.firstChild.textContent = state.voicePaused ? "▶ " : "Ⅱ ";
    }
  }

  function respond(text, heading = "") {
    // Intentionally does not auto-speak: respond() is used for intros,
    // warnings, clarification prompts, and wrap-up text. Only setSpeakable()
    // (the actual guided question/step content) triggers automatic speech.
    state.lastResponse = text;
    addMessage("assistant", text, heading);
    updateVoiceControls();
  }

  function setSpeakable(text) {
    state.lastResponse = text;
    updateVoiceControls();
    if ($("#voiceGuidanceToggle").checked) speakResponse(text);
  }

  function clearConversation() {
    conversation.innerHTML = "";
    state.conversationHistory = [];
    state.lastResponse = "";
    state.activeQuestion = null;
    state.pendingClarification = false;
    state.thinking = false;
    if (state.responseTimer) window.clearTimeout(state.responseTimer);
    state.responseTimer = null;
    updateVoiceControls();
  }

  function showUnknown() {
    respond(`${t("noScenario")} ${t("clarification")}`);
  }

  function urgencyLabel(urgency) {
    const names = { green: t("generalGuidance"), yellow: t("urgentTitle"), red: t("possibleEmergencyTitle"), critical: t("possibleEmergencyTitle") };
    return names[urgency] || t("nextStep");
  }

  function showUrgency(scenario, forced = false) {
    const isCritical = forced || scenario.urgency === "critical";
    const level = isCritical ? "critical" : scenario.urgency;
    if (level === "green") return;
    const escalation = localize(scenario.escalationMessage);
    const text = isCritical ? `${t("getHelpNow")} ${escalation}` : escalation;
    createCard("question-card urgency-card", `<span class="urgency ${level}">${safeText(urgencyLabel(level))}</span><h3>${safeText(t("whatToDoNow"))}</h3><p>${safeText(text)}</p><p class="call-when"><strong>${safeText(t("whenToCall"))}</strong> ${safeText(escalation)}</p><p class="safety-guardrail">${safeText(t("firstAidOnly"))}</p><button type="button" class="button button-emergency emergency-now">🆘 ${safeText(t("emergencyHelp"))}</button>`);
    conversation.lastElementChild.querySelector(".emergency-now").addEventListener("click", openEmergency);
  }

  function startScenario(scenario, { showSelection = false, initialReply = "", viaVoice = false } = {}) {
    stopSpeech();
    state.currentScenario = scenario;
    state.currentQuestion = 0;
    state.activeQuestion = null;
    state.currentStep = 0;
    if (showSelection) addMessage("user", `${scenario.icon} ${localize(scenario.name)}`);
    respond(t("importantFirst"), localize(scenario.name));
    const isUrgent = ["critical", "red"].includes(scenario.urgency);
    if (isUrgent) showUrgency(scenario);
    const firstQuestion = scenario.questions[0];
    const initialAnswer = firstQuestion && initialReply ? interpretAnswer(initialReply, firstQuestion, scenario) : null;
    if (initialAnswer) {
      state.currentQuestion = 1;
      if (scenario.id === "choking" && initialAnswer === "no") state.currentStep = 1;
    }
    const hasNaturalFollowUp = scenario.questions.length > 0 && !initialAnswer;
    showStep({ speak: !hasNaturalFollowUp });
    if (hasNaturalFollowUp) {
      showQuestion();
      setSpeakable(`${localize(scenario.steps[0])} ${localize(firstQuestion.text)}`);
    }
  }

  function showQuestion() {
    const scenario = state.currentScenario;
    const question = scenario.questions[state.currentQuestion];
    if (!question) { showStep(); return; }
    state.activeQuestion = question;
    addMessage("assistant", localize(question.text));
  }

  function answerQuestion(question, option, userText = "") {
    addMessage("user", userText || localize(option.label));
    if (question.emergencyOn.includes(option.value)) showUrgency(state.currentScenario, true);
    state.currentQuestion += 1;
    state.activeQuestion = null;
    if (state.currentScenario.id === "choking" && option.value === "no") {
      state.currentStep = 1;
      showStep();
      return;
    }
    if (state.currentScenario.questions[state.currentQuestion]) showQuestion();
    else if (state.currentScenario.id === "choking" && option.value === "yes") {
      state.currentStep = 0;
      showStep();
    } else showStep();
  }

  function showStep({ speak = true } = {}) {
    const scenario = state.currentScenario;
    const step = scenario.steps[state.currentStep];
    if (!step) { finishScenario(); return; }
    conversation.querySelectorAll(".step-card.current-step").forEach((card) => card.remove());
    const stepText = localize(step);
    respond(stepText);
    if (speak) setSpeakable(stepText);
    const dots = scenario.steps.map((_, index) => `<span class="${index <= state.currentStep ? "active" : ""}" aria-hidden="true"></span>`).join("");
    const card = createCard("step-card current-step", `<div class="progress">${dots}</div><div class="step-number">${safeText(interpolate(t("stepOf"), { current: state.currentStep + 1, total: scenario.steps.length }))}</div><div class="step-actions"><button type="button" class="button button-secondary previous-step" ${state.currentStep === 0 ? "disabled" : ""}>← ${safeText(t("previous"))}</button><button type="button" class="button button-secondary repeat-step">↻ ${safeText(t("repeatStep"))}</button><button type="button" class="button button-primary next-step">${safeText(t("next"))} →</button><button type="button" class="button button-help need-help">🆘 ${safeText(t("needHelp"))}</button></div>`);
    card.querySelector(".previous-step").addEventListener("click", () => {
      if (state.currentStep === 0) return;
      state.currentStep -= 1;
      showStep();
    });
    card.querySelector(".repeat-step").addEventListener("click", () => speakResponse(stepText));
    card.querySelector(".need-help").addEventListener("click", openEmergency);
    card.querySelector(".next-step").addEventListener("click", () => {
      addMessage("user", t("next"));
      state.currentStep += 1;
      showStep();
    });
  }

  function finishScenario() {
    const scenario = state.currentScenario;
    conversation.querySelectorAll(".step-card.current-step").forEach((card) => card.remove());
    respond(localize(scenario.escalationMessage), t("nextStep"));
    const avoid = createCard("avoid-list", `<p>${safeText(t("doNot"))}</p><ul>${scenario.doNot.map((item) => `<li>${safeText(localize(item))}</li>`).join("")}</ul><div class="restart-row"><button type="button" class="button button-secondary restart-flow">↺ ${safeText(t("startOver"))}</button><button type="button" class="text-button emergency-now">🆘 ${safeText(t("emergencyHelp"))}</button></div>`);
    avoid.querySelector(".restart-flow").addEventListener("click", resetFlow);
    avoid.querySelector(".emergency-now").addEventListener("click", openEmergency);
  }

  function interpretAnswer(text, question, scenario) {
    const normalized = normalizeText(text);
    if (!normalized) return null;
    if (scenario.id === "choking") {
      if (/\b(can t|cant|cannot|unable|struggl\w*|not|no)\b.{0,24}\b(cough|speak|breathe|breathing|air)\b|\b(not breathing|silent|turning blue|unresponsive)\b/.test(normalized)) return "no";
      if (/\b(can|able to|is|are)\b.{0,24}\b(cough|speak|breathe|breathing)\b|\bcoughing effectively\b|\bthey can\b/.test(normalized)) return "yes";
    }
    if (scenario.id === "severe_bleeding" || scenario.id === "minor_bleeding") {
      if (/\b(still bleeding|wont stop|won t stop|not stopping|spurting|heavy bleeding|bleeding heavily)\b/.test(normalized)) return "yes";
      if (/\b(bleeding stopped|has stopped|stopped bleeding|no more blood)\b/.test(normalized)) return "no";
    }
    if (scenario.id === "unconscious" || scenario.id === "fainting") {
      if (/\b(not responding|unresponsive|unconscious|not awake|won t wake|wont wake)\b/.test(normalized)) return "no";
      if (/\b(responding|awake|woke up|conscious|speaking)\b/.test(normalized)) return "yes";
    }
    if (scenario.id === "burn" && /\b(not breathing|unconscious|unresponsive|struggling to breathe)\b/.test(normalized)) return "no";
    if (/\b(not sure|unsure|dont know|do not know|maybe|uncertain)\b/.test(normalized)) return "not_sure";
    if (/^(no|nope|not really|cannot|cant|can t)$/.test(normalized)) return "no";
    if (/^(yes|yeah|yep|correct|that is right)$/.test(normalized)) return "yes";

    const negativeEvidence = ["no", "not_sure"].some((value) => question.emergencyOn.includes(value));
    if (negativeEvidence && /\b(severe|heavy|spurting|large|deep|electrical|chemical|trouble breathing|serious)\b/.test(normalized)) return "yes";
    if (negativeEvidence && /\b(normal|stopped|awake|responding|breathing normally|small|minor|mild)\b/.test(normalized)) return "yes";
    if (!negativeEvidence && /\b(no|not|cannot|unable|unresponsive|unconscious|trouble breathing|not breathing)\b/.test(normalized)) return "no";
    return null;
  }

  function handleActiveReply(text, viaVoice) {
    const scenario = state.currentScenario;
    if (!scenario) return false;
    const normalized = normalizeText(text);
    const question = state.activeQuestion;
    if (question) {
      const value = interpretAnswer(text, question, scenario);
      if (!value) return false;
      const option = question.options.find((item) => item.value === value);
      if (!option) return false;
      answerQuestion(question, option, text);
      return true;
    }

    if (/\b(next|continue|go on|what next|done)\b/.test(normalized)) {
      addMessage("user", text);
      state.currentStep += 1;
      showStep();
      return true;
    }
    if (/\b(repeat|again|say that again)\b/.test(normalized)) {
      addMessage("user", text);
      speakResponse();
      return true;
    }
    if (/\b(previous|go back|back)\b/.test(normalized) && state.currentStep > 0) {
      addMessage("user", text);
      state.currentStep -= 1;
      showStep();
      return true;
    }
    if (/\b(help|emergency|call an ambulance|call emergency)\b/.test(normalized)) {
      addMessage("user", text);
      respond(t("getHelpNow"));
      if (viaVoice) speakResponse(t("getHelpNow"));
      return true;
    }
    return false;
  }

  function handleSituation(text, { viaVoice = false } = {}) {
    const value = (text || "").trim();
    if (!value) { situationInput.focus(); return; }
    if (viaVoice && state.voiceEntryPending) {
      state.voiceEntryPending = false;
      showView("assistant");
      clearConversation();
    }
    const result = interpretUserInput(value);
    if (state.currentScenario) {
      if (result.type === "scenario" && result.scenario.id !== state.currentScenario.id) {
        addMessage("user", value);
        startScenario(result.scenario, { initialReply: value, viaVoice });
        return;
      }
      if (handleActiveReply(value, viaVoice)) return;
      addMessage("user", value);
      const followUp = state.activeQuestion
        ? `I’m following the current situation. ${localize(state.activeQuestion.text)}`
        : "I’m following the current situation. Could you tell me a little more about what is happening now?";
      respond(followUp);
      return;
    }
    if (!state.pendingClarification && !viaVoice) clearConversation();
    addMessage("user", value);
    if (result.type === "medication") { state.pendingClarification = false; respond(t("medication")); return; }
    if (result.type === "unknown") { state.pendingClarification = true; showUnknown(); return; }
    if (result.type === "ambiguous") { state.pendingClarification = true; respond("I’m not sure which situation you mean. What is the main problem right now?"); return; }
    state.pendingClarification = false;
    startScenario(result.scenario, { initialReply: value, viaVoice });
  }

  function resetFlow() {
    stopConversation();
    state.currentScenario = null;
    state.currentQuestion = 0;
    state.currentStep = 0;
    state.activeQuestion = null;
    state.pendingClarification = false;
    clearConversation();
    respond(t("welcome"));
    situationInput.value = "";
    situationInput.focus();
  }

  function renderQuickActions() {
    const quickIds = ["choking", "severe_bleeding", "burn", "unconscious", "possible_stroke", "possible_heart_attack", "seizure", "fracture", "poisoning", "severe_allergic_reaction", "electric_shock", "heat_stroke"];
    const grid = $("#quickActionGrid");
    grid.innerHTML = "";
    quickIds.forEach((id) => {
      const scenario = scenarios.find((item) => item.id === id);
      if (!scenario) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `quick-action-card urgency-${scenario.urgency}`;
      button.innerHTML = `<span aria-hidden="true">${scenario.icon}</span><strong>${safeText(localize(scenario.name))}</strong><small>${safeText(urgencyLabel(scenario.urgency))}</small>`;
      button.addEventListener("click", () => { clearConversation(); startScenario(scenario, { showSelection: true }); });
      grid.append(button);
    });
  }

  function renderScenarioCards() {
    const commonIds = ["minor_bleeding", "sprain", "nosebleed", "heat_exhaustion", "drowning", "not_breathing_normally", "panic_distress", "fainting"];
    const grid = $("#scenarioGrid");
    grid.innerHTML = "";
    commonIds.forEach((id) => {
      const scenario = scenarios.find((item) => item.id === id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenario-card";
      button.innerHTML = `<span aria-hidden="true">${scenario.icon}</span>${safeText(localize(scenario.name))}<small>${safeText(urgencyLabel(scenario.urgency))}</small>`;
      button.addEventListener("click", () => { clearConversation(); startScenario(scenario, { showSelection: true }); });
      grid.append(button);
    });
  }

  function showView(view, updateHash = true) {
    const next = ["welcome", "assistant", "demo", "guide"].includes(view) ? view : "welcome";
    if (next !== "assistant" && state.conversationMode) stopConversation();
    state.activeView = next;
    $("#welcomeScreen").hidden = next !== "welcome";
    $("#mainExperience").hidden = next !== "assistant";
    $("#demoPage").hidden = next !== "demo";
    $("#visualGuidePage").hidden = next !== "guide";
    if (next !== "guide") stopGuidePlayback();
    if (updateHash && location.hash !== `#${next}`) history.pushState(null, "", `#${next}`);
    updateVoiceControls();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function appendDemoMessage(kind, text) {
    const message = document.createElement("p");
    message.className = `demo-message ${kind}`;
    message.textContent = text;
    $("#demoConversation").append(message);
  }

  function beginDemo(scenario) {
    state.demoScenario = scenario;
    state.demoStep = 0;
    const output = $("#demoConversation");
    output.replaceChildren();
    $("#resetDemoButton").disabled = false;
    appendDemoMessage("assistant", `${localize(scenario.name)} · ${urgencyLabel(scenario.urgency)}. ${localize(scenario.escalationMessage)}`);
    if (scenario.questions.length) {
      const question = scenario.questions[0];
      appendDemoMessage("assistant", localize(question.text));
      renderDemoAnswers(question);
    } else {
      showDemoStep();
    }
  }

  function renderDemoAnswers(question) {
    const controls = $("#demoControls");
    controls.replaceChildren();
    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-button";
      button.textContent = localize(option.label);
      button.addEventListener("click", () => {
        appendDemoMessage("user", localize(option.label));
        if (state.demoScenario.id === "choking" && option.value === "no") state.demoStep = 1;
        else state.demoStep = 0;
        showDemoStep();
      });
      controls.append(button);
    });
  }

  function showDemoStep() {
    const scenario = state.demoScenario;
    const controls = $("#demoControls");
    controls.replaceChildren();
    if (!scenario) return;
    if (state.demoStep >= scenario.steps.length) {
      appendDemoMessage("assistant", localize(scenario.escalationMessage));
      appendDemoMessage("assistant", `${t("doNot")}: ${scenario.doNot.map(localize).join(" ")}`);
      return;
    }
    appendDemoMessage("assistant", `Step ${state.demoStep + 1}: ${localize(scenario.steps[state.demoStep])}`);
    const next = document.createElement("button");
    next.type = "button";
    next.className = "button button-primary";
    next.textContent = state.demoStep + 1 < scenario.steps.length ? "Show next step" : "Finish example";
    next.addEventListener("click", () => {
      appendDemoMessage("user", "Continue");
      state.demoStep += 1;
      showDemoStep();
    });
    controls.append(next);
  }

  function resetDemo() {
    state.demoScenario = null;
    state.demoStep = 0;
    $("#demoConversation").innerHTML = '<p class="demo-placeholder">Choose an example to begin.</p>';
    $("#demoControls").replaceChildren();
    $("#resetDemoButton").disabled = true;
  }

  function renderDemoScenarios() {
    const list = $("#demoScenarioList");
    list.replaceChildren();
    ["choking", "severe_bleeding", "possible_stroke", "burn"].forEach((id) => {
      const scenario = scenarios.find((item) => item.id === id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "demo-scenario-button";
      button.textContent = `${scenario.icon} ${localize(scenario.name)}`;
      button.addEventListener("click", () => beginDemo(scenario));
      list.append(button);
    });
  }

  function renderGuideTopics() {
    const select = $("#guideScenarioSelect");
    const current = select.value;
    select.replaceChildren();
    ["choking", "severe_bleeding", "burn"].forEach((id) => {
      const scenario = scenarios.find((item) => item.id === id);
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = localize(scenario.name);
      select.append(option);
    });
    if (scenarios.some((scenario) => scenario.id === current)) select.value = current;
    state.guideScenario = scenarios.find((scenario) => scenario.id === select.value) || scenarios.find((scenario) => scenario.id === "choking");
    renderGuideStep();
  }

  function renderGuideStep() {
    const scenario = state.guideScenario;
    if (!scenario) return;
    state.guideStep = Math.min(state.guideStep, scenario.steps.length - 1);
    $("#guideStepCount").textContent = `Step ${state.guideStep + 1} of ${scenario.steps.length} · ${localize(scenario.name)}`;
    $("#guideCaption").textContent = localize(scenario.steps[state.guideStep]);
    $("#guideIllustration").dataset.topic = scenario.id;
    $("#guideProgress").replaceChildren(...scenario.steps.map((_, index) => {
      const dot = document.createElement("span");
      if (index === state.guideStep) dot.className = "active";
      return dot;
    }));
    $("#guidePreviousButton").disabled = state.guideStep === 0;
    $("#guideNextButton").disabled = state.guideStep === scenario.steps.length - 1;
  }

  function stopGuidePlayback() {
    if (state.guideTimer) window.clearInterval(state.guideTimer);
    state.guideTimer = null;
    const button = $("#guidePlayButton");
    if (button) button.textContent = "▶ Play steps";
  }

  function toggleGuidePlayback() {
    if (state.guideTimer) {
      stopGuidePlayback();
      return;
    }
    if (state.guideStep >= state.guideScenario.steps.length - 1) state.guideStep = 0;
    $("#guidePlayButton").textContent = "Ⅱ Pause";
    renderGuideStep();
    state.guideTimer = window.setInterval(() => {
      if (state.guideStep >= state.guideScenario.steps.length - 1) {
        stopGuidePlayback();
        return;
      }
      state.guideStep += 1;
      renderGuideStep();
    }, 4500);
  }

  function translateUI() {
    document.documentElement.lang = state.language;
    document.body.dir = state.language === "ur" ? "rtl" : "ltr";
    languageSelect.value = state.language;
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    updateConnectionStatus();
    updateEmergencyNumber();
    renderQuickActions();
    renderScenarioCards();
    renderDemoScenarios();
    renderGuideTopics();
    if (!state.currentScenario && !conversation.children.length) respond(t("welcome"));
  }

  function setLanguage(language) {
    state.language = translations[language] ? language : "en";
    localStorage.setItem("medibridge-language", state.language);
    translateUI();
    // Re-show the current point of a flow in the newly selected language.
    if (state.currentScenario) {
      const scenario = state.currentScenario;
      clearConversation();
      respond(t("importantFirst"), localize(scenario.name));
      if (["critical", "red"].includes(scenario.urgency)) showUrgency(scenario);
      if (state.currentQuestion < scenario.questions.length) showQuestion(); else showStep();
    }
  }

  function updateConnectionStatus() {
    const connectionLabel = navigator.onLine ? "Online" : "Offline";
    const connectionDetail = navigator.onLine ? "Core first-aid content is available locally. Browser speech may still need an internet connection." : "Offline. Core first-aid content remains available locally; speech recognition may not work.";
    connectionStatus.textContent = connectionLabel;
    connectionStatus.setAttribute("aria-label", `${connectionLabel}. ${connectionDetail}`);
    connectionStatus.title = connectionDetail;
    connectionStatus.classList.toggle("offline", !navigator.onLine);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    $("#voiceConnectionNote").textContent = !Recognition
      ? "Speech recognition is not supported by this browser. You can type; local first-aid guidance remains available."
      : navigator.onLine
        ? "Browser speech recognition may send audio to an online service. It is not guaranteed to work offline."
        : "You are offline. Voice recognition is unavailable unless this browser has an installed on-device speech model for your language.";
  }

  function updateEmergencyNumber() {
    const key = EMERGENCY_NUMBERS[$("#countrySelect").value] || EMERGENCY_NUMBERS.other;
    $("#emergencyNumber").textContent = t(key);
  }

  function openEmergency() {
    stopConversation();
    if (typeof emergencyDialog.showModal === "function") emergencyDialog.showModal(); else emergencyDialog.setAttribute("open", "");
  }

  function closeDialogs() { [emergencyDialog, settingsDialog].forEach((dialog) => { if (dialog.open && typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); }); }

  // --- Voice output -----------------------------------------------------
  // Setting utterance.lang alone does not guarantee the browser can actually
  // speak that language: if no matching voice is installed, some browsers
  // fail silently instead of speaking in a fallback accent. So we check the
  // browser's real voice list first and only ever speak with a voice that
  // genuinely matches, telling the user plainly when none exists.
  let cachedVoices = [];

  function refreshVoiceCache() {
    if (!("speechSynthesis" in window)) return;
    const list = window.speechSynthesis.getVoices();
    if (list && list.length) cachedVoices = list;
  }

  if ("speechSynthesis" in window) {
    refreshVoiceCache();
    // Chrome (and some other browsers) load the voice list asynchronously —
    // it is often empty on the very first call until this event fires.
    window.speechSynthesis.onvoiceschanged = refreshVoiceCache;
  }

  function findVoiceForLanguage(langTag) {
    if (!cachedVoices.length) refreshVoiceCache();
    if (!cachedVoices.length || !langTag) return null;
    const base = langTag.split("-")[0].toLowerCase();
    const exact = cachedVoices.filter((voice) => voice.lang && voice.lang.toLowerCase() === langTag.toLowerCase());
    const prefixed = cachedVoices.filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith(base + "-"));
    const baseOnly = cachedVoices.filter((voice) => voice.lang && voice.lang.toLowerCase() === base);
    // Some bundled Chrome voices actually stream audio from a network
    // service despite appearing in the voice list. Prefer a voice the
    // browser marks as local (voice.localService) so read-aloud keeps
    // working offline; still use a non-local match rather than nothing.
    const pick = (list) => list.find((voice) => voice.localService) || list[0] || null;
    return pick(exact) || pick(prefixed) || pick(baseOnly) || null;
  }

  function speakResponse(text = state.lastResponse) {
    if (!("speechSynthesis" in window) || !text) return;
    const langTag = SPEECH_LOCALES[state.language];
    const voice = findVoiceForLanguage(langTag);
    if (!voice) {
      // Never claim to speak a language this browser/device has no voice
      // for. The guidance text is already visible either way, so this is a
      // true fallback, not a broken feature — explained once per language.
      state.speechStatus = "idle";
      updateVoiceControls();
      if (!state.voiceUnavailableWarned.has(state.language)) {
        state.voiceUnavailableWarned.add(state.language);
        addMessage("assistant", t("voiceOutputUnavailable"));
      }
      maybeContinueConversation();
      return;
    }
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.92;
    utterance.onend = () => { state.speechStatus = "idle"; updateVoiceControls(); maybeContinueConversation(); };
    utterance.onerror = (event) => {
      state.speechStatus = "idle";
      updateVoiceControls();
      if (event.error !== "canceled" && event.error !== "interrupted") addMessage("assistant", t("voiceOutputUnavailable"));
      maybeContinueConversation();
    };
    state.speechStatus = "speaking";
    window.speechSynthesis.speak(utterance);
    updateVoiceControls();
  }

  function pauseSpeech() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.pause();
    state.speechStatus = "paused";
    updateVoiceControls();
  }

  function resumeSpeech() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.resume();
    state.speechStatus = "speaking";
    updateVoiceControls();
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    state.speechStatus = "idle";
    updateVoiceControls();
  }

  function stopConversation() {
    state.conversationMode = false;
    state.voicePaused = false;
    state.voiceEntryPending = false;
    state.thinking = false;
    if (state.responseTimer) window.clearTimeout(state.responseTimer);
    state.responseTimer = null;
    if (state.recognition) {
      const recognition = state.recognition;
      state.recognition = null;
      state.recognitionStarted = false;
      stoppedRecognitions.add(recognition);
      try {
        recognition.stop();
      } catch (error) {
        stoppedRecognitions.delete(recognition);
        console.warn("Could not stop speech recognition cleanly.", error);
      }
    }
    stopSpeech();
    updateVoiceControls();
  }

  function stopListeningForReply() {
    if (!state.recognition) return;
    const recognition = state.recognition;
    state.recognition = null;
    state.recognitionStarted = false;
    stoppedRecognitions.add(recognition);
    try {
      recognition.stop();
    } catch (error) {
      stoppedRecognitions.delete(recognition);
      console.warn("Could not pause speech recognition for a typed reply.", error);
    }
    updateVoiceControls();
  }

  function maybeContinueConversation() {
    if (!state.conversationMode) return;
    if (state.thinking) return; // still generating the response - see recognition.onresult
    if (state.speechStatus === "speaking") return; // utterance.onend will retry once speech ends
    if (state.recognition) return; // already listening
    startVoiceRecognition();
  }

  function startVoiceRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      state.conversationMode = false;
      state.voicePaused = false;
      state.voiceEntryPending = false;
      showView("assistant");
      respond(t("voiceUnsupported"));
      return;
    }

    if (state.recognition) {
      pauseConversation();
      return;
    }

    const onDeviceLangTag = ON_DEVICE_STT_LOCALES[state.language];
    const useOnDevice = !navigator.onLine && onDeviceLangTag && offlineRecognitionReady.has(onDeviceLangTag);
    if (!navigator.onLine && !useOnDevice) {
      state.conversationMode = false;
      state.voicePaused = false;
      state.voiceEntryPending = false;
      showView("assistant");
      respond(t("voiceOfflineUnavailable"));
      return;
    }
    state.conversationMode = true;
    state.voicePaused = false;

    // Never listen while MediBridge is talking - this is what stops the
    // microphone from picking up its own voice. Once speech ends,
    // speakResponse()'s utterance.onend calls maybeContinueConversation(),
    // which starts a fresh recognition attempt automatically.
    if (state.speechStatus === "speaking") return;

    let recognition;
    try {
      recognition = new Recognition();
    } catch (error) {
      state.conversationMode = false;
      state.voiceEntryPending = false;
      showView("assistant");
      console.warn("Could not create speech recognition.", error);
      respond(t("voiceError"));
      return;
    }
    state.recognition = recognition;
    state.recognitionStarted = false;
    recognition.lang = SPEECH_LOCALES[state.language];
    if (useOnDevice) recognition.processLocally = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    updateVoiceControls();
    let gotResult = false;
    let recognitionError = "";
    recognition.onresult = (event) => {
      if (!state.conversationMode) return;
      gotResult = true;
      const transcript = event.results[0][0].transcript;
      situationInput.value = transcript;
      // A short, real pause so "MediBridge is understanding you" is visible
      // as its own step, not an instant jump straight to speaking. The
      // conversation loop will not try to relisten during this window (see
      // maybeContinueConversation's state.thinking guard).
      state.thinking = true;
      updateVoiceControls();
      state.responseTimer = window.setTimeout(() => {
        state.responseTimer = null;
        if (!state.conversationMode) {
          state.thinking = false;
          updateVoiceControls();
          return;
        }
        state.thinking = false;
        handleSituation(transcript, { viaVoice: true });
        if (situationInput.value === transcript) situationInput.value = "";
        if ($("#voiceGuidanceToggle").checked && state.speechStatus !== "speaking" && state.lastResponse) {
          speakResponse();
        }
        updateVoiceControls();
        maybeContinueConversation(); // covers the case where no speech follows (e.g. voice guidance off)
      }, 450);
    };
    recognition.onerror = (event) => {
      if (stoppedRecognitions.has(recognition)) return;
      if (gotResult) return; // a valid result already came through; onend will continue the loop
      recognitionError = event && event.error || "";
      if (recognitionError === "no-speech") return;
      // A real failure (no speech heard, mic denied, timed out, offline with
      // no cloud reachable, etc.) ends the loop gracefully rather than
      // retrying forever - tapping Talk again starts a fresh attempt.
      state.conversationMode = false;
      const networkFailure = recognitionError === "network";
      const captureFailure = recognitionError === "audio-capture";
      const permissionFailure = recognitionError === "not-allowed" || recognitionError === "service-not-allowed";
      state.recognitionStarted = false;
      if (state.voiceEntryPending) {
        state.voiceEntryPending = false;
        showView("assistant");
      }
      const message = networkFailure ? t("voiceNetworkError")
        : captureFailure ? t("voiceMicrophoneUnavailable")
        : permissionFailure ? t("voicePermissionDenied")
        : t("voiceError");
      respond(message);
    };
    recognition.onstart = () => {
      if (state.recognition !== recognition) return;
      state.recognitionStarted = true;
      updateVoiceControls();
    };
    recognition.onend = () => {
      if (stoppedRecognitions.has(recognition)) {
        stoppedRecognitions.delete(recognition);
        return;
      }
      if (state.recognition !== recognition) return;
      state.recognition = null;
      state.recognitionStarted = false;
      updateVoiceControls();
      if (gotResult) maybeContinueConversation();
      else if (state.conversationMode && recognitionError === "no-speech") {
        window.setTimeout(maybeContinueConversation, 300);
      }
    };
    try {
      // Start synchronously from the button click so browsers can show their
      // microphone permission prompt while the click still has user activation.
      recognition.start();
    } catch (error) {
      state.recognition = null;
      state.recognitionStarted = false;
      state.conversationMode = false;
      state.voiceEntryPending = false;
      showView("assistant");
      updateVoiceControls();
      console.warn("Could not start speech recognition.", error);
      const message = ["NotAllowedError", "SecurityError"].includes(error.name) ? t("voicePermissionDenied")
        : ["NotFoundError", "DevicesNotFoundError"].includes(error.name) ? t("voiceMicrophoneUnavailable")
        : error.name === "NetworkError" ? t("voiceNetworkError")
        : t("voiceError");
      respond(message);
    }

  }

  function pauseConversation() {
    state.conversationMode = false;
    state.voicePaused = true;
    state.thinking = false;
    if (state.responseTimer) window.clearTimeout(state.responseTimer);
    state.responseTimer = null;
    if (state.recognition) {
      const recognition = state.recognition;
      state.recognition = null;
      state.recognitionStarted = false;
      stoppedRecognitions.add(recognition);
      try {
        recognition.stop();
      } catch (error) {
        stoppedRecognitions.delete(recognition);
        console.warn("Could not pause speech recognition cleanly.", error);
      }
    }
    stopSpeech();
    updateVoiceControls();
  }

  function resumeConversation() {
    if (!state.voicePaused) return;
    state.voicePaused = false;
    startVoiceRecognition();
  }

  function prepareOfflineVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition || typeof Recognition.available !== "function" || !navigator.onLine) return;
    // Best-effort and silent: while online, ask the browser to download its
    // on-device voice models for English and Hindi, so a later offline
    // attempt (e.g. during a demo with Wi-Fi off) has a real chance of
    // working. Never surfaces an error if the browser doesn't support this.
    Object.values(ON_DEVICE_STT_LOCALES).forEach((langTag) => {
      Recognition.available({ langs: [langTag], processLocally: true })
        .then((status) => {
          if (status === "available") offlineRecognitionReady.add(langTag);
          if (status === "downloadable") {
            return Recognition.install({ langs: [langTag], processLocally: true }).then(() => offlineRecognitionReady.add(langTag));
          }
        })
        .catch((error) => console.info(`On-device speech recognition is unavailable for ${langTag}.`, error));
    });
  }

  function applySavedSettings() {
    const large = localStorage.getItem("medibridge-large-text") === "true";
    const contrast = localStorage.getItem("medibridge-high-contrast") === "true";
    // Default to ON for first-time visitors (auto-narrated steps feel more like
    // a person guiding you); an explicit saved choice is always respected.
    const savedVoice = localStorage.getItem("medibridge-voice-guidance");
    const voice = savedVoice === null ? true : savedVoice === "true";
    $("#largeTextToggle").checked = large;
    $("#contrastToggle").checked = contrast;
    $("#voiceGuidanceToggle").checked = voice;
    document.body.classList.toggle("large-text", large);
    document.body.classList.toggle("high-contrast", contrast);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("service-worker.js").catch((error) => {
        console.warn("Offline app caching could not be registered. Core guidance remains available while this page is open.", error);
      });
    }
  }

  function bindEvents() {
    situationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const message = situationInput.value;
      const keepVoiceActive = state.conversationMode;
      if (keepVoiceActive) stopListeningForReply();
      handleSituation(message);
      if (message.trim()) situationInput.value = "";
      if (keepVoiceActive && state.speechStatus !== "speaking") maybeContinueConversation();
    });
    $("#welcomeStartButton").addEventListener("click", () => {
      if (state.voicePaused) resumeConversation();
      else if (state.conversationMode || state.recognition) pauseConversation();
      else {
        state.voiceEntryPending = true;
        startVoiceRecognition();
      }
    });
    $("#welcomeDemoButton").addEventListener("click", () => showView("demo"));
    $("#primaryTalkButton").addEventListener("click", () => {
      if (state.voicePaused) resumeConversation();
      else if (state.conversationMode || state.recognition) pauseConversation();
      else startVoiceRecognition();
    });
    $("#voicePauseButton").addEventListener("click", () => {
      if (state.voicePaused) resumeConversation();
      else pauseConversation();
    });
    $("#primaryStopButton").addEventListener("click", stopConversation);
    $("#chatMicButton").addEventListener("click", () => {
      if (state.voicePaused) resumeConversation();
      else if (state.conversationMode || state.recognition) pauseConversation();
      else startVoiceRecognition();
    });
    $("#speakResponseButton").addEventListener("click", () => speakResponse());
    $("#repeatSpeechButton").addEventListener("click", () => speakResponse());
    $("#readAloudButton").addEventListener("click", () => speakResponse());
    $("#pauseSpeechButton").addEventListener("click", pauseSpeech);
    $("#resumeSpeechButton").addEventListener("click", resumeSpeech);
    $("#stopSpeechButton").addEventListener("click", stopConversation);
    $("#emergencyButton").addEventListener("click", openEmergency);
    document.querySelectorAll("[data-emergency]").forEach((button) => button.addEventListener("click", openEmergency));
    $("#settingsButton").addEventListener("click", () => settingsDialog.showModal());
    document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", closeDialogs));
    $("#countrySelect").addEventListener("change", updateEmergencyNumber);
    languageSelect.addEventListener("change", (event) => setLanguage(event.target.value));
    $("#clearConversationButton").addEventListener("click", resetFlow);
    $("#mainDemoButton").addEventListener("click", () => showView("demo"));
    document.querySelectorAll("[data-go-home]").forEach((button) => button.addEventListener("click", () => showView("welcome")));
    $("#openVisualGuideButton").addEventListener("click", () => showView("guide"));
    $("#returnFromGuideButton").addEventListener("click", () => showView("assistant"));
    $("#resetDemoButton").addEventListener("click", resetDemo);
    $("#guideScenarioSelect").addEventListener("change", (event) => {
      stopGuidePlayback();
      state.guideScenario = scenarios.find((scenario) => scenario.id === event.target.value);
      state.guideStep = 0;
      renderGuideStep();
    });
    $("#guidePlayButton").addEventListener("click", toggleGuidePlayback);
    $("#guidePreviousButton").addEventListener("click", () => { stopGuidePlayback(); state.guideStep -= 1; renderGuideStep(); });
    $("#guideNextButton").addEventListener("click", () => { stopGuidePlayback(); state.guideStep += 1; renderGuideStep(); });
    $("#largeTextToggle").addEventListener("change", (event) => { document.body.classList.toggle("large-text", event.target.checked); localStorage.setItem("medibridge-large-text", event.target.checked); });
    $("#contrastToggle").addEventListener("change", (event) => { document.body.classList.toggle("high-contrast", event.target.checked); localStorage.setItem("medibridge-high-contrast", event.target.checked); });
    $("#voiceGuidanceToggle").addEventListener("change", (event) => localStorage.setItem("medibridge-voice-guidance", event.target.checked));
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);
    window.addEventListener("hashchange", () => showView(location.hash.slice(1), false));
    window.addEventListener("popstate", () => showView(location.hash.slice(1), false));
  }

  function init() {
    $("#year").textContent = new Date().getFullYear();
    applySavedSettings();
    bindEvents();
    translateUI();
    updateVoiceControls();
    showView(location.hash.slice(1) || "welcome", false);
    registerServiceWorker();
    prepareOfflineVoice();
  }

  // Public hooks make the local engine straightforward to inspect or extend later.
  window.MediBridge = { detectScenario, interpretUserInput, startVoiceRecognition, speakResponse, pauseSpeech, resumeSpeech };
  init();
})();
