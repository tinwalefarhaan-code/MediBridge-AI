# MediBridge AI Quick Start

## Run the app

From the project directory, start a local server:

```powershell
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) in a modern browser. A local server enables the service worker; opening `index.html` directly still supports the text-based, local first-aid flows but not service-worker caching.

## Try the experience

1. Start at the welcome screen. **Start Talking** begins browser speech recognition with the user's explicit click; the browser may ask for microphone permission. When a transcript is received, the chat opens and local first-aid matching starts immediately. If speech recognition is unsupported or unavailable, the app opens typed chat and displays the error.
2. During a voice session, use the chat composer microphone or **Pause** to stop listening and narration, **Resume** to listen again, and **End Conversation** to stop the session without automatic restart.
3. Select **Try Demo** for microphone-free simulated choking, severe bleeding, possible stroke, or burn conversations. Demo output is prepared local content, not live AI.
4. Open **Visual First-Aid Guide** from the main experience to select a topic and play, pause, or step through captions.
5. Use the persistent Emergency control to open emergency information and accessibility settings for text size, contrast, and narration.

## Verify scenarios and offline behavior

- Enter `Someone is choking.` and check that the matching urgent flow begins directly in chat, then reply naturally to the follow-up.
- Enter `Someone is choking and they cannot breathe.` and confirm the first displayed action is the urgent response rather than the initial cough check.
- Try severe bleeding, burns, possible stroke, and `I need medicine.`; the app uses local keyword matching and refuses medication advice.
- Use the visual guide's topic selector and next/previous/play controls.
- After visiting the app once on localhost, use browser developer tools to set network offline and reload. The cached app shell and prepared content should work; speech recognition and speech synthesis are not guaranteed offline.

## Important limitations

MediBridge is a prototype, not a diagnosis or a substitute for emergency services. Its locally prepared first-aid content requires qualified clinical review; no AI API, verified video assets, AI video generation, or guaranteed offline speech recognition is configured. Browser speech recognition may use an online service. Do not delay professional help to use this app.
