import { useState } from "react";
import { signOutAndGo } from "./supabase";
import ServerView from "./views/ServerView";
import Campaign from "./views/Campaign";
import ProofView from "./views/ProofView";
import Insights from "./views/Insights";
import Benefit from "./views/Benefit";
import Pipeline from "./views/Pipeline";
import LiveRun from "./views/LiveRun";
import PrivacyUtility from "./views/PrivacyUtility";
import BuildingBlocks from "./views/BuildingBlocks";
import Responsible from "./views/Responsible";

const ADMIN = [
  { id: "server", label: "Server view" },
  { id: "campaign", label: "Campaign" },
  { id: "model", label: "Model" },
  { id: "insights", label: "Insights" },
  { id: "benefit", label: "Benefit" },
] as const;
const RESEARCH = [
  { id: "pipeline", label: "Pipeline" },
  { id: "live", label: "Benchmark run" },
  { id: "pu", label: "Privacy vs utility" },
  { id: "blocks", label: "Building blocks" },
  { id: "resp", label: "Responsible AI" },
] as const;

type TabId = (typeof ADMIN)[number]["id"] | (typeof RESEARCH)[number]["id"];
const ALL = [...ADMIN, ...RESEARCH];

export default function App() {
  const fromHash = ALL.find((t) => t.id === window.location.hash.slice(1))?.id;
  const [tab, setTabState] = useState<TabId>(fromHash ?? "server");
  const [notes, setNotes] = useState(false);
  const setTab = (id: TabId) => {
    setTabState(id);
    window.history.replaceState(null, "", `#${id}`);
  };
  const button = (t: { id: TabId; label: string }, research = false) => (
    <button key={t.id} role="tab" className={research ? "research" : undefined} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
      {t.label}
    </button>
  );
  return (
    <>
      <header className="app-header">
        <div className="app-title">
          <h1>FedAd · Ad admin</h1>
          <span className="badge">Prototype</span>
          <button className="notes-btn" onClick={() => void signOutAndGo()}>Sign out</button>
          <button className="notes-btn" aria-pressed={notes} onClick={() => { setNotes(!notes); document.body.classList.toggle("notes"); }}>Notes</button>
        </div>
        <nav role="tablist" aria-label="Views">
          {ADMIN.map((t) => button(t))}
          <span className="sep" aria-hidden="true" />
          {RESEARCH.map((t) => button(t, true))}
        </nav>
      </header>
      <main>
        {tab === "server" && <ServerView />}
        {tab === "campaign" && <Campaign />}
        {tab === "model" && <ProofView />}
        {tab === "insights" && <Insights />}
        {tab === "benefit" && <Benefit />}
        {tab === "pipeline" && <Pipeline />}
        {/* The benchmark run stays mounted so a running stream and the compare table survive switching tabs. */}
        <div hidden={tab !== "live"}>
          <LiveRun />
        </div>
        {tab === "pu" && <PrivacyUtility />}
        {tab === "blocks" && <BuildingBlocks />}
        {tab === "resp" && <Responsible />}
      </main>
    </>
  );
}
