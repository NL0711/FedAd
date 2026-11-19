// Shapes returned by backend/src/fedad/web/app.py. NaN and infinity arrive as null.

export type Num = number | null;

export interface RunRequest {
  engine: "native" | "flower";
  mode: "sync" | "async";
  n_clients: number;
  rounds: number;
  seed: number;
  dp: boolean;
  eps_total: number;
  accountant: "basic" | "rdp";
  secure_agg: boolean;
  he: boolean;
  top_k: number;
  agg: "fedavg" | "weighted";
  n_edges: number;
}

export interface RoundRow {
  round?: number;
  version?: number;
  bytes_up: number;
  auc: Num;
  logloss: Num;
  eps_basic: Num;
  eps_rdp: Num;
  n_updates?: number;
}

export interface RunSummary {
  auc: Num;
  logloss: Num;
  rounds_done: number;
  kb_per_upload: Num;
  dense_kb: Num;
  compression_ratio: Num;
  eps_run: Num;
  eps_rdp: Num;
  sigma_min: Num;
  sigma_max: Num;
  seconds: Num;
  engine: string;
  mode: string;
}

export interface RunSnapshot {
  id: string;
  status: "queued" | "running" | "done" | "error";
  request: RunRequest;
  rows: RoundRow[];
  summary: RunSummary | null;
  error: string | null;
}

export interface Dataset {
  name: string;
  license: string;
  synthetic: boolean;
  sample_rows: number;
  source_rows: number;
  click_rate: number;
  n_features: number;
  partition_column: number;
  partition_cardinality: number;
  short: string;
}

export interface Health {
  ok: boolean;
  flower: string | null;
  engines: string[];
  experiments_available: boolean;
  dataset?: Dataset | null;
  benchmark_ready?: boolean;
}

export interface Stat {
  mean: number;
  ci: number;
  n: number;
  by_seed?: number[];
}

export interface Metrics {
  auc: Stat;
  logloss: Stat;
  kb_per_upload: Stat;
  eps_run: Stat;
  eps_rdp: Stat;
  seconds: Stat;
  dense_kb: Stat;
}

export interface CurvePoint extends Metrics {
  eps_total: number;
}

export interface NoisePoint {
  eps_total: number;
  sigma_basic: number;
  sigma_rdp: number;
  noise_ratio: number;
  eps_rdp_of_basic: number;
}

export interface PairedGain extends Stat {
  eps_total: number;
}

export interface Technique extends Metrics {
  name: string;
  group: string;
  async: boolean;
  raw_rows_collected?: number;
}

export interface CompressionPoint extends Metrics {
  top_k: number;
}

export interface FlowerParity {
  name: string;
  flower_version: string | null;
  auc_native: number;
  auc_flower: number;
  max_abs_weight_diff: number;
  flower_seconds: number;
}

export interface Experiments {
  dataset?: Dataset;
  rows?: number;
  n_params?: number;
  seeds: number[];
  n_clients: number;
  rounds: number;
  privacy_utility: {
    no_dp: Metrics;
    curves: { basic: CurvePoint[]; rdp: CurvePoint[] };
    noise: NoisePoint[];
    paired_auc_gain_rdp?: PairedGain[];
    rounds: number;
    delta_total: number;
    clip_c: number;
  };
  techniques: Technique[];
  compression: CompressionPoint[];
  flower_parity?: FlowerParity[];
}

export interface Calibration {
  sigma_basic: number;
  sigma_rdp: number;
  noise_ratio: number;
  eps_rdp_of_basic: number;
  noise_multiplier_basic: number;
  noise_multiplier_rdp: number;
  sensitivity: number;
  rounds: number;
}
