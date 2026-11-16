# Production Deployment — securityiq.misecure.io

Verified working on the production server (Kali, nginx + gunicorn + systemd).

## Layout

| Item | Value |
|---|---|
| Domain | `securityiq.misecure.io` (HTTPS via certbot, already issued) |
| App directory | `/var/www/CYBERAWD` (git repo, `origin/main`) |
| App server | gunicorn, **1 worker**, 4 threads, bound to `127.0.0.1:5600` |
| Service | `cyberawd.service` (runs as `www-data`) |
| nginx site | `/etc/nginx/sites-available/cyberawd` (`proxy_pass http://127.0.0.1:5600`) |
| Other apps on the box | do not touch: cybercore `:5000`, misecuritiq `:5801`/`:5800`, asset `:8080`, etc. |
| Config | `/var/www/CYBERAWD/.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `FLASK_SECRET_KEY`) |
| Runtime data | `/var/www/CYBERAWD/data/` (see "Data" below) |

**Why 1 worker:** lab sessions live in memory and are mirrored to `data/sessions.json`. Several
workers would each hold a different copy and break labs. Scale with `--threads`, not `-w`.

**Port 5600** is only reachable on localhost; do not open it in the firewall. Public traffic is
80/443 through nginx.

## First-time setup (already done on this server)

```bash
cd /var/www
git clone https://github.com/dataspark-dev/CYBERAWD.git && cd CYBERAWD
sudo apt install -y python3-venv python3-pip
python3 -m venv venv && source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt gunicorn
cp .env.example .env && nano .env       # set the 3 values below
chmod 640 .env && sudo chgrp www-data .env
sudo chown -R www-data:www-data data && sudo chmod 700 data
```

`.env`:
```
ADMIN_USERNAME=<admin user>
ADMIN_PASSWORD=<strong password>
FLASK_SECRET_KEY=<python3 -c "import secrets;print(secrets.token_hex(32))">
```
Never paste these values into chat/tickets. If a key is ever exposed, generate a new one and restart.

### systemd — `/etc/systemd/system/cyberawd.service`
```ini
[Unit]
Description=CYBERAWD (securityiq)
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/CYBERAWD
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/var/www/CYBERAWD/venv/bin/gunicorn -w 1 --threads 4 -b 127.0.0.1:5600 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now cyberawd
```

### nginx — the existing site (certbot-managed) must contain
```nginx
location / {
    proxy_pass http://127.0.0.1:5600;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
`X-Forwarded-Proto` + `Host` are required so the QR/join links come out as
`https://securityiq.misecure.io/join/<CODE>`. Do not add a second `server` block for the same
`server_name`; edit the existing file. After any change: `sudo nginx -t && sudo systemctl reload nginx`.

## Update procedure (every release)

```bash
cd /var/www/CYBERAWD
sudo cp -a data /root/cyberawd-data-backup-$(date +%F)     # back up labs + participants
git status                                                 # must be clean; else `git stash`
git pull origin main
source venv/bin/activate && pip install -r requirements.txt   # only if requirements changed
sudo systemctl restart cyberawd
sleep 3
curl -s https://securityiq.misecure.io/health              # {"ok":true,"sessionsLoaded":N}
sudo journalctl -u cyberawd -n 30 --no-pager | grep -i -E "persist|error"   # expect nothing new
```
Developer side: `git add -u && git commit && git push origin main`.

## Smoke test after deploy

1. `https://securityiq.misecure.io/admin` → log in.
2. New lab → QR link starts with `https://securityiq.misecure.io/join/`.
3. Join on a phone (mobile data): name + contact number required; role, email, company optional.
4. Launch an activity, step through it.
5. Admin → **Participant Directory** shows the joiner; **Download CSV** works.
6. `sudo systemctl restart cyberawd` → lab and participant list still present.

## Data

All under `/var/www/CYBERAWD/data/` (gitignored; owner `www-data`, mode `700`, files `600`):

| File | Contents | Reset by "Reset This Lab"? |
|---|---|---|
| `sessions.json` | live labs: participants, answers, progress | yes (that lab only) |
| `participants.jsonl` | **permanent** join log: lab code, name, contact, role, email, company, time | **no** |

The participant data is personal data. Keep `data/` private, back it up, and delete it when the
retention period for the event ends.

**Fetching participant data (admin only):**
- Admin dashboard → **Participant Directory** (search, per-lab code column, Download CSV).
- API (logged-in admin session): `GET /api/admin/participants` (JSON), `?format=csv`, `?room=<CODE>`.
- Per-lab CSV: `GET /api/admin/session/<CODE>/participants.csv`.
- Offline on the server: `sudo cat /var/www/CYBERAWD/data/participants.jsonl` (one JSON object per line).

## Rollback

```bash
cd /var/www/CYBERAWD
git log --oneline -5
git checkout <previous-good-commit> -- .          # or: git revert <bad-commit>
sudo systemctl restart cyberawd
```
Restore data if needed: `sudo cp -a /root/cyberawd-data-backup-<date>/. data/ && sudo chown -R www-data:www-data data`.

## Troubleshooting

| Symptom | Check |
|---|---|
| 502 Bad Gateway | `systemctl status cyberawd`; `sudo ss -ltnp \| grep 5600`; after editing the unit run `daemon-reload` then `restart` |
| Admin login fails | `.env` readable by `www-data` (`chmod 640`, `chgrp www-data`); restart service |
| `failed to persist sessions` in logs | `sudo chown -R www-data:www-data data && sudo chmod 700 data` |
| QR shows `http://` or wrong host | nginx missing `Host` / `X-Forwarded-Proto` headers |
| `nginx -t` duplicate server_name | a second site declares `securityiq.misecure.io`; keep only one |
| Many people cannot join at once | per-IP join limit (30/min) sees all users as one IP behind nginx; see follow-ups |

## Known follow-ups (not yet implemented)

- Trust nginx's forwarded client IP (Werkzeug `ProxyFix`) so the join rate limit is per
  participant, not shared by everyone.
- `/api/admin/login` should return 400 (not 500) for a JSON body that is not an object.
- `app.py` still ends with `app.run(debug=True, ...)`; this is only used for local `python app.py`
  runs, never under gunicorn. Do not deploy with `python app.py`.
