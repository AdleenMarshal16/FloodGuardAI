# FloodGuardAI (Alappuzha, Kerala): flood project
Node 18+ required. Open the `flood` folder in VS Code and use two terminals.

Terminal 1 (server, http://localhost:4000)
    cd server
    npm install
    copy .env.example .env      (use cp on Mac/Linux)
    npm start

Terminal 2 (ui, http://localhost:5173)
    cd ui
    npm install
    npm start

Login: only rohan, amaya and adleen can sign in (passwords were given to you separately).
Change a password:  cd server  then  node setpassword.js rohan NewPassword123

Real SMS: fill TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM and ALERT_PHONES (comma-separated, +91... format, 3 or more numbers) in server/.env.
Without keys, SMS text is printed in the server terminal. ALERT_AREA picks the area used for alerts.

Demo: click "Simulate flood" in the app (or set DEMO_MODE=flood in server/.env) to run the preset flood dataset. It triggers the alert banner and an SMS (printed in the server terminal unless Twilio keys are set).

## Discord alerts (free, no bot needed)
1. In Discord, create a private server and a channel (for example #flood-alerts). Invite Rohan, Amaya and Adleen.
2. Channel settings, Integrations, Webhooks, New Webhook, then Copy Webhook URL.
3. Put it in server/.env as DISCORD_WEBHOOK_URLS=<the url> (several URLs allowed, separated by commas) and restart the server.
4. Click "Simulate flood" in the app: the alert is posted to the channel the moment the simulation starts, and the red banner shows whether it was delivered.
Anyone who has the webhook URL can post to the channel, so keep the URL secret.
