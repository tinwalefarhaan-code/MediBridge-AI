# MediBridge AI — Offline First-Aid Assistant

MediBridge AI is a beginner-friendly, local browser prototype that offers short, structured first-aid guidance. It is designed for a hackathon demonstration: a person can type or speak what happened, choose an important answer, and be guided one step at a time.

> **Safety note:** MediBridge is not a doctor, diagnosis tool, or substitute for professional medical care. It does not prescribe or recommend medicines. For an emergency, contact local emergency services or a qualified healthcare professional immediately.

## The problem it explores

In a stressful situation, people can panic, forget the first-aid sequence, or have limited internet. MediBridge keeps a small set of conservative first-aid flows on the device so a user does not have to search through long articles first.

## What works in this prototype

- Local, rule-based situation detection — no API, account, database, or internet is required for core guidance.
- 20 structured scenarios: unconsciousness, abnormal breathing, choking, severe/minor bleeding, burns, fainting, seizure, stroke warning, chest emergency, severe allergic reaction, fracture, sprain, nosebleed, heat exhaustion/heat stroke, poisoning, electric shock, drowning, and panic-type distress.
- An urgency system: general, urgent, possible emergency, and critical.
- A welcome screen with explicit Start Talking, Try Demo, and Emergency Help actions.
- A chat-style conversation with typed and voice replies, local emergency recognition, immediate prepared guidance, and optional Previous, Next, Repeat step, and I need help controls.
- Emergency-help panel with country-ready emergency number configuration. India is currently set to `112` in **one place** near the top of `app.js`.
- UI and prepared first-aid content in English, Hindi, Kannada, and Urdu.
- A separate microphone-free Demo Mode with simulated choking, severe bleeding, possible stroke, and burn flows.
- An illustrative visual guide for choking, severe bleeding, and burns. It uses text captions and abstract animations, not clinical video or procedural animations.
- Browser voice input/output when the browser supports it, including repeat, pause/resume, and End Call, with a safe typed-input fallback.
- Large-text and high-contrast accessibility options.
- Optional offline caching through `service-worker.js` when the app is served from a local web server.

## Project files

```text
MediBridge/
├── index.html                Main page and accessible interface
├── style.css                 Responsive healthcare UI styles
├── app.js                    Conversation flow, local matching, voice, settings
├── service-worker.js         Optional browser offline cache
├── data/
│   ├── firstAidData.js       Local multilingual structured first-aid scenarios
│   └── translations.js       UI translations
└── README.md                 This guide
```

## How to open it — simplest way

1. Open the `MediBridge` folder in File Explorer.
2. Double-click `index.html`.
3. Your default browser opens the app. Type a situation such as `Someone is choking.` and select an answer.

This simplest option runs the core app without internet. Browser voice input support varies by browser and may need an internet-enabled browser speech service.

## How to enable the offline cache

Browsers only allow service workers when a site is served over `http://localhost` (not by double-clicking a file). No packages need to be installed if Python is already on your computer.

1. In the MediBridge folder, click the address bar in File Explorer, type `powershell`, then press Enter.
2. In the blue PowerShell window, run:

   ```powershell
   python -m http.server 8000
   ```

3. Open [http://localhost:8000](http://localhost:8000) in your browser.
4. Visit once while connected. The core files are then cached by the browser for offline use.
5. To stop the local server later, return to PowerShell and press `Ctrl` + `C`.

If `python` is not recognized, use the simple double-click method above; the core app still works, but the browser will not install the service-worker cache.

## How the local assistant works

1. `interpretUserInput()` receives the user’s words.
2. For now, it calls `detectScenario()`, which normalizes text and scores local keywords from `data/firstAidData.js`.
3. If the evidence is unclear or several weak matches exist, MediBridge asks the user to choose rather than guessing.
4. The chosen scenario provides a prepared question, urgency level, steps, “avoid” advice, and escalation message.

To connect a future **local** AI model, replace the contents of `interpretUserInput()` in `app.js`. Keep the structured scenario data and safety flow so a general model cannot freely invent instructions.

## Voice and language

Choose English, Hindi, Kannada, or Urdu in the top-right language menu. Start Talking is an explicit user action that begins browser speech recognition. It opens the chat view after a transcript is received; the conversation continues in context, and its composer has a microphone control for starting or pausing recognition. The UI only reports listening after the browser fires its recognition `start` event. Pause stops listening and narration until resumed; End Conversation disables automatic restarts and stops narration. Browser speech recognition support varies, may rely on an internet service, and must not be assumed to work offline. Core first-aid matching and prepared guidance run locally; no live AI model or API is configured. Text input remains available.

## Demo and visual guide

Try Demo opens a separate practice page with simulated local responses and no microphone use. The visual guide is also separate from the voice workspace; its animated marker is illustrative only, and the displayed text comes from the local scenario content. The current scenario content has not been certified as medically reviewed, and no verified video assets or AI video generation are included.

## Good first tests

Try these in the input box:

- `Someone is unconscious.`
- `Someone is choking.`
- `Someone has severe bleeding.`
- `Someone may be having a stroke.`
- `I need medicine.` — this intentionally refuses medication advice.

Also try a home-screen quick action, **Try Demo**, changing language during a flow, **Emergency**, the read-aloud controls, and the accessibility settings icon.

## Suggested hackathon demo

1. Begin on the home screen and point out the offline status, language selector, persistent Emergency button, and 12 large quick actions.
2. Select **Try Demo** → **Someone is choking**. The demo submits that natural-language input through the same local rule-based detector a user would use.
3. Show the visible emergency level, the “What to do now” card, its first-aid-only guardrail, and the emergency-help button.
4. Answer the important question, then use **Next**, **Previous**, and **Repeat step** to show the one-action-at-a-time flow.
5. Press **Read instructions aloud**, then Pause/Resume. Change to Hindi, Kannada, or Urdu to show that the UI and prepared guidance change locally.
6. Open **Emergency** and change the country selector to demonstrate the single, configurable emergency-number location.
7. Switch off Wi-Fi after opening the locally served app once (or use browser offline mode) and repeat a quick-action flow to demonstrate that the core data and triage do not call an API.

## Safety limitations and future work

This is an educational first-aid prototype, not a medically certified product. It does not diagnose a condition, replace dispatchers or clinicians, assess a real person remotely, or give medicine/dose advice. Any future version should be clinically reviewed, localized by qualified professionals, tested with accessibility users, and adapted to reliable local emergency contacts and regional protocols.
