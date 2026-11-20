import { useEffect, useRef, useState } from "react";
import { createCampaign } from "../live";

/** A basic form for starting a campaign. The campaign it replaces is saved, and stays in the header list. */
export default function NewCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [eps, setEps] = useState(1000);
  const [uploads, setUploads] = useState(10);
  const [step, setStep] = useState(1);
  const [dp, setDp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { ref.current?.showModal(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Give the campaign a name."); return; }
    setBusy(true);
    setErr("");
    try {
      const r = await createCampaign({ name: name.trim(), eps_total: eps, max_uploads: uploads, buffer_k: step, dp, mode: "async", top_k: 0, prior_ctr: 0.05 });
      onCreated(r.id);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form onSubmit={submit}>
        <h3>New campaign</h3>
        <div className="field">
          <label htmlFor="n-name">Name</label>
          <input id="n-name" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="For example: Reviewer demo" />
        </div>
        <div className="field">
          <label htmlFor="n-eps">Total ε per device</label>
          <input id="n-eps" type="number" min={1} max={100000} value={eps} disabled={!dp} onChange={(e) => setEps(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))} />
        </div>
        <div className="field">
          <label htmlFor="n-up">Updates allowed per device</label>
          <input id="n-up" type="number" min={1} max={100} value={uploads} onChange={(e) => setUploads(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </div>
        <div className="field">
          <label htmlFor="n-k">Updates per model step</label>
          <input id="n-k" type="number" min={1} max={20} value={step} onChange={(e) => setStep(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
        </div>
        <label className="check">
          <input type="checkbox" checked={dp} onChange={(e) => setDp(e.target.checked)} />
          Add noise on the device
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row">
          <button type="submit" className="btn" disabled={busy}>Create campaign</button>
          <button type="button" className="notes-btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
