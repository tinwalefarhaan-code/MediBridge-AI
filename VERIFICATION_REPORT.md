# MediBridge AI Verification Notes

This file records the current prototype's implementation boundaries. Only checks actually performed for the latest build should be described as verified.

## Product boundaries

- Core scenario selection is local keyword matching, not a live AI model.
- The demo page uses simulated responses and does not request microphone access.
- The visual guide is an illustrative caption viewer using existing local scenario text; there are no verified video assets or generated videos.
- First-aid scenario text is prototype content and has not been certified as medically reviewed. Do not use the app as a substitute for emergency services or professional care.
- Browser speech recognition support varies. It may rely on an internet-connected browser service and is not guaranteed to work offline.

## Current local test procedure

1. Run `python -m http.server 8000` from the project directory and open `http://localhost:8000`.
2. Check that the welcome screen opens and Try Demo navigates to its own page.
3. Select choking in Demo Mode, answer No, and verify that the simulated follow-up advances to urgent choking instructions. Reset and try another scenario.
4. Open the main experience and verify the local text flow for choking and severe bleeding.
5. Open the visual guide and test topic selection, next/previous, and play/pause.
6. If testing voice, use an actual supported browser and microphone. The UI should say it is listening only after recognition starts; test pause/resume and verify End Call does not restart.
7. Once the app has been cached on localhost, test offline using browser developer tools. Verify text guidance remains available; do not infer offline speech support.

## Limitations not verified by this report

Microphone hardware and permission behavior, real browser speech recognition and synthesis, clinical safety of scenario wording, cross-browser compatibility, and offline speech recognition require dedicated testing and/or external review. No clinical certification, AI backend, or emergency-call integration is present.
