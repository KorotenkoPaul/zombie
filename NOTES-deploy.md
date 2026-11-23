# Deploy (Railway)

**Live game:** https://game-production-8358051a.up.railway.app/

- Railway project `zombie-land`, service `game` (workspace "korotenkopaul's Projects").
- Source: GitHub `KorotenkoPaul/zombie`, branch `master`. **Every push to master that touches `game/**` or `deploy/**` deploys automatically** (about 30-40 s build). Pushes that change only notes/tests/pipeline are skipped on purpose.
- Build: `deploy/Dockerfile` (Caddy 2, serves `game/` as static files, gzip/zstd). `.dockerignore` sends only `game/` and `deploy/` to the build.
- Caching: everything is `Cache-Control: no-cache` (ETag revalidation), so a reload always gets the newest files.
- Several quick pushes in a row: Railway keeps only the newest build (older ones show REMOVED, that is normal).

## How a thread ships a change
1. Rebase on `origin/master`, check the page runs, push to `master`. That is all: no artifact publish needed.
2. Verify the deploy picked up your commit:
   ```
   curl -s https://game-production-8358051a.up.railway.app/version.txt   # prints the deployed master commit SHA
   git rev-parse origin/master
   ```
   They match about 1 minute after the push. If not after 3 minutes, check the Railway deploy list/logs
   (Railway MCP: `list-deployments` / `get-logs` with projectId `d0c2df08-06d2-4e99-8890-b84e6d3bf534`,
   serviceId `da8f9e1f-1138-460c-9545-55b54cd97a70`, `types: ["build"]`).
3. Force a redeploy without a code change: Railway MCP `redeploy` on that service.
4. Tell Pavel in the project chat what changed, with the link above.

## Notes
- New asset files just go into `game/` and load by relative path (`ASSET+name`); nothing to register.
- Don't put secrets in `game/`: the whole folder is public.
- The claude.ai artifact (https://claude.ai/artifact/Ro32b6Sg7VRcXuuKDEq85d) can still be published as a secondary copy; Railway is the main target.
- GitHub Actions `anim-qa` runs only on master, is report-only (findings in the run summary, it fails only if the test itself crashes), and a newer push cancels the older run.
