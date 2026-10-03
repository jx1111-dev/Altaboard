# Disk hygiene

Container builds hoard disk: every `npm ci` + `next build` layer is cached,
and the WSL/Docker virtual disk only grows. Keep it in check with:

```sh
docker builder prune -af --filter until=240h   # build cache older than 10 days
docker image prune -af --filter unused-for=240h
```

(never prune volumes — that deletes the database). If the vhdx itself stays
large after pruning, shut WSL down (`wsl --shutdown`) and compact it with
`diskpart` → `select vdisk file="...\ext4.vhdx"` → `compact vdisk`.
