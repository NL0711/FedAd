"""Paper section 2.2: local encoder with multilayer convolution over the behaviour sequence and an attention module
that aligns it with the candidate ad (eq. 1, h^(l) = sigma(W^(l) h^(l-1) + b^(l)), is the convolution/MLP stack).

    history ids --embedding--> conv1d -> ReLU -> conv1d -> ReLU --\
                                                                    attention (query = shown ad's category embedding)
    tabular features -> Linear -> ReLU ----------------------------+--> concat -> MLP -> click logit

Same interface as ``model.Model`` (flat parameter vector in and out), so the federation code does not care which one runs.
Needs PyTorch (optional dependency: ``pip install -e ".[deep]"``). The architecture is our design from the paper's
two-sentence description; layer sizes are `assumed`.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np
import torch
from torch import nn
from torch.nn.utils import parameters_to_vector, vector_to_parameters

from .data import AD_CAT_OFFSET, HIST_LEN, N_CATEGORIES, N_FEATURES


class _Net(nn.Module):
    def __init__(self, n_features: int, d: int = 8, hidden: int = 16):
        super().__init__()
        self.n_features, self.d = n_features, d
        self.emb = nn.Embedding(N_CATEGORIES + 1, d, padding_idx=0)
        self.conv1 = nn.Conv1d(d, d, 3, padding=1)
        self.conv2 = nn.Conv1d(d, d, 3, padding=1)
        self.wq = nn.Linear(d, d, bias=False)
        self.tab = nn.Linear(n_features, hidden)
        self.out1 = nn.Linear(hidden + 3 * d, hidden)
        self.out2 = nn.Linear(hidden, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        tab = x[:, :self.n_features]
        hist = x[:, self.n_features:].long()
        ad = tab[:, AD_CAT_OFFSET:AD_CAT_OFFSET + N_CATEGORIES].argmax(1) + 1
        mask = hist > 0
        e = self.emb(hist)                                       # B, L, d
        h = torch.relu(self.conv1(e.transpose(1, 2)))
        h = torch.relu(self.conv2(h)).transpose(1, 2)            # B, L, d
        q = self.wq(self.emb(ad))                                # B, d
        score = (h * q[:, None, :]).sum(-1) / self.d ** 0.5
        score = score.masked_fill(~mask, -1e9)
        att = torch.softmax(score, dim=1) * mask                 # all-padding rows give zero context
        ctx = (att[:, :, None] * h).sum(1)
        # interaction: mean over real history positions of (history feature x ad query), so "how much of the history
        # matches this ad" survives the softmax normalisation of the attention
        cnt = mask.sum(1).clamp(min=1).unsqueeze(1)
        inter = (h * mask[:, :, None] * q[:, None, :]).sum(1) / cnt
        z = torch.cat([torch.relu(self.tab(tab)), ctx, self.emb(ad), inter], dim=1)
        return self.out2(torch.relu(self.out1(z))).squeeze(1)


class SeqModel:
    def __init__(self, n_features: int = N_FEATURES, seed: int = 0, d: int = 8, hidden: int = 16):
        self.n_features, self.seed = n_features, seed
        self.net = _Net(n_features, d, hidden)
        self._init = self._fresh()
        self.n_params = int(self._init.size)

    def _fresh(self) -> np.ndarray:
        torch.manual_seed(self.seed)
        fresh = _Net(self.n_features, self.net.d, self.net.out1.out_features)
        return parameters_to_vector(fresh.parameters()).detach().numpy().astype(np.float64)

    def init(self) -> np.ndarray:
        return self._init.copy()

    def _load(self, w: np.ndarray) -> None:
        vector_to_parameters(torch.as_tensor(w, dtype=torch.float32), self.net.parameters())

    def predict(self, w: np.ndarray, X: np.ndarray) -> np.ndarray:
        self._load(w)
        with torch.no_grad():
            return torch.sigmoid(self.net(torch.as_tensor(X, dtype=torch.float32))).numpy().astype(np.float64)

    def loss(self, w: np.ndarray, X: np.ndarray, y: np.ndarray) -> float:
        p = np.clip(self.predict(w, X), 1e-7, 1 - 1e-7)
        return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))

    def local_train(self, w: np.ndarray, X: np.ndarray, y: np.ndarray, epochs: int, lr: float, batch: int,
                    rng: np.random.Generator, l2: float = 1e-4) -> Tuple[np.ndarray, float, float]:
        before = self.loss(w, X, y)
        self._load(w)
        Xt = torch.as_tensor(X, dtype=torch.float32)
        yt = torch.as_tensor(y, dtype=torch.float32)
        opt = torch.optim.SGD(self.net.parameters(), lr=lr, weight_decay=l2)
        bce = nn.BCEWithLogitsLoss()
        n = len(y)
        for _ in range(epochs):
            order = rng.permutation(n)
            for s in range(0, n, batch):
                idx = torch.as_tensor(order[s:s + batch])
                opt.zero_grad()
                bce(self.net(Xt[idx]), yt[idx]).backward()
                opt.step()
        after_w = parameters_to_vector(self.net.parameters()).detach().numpy().astype(np.float64)
        return after_w - w, before, self.loss(after_w, X, y)
