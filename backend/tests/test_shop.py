"""Shop: guests browse, accounts buy, and the server's log of what it received differs between the two."""

import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from fedad.web import shop  # noqa: E402
from fedad.web.app import app  # noqa: E402


@pytest.fixture()
def c():
    shop.reset()
    return TestClient(app)


def test_guest_can_browse_but_not_buy(c):
    items = c.get("/v1/shop/products").json()["items"]
    assert len(items) >= 20 and {p["category"] for p in items} >= {"Travel", "Food", "Tech", "Games"}
    assert c.get("/v1/shop/products/goa").status_code == 200
    assert c.get("/v1/shop/products/nope").status_code == 404
    assert c.get("/v1/shop/cart").status_code == 401
    assert c.post("/v1/shop/cart", json={"product_id": "amz", "amount": 500}).status_code == 401
    assert c.post("/v1/shop/events", json={"type": "view"}).status_code == 401
    assert c.get("/v1/shop/orders").status_code == 401


def test_login_cart_checkout_and_wrong_password(c):
    assert c.post("/v1/shop/login", json={"email": "bad", "password": "abcd"}).status_code == 400
    r = c.post("/v1/shop/login", json={"email": "Asha@Example.com", "password": "hunter22"})
    assert r.status_code == 200 and r.json()["email"] == "asha@example.com" and r.json()["new"] is True
    assert c.post("/v1/shop/login", json={"email": "asha@example.com", "password": "other-pw"}).status_code == 403
    h = {"Authorization": "Bearer " + r.json()["token"]}
    assert c.post("/v1/shop/cart", json={"product_id": "amz", "amount": 1000, "qty": 2}, headers=h).status_code == 200
    assert c.post("/v1/shop/cart", json={"product_id": "amz", "amount": 123}, headers=h).status_code == 400   # not a real denomination
    assert c.get("/v1/shop/cart", headers=h).json()["items"] == [{"product_id": "amz", "amount": 1000, "qty": 2}]
    order = c.post("/v1/shop/checkout", headers=h).json()
    assert order["total"] == int(2000 * 98 / 100) and c.get("/v1/shop/cart", headers=h).json()["items"] == []
    assert c.get("/v1/shop/orders", headers=h).json()["items"][0]["id"] == order["id"]
    c.post("/v1/shop/logout", headers=h)
    assert c.get("/v1/shop/cart", headers=h).status_code == 401


def test_server_log_splits_guest_from_account_and_redacts_password(c):
    c.get("/v1/shop/products?category=Travel")
    c.get("/v1/shop/products/goa")
    tok = c.post("/v1/shop/login", json={"email": "a@b.co", "password": "secret1"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    c.post("/v1/shop/cart", json={"product_id": "goa", "amount": 5000}, headers=h)
    c.post("/v1/shop/events", json={"type": "view", "product_id": "goa", "category": "Travel"}, headers=h)
    s = c.get("/api/shop/seen").json()
    g, a, lg = s["summary"]["guest"], s["summary"]["account"], s["summary"]["login"]
    assert "email" not in g["fields"] and "session token" not in g["fields"] and "IP address" in g["fields"]
    assert lg["requests"] == 1 and {"email", "password"} <= set(lg["fields"])           # identity first leaves at login
    assert {"email", "session token", "behaviour", "cart and orders"} <= set(a["fields"])
    assert "what you looked at" in g["fields"]                      # the URL itself says what a guest viewed
    login = [r for r in s["items"] if r["path"] == "/v1/shop/login"][0]
    assert login["body"]["password"] == "[redacted]" and login["body"]["email"] == "a@b.co"
    assert all(r["ip"] and r["ua"] is not None for r in s["items"])


def test_shop_admin_is_local_only(c):
    remote = TestClient(app, client=("192.168.1.50", 5000))
    assert remote.get("/api/shop/seen").status_code == 403
    assert remote.post("/api/shop/reset").status_code == 403
    assert remote.get("/v1/shop/products").status_code == 200
