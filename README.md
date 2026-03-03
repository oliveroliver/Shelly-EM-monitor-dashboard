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

1. Connect your Shelly EM to the same network as your computer.
2. Open `index.html` in a browser.
3. Click the settings gear, enter the Shelly EM's **IP address** and **port** (default: 80).
4. Click the status pill — it will read *Disconnected · tap to connect*.
5. The chart will start streaming live data immediately on connection.

## Settings

| Setting   | Default       | Description                                  |
| --------- | ------------- | -------------------------------------------- |
| Host      | `localhost`   | IP or hostname of the Shelly EM              |
| Port      | `80`          | HTTP port                                    |
| Poll rate | `2` samples/s | How often to request data (1–60)             |
| Draw rate | `30` fps      | Chart render rate (1–60)                     |
| Max log   | `10` min      | How much history to retain in memory (min 1) |