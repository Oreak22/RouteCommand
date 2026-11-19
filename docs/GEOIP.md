# Offline IP geolocation

The API can use a local MaxMind GeoLite2 City database to attach an approximate country and region to each refresh-token session. It makes no geolocation network request and does not store precise coordinates. If the database is absent or unreadable, authentication continues and the session location is left empty.

## Provisioning

1. Create a MaxMind account and generate a GeoLite license key under its current download terms. The API does not need the key; it is only used to obtain the database.
2. In the MaxMind account portal, open **GeoIP / GeoLite → Download Files**, choose **GeoLite2 City**, and download the binary **MMDB** file. MaxMind supports downloading the MMDB database from that portal. [Download instructions](https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases)
3. Extract the archive and copy `GeoLite2-City.mmdb` to `apps/api/data/GeoLite2-City.mmdb`. For example:

   ```sh
   mkdir -p apps/api/data
   install -m 0644 ~/Downloads/GeoLite2-City_*/GeoLite2-City.mmdb apps/api/data/GeoLite2-City.mmdb
   ```

   `apps/api/data/` is Git-ignored and mounted read-only into the API container.

4. Compose already sets `GEOIP_DATABASE_PATH=/data/GeoLite2-City.mmdb`. Recreate the API so it opens the newly installed file:

   ```sh
   docker compose up -d --force-recreate api
   docker compose exec -T api test -r /data/GeoLite2-City.mmdb
   ```

5. Confirm the database opens and contains a public IP record:

   ```sh
   docker compose exec -T api node --input-type=module -e '
   import maxmind from "maxmind";
   const db = await maxmind.open("/data/GeoLite2-City.mmdb");
   console.log(db.get("8.8.8.8")?.country?.iso_code ?? "No record for test IP");
   '
   ```

   A local browser login often arrives from a private or loopback address, which has no public geolocation entry. That is expected; test the database with a public IP as above. The API stores country and region codes only.

6. Refresh the database regularly in deployment and follow MaxMind's license and attribution terms. MaxMind says GeoLite City is updated Tuesdays and Fridays and advises keeping databases up to date. [Database update schedule](https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases)

Session rows store only country and first-level region codes in `refresh_tokens.ip_geolocation`. The account's `last_login_ip` and each refresh-token row retain the client IP for security review; treat the database as sensitive and use the project's retention policy when one is established.

The GeoIP lookup is optional until a database is provisioned. Do not commit GeoLite2 data or its license key.

Local Compose provisioning was verified by the user on 2026-11-16: the API container opened the mounted database and resolved `8.8.8.8` to `US`.
