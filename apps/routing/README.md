# Local routing data

Phase 6 adds Valhalla to the development Compose override. It is available to other Compose
services at `http://valhalla:8002`; the port is not published on the host.

The routing container needs an OpenStreetMap Protocolbuffer Binary Format extract before it can
build its road graph. The planned demo area is Nigeria because the app's map and seed data use
Lagos. Geofabrik currently provides a Nigeria extract at
<https://download.geofabrik.de/africa/nigeria.html>; it is a large file, so download it only when
you want to prepare the routing graph.

From the project root:

```sh
mkdir -p apps/routing/data
curl -L --fail --output apps/routing/data/nigeria-latest.osm.pbf \
  https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
docker compose up -d valhalla
docker compose logs -f valhalla
```

The first graph build can take several minutes and needs extra disk space for both the PBF and
generated graph tiles. Valhalla stores its configuration, tiles, and supporting data in the mounted
directory. A subsequent start reuses the generated tiles unless the source extract changes.

During the first build, Valhalla may log `admin_access.admin_id` NOT NULL errors for administrative
areas outside a regional extract. Its message says these can be ignored when not using a planet
extract; the official guide also notes that regional extracts may omit parent administrative
boundaries. The screenshot/log should continue through timezone setup and graph tile generation to
the service startup before you treat the container as ready. These messages do not alone prove that
the graph build failed.

After the container finishes starting, check the status endpoint from the API container (Valhalla
is only exposed on the private Compose network):

```sh
sudo docker compose exec -T api node --input-type=module -e 'const response = await fetch("http://valhalla:8002/status"); console.log(response.status, await response.text());'
```

Then request a short route inside Lagos:

```sh
sudo docker compose exec -T api node --input-type=module -e 'const response = await fetch("http://valhalla:8002/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locations: [{ lat: 6.5244, lon: 3.3792 }, { lat: 6.4474, lon: 3.3903 }], costing: "auto", units: "kilometers" }) }); const body = await response.json(); console.log(response.status, body.trip?.summary ?? body.error ?? body.status_message);'
```

A ready status response and a route response with `trip.summary` confirm the graph is serving this
area. If the route request returns an error, inspect the latest startup output with
`sudo docker compose logs --tail=100 valhalla`.

OpenStreetMap data is © OpenStreetMap contributors and is available under the Open Database
License (ODbL). Keep attribution visible in any map or route UI that uses this data.

To refresh the routing data, download a new extract to this directory and restart the service. The
scripted Valhalla image rebuilds tiles when its source data changes. The exact extract date and
size can be checked on Geofabrik before downloading.
