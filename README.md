# Shelly EM Live Monitor

A browser-based real-time dashboard for [Shelly EM](https://www.shelly.com/en/products/shop/shelly-em) energy monitors. Connects directly to the device over WebSocket and plots live power, voltage, and current with no server or cloud required.

## Features

- Live chart with configurable poll rate (1–60 samples/s) and draw rate
- Power (W), voltage (V), and current (A) KPI cards — click to toggle series
- Drag to pan, scroll wheel to zoom the time window
- Pause/resume data collection
- CSV and PNG export
- Settings persist across page loads via localStorage

## Quick Start

### Loading `index.html` locally

1. Connect your Shelly EM to the same network as your computer.
2. Open `dist/index.html` in a browser.
3. Click the settings gear, enter the Shelly EM's **IP address** and **port** (default: 80).
4. Click **Connect**. The chart will start streaming live data immediately.

### Serving from the Shelly

1. Factory reset the Shelly EM and connect it to your local network.
2. Open the Shelly web UI by navigating to the device's IP address in a browser (e.g. `http://192.168.1.100`) → **Scripts**.
3. Create a new script and paste the contents of `dist/em-dashboard.shelly.js`.
4. Save and run the script.
5. Open the dashboard at `http://<device-ip>/script/<id>/ui`. If this is the first (or only) script on the device, the ID will be `1` — e.g. `http://192.168.1.100/script/1/ui`. Otherwise check the ID shown in the Scripts UI.

## Settings

| Setting   | Default       | Description                                  |
| --------- | ------------- | -------------------------------------------- |
| Host      | `localhost`   | IP or hostname of the Shelly EM              |
| Port      | `80`          | HTTP port                                    |
| Poll rate | `2` samples/s | How often to request data (1–60)             |
| Draw rate | `30` fps      | Chart render rate (1–60)                     |
| Max log   | `10` min      | How much history to retain in memory (min 1) |