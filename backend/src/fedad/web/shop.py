"""Demo voucher shop ("Perks") behind the phone app. Browsing is public; cart, orders and behaviour events need an account.

Purpose: show what a server learns about a guest versus a signed-in user. Every /v1/shop request is recorded EXACTLY as it
arrives (client address, device string, language, whether a session token came with it, the JSON body) and the laptop's
admin console shows that log. Nothing is invented: the log is the request.

  GET  /v1/shop/products[?category=]      public
  GET  /v1/shop/products/{id}             public
  POST /v1/shop/login {email, password}   creates the account on first use (demo: no email check, password >= 4 chars)
  POST /v1/shop/logout                    token
  GET  /v1/shop/cart  POST /v1/shop/cart {product_id, amount, qty}  POST /v1/shop/cart/remove   token
  POST /v1/shop/checkout   GET /v1/shop/orders                       token (no payment: demo)
  POST /v1/shop/events {type, product_id, category}                  token (the app sends these only when signed in)
  GET  /api/shop/seen   POST /api/shop/reset                         admin, localhost only

Demo only: in-memory, no real vouchers, no real payment, passwords are salted and hashed but this is not a login system to copy.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
LOCK = threading.Lock()
log = logging.getLogger("fedad.shop")

# id, brand, kind, schema category, amounts (INR), percent off, photo file, ground colour, text colour
_P = [
    ("amz", "Amazon", "Gift card", "Tech", [500, 1000, 2000, 5000], 2, None, "#232f3e", "#ff9900"),
    ("flip", "Flipkart", "Gift card", "Tech", [500, 1000, 2500], 3, None, "#2874f0", "#ffffff"),
    ("play", "Google Play", "Credit", "Games", [300, 600, 1000, 2000], 0, None, "#0b3d2e", "#7ee2a8"),
    ("steam", "Steam", "Wallet code", "Games", [500, 1000, 2000], 0, None, "#171a21", "#c7d5e0"),
    ("nflx", "Netflix", "Gift card", "Games", [500, 1000, 2000], 0, None, "#141414", "#e50914"),
    ("apple", "Apple", "Gift card", "Tech", [1000, 2000, 5000], 0, None, "#1d1d1f", "#f5f5f7"),
    ("myn", "Myntra", "Gift card", "Fashion", [500, 1000, 2000], 5, None, "#ff3f6c", "#ffffff"),
    ("nyk", "Nykaa", "Gift card", "Fashion", [500, 1000, 3000], 4, None, "#fc2779", "#ffffff"),
    ("zara", "Zara", "Gift card", "Fashion", [1000, 3000, 5000], 0, None, "#111111", "#f2efe9"),
    ("swig", "Swiggy", "Voucher", "Food", [250, 500, 1000], 6, None, "#fc8019", "#ffffff"),
    ("zom", "Zomato", "Voucher", "Food", [250, 500, 1000], 6, None, "#e23744", "#ffffff"),
    ("coffee", "Cafe voucher", "Voucher", "Food", [300, 600, 1200], 8, "coffee.jpg", "#6f4e37", "#ffffff"),
    ("dine", "Dining out", "Voucher", "Food", [1000, 2000, 4000], 10, "dining.jpg", "#7a2e1d", "#ffffff"),
    ("goa", "Goa beach stay", "Stay voucher", "Travel", [5000, 10000, 20000], 12, "goa.jpg", "#c9844a", "#ffffff"),
    ("jpr", "Jaipur heritage tour", "Experience", "Travel", [3000, 6000, 12000], 10, "jaipur.jpg", "#b4553a", "#ffffff"),
    ("ker", "Kerala houseboat", "Stay voucher", "Travel", [8000, 15000, 25000], 15, "kerala.jpg", "#2f6b4f", "#ffffff"),
    ("bali", "Bali escape", "Holiday voucher", "Travel", [20000, 40000, 80000], 8, "bali.jpg", "#3f7d3a", "#ffffff"),
    ("mmt", "MakeMyTrip", "Travel voucher", "Travel", [2000, 5000, 10000], 5, None, "#e31e24", "#ffffff"),
    ("uber", "Uber", "Ride credit", "Travel", [300, 500, 1000], 0, None, "#000000", "#ffffff"),
    ("dec", "Decathlon", "Gift card", "Sports", [500, 1000, 3000], 3, None, "#0082c3", "#ffffff"),
    ("cult", "Fitness pass", "Pass", "Sports", [1500, 4000, 9000], 15, None, "#f5c518", "#111111"),
    ("pharm", "Wellness shop", "Gift card", "Health", [500, 1000, 2000], 7, None, "#15803d", "#ffffff"),
    ("zerod", "Invest starter", "Gift", "Finance", [1000, 5000, 10000], 0, None, "#2b3a55", "#ffffff"),
    ("insur", "Health cover", "Gift", "Finance", [2000, 5000], 0, None, "#334155", "#ffffff"),
]
PRODUCTS: List[Dict[str, Any]] = [
    {"id": i, "title": t, "kind": k, "category": c, "amounts": a, "off": o, "photo": f and f"/shop/{f}", "bg": bg, "fg": fg}
    for (i, t, k, c, a, o, f, bg, fg) in _P
]
BY_ID = {p["id"]: p for p in PRODUCTS}

USERS: Dict[str, Dict[str, Any]] = {}
SESSIONS: Dict[str, str] = {}
SEEN: Deque[Dict[str, Any]] = deque(maxlen=400)
_SEQ = [0]


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)


def reset() -> None:
    with LOCK:
        USERS.clear()
        SESSIONS.clear()
        SEEN.clear()


def _user(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    found = None
    for tok, email in list(SESSIONS.items()):
        if hmac.compare_digest(tok, auth[7:]):
            found = email
    return found


def _log(request: Request, body: Optional[dict], user: Optional[str]) -> None:
    """Record the request as received. The password is redacted in the log, nothing else is touched."""
    shown = None
    if body is not None:
        shown = {k: ("[redacted]" if k == "password" else v) for k, v in body.items()}
    _SEQ[0] += 1
    kind = "LOGIN " if request.url.path.endswith("/login") else ("ACCOUNT" if request.headers.get("authorization") else "GUEST  ")
    log.info("SHOP %s %s %s ip=%s device=%r user=%s body=%s", kind, request.method, request.url.path + (("?" + request.url.query) if request.url.query else ""),
             request.client.host if request.client else "?", (request.headers.get("user-agent") or "")[:60], user or "-", shown if shown else "-")
    SEEN.appendleft({
        "n": _SEQ[0], "t": time.time(), "method": request.method, "path": request.url.path + (("?" + request.url.query) if request.url.query else ""),
        "ip": request.client.host if request.client else None, "ua": request.headers.get("user-agent"),
        "lang": request.headers.get("accept-language"), "has_token": bool(request.headers.get("authorization")),
        "user": user, "body": shown, "referer": request.headers.get("referer"),
    })


async def _body(request: Request) -> Optional[dict]:
    raw = await request.body()
    if not raw:
        return None
    try:
        d = await request.json()
    except ValueError:
        raise HTTPException(400, "bad json")
    if not isinstance(d, dict):
        raise HTTPException(400, "bad json")
    return d


def _need_user(request: Request) -> str:
    u = _user(request)
    if u is None:
        raise HTTPException(401, "login required")
    return u


# ---- public ----------------------------------------------------------------------------------------------------------------

@router.get("/v1/shop/products")
def products(request: Request, category: Optional[str] = None) -> dict:
    _log(request, None, _user(request))
    items = [p for p in PRODUCTS if category in (None, "", "All") or p["category"] == category]
    return {"items": items, "categories": sorted({p["category"] for p in PRODUCTS})}


@router.get("/v1/shop/products/{pid}")
def product(pid: str, request: Request) -> dict:
    _log(request, None, _user(request))
    p = BY_ID.get(pid)
    if p is None:
        raise HTTPException(404, "no such product")
    return p


@router.post("/v1/shop/login")
async def login(request: Request) -> dict:
    d = await _body(request) or {}
    _log(request, d, None)
    email, pw = str(d.get("email", "")).strip().lower(), str(d.get("password", ""))
    if "@" not in email or len(email) > 80 or len(pw) < 4 or len(pw) > 100:
        raise HTTPException(400, "enter an email and a password of 4+ characters")
    with LOCK:
        u = USERS.get(email)
        mode = d.get("mode")
        if mode == "signin" and u is None:
            raise HTTPException(404, "no account with that email, create one first")
        if mode == "signup" and u is not None:
            raise HTTPException(409, "an account with that email already exists, sign in instead")
        if u is None:
            salt = secrets.token_bytes(16)
            USERS[email] = {"salt": salt, "hash": _hash(pw, salt), "cart": [], "orders": []}
        elif not hmac.compare_digest(u["hash"], _hash(pw, u["salt"])):
            raise HTTPException(403, "wrong password")
        tok = secrets.token_urlsafe(32)
        SESSIONS[tok] = email
    return {"token": tok, "email": email, "new": u is None}


# ---- needs an account ------------------------------------------------------------------------------------------------------

@router.post("/v1/shop/logout")
def logout(request: Request) -> dict:
    u = _user(request)
    _log(request, None, u)
    auth = request.headers.get("authorization", "")
    with LOCK:
        for tok in [t for t in SESSIONS if hmac.compare_digest(t, auth[7:])]:
            SESSIONS.pop(tok, None)
    return {"ok": True}


@router.get("/v1/shop/cart")
def cart(request: Request) -> dict:
    u = _user(request)
    _log(request, None, u)
    if u is None:
        raise HTTPException(401, "login required")
    return {"items": USERS[u]["cart"]}


@router.post("/v1/shop/cart")
async def cart_add(request: Request) -> dict:
    d = await _body(request) or {}
    u = _user(request)
    _log(request, d, u)
    if u is None:
        raise HTTPException(401, "login required")
    p = BY_ID.get(str(d.get("product_id")))
    amount, qty = int(d.get("amount", 0)), max(1, min(int(d.get("qty", 1)), 10))
    if p is None or amount not in p["amounts"]:
        raise HTTPException(400, "bad product or amount")
    with LOCK:
        items = USERS[u]["cart"]
        for it in items:
            if it["product_id"] == p["id"] and it["amount"] == amount:
                it["qty"] = min(10, it["qty"] + qty)
                break
        else:
            items.append({"product_id": p["id"], "amount": amount, "qty": qty})
    return {"items": USERS[u]["cart"]}


@router.post("/v1/shop/cart/remove")
async def cart_remove(request: Request) -> dict:
    d = await _body(request) or {}
    u = _user(request)
    _log(request, d, u)
    if u is None:
        raise HTTPException(401, "login required")
    with LOCK:
        USERS[u]["cart"] = [it for it in USERS[u]["cart"] if not (it["product_id"] == d.get("product_id") and it["amount"] == d.get("amount"))]
    return {"items": USERS[u]["cart"]}


@router.post("/v1/shop/checkout")
def checkout(request: Request) -> dict:
    u = _user(request)
    _log(request, None, u)
    if u is None:
        raise HTTPException(401, "login required")
    with LOCK:
        items = USERS[u]["cart"]
        if not items:
            raise HTTPException(400, "cart is empty")
        total = 0
        for it in items:
            p = BY_ID[it["product_id"]]
            total += int(it["amount"] * it["qty"] * (100 - p["off"]) / 100)
        order = {"id": secrets.token_hex(3).upper(), "t": time.time(), "items": list(items), "total": total}
        USERS[u]["orders"].insert(0, order)
        USERS[u]["cart"] = []
    return order


@router.get("/v1/shop/orders")
def orders(request: Request) -> dict:
    u = _user(request)
    _log(request, None, u)
    if u is None:
        raise HTTPException(401, "login required")
    return {"items": USERS[u]["orders"]}


@router.post("/v1/shop/events")
async def events(request: Request) -> dict:
    d = await _body(request) or {}
    u = _user(request)
    _log(request, d, u)
    if u is None:
        raise HTTPException(401, "login required")
    return {"ok": True}


# ---- admin (localhost only through the /api prefix check in app.py) ------------------------------------------------------------------

def _summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    out = {}
    login = [r for r in rows if r["path"] == "/v1/shop/login"]
    for who, pick in (("guest", [r for r in rows if not r["has_token"] and r not in login]), ("login", login),
                      ("account", [r for r in rows if r["has_token"]])):
        fields = {"IP address", "device and browser", "language"} if pick else set()
        for r in pick:
            if r["has_token"]:
                fields.add("session token")
            if r["user"]:
                fields.add("email")
            for k in (r["body"] or {}):
                fields.add({"product_id": "product", "amount": "amount", "type": "behaviour", "category": "interest", "qty": "quantity"}.get(k, k))
            if "/products/" in r["path"] or "category=" in r["path"]:
                fields.add("what you looked at")
            if "/cart" in r["path"] or "/checkout" in r["path"] or "/orders" in r["path"]:
                fields.add("cart and orders")
        out[who] = {"requests": len(pick), "fields": sorted(fields), "ips": sorted({r["ip"] for r in pick if r["ip"]})}
    return out


@router.get("/api/shop/seen")
def seen() -> dict:
    rows = list(SEEN)
    return {"items": rows[:120], "summary": _summary(rows), "accounts": len(USERS)}


@router.post("/api/shop/reset")
def shop_reset() -> dict:
    reset()
    return {"ok": True}
