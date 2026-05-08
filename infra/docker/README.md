# Docker

Postgres local para dev (si no usás Supabase remoto):

```bash
docker run -d --name comadre-pg \
  -e POSTGRES_USER=comadre \
  -e POSTGRES_PASSWORD=comadre \
  -e POSTGRES_DB=comadre \
  -p 5432:5432 \
  postgres:15
```

DATABASE_URL: `postgresql://comadre:comadre@localhost:5432/comadre`
