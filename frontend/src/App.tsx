import { useCallback, useEffect, useMemo, useState } from "react";
import { signOutAndGo } from "./supabase";
import Campaign from "./views/Campaign";
import ProofView from "./views/ProofView";
import Insights from "./views/Insights";
import NewCampaign from "./views/NewCampaign";
import { CampaignContext, listCampaigns, type CampaignSummary } from "./live";

const TABS = [
  { id: "campaign", label: "Campaign" },
  { id: "model", label: "Model" },
  { id: "insights", label: "Insights" },
] as const;

type TabId = (typeof TABS)[number]["id"];
const NEW = "__new";

export default function App() {
  const fromHash = TABS.find((t) => t.id === window.location.hash.slice(1))?.id;
  const [tab, setTabState] = useState<TabId>(fromHash ?? "campaign");
  const setTab = (id: TabId) => {
    setTabState(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  const [items, setItems] = useState<CampaignSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [viewId, setViewId] = useState("");                 // the campaign being looked at; empty until the list has loaded
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => {
    listCampaigns().then((r) => {
      setItems(r.items);
      setActiveId(r.active);
      setViewId((v) => (v && r.items.some((i) => i.id === v) ? v : r.active));     // follow the active one until another is chosen
    }).catch(() => {});
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const ctx = useMemo(() => ({ items, activeId, viewId, setViewId, refresh }), [items, activeId, viewId, refresh]);

  return (
    <CampaignContext.Provider value={ctx}>
      <header className="app-header">
        <div className="app-title">
          <h1>FedAd</h1>
          <div className="top-right">
            <label className="picker">
              <span className="sr">Campaign</span>
              <select value={viewId} onChange={(e) => (e.target.value === NEW ? setCreating(true) : setViewId(e.target.value))} aria-label="Campaign">
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}{i.active ? " (active)" : ""} · v{i.version}</option>
                ))}
                <option value={NEW}>New campaign…</option>
              </select>
            </label>
            <button className="notes-btn" onClick={() => void signOutAndGo()}>Sign out</button>
          </div>
        </div>
        <nav role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "campaign" && <Campaign />}
        {tab === "model" && <ProofView />}
        {tab === "insights" && <Insights />}
      </main>
      {creating && (
        <NewCampaign
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setViewId(id); refresh(); }}
        />
      )}
    </CampaignContext.Provider>
  );
}
