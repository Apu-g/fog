# AgroFog AI — A Distributed Smart Farming Demonstrator

A complete **fog computing + local machine learning** classroom project. It runs entirely offline on one laptop, launches **five separate OS processes** with a single command, and demonstrates what happens when the cloud or an individual fog node fails.

> **Scope:** Educational simulation. All sensor values, crop conditions, and irrigation water consumption are synthetic. It is not a production farming controller. The ML training and inference, service boundaries, HTTP messages, process shutdowns and restarts are real software operations.

## Run in one command

Open a terminal and paste:

```bash
cd /home/apu/Desktop/fog && ./start.sh
```

Then visit **http://localhost:3000** in Chrome or any modern browser.

Alternative: `node start.js` or `npm start` from the project directory. **Requirement: Node.js 18 or newer.** No `npm install`, Docker, Wi-Fi, Python dependencies, API keys, cloud account, or external sensor hardware is required. Press **Ctrl+C** in the running terminal to close every service.

## New: Interactive Data Flow Lab

Choose **Data flow lab** from the left navigation (or the button on the Overview page). This is the primary visual demonstration for your teacher.

1. **Select a field:** North Field, East Orchard, or South Greenhouse. Each choice targets a different running fog process.
2. **Choose a preset or type four sensor readings:** soil moisture (%), temperature (°C), humidity (%), rainfall (mm/hour). Example for watering: **16, 40, 25, 0**.
3. Click **Send sensor packet**. A generated packet ID appears. Watch animated sensor → fog → AI → pump → peer → cloud routes. The animation replays the actual recorded stages and HTTP acknowledgements; you can click **Replay packet journey** to explain them slowly.
4. In the **packet inspector**, show the exact input reading, ML irrigation probability, local pump ON/OFF state, direct neighbor acknowledgments and the cloud delivery receipt.
5. Click **Disconnect cloud** within this page, choose **Rainstorm** (or enter 12, 30, 85, 18), and submit again. The pump stays OFF despite low soil moisture, and the cloud packet becomes **Buffered at fog**.
6. Click **Reconnect cloud**. Watch the same packet change from **Buffered** to **Cloud acknowledged**, reflecting the actual local outbox replay and cloud acknowledgement.

You can use **Animation speed** 1× or 2× and replay the journey as often as you need. These visual dots are an instructional **replay** of execution stages; the real transports are HTTP calls between separate local processes (not packet captures). All virtual sensors and pumps remain simulated.

### What the one-command launcher runs

```text
                  Browser: http://localhost:3000
                             |
                  Demo observer (hub.js)
                    /       |       \
             reads      controls     reads
                  independent HTTP services
                 /           |          \
    Fog 01 · 4201       Fog 02 · 4202     Fog 03 · 4203
     North Field         East Orchard      South Greenhouse
       |    \                |                 /
       |     \___ peer-to-peer local summaries ______/
       |
   [Synthetic sensors -> locally trained AI -> safety rule -> drip pump]
                 \            |           /
                  \     telemetry push   /
                  Cloud · 4100 (separate process)
                   history and aggregation only
```

The cloud **does not control irrigation**. Each fog node owns its trained model, local state, sensor simulation, safety decisions, event history and pump state. Fog nodes send summaries to the cloud and broadcast peer status directly to neighboring nodes. While the cloud is disconnected, each node buffers telemetry in a bounded in-memory outbox (up to 600 records), then automatically replays those records after reconnection. This buffering survives cloud failure but not a fog-node restart. If the cloud process is killed, the dashboard can still query the fog services via the independent demo observer.

### Project files

| File | Purpose |
| --- | --- |
| `start.sh` / `start.js` | One-command launch and process supervisor |
| `services/fog-node.js` | Standalone fog node (three separately running instances) |
| `lib/model.js` | Trains logistic regression with SGD and performs local predictions |
| `lib/simulator.js` | Sensor readings, scenarios, watering decisions and history |
| `services/cloud.js` | Separate cloud telemetry collector and aggregate stats |
| `services/hub.js` | Demo UI and direct fog inspection (not the cloud service) |
| `public/` | Offline-ready responsive UI, animated field view, manual input and packet-flight visualization |
| `public/flow-lab.js` / `public/flow-lab.css` | Interactive sensor data injection, trace viewer, flow animation |
| `tests/model.test.js` | Automated AI/controller tests |
| `tests/e2e-smoke.js` | Live process / fault-injection / recovery tests |

## Six-minute presentation script

1. **Overview:** “We have three agricultural zones, each with its own sensors and separate fog node. Their AI and pumps are independent of cloud access.” Select North Field and show its readings.
2. **Drought:** In **Overview**, select *North Field* then *Drought*. Point to the soil moisture and the **Irrigation running** decision. The local AI activates the pump.
3. **What happens when the internet or cloud fails?** Go to **Fog network**, click **Disconnect cloud**. The cloud process actually stops. The network diagram turns offline. Show the North Field fog node is still online and its sensor `tick` count continues advancing.
4. **Rain:** Return to **Overview**, keep North Field selected, choose **Heavy rain**. Even with the cloud offline, its local safety rule turns the pump **OFF**.
5. **Cloud recovery:** Return to **Fog network** and click **Reconnect cloud**. Telemetry starts flowing into the newly started cloud again. Optionally disconnect and restart just South Greenhouse to show independent fault isolation.
6. **AI explanation:** Go to **AI decisions**. Show probability of irrigation, feature evidence, 2,400 synthetic training rows, 500 validation rows and measured synthetic validation accuracy. Optionally choose *Sensor fault* in East Orchard to demonstrate pump fail-safe behavior.

Use the **Live demo guide** in the sidebar for a sequenced, one-button-at-a-time walkthrough. Each step performs the real scenario action in the running system. Click **Reset** before presenting again.

## Demonstration controls

- **Drought:** Low soil moisture, high temperature, no rain. AI usually starts watering.
- **Heatwave:** Elevated temperature and evaporative demand.
- **Heavy rain:** Rainfall safety lockout stops the pump.
- **Sensor fault:** Missing moisture reading; automatic watering is disabled.
- **Normal:** Restores a zone to its baseline weather and soil reading.
- **Switch to manual:** Overrides the AI output; use **Restore AI autonomy** to resume local model control.
- **Speed 1×/2×/4×:** Speeds up independently running local sensor/tick loops.
- **Fog network → Disconnect node:** Kills one field's dedicated Node.js process; the other nodes continue.
- **Fog network → Disconnect cloud:** Kills the cloud process without killing the demo dashboard or fog nodes.
- **Reset:** Restarts cloud and fog processes to a fresh predictable demonstration state.

## Why this is fog computing

The **IoT/edge layer** is represented by synthetic local sensors. The **fog layer** consists of three independent services that process readings with a locally trained ML model and make actuator decisions without cloud participation. The **cloud layer** only receives summaries for cross-farm analytics and history. The demo observer is separate from the cloud specifically so you can show cloud failure and continued fog operation visibly.

Actual peer communication is HTTP between the three fog processes. For a hardware extension, replace a virtual fog node's sensor input with an ESP32 or Raspberry Pi data stream; the offline classroom demonstration does not require that integration.

## About the AI

A six-feature (including intercept and rainfall lockout indicator) **logistic regression classifier** is trained separately inside each fog process on **2,400 deterministic synthetic labeled examples**. The training algorithm is stochastic gradient descent. Each model checks **500 held-out synthetic validation examples** and displays its own accuracy. Inputs: soil moisture, temperature, relative humidity and rainfall. Output: estimated irrigation demand probability. A separate local safety rule prevents automatic watering during heavy rain or if the moisture sensor fails. This is a real trained ML inference pipeline, but the simulation is not trained on real agronomic datasets.

Water “not used” compares the simulated pump consumption to a simplified fixed-rate watering baseline; it is **not a measured field saving**.

## Verify before class

In terminal 1 (leave running):

```bash
cd /home/apu/Desktop/fog && ./start.sh
```

In terminal 2:

```bash
cd /home/apu/Desktop/fog
npm test
npm run smoke
npm run browser-smoke  # optional: requires Chrome and Node 22+
```

`npm test` checks model training, safe irrigation decisions, zone independence and manual control. `npm run smoke` uses actual local HTTP services to test drought, cloud stoppage, independent fog execution, local rain lockout, cloud recovery, sensor failure, node disconnection/recovery and manual override. The smoke test verifies custom manual sensor inputs, per-packet trace IDs, local ML, direct peer HTTP acknowledgements, cloud acknowledgement, invalid input rejection, cloud buffering and replay, plus other process faults. It automatically requests a farm reset. The optional browser test drives a real headless Chrome instance through the UI, including cloud failure, scenario buttons, navigation and responsive mobile layout.

### If the page does not open

1. Keep the `./start.sh` terminal running. Look for **dashboard: http://localhost:3000**, **cloud**, and **fog:north/east/south** startup lines.
2. Verify Node is installed: `node --version` (18+).
3. If the port is occupied by another program, stop that program; the demo uses TCP ports **3000**, **4100**, **4201**, **4202**, and **4203** on **127.0.0.1**.
4. The address is **http://localhost:3000**, not HTTPS. No local Wi-Fi connection is needed; laptop and browser can run in airplane mode.
5. Press Ctrl+C to stop and then run `./start.sh` again if an old process was left running.

**Academic integrity:** Present this as an offline fog-architecture demonstrator with trained synthetic-data ML, not as a field-tested irrigation optimizer or physical IoT installation.
