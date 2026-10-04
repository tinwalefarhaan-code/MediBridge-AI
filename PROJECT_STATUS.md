# MediBridge AI — Project Status

**Status: Prototype with local first-aid flows; not clinically certified.**

MediBridge is a static browser application. The emergency helper uses local keyword matching and prepared scenario content; no cloud AI model, account, server API, or database is configured.

## Implemented experience

- Welcome screen with explicit Start Talking, Try Demo, and Emergency Help controls.
- Main voice workspace with transcript, browser-recognition lifecycle indicators, Pause/Resume, End Call, typing fallback, and safe local conversation flows.
- Dedicated Demo Mode with four simulated flows; no microphone is required.
- Separate caption-based visual guide for choking, severe bleeding, and burns. It has play/pause and step controls, but only abstract animation, not procedural video.
- Existing local first-aid scenarios, multilingual content, urgency notices, emergency information, accessibility controls, and PWA shell retained.

## Current verification (2026-10-04)

- Browser loaded the welcome, main, demo, and visual-guide routes without page JavaScript errors.
- Demo choking flow advanced after a simulated No answer and reset to its initial state.
- Text input for choking displayed the follow-up question; answering No advanced to the urgent step.
- A mocked speech-recognition API exercised start, transcript handling, context-aware choking response, Pause, Resume, and End Call. After End Call, the mock did not restart.
- Back navigation returned from Demo Mode to the welcome screen.
- Layout was checked at 320, 390, 768, and 1280 pixels across all four views without horizontal overflow.
- The service worker registered and populated its versioned cache. Full offline reload was not verified.
- Live microphone access and real browser speech input/output were not tested; browser/device permission and hardware are external requirements.

## Safety and availability limitations

- First-aid scenario text is prototype material that needs qualified clinical review. The app does not diagnose, prescribe, or replace emergency services.
- Browser speech recognition may use an online service and is not guaranteed offline. Unsupported or denied voice access falls back to typing.
- The visual guide has no verified medical video assets or generated videos.
- The emergency panel displays configured local emergency numbers; it does not place calls automatically.

## Run locally

From the project directory:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`. See [QUICKSTART.md](./QUICKSTART.md) for manual checks and offline limitations.
