"""Report figures and CSV tables from results/experiments.json. Colour-blind-safe palette, every curve carries its 95 percent CI.

Run through ``python -m fedad.experiments`` or on its own: ``python -m fedad.figures [results_dir]``.
Figures are 300 dpi PNGs sized for a single report column (6.3 in wide).
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

BLUE, ORANGE, GREY, GREEN = "#0072B2", "#D55E00", "#6b7280", "#009E73"
plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
                     "grid.alpha": 0.25, "figure.dpi": 120, "savefig.dpi": 300, "savefig.bbox": "tight"})


def _band(ax, xs, rows, key, color, label, marker="o"):
    m = [r[key]["mean"] for r in rows]
    c = [r[key]["ci"] for r in rows]
    ax.plot(xs, m, marker=marker, color=color, label=label, lw=1.8, ms=4)
    ax.fill_between(xs, [a - b for a, b in zip(m, c)], [a + b for a, b in zip(m, c)], color=color, alpha=0.18, lw=0)


def privacy_utility(res: dict, out: Path) -> None:
    pu = res["privacy_utility"]
    xs = [r["eps_total"] for r in pu["curves"]["basic"]]
    fig, ax = plt.subplots(figsize=(6.3, 3.4))
    _band(ax, xs, pu["curves"]["basic"], "auc", BLUE, "Basic composition (sum of per-round epsilons)")
    _band(ax, xs, pu["curves"]["rdp"], "auc", ORANGE, "Renyi (RDP) accounting", marker="s")
    ax.axhline(pu["no_dp"]["auc"]["mean"], color=GREY, ls="--", lw=1.2, label="No privacy (FedAvg)")
    ax.axhline(0.5, color=GREY, ls=":", lw=1, label="Chance")
    ax.set_xscale("log")
    ax.set_xlabel(r"Total privacy budget $\varepsilon$ per client (log scale), $\delta=10^{-5}$")
    ax.set_ylabel("Test AUC")
    ax.set_title(f"Privacy-utility trade-off, {res['n_clients']} clients, {res['rounds']} rounds, {len(res['seeds'])} seeds")
    ax.legend(frameon=False, fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=2)
    fig.savefig(out / "fig_privacy_utility.png")
    plt.close(fig)


def noise(res: dict, out: Path) -> None:
    rows = res["privacy_utility"]["noise"]
    xs = [r["eps_total"] for r in rows]
    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    ax.plot(xs, [r["sigma_basic"] for r in rows], marker="o", color=BLUE, label="Basic composition")
    ax.plot(xs, [r["sigma_rdp"] for r in rows], marker="s", color=ORANGE, label="RDP accounting")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel(r"Total privacy budget $\varepsilon$ (log scale)")
    ax.set_ylabel(r"Noise std $\sigma$ per update (clip $C=1$)")
    ax.set_title("Same guarantee, less noise: the tighter accountant")
    ax.legend(frameon=False, fontsize=8)
    fig.savefig(out / "fig_noise.png")
    plt.close(fig)


def compression(res: dict, out: Path) -> None:
    rows = res["compression"]
    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    ax.errorbar([r["kb_per_upload"]["mean"] for r in rows], [r["auc"]["mean"] for r in rows],
                yerr=[r["auc"]["ci"] for r in rows], fmt="o-", color=GREEN, capsize=3, lw=1.5)
    for r in rows:
        ax.annotate("dense" if r["top_k"] == 0 else f"top-{r['top_k']}", (r["kb_per_upload"]["mean"], r["auc"]["mean"]),
                    textcoords="offset points", xytext=(4, 6), fontsize=8)
    ax.set_xlabel("Upload size (KB, after DEFLATE)")
    ax.set_ylabel("Test AUC")
    ax.set_title(f"Communication saving from top-k sparsification (logistic model, {res['n_params']} parameters)")
    fig.savefig(out / "fig_compression.png")
    plt.close(fig)


def techniques(res: dict, out: Path) -> None:
    rows = res["techniques"][::-1]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.3, 3.6), sharey=True, gridspec_kw={"width_ratios": [3, 2]})
    names = [r["name"] for r in rows]
    a1.barh(names, [r["auc"]["mean"] for r in rows], xerr=[r["auc"]["ci"] for r in rows], color=BLUE, capsize=2)
    a1.set_xlim(0.5, max(r["auc"]["mean"] for r in rows) + 0.03)
    a1.set_xlabel("Test AUC")
    a2.barh(names, [r["kb_per_upload"]["mean"] for r in rows], color=GREEN)
    a2.set_xlabel("KB per upload")
    a1.tick_params(axis="y", labelsize=7)
    fig.suptitle("What each building block buys or costs", fontsize=10)
    fig.savefig(out / "fig_techniques.png")
    plt.close(fig)


def _fmt(d: dict, nd: int = 4) -> str:
    if d["mean"] is None:
        return "n/a"
    return f"{d['mean']:.{nd}f} +/- {d['ci']:.{nd}f}"


def _one(d: dict, nd: int = 1) -> str:
    return "n/a" if d["mean"] is None else f"{d['mean']:.{nd}f}"


def tables(res: dict, out: Path) -> None:
    with open(out / "table_techniques.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["technique", "group", "AUC", "log loss", "KB per upload", "eps (run accountant)", "eps (RDP bound)", "seconds"])
        for r in res["techniques"]:
            w.writerow([r["name"], r["group"], _fmt(r["auc"]), _fmt(r["logloss"]), _fmt(r["kb_per_upload"], 3),
                        _one(r["eps_run"]), _one(r["eps_rdp"]), _one(r["seconds"], 2)])
    with open(out / "table_privacy_utility.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["total epsilon", "AUC (basic)", "AUC (RDP)", "paired AUC gain of RDP", "sigma (basic)", "sigma (RDP)",
                    "noise ratio RDP/basic"])
        pu = res["privacy_utility"]
        for b, r, p, n in zip(pu["curves"]["basic"], pu["curves"]["rdp"], pu["paired_auc_gain_rdp"], pu["noise"]):
            w.writerow([b["eps_total"], _fmt(b["auc"]), _fmt(r["auc"]), _fmt(p), f"{n['sigma_basic']:.3f}",
                        f"{n['sigma_rdp']:.3f}", f"{n['noise_ratio']:.2f}"])
    with open(out / "table_compression.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["top-k (0 = dense)", "AUC", "KB per upload"])
        for r in res["compression"]:
            w.writerow([r["top_k"], _fmt(r["auc"]), _fmt(r["kb_per_upload"], 3)])


def make_all(res: dict, out: Path) -> None:
    fig_dir, tab_dir = out / "figures", out / "tables"
    fig_dir.mkdir(parents=True, exist_ok=True)
    tab_dir.mkdir(parents=True, exist_ok=True)
    privacy_utility(res, fig_dir)
    noise(res, fig_dir)
    compression(res, fig_dir)
    techniques(res, fig_dir)
    tables(res, tab_dir)
    print(f"figures in {fig_dir}, tables in {tab_dir}")


if __name__ == "__main__":
    d = Path(sys.argv[1] if len(sys.argv) > 1 else "results")
    make_all(json.loads((d / "experiments.json").read_text(encoding="utf-8")), d)
