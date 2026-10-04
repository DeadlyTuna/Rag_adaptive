# Adaptive RAG — frontend

The Next.js interface for Adaptive RAG. See the [project README](../README.md) for what it
does and [DESIGN_PLAN.md](../DESIGN_PLAN.md) for the design.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
```

Set `NEXT_PUBLIC_API_URL` (e.g. in `.env.local`) to use the FastAPI backend instead of the
in-browser demo engine.
