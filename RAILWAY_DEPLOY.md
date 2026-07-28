# Railway Deployment Guide — CBE Console

## Architecture (5 Railway Services)

| Service | Source Dir | Type | Port |
|---------|-----------|------|------|
| **cbe-backend** | `back-end/` | Docker (Node.js) | 3000 |
| **cbe-admin-panel** | `admin-panel/` | Docker (nginx static) | 80 |
| **cbe-exam-portal** | `exam-portal/` | Docker (nginx static) | 80 |
| **PostgreSQL** | Railway add-on | Managed DB | 5432 |
| **Redis** | Railway add-on | Managed DB | 6379 |

## Prerequisites

1. Install Railway CLI:
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. Make sure your code is pushed to a Git repository (GitHub/GitLab).

---

## Step-by-Step Deployment

### Step 1: Create a Railway Project

```bash
railway init
```
Choose "Create new project" — name it `cbe-console`.

### Step 2: Add PostgreSQL Database

```bash
railway add --type postgresql
```
Railway will create a PostgreSQL instance and set `DATABASE_URL` automatically.

### Step 3: Add Redis Database

```bash
railway add --type redis
```
Railway will create a Redis instance and set `REDIS_URL` automatically.

### Step 4: Deploy the Backend

```bash
# From the project root
railway up  # when prompted, select the back-end service or create one
```

Or deploy from the `back-end` directory:
```bash
cd back-end
railway up
```

**Set these environment variables** in the Railway dashboard (or via CLI):

```bash
railway variables set NODE_ENV=production
railway variables set JWT_SECRET=<generate-a-32+-char-secret>
railway variables set JWT_ACCESS_EXPIRY=15m
railway variables set JWT_REFRESH_EXPIRY=24h
railway variables set LOG_LEVEL=info
```

**Note:** `DATABASE_URL` and `REDIS_URL` are set automatically by Railway's PostgreSQL and Redis add-ons.

**S3/Storage variables** (choose one option):

*Option A: Use Cloudflare R2 or AWS S3 (recommended for production):*
```bash
railway variables set S3_ENDPOINT=https://<your-s3-endpoint>
railway variables set S3_REGION=auto
railway variables set S3_ACCESS_KEY=<your-access-key>
railway variables set S3_SECRET_KEY=<your-secret-key>
railway variables set S3_BUCKET=cbe-console
railway variables set S3_PUBLIC_URL=https://<your-public-s3-url>
```

*Option B: Deploy SeaweedFS as a separate Railway service (for self-hosted S3):*
```bash
# Deploy SeaweedFS S3 as a Docker image
railway add --image chrislusf/seaweedfs:3.91
# Set the start command: s3 -filer=<seaweedfs-filer-url>:8888 -ip.bind=0.0.0.0 -port=8333
```

### Step 5: Generate Backend Domain

In the Railway dashboard:
1. Go to the **cbe-backend** service
2. Go to **Settings > Networking**
3. Click **Generate Domain**
4. Note the URL (e.g., `https://cbe-backend-production.up.railway.app`)

### Step 6: Deploy the Admin Panel

```bash
cd admin-panel
railway up
```

**Set environment variable:**
```bash
railway variables set BACKEND_URL=https://cbe-backend-production.up.railway.app
```
*(Replace with your actual backend domain from Step 5)*

Generate a public domain for the admin panel in Railway dashboard.

### Step 7: Deploy the Exam Portal

```bash
cd exam-portal
railway up
```

**Set environment variable:**
```bash
railway variables set BACKEND_URL=https://cbe-backend-production.up.railway.app
```
*(Same backend URL as admin panel)*

Generate a public domain for the exam portal in Railway dashboard.

---

## Post-Deployment

### Verify Backend Health
```bash
curl https://<your-backend-domain>/health
# Should return: {"status":"ok","env":"production",...}
```

### Verify Admin Panel
Open `https://<your-admin-domain>.up.railway.app` in your browser.

### Verify Exam Portal
Open `https://<your-exam-domain>.up.railway.app/examportal/` in your browser.

### Login Credentials (from seed data)
- **Admin:** `admin@cbe.local` / `Admin@123`
- **Candidate:** `ADM-001` / `01012000`

---

## Environment Variables Summary

### Backend (`cbe-backend`)
| Variable | Source | Example |
|----------|--------|---------|
| `DATABASE_URL` | Railway PostgreSQL add-on (auto) | `postgresql://...` |
| `REDIS_URL` | Railway Redis add-on (auto) | `redis://...` |
| `JWT_SECRET` | You set this | `your-32+-char-secret` |
| `JWT_ACCESS_EXPIRY` | Default | `15m` |
| `JWT_REFRESH_EXPIRY` | Default | `24h` |
| `NODE_ENV` | Set to | `production` |
| `PORT` | Railway sets automatically | `3000` |
| `S3_ENDPOINT` | Your S3-compatible storage | `https://...` |
| `S3_ACCESS_KEY` | Your S3 credentials | `...` |
| `S3_SECRET_KEY` | Your S3 credentials | `...` |
| `S3_BUCKET` | Bucket name | `cbe-console` |
| `S3_PUBLIC_URL` | Public URL for S3 | `https://...` |

### Admin Panel & Exam Portal
| Variable | Source | Example |
|----------|--------|---------|
| `BACKEND_URL` | Backend's Railway public domain | `https://cbe-backend-xxx.up.railway.app` |

---

## Troubleshooting

### Backend won't start
- Check that `DATABASE_URL` and `REDIS_URL` are set (Railway dashboard > Variables)
- Check backend logs: `railway logs`
- The `docker-entrypoint.sh` waits for PostgreSQL, runs migrations, then starts the server

### Frontend can't reach API
- Verify `BACKEND_URL` is set correctly in frontend service variables
- Make sure the backend has a public domain generated
- Check that `BACKEND_URL` includes `https://` prefix

### WebSocket/SSE not working
- Railway supports WebSocket connections
- Make sure `BACKEND_URL` uses `https://` (Railway terminates TLS)
- The nginx config in frontends handles WebSocket upgrade headers

### Database migrations
- Migrations run automatically on backend startup via `docker-entrypoint.sh`
- Seed data also runs automatically on first deploy

---

## Cost Estimate

| Service | Railway Plan |
|---------|-------------|
| Backend (Container) | ~$5/mo (500MB RAM) |
| Admin Panel (Static) | ~$0-2/mo |
| Exam Portal (Static) | ~$0-2/mo |
| PostgreSQL | ~$5/mo (1GB) |
| Redis | ~$5/mo (256MB) |
| **Total** | **~$15-19/mo** |

*Costs vary based on usage. See [railway.app/pricing](https://railway.app/pricing).*
