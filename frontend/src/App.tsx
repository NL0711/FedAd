import { useState } from "react";
import { signOutAndGo } from "./supabase";
import Campaign from "./views/Campaign";
import ProofView from "./views/ProofView";
import Insights from "./views/Insights";

const TABS = [
  { id: "campaign", label: "Campaign" },
  { id: "model", label: "Model" },
  { id: "insights", label: "Insights" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const fromHash = TABS.find((t) => t.id === window.location.hash.slice(1))?.id;
  const [tab, setTabState] = useState<TabId>(fromHash ?? "campaign");
  const setTab = (id: TabId) => {
    setTabState(id);
    window.history.replaceState(null, "", `#${id}`);
  };
  return (
    <>
      <header className="app-header">
        <div className="app-title">
          <h1>FedAd Admin</h1>
          <button className="notes-btn" onClick={() => void signOutAndGo()}>Sign out</button>
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
    </>
  );
}
