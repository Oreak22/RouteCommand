# Dispatcher map performance check

The live map uses paginated driver loading. Above 120 visible drivers it switches to a canvas layer that clusters nearby drivers, draws positions and headings without React marker components, and updates on the map's animation frame. The development-only replay produces 200 synthetic driver fixes once per second without creating API accounts.

## Run the 200-driver replay

1. Start the normal local development stack and sign in as an admin or dispatcher.
2. Open `http://localhost:5173/map?benchmark=200`.
3. Wait for the map to settle, then pan and zoom for 60 seconds. Clusters expand as you zoom; at close zoom, overlapping clusters can be expanded into individual markers.
4. In Chrome DevTools, open **More tools → Rendering**, enable **FPS meter**, and record the lowest sustained reading while panning and zooming. Use the reading sustained for several seconds, not a one-frame dip. Phase 12's target is at least 55 FPS on a mid-range laptop.
5. Repeat in a separate development run with **React DevTools → Profiler** recording. Telemetry should update the canvas without a `MapPage` commit for each driver fix. Selecting a driver may update its detail panel.

## Capture the machine and result

- Browser/version: open `chrome://version` and copy the Google Chrome version.
- CPU model and core count: open a terminal and run `lscpu`; copy `Model name` and `CPU(s)`.
- Memory: run `free -h` and copy the `Mem:` total.
- Screen resolution: read it from **Settings → Displays**. Keep the browser window size the same if comparing runs.
- FPS: on the `/map?benchmark=200` page, confirm the top strip says `200 simulated drivers · 1 Hz`. With FPS meter visible, pan and zoom continuously for 60 seconds; write down the lowest FPS that persists for several seconds.
- Long tasks: optionally record the same 60 seconds in DevTools **Performance** and note any long tasks (yellow task blocks over 50 ms).

Record the result here before claiming the performance DoD. Development profiling adds overhead, so use the FPS run without the React Profiler enabled.

| Date       | Chrome | CPU / cores | RAM | Display | Drivers / rate | Duration | Lowest sustained FPS                                                                                        | Long tasks |
| ---------- | ------ | ----------- | --- | ------- | -------------- | -------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| 2026-11-18 |        |             |     |         |                |          | 55.8 FPS shown in first screenshot; 45 FPS dip reported afterward (before visuals were restored/new target) |            |

The query flag only activates under Vite development mode. It does not create users, write telemetry to the API, or represent server/socket throughput. The replay measures client rendering and marker updates; a separate multi-client test is needed to measure end-to-end socket throughput.
