# Raspberry Pi Database Migration Plan

Migration from Neon (serverless PostgreSQL) to self-hosted PostgreSQL on Raspberry Pi.

## Current Architecture

| Component | Current Setup |
|-----------|---------------|
| Database | PostgreSQL on Neon (serverless) |
| Driver | `psycopg2` with raw SQL (no ORM) |
| Backend | Flask API on Vercel |
| Frontend | Static JS polling the API |
| Data sources | ESP32 sensors (CO2/temp/humidity) |

### Database Schema

**Table: `readings`**
- `id` SERIAL PRIMARY KEY
- `device` VARCHAR(50)
- `co2` INTEGER
- `temp` REAL
- `humidity` REAL
- `created_at` TIMESTAMPTZ

**Table: `sensor_events`**
- `id` SERIAL PRIMARY KEY
- `device` VARCHAR(50)
- `event_type` VARCHAR(20)
- `message` TEXT
- `uptime_seconds` INTEGER
- `heap_bytes` INTEGER
- `total_measurements` INTEGER
- `i2c_errors` INTEGER
- `created_at` TIMESTAMPTZ

### Connection Config
- Environment variable: `BACKUP_DATABASE_URL`
- Located in: `api/db.py`

---

## Migration Steps

### 1. Install PostgreSQL on RPi

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 2. Configure PostgreSQL for Remote Access

Edit `/etc/postgresql/*/main/postgresql.conf`:
```
listen_addresses = '*'
```

Edit `/etc/postgresql/*/main/pg_hba.conf` to allow connections:
```
# Allow from local network
host    all    all    192.168.0.0/24    scram-sha-256

# Or allow from specific IP (Vercel, etc.)
host    all    all    <vercel-ip>/32    scram-sha-256
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### 3. Create Database and User

```bash
sudo -u postgres psql
```

```sql
CREATE USER bopzone WITH PASSWORD 'your-secure-password';
CREATE DATABASE bopzone OWNER bopzone;
\q
```

### 4. Initialize Tables

Either hit the `/init-database` endpoint after updating the connection string, or run manually:

```sql
CREATE TABLE IF NOT EXISTS readings (
    id SERIAL PRIMARY KEY,
    device VARCHAR(50) NOT NULL,
    co2 INTEGER,
    temp REAL,
    humidity REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_readings_device_time
ON readings (device, created_at DESC);

CREATE TABLE IF NOT EXISTS sensor_events (
    id SERIAL PRIMARY KEY,
    device VARCHAR(50) NOT NULL,
    event_type VARCHAR(20) NOT NULL DEFAULT 'info',
    message TEXT,
    uptime_seconds INTEGER,
    heap_bytes INTEGER,
    total_measurements INTEGER,
    i2c_errors INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_device_time
ON sensor_events (device, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_type
ON sensor_events (event_type);
```

### 5. Network Access

**Option A: Port Forwarding (simpler)**
- Forward port 5432 on your router to the RPi
- Use dynamic DNS if you don't have a static IP (e.g., DuckDNS, No-IP)

**Option B: Cloudflare Tunnel (safer, no open ports)**
```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Authenticate and create tunnel
cloudflared tunnel login
cloudflared tunnel create bopzone-db
cloudflared tunnel route dns bopzone-db db.yourdomain.com
```

**Option C: Tailscale (easiest for personal use)**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Then use the Tailscale IP in your connection string.

### 6. Migrate Existing Data

Export from Neon:
```bash
pg_dump "$BACKUP_DATABASE_URL" --data-only > neon_data.sql
```

Import to RPi:
```bash
psql -h <rpi-address> -U bopzone -d bopzone < neon_data.sql
```

### 7. Update Environment Variable

Update `BACKUP_DATABASE_URL` in Vercel (or wherever deployed):
```
postgresql://bopzone:your-secure-password@<rpi-address>:5432/bopzone
```

### 8. Set Up Backups

Create `/home/pi/backup-db.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/home/pi/db-backups"
mkdir -p "$BACKUP_DIR"
pg_dump -U bopzone bopzone | gzip > "$BACKUP_DIR/bopzone_$(date +%Y%m%d_%H%M%S).sql.gz"
# Keep only last 7 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
```

Add to crontab (`crontab -e`):
```
0 3 * * * /home/pi/backup-db.sh
```

---

## Decisions to Make

| Decision | Options | Notes |
|----------|---------|-------|
| Network access | Port forward / Cloudflare Tunnel / Tailscale | Tailscale easiest, Cloudflare most secure |
| Keep Vercel? | Yes (change DB URL only) / Move API to RPi | Keeping Vercel = less RPi load |
| SSL? | Required for production | Use Let's Encrypt or Cloudflare |
| Monitoring | None / Grafana / Simple health check | Consider adding uptime monitoring |

---

## Post-Migration Checklist

- [ ] PostgreSQL installed and running on RPi
- [ ] Remote access configured and tested
- [ ] Database and user created
- [ ] Tables and indexes created
- [ ] Network access working (can connect from outside)
- [ ] Data migrated from Neon
- [ ] Environment variable updated
- [ ] API tested with new database
- [ ] Backup script configured
- [ ] Old Neon database kept as fallback (temporarily)
