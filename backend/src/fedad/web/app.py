"""Dashboard API (FastAPI). Starts experiments, streams per-round metrics, serves the multi-seed results and the React build.

  GET  /api/health                  engines available, whether results/experiments.json exists
  POST /api/runs                    start a run in the background -> {id}
  GET  /api/runs/{id}               snapshot: status, request, rows so far, summary
  GET  /api/runs/{id}/events        server-sent events: `round` per round, then `done` or `error`
  GET  /api/experiments             results/experiments.json (python -m fedad.experiments)
  GET  /api/privacy/calibrate       noise needed for a target (eps, delta) under basic composition and under RDP
  GET  /figures/<name>.png          report figures written by the experiments run
  GET  /                            the built React app (frontend/dist), if present

Benchmark runs use real Criteo click data (ml/criteo.py) with a simulated federation; the live campaign (web/live.py) uses
real devices. One process; a demo of the research prototype, not a service. Runs are kept in memory and lost on restart.
Admin endpoints (/api/*) answer to localhost only.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import sys
import math
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from .. import flower_engine
from ..federation.async_runner import run_async
from ..federation.pipeline import Config, run
from ..ml import criteo
from ..ml.criteo import N_FEATURES
from ..privacy import rdp
from . import advertiser_api, auth, live, shop

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")   # Render shows stdout

BACKEND = Path(__file__).resolve().parents[3]
RESULTS = Path(os.environ.get("FEDAD_RESULTS", BACKEND / "results"))
DIST = BACKEND.parent / "frontend" / "dist"
_FLOWER_LOCK = threading.Lock()            # Ray is process-global: one Flower simulation at a time
_POOL = ThreadPoolExecutor(max_workers=2)


class RunRequest(BaseModel):
    engine: Literal["native", "flower"] = "native"
    mode: Literal["sync", "async"] = "sync"
    n_clients: int = Field(20, ge=5, le=50)
    rounds: int = Field(15, ge=3, le=40)
    seed: int = Field(0, ge=0, le=999)
    dp: bool = False
    eps_total: float = Field(3000.0, gt=0.0, le=1000000.0)
    accountant: Literal["basic", "rdp"] = "rdp"
    secure_agg: bool = False
    he: bool = False
    top_k: int = Field(0, ge=0, le=N_FEATURES + 1)
    agg: Literal["fedavg", "weighted"] = "fedavg"
    n_edges: int = Field(2, ge=1, le=4)

    @model_validator(mode="after")
    def _combos(self):
        if self.he and self.secure_agg:
            raise ValueError("choose secret sharing or Paillier HE, not both (a layered protocol is not implemented)")
        if self.engine == "flower" and self.mode == "async":
            raise ValueError("the Flower engine runs synchronous rounds; use the native engine for asynchronous training")
        return self


@dataclass
class Job:
    id: str
    req: RunRequest
    status: str = "queued"                 # queued | running | done | error
    rows: List[dict] = field(default_factory=list)
    summary: Optional[dict] = None
    error: Optional[str] = None
    created: float = field(default_factory=time.time)
    started: Optional[float] = None
    finished: Optional[float] = None


JOBS: Dict[str, Job] = {}


def clean(x: Any) -> Any:
    """JSON-safe copy: NaN and infinity become null, numpy scalars become Python numbers."""
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if hasattr(x, "item") and not isinstance(x, (str, bytes)):
        x = x.item()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x


def config_of(r: RunRequest) -> Config:
    return Config(rounds=r.rounds, seed=r.seed, dp=r.dp, eps_total=r.eps_total, accountant=r.accountant,
                  secure_agg=r.secure_agg, he=r.he, he_bits=1024, top_k=r.top_k, agg=r.agg, n_edges=r.n_edges)


def _execute(job: Job) -> None:
    job.status, job.started = "running", time.time()
    try:
        r = job.req
        clients = criteo.make_clients(n_clients=r.n_clients, seed=r.seed, rows=60_000)
        cfg = config_of(r)
        push = job.rows.append
        if r.engine == "flower":
            with _FLOWER_LOCK:
                res = flower_engine.run_flower(clients, cfg, N_FEATURES, on_round=push)
        elif r.mode == "async":
            res = run_async(clients, cfg, N_FEATURES, buffer_k=4, on_round=push)
        else:
            res = run(clients, cfg, N_FEATURES, on_round=push)
        last = res.history[-1]
        ups = sum(h.get("n_updates", r.n_clients) for h in res.history)
        kb = sum(h["bytes_up"] for h in res.history) / max(1, ups) / 1024
        eps_run = max((e for e, _ in res.accountant.values()), default=0.0)
        eps_rdp = max((e for e, _ in res.accountant_rdp.values()), default=0.0)
        sig = sorted(res.sigma_by_client.values())
        job.summary = clean({
            "auc": last["auc"], "logloss": last["logloss"], "rounds_done": len(res.history), "kb_per_upload": kb,
            "dense_kb": res.dense_bytes_per_upload / 1024, "compression_ratio": (res.dense_bytes_per_upload / 1024) / kb if kb else None,
            "eps_run": eps_run, "eps_rdp": eps_rdp, "sigma_min": sig[0] if sig else None, "sigma_max": sig[-1] if sig else None,
            "seconds": time.time() - job.started, "engine": r.engine, "mode": r.mode,
            "synthetic": False, "prototype": True})
        job.status = "done"
    except Exception as e:                       # surfaced to the UI; the server keeps running
        job.status, job.error = "error", f"{type(e).__name__}: {e}"
    finally:
        job.finished = time.time()


def snapshot(job: Job) -> dict:
    return clean({"id": job.id, "status": job.status, "request": job.req.model_dump(), "rows": list(job.rows),
                  "summary": job.summary, "error": job.error})


app = FastAPI(title="FedAd dashboard API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST"], allow_headers=["*"])
_LOCAL = {"127.0.0.1", "::1", "localhost", "testclient"}


OPEN_ADMIN = os.environ.get("FEDAD_OPEN_ADMIN") == "1"      # DEMO ONLY: opens the aggregate-only advertiser endpoints (/api/b/*), nothing else


@app.middleware("http")
async def admin_is_local_only(request: Request, call_next):
    """Access rules for /api/*. Phones and the extension use /v1/* and the static pages, which are not affected.
      full admin (per-device ledger, update vectors, shop request log, campaign reset, benchmark runs):
          localhost (and no proxy header), or a Supabase user whose app_metadata.role is "admin" (web/auth.py).
      advertiser endpoints (/api/b/*, aggregates only): the above, or role "advertiser", or anyone if FEDAD_OPEN_ADMIN=1.
    A request that came through a proxy (X-Forwarded-For) is never treated as local."""
    path = request.url.path
    if path.startswith("/api"):
        local = request.client is not None and request.client.host in _LOCAL and "x-forwarded-for" not in request.headers
        role = auth.role_of(request)
        full = local or role == "admin"
        if path.startswith("/api/b/"):
            allowed = full or role == "advertiser" or OPEN_ADMIN
        else:
            allowed = full
        if not allowed:
            return JSONResponse({"error": "sign in required"}, status_code=403)
    return await call_next(request)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


app.include_router(live.router)
app.include_router(shop.router)
app.include_router(advertiser_api.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "flower": flower_engine.flower_version(), "engines": ["native"] + (["flower"] if flower_engine.HAVE_FLOWER else []),
            "experiments_available": (RESULTS / "experiments.json").exists(), "synthetic": False, "prototype": True,
            "dataset": criteo.info() if criteo.available() else None, "benchmark_ready": criteo.available()}


@app.post("/api/runs", status_code=202)
def start_run(req: RunRequest) -> dict:
    if req.engine == "flower" and not flower_engine.HAVE_FLOWER:
        raise HTTPException(400, "flwr is not installed in this environment")
    if not criteo.available():
        raise HTTPException(409, "Criteo sample not prepared: run `python -m fedad.ml.criteo download` then `prepare`")
    if len(JOBS) > 200:                          # bound memory: drop the oldest finished runs
        for k in [k for k, j in sorted(JOBS.items(), key=lambda kv: kv[1].created) if j.status in ("done", "error")][:100]:
            JOBS.pop(k, None)
    job = Job(uuid.uuid4().hex[:10], req)
    JOBS[job.id] = job
    _POOL.submit(_execute, job)
    return {"id": job.id}


@app.get("/api/runs/{job_id}")
def get_run(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown run")
    return snapshot(job)


@app.get("/api/runs/{job_id}/events")
async def run_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown run")

    async def gen():
        sent = 0
        while True:
            rows = list(job.rows)
            for row in rows[sent:]:
                yield f"event: round\ndata: {json.dumps(clean(row))}\n\n"
            sent = len(rows)
            if job.status == "done":
                yield f"event: done\ndata: {json.dumps(clean(job.summary))}\n\n"
                return
            if job.status == "error":
                yield f"event: error\ndata: {json.dumps({'error': job.error})}\n\n"
                return
            await asyncio.sleep(0.15)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/experiments")
def experiments() -> dict:
    f = RESULTS / "experiments.json"
    if not f.exists():
        raise HTTPException(404, "no results yet: run `python -m fedad.experiments` in backend/")
    return clean(json.loads(f.read_text(encoding="utf-8")))


@app.get("/api/privacy/calibrate")
def calibrate(eps_total: float = Query(100.0, gt=0, le=1e5), delta_total: float = Query(1e-5, gt=0, lt=1),
              rounds: int = Query(20, ge=1, le=1000), clip_c: float = Query(1.0, gt=0, le=100)) -> dict:
    try:
        c = rdp.compare(eps_total, delta_total, 2.0 * clip_c, rounds)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return clean({**c, "noise_multiplier_basic": c["sigma_basic"] / clip_c, "noise_multiplier_rdp": c["sigma_rdp"] / clip_c,
                  "sensitivity": 2.0 * clip_c, "rounds": rounds})


if (RESULTS / "figures").is_dir():
    app.mount("/figures", StaticFiles(directory=RESULTS / "figures"), name="figures")
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
