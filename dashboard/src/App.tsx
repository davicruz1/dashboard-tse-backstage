import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  Download,
  Filter,
  Gauge,
  Info,
  MapPinned,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  UsersRound,
  Vote,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  loadDashboardData,
  type BallotRow,
  type DashboardData,
  type Turn,
} from "./data";

type PopulationFilter = "all" | "<20k hab" | "20k-100k hab" | ">100k hab";
type DashboardView = "overview" | "swing" | "population" | "disputes";
type SwingDirection = "left" | "right";
type MunicipalitySwing = {
  uf: string;
  municipio: string;
  populacao: number | null;
  faixa_populacao: string | null;
  share2018: number;
  share2022: number;
  swing: number;
  flipped: boolean;
};
type AggregateInput = Pick<
  BallotRow,
  | "votos_esquerda"
  | "votos_direita"
  | "votos_terceira_via"
  | "votos_validos"
  | "abstencoes"
  | "aptos"
  | "brancos"
  | "nulos"
>;

const COLORS = {
  left: "#f16b8c",
  right: "#67a6ff",
  third: "#f5b84b",
  teal: "#57d6be",
  grid: "rgba(151, 167, 193, .12)",
  muted: "#8794a9",
};
const number = new Intl.NumberFormat("pt-BR");
const percent = (value: number, digits = 1) =>
  `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const percentagePoints = (value: number, digits = 1) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const compact = (value: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const municipalityCount = (value: number) =>
  `${number.format(value)} ${value === 1 ? "município" : "municípios"}`;

function sum<T>(items: T[], read: (item: T) => number) {
  return items.reduce((total, item) => total + (Number(read(item)) || 0), 0);
}

function share(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function isBrazilianUf(uf: string | null | undefined): uf is string {
  return Boolean(uf && uf !== "ZZ");
}

function matchesUf(rowUf: string | null | undefined, selectedUf: string) {
  if (selectedUf === "BR") return isBrazilianUf(rowUf);
  if (selectedUf === "ZZ") return rowUf === "ZZ";
  return rowUf === selectedUf;
}

function matchesPopulation(
  row: { faixa_populacao: string | null },
  population: PopulationFilter,
) {
  return population === "all" || row.faixa_populacao === population;
}

function aggregateVotes(rows: AggregateInput[]) {
  const left = sum(rows, (row) => row.votos_esquerda);
  const right = sum(rows, (row) => row.votos_direita);
  const third = sum(rows, (row) => row.votos_terceira_via);
  const valid = sum(rows, (row) => row.votos_validos);
  const abstentions = sum(rows, (row) => row.abstencoes);
  const eligible = sum(rows, (row) => row.aptos);
  const blanks = sum(rows, (row) => row.brancos);
  const nulls = sum(rows, (row) => row.nulos);
  return {
    left,
    right,
    third,
    valid,
    abstentions,
    eligible,
    blanks,
    nulls,
    leftShare: share(left, valid),
    rightShare: share(right, valid),
    thirdShare: share(third, valid),
    abstentionRate: share(abstentions, eligible),
  };
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [year, setYear] = useState<2018 | 2022>(2022);
  const [turn, setTurn] = useState<Turn>(2);
  const [uf, setUf] = useState("BR");
  const [population, setPopulation] = useState<PopulationFilter>("all");
  const [raceSearch, setRaceSearch] = useState("");
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [swingDirection, setSwingDirection] = useState<SwingDirection>("left");
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [swingSearch, setSwingSearch] = useState("");
  const [swingPage, setSwingPage] = useState(0);
  const [racePage, setRacePage] = useState(0);

  useEffect(() => {
    loadDashboardData().then(setData).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os dados.");
    });
  }, []);
  useEffect(() => {
    setSwingPage(0);
  }, [swingSearch, uf, population]);
  useEffect(() => {
    setRacePage(0);
  }, [raceSearch, uf, population, year]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeView]);
  useEffect(() => {
    if (!methodologyOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMethodologyOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [methodologyOpen]);

  const yearStats = useMemo(() => {
    const empty = aggregateVotes([]);
    if (!data) return { 2018: empty, 2022: empty };
    const forYear = (electionYear: 2018 | 2022) => {
      if (uf === "BR") {
        const national = data.totals.find((row) => row.ano === electionYear && row.turno === turn);
        if (national) return aggregateVotes([national]);
      }
      return aggregateVotes(
        data.municipios.filter(
          (row) =>
            row.ano === electionYear &&
            row.turno === turn &&
            matchesUf(row.uf, uf) &&
            matchesPopulation(row, population),
        ),
      );
    };
    return { 2018: forYear(2018), 2022: forYear(2022) };
  }, [data, population, turn, uf]);
  const swing = yearStats[2022].leftShare - yearStats[2018].leftShare;

  const swingCities = useMemo(() => {
    if (!data) return [];
    return data.swingCities
      .filter(
        (city) =>
          matchesUf(city.uf, uf) && matchesPopulation(city, population),
      )
      .sort((a, b) => Math.abs(b.swing_rate_pp) - Math.abs(a.swing_rate_pp));
  }, [data, population, uf]);

  const municipalitySwings = useMemo(() => {
    if (!data) return [];
    const recordsByMunicipality = new Map<string, BallotRow[]>();
    data.municipios
      .filter((row) => row.turno === 2 && (row.ano === 2018 || row.ano === 2022))
      .forEach((row) => {
        const key = `${row.uf ?? ""}\u0000${row.municipio}`;
        recordsByMunicipality.set(key, [...(recordsByMunicipality.get(key) ?? []), row]);
      });

    return [...recordsByMunicipality.values()]
      .map((records): MunicipalitySwing | null => {
        const row2018 = records.find((row) => row.ano === 2018);
        const row2022 = records.find((row) => row.ano === 2022);
        const state = row2022?.uf ?? row2018?.uf;
        if (!row2018 || !row2022 || !isBrazilianUf(state)) return null;
        const winner2018 =
          row2018.share_esquerda_pct > row2018.share_direita_pct ? "left" : "right";
        const winner2022 =
          row2022.share_esquerda_pct > row2022.share_direita_pct ? "left" : "right";
        return {
          uf: state,
          municipio: row2022.municipio,
          populacao: row2022.populacao ?? row2018.populacao,
          faixa_populacao: row2022.faixa_populacao ?? row2018.faixa_populacao,
          share2018: row2018.share_esquerda_pct,
          share2022: row2022.share_esquerda_pct,
          swing: row2022.share_esquerda_pct - row2018.share_esquerda_pct,
          flipped: winner2018 !== winner2022,
        };
      })
      .filter(
        (row): row is MunicipalitySwing =>
          Boolean(row && matchesUf(row.uf, uf) && matchesPopulation(row, population)),
      )
      .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
  }, [data, population, uf]);

  const swingChartData = useMemo(() => {
    const ordered = [...municipalitySwings].sort((a, b) =>
      swingDirection === "left" ? b.swing - a.swing : a.swing - b.swing,
    );
    return ordered
      .filter((row) => (swingDirection === "left" ? row.swing > 0 : row.swing < 0))
      .slice(0, 10)
      .map((row) => ({
        ...row,
        chartValue: Math.abs(row.swing),
        label: `${row.municipio} · ${row.uf}`,
      }));
  }, [municipalitySwings, swingDirection]);

  const abstentionData = useMemo(() => {
    if (!data) return [];
    return ([2018, 2022] as const).map((electionYear) => {
      const national =
        uf === "BR" && population === "all"
          ? data.totals.find((row) => row.ano === electionYear && row.turno === turn)
          : undefined;
      const rows = national
        ? [national]
        : data.municipios.filter(
            (row) =>
              row.ano === electionYear &&
              row.turno === turn &&
              matchesUf(row.uf, uf) &&
              matchesPopulation(row, population),
          );
      const stats = aggregateVotes(rows);
      return {
        ano: String(electionYear),
        Abstenção: stats.abstentionRate,
        Brancos: share(stats.blanks, stats.eligible),
        Nulos: share(stats.nulls, stats.eligible),
      };
    });
  }, [data, population, turn, uf]);

  const stateRanking = useMemo(() => {
    if (!data) return [];
    const rows = data.municipios.filter(
      (row) =>
        row.ano === year &&
        row.turno === turn &&
        matchesUf(row.uf, uf) &&
        matchesPopulation(row, population),
    );
    const grouped = new Map<string, BallotRow[]>();
    rows.forEach((row) => {
      if (isBrazilianUf(row.uf)) {
        grouped.set(row.uf, [...(grouped.get(row.uf) ?? []), row]);
      }
    });
    const officialStates = data.states.filter(
      (state) =>
        state.ano === year &&
        state.turno === turn &&
        matchesUf(state.uf, uf),
    );
    if (turn === 2 && population === "all" && officialStates.length > 0) {
      return officialStates
        .map((state) => {
          const stats = aggregateVotes(grouped.get(state.uf) ?? []);
          return {
            uf: state.uf,
            abstencao: state.taxa_abstencao_pct,
            brancos: share(stats.blanks, stats.eligible),
            nulos: share(stats.nulls, stats.eligible),
          };
        })
        .sort((a, b) => b.abstencao - a.abstencao)
        .slice(0, 5);
    }
    return [...grouped.entries()]
      .map(([state, stateRows]) => {
        const stats = aggregateVotes(stateRows);
        return {
          uf: state,
          abstencao: stats.abstentionRate,
          brancos: share(stats.blanks, stats.eligible),
          nulos: share(stats.nulls, stats.eligible),
        };
      })
      .sort((a, b) => b.abstencao - a.abstencao)
      .slice(0, 5);
  }, [data, population, turn, uf, year]);

  const demographics = useMemo(() => {
    if (!data) return [];
    const categories = ["<20k hab", "20k-100k hab", ">100k hab"];
    const demographicTurn = 1;
    if (uf === "BR" && population === "all") {
      return categories.map((category) => {
        const rows = data.demographics.filter(
          (row) =>
            row.ano === year &&
            row.turno === demographicTurn &&
            row.dimensao === "faixa_populacao" &&
            row.categoria === category,
        );
        const getShare = (spectrum: string) =>
          rows.find((row) => row.espectro === spectrum)?.share_categoria_pct ?? 0;
        return {
          faixa: category.replace(" hab", ""),
          Esquerda: getShare("Esquerda"),
          Direita: getShare("Direita"),
          "3ª Via": getShare("Terceira Via/Outros"),
        };
      });
    }
    const rows = data.municipios.filter(
      (row) =>
        row.ano === year &&
        row.turno === demographicTurn &&
        matchesUf(row.uf, uf) &&
        matchesPopulation(row, "all"),
    );
    return categories.map((category) => {
      const group = rows.filter((row) => row.faixa_populacao === category);
      const stats = aggregateVotes(group);
      return {
        faixa: category.replace(" hab", ""),
        Esquerda: stats.leftShare,
        Direita: stats.rightShare,
        "3ª Via": stats.thirdShare,
      };
    });
  }, [data, population, turn, uf, year]);

  const flowData = useMemo(() => {
    if (!data) return [];
    return ([2018, 2022] as const).map((electionYear) => {
      const rows = data.flow.filter(
        (row) =>
          row.ano === electionYear &&
          matchesUf(row.uf, uf) &&
          matchesPopulation(row, population),
      );
      const firstRoundWinner = sum(rows, (row) => row.votos_vencedor_turno_1);
      const runoffWinner = sum(rows, (row) => row.votos_vencedor_turno_2);
      const thirdRoundVotes = sum(rows, (row) => row.votos_terceira_via_turno_1);
      const gain = runoffWinner - firstRoundWinner;
      return {
        ano: String(electionYear),
        "Vencedor · 1º turno": firstRoundWinner,
        "Vencedor · 2º turno": runoffWinner,
        "Demais candidatos · 1º turno": thirdRoundVotes,
        absorcao: share(gain, thirdRoundVotes),
      };
    });
  }, [data, population, uf]);

  const filteredCloseRaces = useMemo(() => {
    if (!data) return [];
    const query = raceSearch.trim().toLocaleLowerCase("pt-BR");
    return data.closeRaces
      .filter(
        (race) =>
          race.ano === year &&
          matchesUf(race.uf, uf) &&
          matchesPopulation(race, population) &&
          (!query ||
            race.municipio.toLocaleLowerCase("pt-BR").includes(query) ||
            (race.uf ?? "").toLocaleLowerCase("pt-BR").includes(query)),
      )
      .sort((a, b) => a.margem_pct - b.margem_pct);
  }, [data, population, raceSearch, uf, year]);
  const racePageSize = 25;
  const racePageCount = Math.max(1, Math.ceil(filteredCloseRaces.length / racePageSize));
  const closeRaces =
    activeView === "disputes"
      ? filteredCloseRaces.slice(racePage * racePageSize, (racePage + 1) * racePageSize)
      : filteredCloseRaces.slice(0, 8);

  const filteredSwingTable = useMemo(() => {
    const query = swingSearch.trim().toLocaleLowerCase("pt-BR");
    return [...municipalitySwings]
      .filter(
        (row) =>
          !query ||
          row.municipio.toLocaleLowerCase("pt-BR").includes(query) ||
          row.uf.toLocaleLowerCase("pt-BR").includes(query),
      )
      .sort((a, b) => a.municipio.localeCompare(b.municipio, "pt-BR"));
  }, [municipalitySwings, swingSearch]);
  const swingPageSize = 25;
  const swingPageCount = Math.max(1, Math.ceil(filteredSwingTable.length / swingPageSize));
  const swingPageRows = filteredSwingTable.slice(
    swingPage * swingPageSize,
    (swingPage + 1) * swingPageSize,
  );
  const swingTableSummary = useMemo(() => {
    const count = filteredSwingTable.length;
    const flipped = filteredSwingTable.filter((row) => row.flipped).length;
    return {
      count,
      flipped,
      share2018: count ? sum(filteredSwingTable, (row) => row.share2018) / count : 0,
      share2022: count ? sum(filteredSwingTable, (row) => row.share2022) / count : 0,
      swing: count ? sum(filteredSwingTable, (row) => row.swing) / count : 0,
    };
  }, [filteredSwingTable]);

  const ufs = useMemo(
    () => [...new Set(data?.municipios.map((row) => row.uf).filter(isBrazilianUf) ?? [])].sort(),
    [data],
  );
  const hasExteriorRows = useMemo(
    () => Boolean(data?.municipios.some((row) => row.uf === "ZZ")),
    [data],
  );
  const swingTone = swing >= 0 ? "up" : "down";
  const highlightedCity = swingCities[0];
  const activeLocation = uf === "BR" ? "Brasil" : uf === "ZZ" ? "Exterior (ZZ)" : uf;
  const populationLabel =
    population === "all" ? "Todos os portes" : population.replace(" hab", " habitantes");

  if (loadError) {
    return (
      <main className="error-screen">
        <div className="error-card">
          <Database size={26} />
          <h1>Não foi possível abrir o painel</h1>
          <p>{loadError}</p>
          <p>Confirme que os arquivos JSON estão em <code>public/data</code> e reinicie o servidor.</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading-screen">
        <div className="loading-orb" />
        <span>Preparando inteligência eleitoral…</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={20} strokeWidth={2.2} /></div>
          <div>
            <strong className="brand-name">Backstage</strong>
            <small>Inteligência Eleitoral • TSE 2018–2022</small>
          </div>
        </div>

        <div className="side-label">ESPAÇO DE TRABALHO</div>
        <nav className="side-nav" aria-label="Navegação principal">
          <button type="button" className={`nav-item ${activeView === "overview" ? "active" : ""}`} onClick={() => setActiveView("overview")}><BarChart3 size={17} /> Visão geral {activeView === "overview" && <span />}</button>
          <button type="button" className={`nav-item ${activeView === "swing" ? "active" : ""}`} onClick={() => setActiveView("swing")}><Gauge size={17} /> Volatilidade {activeView === "swing" && <span />}</button>
          <button type="button" className={`nav-item ${activeView === "population" ? "active" : ""}`} onClick={() => setActiveView("population")}><UsersRound size={17} /> Porte do voto {activeView === "population" && <span />}</button>
          <button type="button" className={`nav-item ${activeView === "disputes" ? "active" : ""}`} onClick={() => setActiveView("disputes")}><MapPinned size={17} /> Disputas locais {activeView === "disputes" && <span />}</button>
        </nav>

        <div className="sidebar-bottom">
          <div className="source-card">
            <div className="source-icon"><Database size={16} /></div>
            <div><strong>Fonte verificada</strong><span>Dados oficiais · TSE</span></div>
            <ShieldCheck className="verified-icon" size={16} />
          </div>
          <div className="profile-chip">
            <div className="avatar">BR</div>
            <div><strong>Brasil</strong><span>Dados consolidados</span></div>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>

      <main className="main-content" id="visao-geral">
        <header className="topbar">
          <div className="breadcrumb"><span>Inteligência</span><span className="slash">/</span><strong>Panorama eleitoral</strong></div>
          <div className="topbar-actions">
            <button type="button" className="methodology-button" onClick={() => setMethodologyOpen(true)}><Info size={14} /> Fórmulas &amp; Modelo</button>
            <div className="topbar-meta"><span className="live-dot" /> BASE CONSOLIDADA <span className="topbar-divider" /> ELEIÇÕES 2018 — 2022</div>
          </div>
        </header>

        <div className="page-heading">
          <div>
            <div className="eyebrow"><Sparkles size={13} /> CENTRAL DE INTELIGÊNCIA</div>
            <h1>Panorama <span>eleitoral</span></h1>
            <p>Uma leitura territorial das mudanças no comportamento do voto brasileiro.</p>
          </div>
          <button className="export-button" onClick={() => window.print()}><Download size={15} /> Exportar relatório</button>
        </div>

        <section className="filter-bar" aria-label="Filtros globais">
          <div className="filter-title"><Filter size={15} /><span>RECORTE</span></div>
          <label className="filter-control">
            <span>ELEIÇÃO</span>
            <select value={year} onChange={(event) => setYear(Number(event.target.value) as 2018 | 2022)}>
              <option value={2018}>2018</option><option value={2022}>2022</option>
            </select>
          </label>
          <label className="filter-control">
            <span>TURNO</span>
            <select value={turn} onChange={(event) => setTurn(Number(event.target.value) as Turn)}>
              <option value={1}>1º Turno</option><option value={2}>2º Turno</option>
            </select>
          </label>
          <label className="filter-control">
            <span>LOCALIDADE</span>
            <select value={uf} onChange={(event) => setUf(event.target.value)}>
              <option value="BR">Brasil · todas as UFs</option>
              {hasExteriorRows && <option value="ZZ">Exterior (ZZ)</option>}
              {ufs.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>
          <label className="filter-control population-control">
            <span>PORTE MUNICIPAL</span>
            <select value={population} onChange={(event) => setPopulation(event.target.value as PopulationFilter)}>
              <option value="all">Todos os portes</option>
              <option value="<20k hab">&lt;20k habitantes</option>
              <option value="20k-100k hab">20k–100k habitantes</option>
              <option value=">100k hab">&gt;100k habitantes</option>
            </select>
          </label>
          <div className="filter-summary"><span className="summary-dot" /> {activeLocation} <span>·</span> {populationLabel}</div>
        </section>

        <section className="quick-uf-bar" aria-label="Acesso rápido por UF">
          <span className="quick-uf-label"><MapPinned size={13} /> ACESSO RÁPIDO</span>
          <div className="quick-uf-list">
            <button type="button" className={`uf-chip ${uf === "BR" ? "selected" : ""}`} onClick={() => setUf("BR")}>BR</button>
            {ufs.map((state) => (
              <button type="button" key={state} className={`uf-chip ${uf === state ? "selected" : ""}`} onClick={() => setUf(state)}>{state}</button>
            ))}
            {hasExteriorRows && <button type="button" className={`uf-chip ${uf === "ZZ" ? "selected" : ""}`} onClick={() => setUf("ZZ")}>ZZ</button>}
          </div>
        </section>

        {activeView === "overview" ? (
        <section className="dashboard-grid">
          <article className="panel swing-panel" id="swing">
            <PanelHeading icon={<Activity size={16} />} eyebrow="KPI 01 · VOLATILIDADE" title="Swing eleitoral" />
            <div className="swing-content">
              <div className="swing-metric">
                <span className="metric-caption">VARIAÇÃO DA ESQUERDA · 2018 → 2022</span>
                <div className={`big-number ${swingTone}`}>{swing > 0 ? "+" : ""}{percentagePoints(swing, 2)} <span>p.p.</span></div>
                <div className="metric-context"><span className={`trend-pill ${swingTone}`}>{swing >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{swing >= 0 ? "Avanço" : "Recuo"}</span><span>participação nos votos válidos</span></div>
                <div className="share-track">
                  <div className="share-fill" style={{ width: `${Math.min(yearStats[2022].leftShare, 100)}%` }} />
                  <span className="track-marker" style={{ left: `${Math.min(yearStats[2018].leftShare, 98)}%` }} />
                </div>
                <div className="track-legend"><span><i className="legend-dot left-dot" />2022 · {percent(yearStats[2022].leftShare, 1)}</span><span><i className="legend-marker" />2018 · {percent(yearStats[2018].leftShare, 1)}</span></div>
              </div>
              <div className="swing-city-feature">
                <div className="feature-topline"><span>MAIOR VIRADA NO RECORTE</span><span className="feature-arrow">↗</span></div>
                {highlightedCity ? <>
                  <h3>{highlightedCity.municipio}</h3>
                  <div className="feature-location">{highlightedCity.uf} <span>·</span> {number.format(highlightedCity.populacao ?? 0)} hab.</div>
                  <div className="winner-change"><span>{highlightedCity.espectro_vencedor_2018}</span><b>→</b><span>{highlightedCity.espectro_vencedor_2022}</span></div>
                  <div className="feature-swing">{highlightedCity.swing_rate_pp > 0 ? "+" : ""}{percentagePoints(highlightedCity.swing_rate_pp, 1)} <small>p.p. na esquerda</small></div>
                </> : <p className="empty-copy">Sem municípios comparáveis neste recorte.</p>}
              </div>
            </div>
            <div className="panel-footer">
              <span><span className="tiny-signal" /> {swingCities.length.toLocaleString("pt-BR")} {swingCities.length === 1 ? "município virou" : "municípios viraram"} o lado vencedor</span>
              <span>Fonte: apuração municipal</span>
            </div>
          </article>

          <article className="panel abstention-panel">
            <PanelHeading icon={<Vote size={16} />} eyebrow="KPI 02 · PARTICIPAÇÃO" title="Abstenção histórica" />
            <div className="chart-legend compact-legend"><LegendDot color={COLORS.teal} label="Abstenção" /><LegendDot color={COLORS.third} label="Brancos" /><LegendDot color="#9b8cff" label="Nulos" /></div>
            <div className="abstention-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={abstentionData} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}>
                  <defs><linearGradient id="abstFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.22} /><stop offset="100%" stopColor={COLORS.teal} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="ano" tickLine={false} axisLine={false} tick={{ fill: COLORS.muted, fontSize: 11 }} />
                  <YAxis domain={[0, "dataMax + 6"]} tickLine={false} axisLine={false} tick={{ fill: COLORS.muted, fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Area type="monotone" dataKey="Abstenção" stroke={COLORS.teal} strokeWidth={2.5} fill="url(#abstFill)" />
                  <Line type="monotone" dataKey="Brancos" stroke={COLORS.third} strokeWidth={1.6} dot={{ r: 3, fill: COLORS.third, strokeWidth: 0 }} />
                  <Line type="monotone" dataKey="Nulos" stroke="#9b8cff" strokeWidth={1.6} dot={{ r: 3, fill: "#9b8cff", strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="ranking-block">
              <div className="ranking-title"><span>MAIOR ABSTENÇÃO · {year}</span><span>UF / ABST. / BRANCOS / NULOS</span></div>
              {stateRanking.map((state, index) => (
                <div className="ranking-row" key={state.uf}>
                  <span className="rank-number">{String(index + 1).padStart(2, "0")}</span><strong>{state.uf}</strong>
                  <div className="rank-bar"><i style={{ width: `${Math.min(state.abstencao * 2.5, 100)}%` }} /></div>
                  <span className="rank-abstention">{percent(state.abstencao)}</span><span className="rank-secondary">{percent(state.brancos, 1)} <i>/</i> {percent(state.nulos, 1)}</span>
                </div>
              ))}
            </div>
            <div className="method-note"><CircleHelp size={13} /><span>{data.abstentionNote}</span></div>
          </article>

          <article className="panel demographic-panel" id="demografia">
            <div className="demographic-heading"><PanelHeading icon={<UsersRound size={16} />} eyebrow="KPI 03 · DEMOGRAFIA" title="O voto por porte municipal" /><span className="turn-context">1º TURNO · DEMAIS CANDIDATURAS NA CÉDULA</span></div>
            <div className="chart-legend"><LegendDot color={COLORS.left} label="Esquerda" /><LegendDot color={COLORS.right} label="Direita" /><LegendDot color={COLORS.third} label="3ª Via / Outros" /></div>
            <div className="demographic-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={demographics} margin={{ top: 16, right: 10, bottom: 0, left: -17 }} barGap={5}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="faixa" tickLine={false} axisLine={false} tick={{ fill: COLORS.muted, fontSize: 11 }} />
                  <YAxis domain={[0, 70]} tickLine={false} axisLine={false} tick={{ fill: COLORS.muted, fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} />
                  <Tooltip content={<ChartTooltip suffix="%" />} />
                  <Bar dataKey="Esquerda" fill={COLORS.left} radius={[4, 4, 0, 0]} maxBarSize={24}><LabelList dataKey="Esquerda" position="top" formatter={(value: number) => percent(value, 0)} fill="#f3f5f8" fontSize={8} /></Bar>
                  <Bar dataKey="Direita" fill={COLORS.right} radius={[4, 4, 0, 0]} maxBarSize={24}><LabelList dataKey="Direita" position="top" formatter={(value: number) => percent(value, 0)} fill="#f3f5f8" fontSize={8} /></Bar>
                  <Bar dataKey="3ª Via" fill={COLORS.third} radius={[4, 4, 0, 0]} maxBarSize={24}><LabelList dataKey="3ª Via" position="top" formatter={(value: number) => percent(value, 0)} fill="#f3f5f8" fontSize={8} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-footnote"><span>ELEIÇÃO {year} · 1º TURNO</span><span>Participação nos votos válidos da faixa</span></div>
          </article>

          <article className="panel flow-panel">
            <PanelHeading icon={<ArrowDownRight size={16} />} eyebrow="KPI 04 · SEGUNDO TURNO" title="O caminho da 3ª Via" />
            <div className="flow-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flowData} layout="vertical" margin={{ top: 5, right: 30, bottom: 0, left: 4 }} barGap={7}>
                  <CartesianGrid stroke={COLORS.grid} horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="ano" type="category" axisLine={false} tickLine={false} tick={{ fill: "#dce4ef", fontSize: 12, fontWeight: 700 }} width={35} />
                  <Tooltip content={<ChartTooltip compactValues />} />
                  <Bar dataKey="Vencedor · 1º turno" fill="#62758e" radius={[0, 4, 4, 0]} barSize={10}><LabelList dataKey="Vencedor · 1º turno" position="right" formatter={(value: number) => compact(value)} fill="#edf1f6" fontSize={8} /></Bar>
                  <Bar dataKey="Vencedor · 2º turno" fill={COLORS.teal} radius={[0, 4, 4, 0]} barSize={10}><LabelList dataKey="Vencedor · 2º turno" position="right" formatter={(value: number) => compact(value)} fill="#edf1f6" fontSize={8} /></Bar>
                  <Bar dataKey="Demais candidatos · 1º turno" fill={COLORS.third} radius={[0, 4, 4, 0]} barSize={10}><LabelList dataKey="Demais candidatos · 1º turno" position="right" formatter={(value: number) => compact(value)} fill="#edf1f6" fontSize={8} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flow-legend"><LegendDot color="#62758e" label="Vencedor · 1ºT" /><LegendDot color={COLORS.teal} label="Vencedor · 2ºT" /><LegendDot color={COLORS.third} label="Demais candidatos · 1ºT" /></div>
            <div className="absorption-row">
              {flowData.map((item) => <div className="absorption-stat" key={item.ano}><span>{item.ano} · ganho do vencedor / votos 3ª Via</span><strong>{percent(item.absorcao, 1)}</strong></div>)}
            </div>
            <div className="method-note flow-note"><CircleHelp size={13} /><span>{data.flowNote || "Estimativa ecológica: o ganho do vencedor dividido pelos votos da terceira via no primeiro turno; não identifica transferências individuais."}</span></div>
          </article>

          <article className="panel disputes-panel" id="disputas">
            <div className="disputes-heading">
              <PanelHeading icon={<MapPinned size={16} />} eyebrow="RADAR · MARGEM INFERIOR A 3%" title="Disputas acirradas" />
              <label className="search-field"><Search size={14} /><input value={raceSearch} onChange={(event) => setRaceSearch(event.target.value)} placeholder="Buscar município ou UF" /></label>
            </div>
            <div className="race-table-wrap">
              <table className="race-table">
                <thead><tr><th>MUNICÍPIO</th><th>REGIÃO</th><th>POPULAÇÃO</th><th>VENCEDOR</th><th>2º COLOCADO</th><th>MARGEM</th></tr></thead>
                <tbody>
                  {closeRaces.map((race) => (
                    <tr key={`${race.municipio}-${race.uf}-${race.ano}`}>
                      <td><strong>{race.municipio}</strong><span>{race.uf}</span></td>
                      <td>{race.regiao}</td>
                      <td>{race.populacao ? number.format(race.populacao) : "—"}</td>
                      <td><Candidate id={race.candidato_vencedor} /></td>
                      <td><Candidate id={race.candidato_segundo} secondary /></td>
                      <td><span className="margin-badge">{percent(race.margem_pct, 2)}</span></td>
                    </tr>
                  ))}
                  {closeRaces.length === 0 && <tr><td className="no-races" colSpan={6}>Nenhuma disputa encontrada para os filtros atuais.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel-footer disputes-footer">
              <span><span className="tiny-signal" /> {closeRaces.length} de {number.format(filteredCloseRaces.length)} disputas no recorte · margem sobre votos válidos</span>
              {filteredCloseRaces.length > 8 && <button type="button" className="text-action" onClick={() => setActiveView("disputes")}>Ver todas as disputas <ArrowUpRight size={13} /></button>}
              <span>Eleição {year} · TSE</span>
            </div>
          </article>
          <div className="swing-preview-wrap">
            <SwingTopChart
              data={swingChartData}
              direction={swingDirection}
              onDirectionChange={setSwingDirection}
              onOpenDetails={() => setActiveView("swing")}
            />
          </div>
        </section>
        ) : activeView === "swing" ? (
          <section className="detail-layout">
            <SwingTopChart data={swingChartData} direction={swingDirection} onDirectionChange={setSwingDirection} />
            <article className="panel comparison-panel">
              <div className="comparison-heading">
                <div>
                  <PanelHeading icon={<Activity size={16} />} eyebrow="COMPARATIVO MUNICIPAL · 2º TURNO" title="Evolução do voto por município" />
                  <p className="detail-description">Comparação completa dos municípios presentes nas duas eleições, limitada ao recorte ativo.</p>
                </div>
                <label className="search-field comparison-search"><Search size={14} /><input value={swingSearch} onChange={(event) => setSwingSearch(event.target.value)} placeholder="Buscar município ou UF" /></label>
              </div>
              <div className="race-table-wrap swing-table-wrap">
                <table className="race-table swing-table">
                  <thead><tr><th>UF</th><th>MUNICÍPIO</th><th>% ESQUERDA 2018</th><th>% ESQUERDA 2022</th><th>SWING (P.P.)</th><th>STATUS · VIRA-CASACA</th></tr></thead>
                  <tbody>
                    {swingPageRows.map((row) => (
                      <tr key={`${row.uf}-${row.municipio}`}>
                        <td><span className="state-code">{row.uf}</span></td>
                        <td><strong>{row.municipio}</strong><span>{row.populacao ? `${number.format(row.populacao)} hab.` : row.faixa_populacao}</span></td>
                        <td>{percent(row.share2018, 2)}</td>
                        <td>{percent(row.share2022, 2)}</td>
                        <td className={row.swing >= 0 ? "swing-positive" : "swing-negative"}>{row.swing > 0 ? "+" : ""}{percentagePoints(row.swing, 2)} p.p.</td>
                        <td><span className={`flip-status ${row.flipped ? "flipped" : "steady"}`}><i />{row.flipped ? "Vira-casaca" : "Manteve lado"}</span></td>
                      </tr>
                    ))}
                    {swingPageRows.length === 0 && <tr><td className="no-races" colSpan={6}>Nenhum município encontrado para os filtros atuais.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>—</td><td><strong>TOTAL / MÉDIA</strong><span>{municipalityCount(swingTableSummary.count)} · {number.format(swingTableSummary.flipped)} viraram</span></td>
                      <td>{percent(swingTableSummary.share2018, 2)}</td><td>{percent(swingTableSummary.share2022, 2)}</td>
                      <td className={swingTableSummary.swing >= 0 ? "swing-positive" : "swing-negative"}>{swingTableSummary.swing > 0 ? "+" : ""}{percentagePoints(swingTableSummary.swing, 2)} p.p.</td>
                      <td>{percent(share(swingTableSummary.flipped, swingTableSummary.count), 1)} do recorte</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="table-pagination">
                <span>Exibindo {filteredSwingTable.length ? swingPage * swingPageSize + 1 : 0}–{Math.min((swingPage + 1) * swingPageSize, filteredSwingTable.length)} de {municipalityCount(filteredSwingTable.length)} · total consolidado do recorte</span>
                <div><button type="button" disabled={swingPage === 0} onClick={() => setSwingPage((page) => page - 1)}>Anterior</button><span>{swingPage + 1} / {swingPageCount}</span><button type="button" disabled={swingPage + 1 >= swingPageCount} onClick={() => setSwingPage((page) => page + 1)}>Próxima</button></div>
              </div>
            </article>
          </section>
        ) : activeView === "population" ? (
          <section className="detail-layout">
            <article className="panel population-detail-panel">
              <PanelHeading icon={<UsersRound size={16} />} eyebrow="KPI 03 · PERFIL DO VOTO" title="Distribuição por porte populacional" />
              <p className="detail-description">Participação de cada espectro nos votos válidos em municípios de diferentes portes. Eleição {year}, 1º turno — período em que as candidaturas da terceira via estão na cédula.</p>
              <div className="chart-legend"><LegendDot color={COLORS.left} label="Esquerda" /><LegendDot color={COLORS.right} label="Direita" /><LegendDot color={COLORS.third} label="3ª Via / Outros" /></div>
              <div className="demographic-detail-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={demographics} margin={{ top: 28, right: 24, bottom: 8, left: 0 }} barGap={10}>
                    <CartesianGrid stroke={COLORS.grid} vertical={false} />
                    <XAxis dataKey="faixa" tickLine={false} axisLine={false} tick={{ fill: "#d1dae6", fontSize: 12 }} />
                    <YAxis domain={[0, 70]} tickLine={false} axisLine={false} tick={{ fill: "#b9c5d5", fontSize: 11 }} tickFormatter={(value: number) => `${value}%`} />
                    <Tooltip content={<ChartTooltip suffix="%" />} />
                    <Bar dataKey="Esquerda" fill={COLORS.left} radius={[5, 5, 0, 0]} maxBarSize={42}><LabelList dataKey="Esquerda" position="top" formatter={(value: number) => percent(value, 1)} fill="#f3f5f8" fontSize={9} /></Bar>
                    <Bar dataKey="Direita" fill={COLORS.right} radius={[5, 5, 0, 0]} maxBarSize={42}><LabelList dataKey="Direita" position="top" formatter={(value: number) => percent(value, 1)} fill="#f3f5f8" fontSize={9} /></Bar>
                    <Bar dataKey="3ª Via" fill={COLORS.third} radius={[5, 5, 0, 0]} maxBarSize={42}><LabelList dataKey="3ª Via" position="top" formatter={(value: number) => percent(value, 1)} fill="#f3f5f8" fontSize={9} /></Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="method-note"><CircleHelp size={13} /><span>Participação = votos do espectro ÷ votos válidos no respectivo porte. Dados de município, agregados por faixa populacional.</span></div>
            </article>
          </section>
        ) : (
          <section className="detail-layout">
            <article className="panel disputes-panel disputes-detail-panel">
              <div className="disputes-heading">
                <div><PanelHeading icon={<MapPinned size={16} />} eyebrow="RADAR · MARGEM INFERIOR A 3%" title="Disputas municipais acirradas" /><p className="detail-description">Municípios com margem de vitória abaixo de 3% na eleição {year}, ordenados da menor margem.</p></div>
                <label className="search-field"><Search size={14} /><input value={raceSearch} onChange={(event) => setRaceSearch(event.target.value)} placeholder="Buscar município ou UF" /></label>
              </div>
              <div className="race-table-wrap expanded-race-table">
                <table className="race-table">
                  <thead><tr><th>MUNICÍPIO</th><th>REGIÃO</th><th>POPULAÇÃO</th><th>VENCEDOR</th><th>2º COLOCADO</th><th>MARGEM</th></tr></thead>
                  <tbody>{closeRaces.map((race) => (
                    <tr key={`${race.municipio}-${race.uf}-${race.ano}`}>
                      <td><strong>{race.municipio}</strong><span>{race.uf ?? "—"}</span></td><td>{race.regiao}</td><td>{race.populacao ? number.format(race.populacao) : "—"}</td>
                      <td><Candidate id={race.candidato_vencedor} /></td><td><Candidate id={race.candidato_segundo} secondary /></td><td><span className="margin-badge">{percent(race.margem_pct, 2)}</span></td>
                    </tr>
                  ))}{closeRaces.length === 0 && <tr><td className="no-races" colSpan={6}>Nenhuma disputa encontrada para os filtros atuais.</td></tr>}</tbody>
                </table>
              </div>
              <div className="table-pagination race-pagination">
                <span>Exibindo {filteredCloseRaces.length ? racePage * racePageSize + 1 : 0}–{Math.min((racePage + 1) * racePageSize, filteredCloseRaces.length)} de {number.format(filteredCloseRaces.length)} disputas</span>
                <div><button type="button" disabled={racePage === 0} onClick={() => setRacePage((page) => page - 1)}>Anterior</button><span>{racePage + 1} / {racePageCount}</span><button type="button" disabled={racePage + 1 >= racePageCount} onClick={() => setRacePage((page) => page + 1)}>Próxima</button></div>
              </div>
              <div className="panel-footer"><span><span className="tiny-signal" /> Exibindo 25 por página · margem calculada sobre votos válidos</span><span>Eleição {year} · TSE</span></div>
            </article>
          </section>
        )}

        <footer className="page-footer"><span><ShieldCheck size={13} /> Dados eleitorais oficiais · Tribunal Superior Eleitoral</span><span><span className="footer-dot" /> RECORTE ATIVO: {activeLocation} · {year} · {turn}º TURNO</span><strong>BACKSTAGE · INTELIGÊNCIA ELEITORAL</strong></footer>
        <div className="print-credit">Backstage · Inteligência Eleitoral • TSE 2018–2022 · Relatório gerado a partir dos dados oficiais do TSE.</div>
      </main>
      {methodologyOpen && <MethodologyModal onClose={() => setMethodologyOpen(false)} abstentionNote={data.abstentionNote} flowNote={data.flowNote} />}
    </div>
  );
}

function PanelHeading({ icon, eyebrow, title }: { icon: ReactNode; eyebrow: string; title: string }) {
  return <div className="panel-heading"><div className="panel-icon">{icon}</div><div><div className="panel-eyebrow">{eyebrow}</div><h2>{title}</h2></div></div>;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="legend-item"><i style={{ backgroundColor: color }} />{label}</span>;
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix = "",
  compactValues = false,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  suffix?: string;
  compactValues?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <div key={item.name}><i style={{ backgroundColor: item.color }} />{item.name}<b>{compactValues ? compact(item.value) : `${item.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`}</b></div>
      ))}
    </div>
  );
}

function Candidate({ id, secondary = false }: { id: number; secondary?: boolean }) {
  const isLeft = id === 13;
  const isRight = id === 17 || id === 22;
  const label = isLeft ? "Esquerda" : isRight ? "Direita" : `Candidato ${id}`;
  return <span className={`candidate ${secondary ? "candidate-secondary" : isLeft ? "candidate-left" : "candidate-right"}`}><i />{label}</span>;
}

function SwingTopChart({
  data,
  direction,
  onDirectionChange,
  onOpenDetails,
}: {
  data: Array<MunicipalitySwing & { chartValue: number; label: string }>;
  direction: SwingDirection;
  onDirectionChange: (direction: SwingDirection) => void;
  onOpenDetails?: () => void;
}) {
  const tone = direction === "left" ? COLORS.left : COLORS.right;
  return (
    <article className="panel swing-top-panel">
      <div className="swing-chart-header">
        <PanelHeading icon={<Activity size={16} />} eyebrow="VOLATILIDADE MUNICIPAL · TOP 10" title="Onde o voto mais se moveu" />
        <div className="swing-chart-actions">
          <div className="segmented-control" role="group" aria-label="Direção do avanço">
            <button type="button" className={direction === "left" ? "selected" : ""} onClick={() => onDirectionChange("left")}>Maior avanço Esquerda</button>
            <button type="button" className={direction === "right" ? "selected" : ""} onClick={() => onDirectionChange("right")}>Maior avanço Direita</button>
          </div>
          {onOpenDetails && <button type="button" className="text-action" onClick={onOpenDetails}>Comparativo completo <ArrowUpRight size={13} /></button>}
        </div>
      </div>
      <div className="top-swing-chart" style={{ height: Math.max(270, data.length * 30 + 24) }}>
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 92, bottom: 4, left: 0 }} barCategoryGap={8}>
              <CartesianGrid stroke={COLORS.grid} horizontal={false} />
              <XAxis type="number" domain={[0, "dataMax + 4"]} tickLine={false} axisLine={false} tick={{ fill: "#b9c5d5", fontSize: 10 }} tickFormatter={(value: number) => `${value} p.p.`} />
              <YAxis dataKey="label" type="category" width={150} tickLine={false} axisLine={false} tick={{ fill: "#d4dde8", fontSize: 9 }} />
              <Tooltip content={<SwingTooltip direction={direction} />} />
              <Bar dataKey="chartValue" fill={tone} radius={[0, 5, 5, 0]} maxBarSize={17}>
                <LabelList dataKey="swing" position="right" formatter={(value: number) => `${value > 0 ? "+" : ""}${percentagePoints(value, 1)} p.p.`} fill="#f3f5f8" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Sem municípios comparáveis neste filtro.</div>}
      </div>
      <div className="panel-footer">
        <span><span className="tiny-signal" /> Avanço medido pela variação da participação da Esquerda entre 2018 e 2022 · {number.format(data.length)} exibidos</span>
        <span>Recorte: 2º turno · {direction === "left" ? "maiores altas da esquerda" : "maiores altas da direita"}</span>
      </div>
    </article>
  );
}

function SwingTooltip({
  active,
  payload,
  direction,
}: {
  active?: boolean;
  payload?: Array<{ payload: MunicipalitySwing }>;
  direction: SwingDirection;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="chart-tooltip swing-tooltip">
      <strong>{row.municipio} · {row.uf}</strong>
      <div><i style={{ backgroundColor: direction === "left" ? COLORS.left : COLORS.right }} />Swing<b>{row.swing > 0 ? "+" : ""}{percentagePoints(row.swing, 2)} p.p.</b></div>
      <div><i style={{ backgroundColor: "#8998ad" }} />Esquerda<b>{percent(row.share2018, 1)} → {percent(row.share2022, 1)}</b></div>
      <div><i style={{ backgroundColor: row.flipped ? COLORS.third : COLORS.teal }} />Status<b>{row.flipped ? "Vira-casaca" : "Manteve lado"}</b></div>
    </div>
  );
}

function MethodologyModal({
  onClose,
  abstentionNote,
  flowNote,
}: {
  onClose: () => void;
  abstentionNote: string;
  flowNote: string;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="methodology-modal" role="dialog" aria-modal="true" aria-labelledby="methodology-title">
        <header className="modal-header">
          <div><span className="modal-kicker"><Info size={13} /> DOCUMENTAÇÃO ANALÍTICA</span><h2 id="methodology-title">Fórmulas &amp; Modelo</h2><p>Definições utilizadas no painel e estrutura das fontes oficiais.</p></div>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="modal-content">
          <section className="formula-section">
            <h3>Fórmulas dos indicadores</h3>
            <div className="formula-grid">
              <FormulaCard number="01" title="Swing eleitoral" formula="Share da Esquerda em 2022 − share em 2018 (p.p.)." detail="Vira-casaca: espectro mais votado no município muda entre as eleições." />
              <FormulaCard number="02" title="Abstenção" formula="Abstenções ÷ eleitorado apto × 100." detail="Brancos e nulos também são apresentados em relação ao eleitorado apto." />
              <FormulaCard number="03" title="Distribuição do voto" formula="Votos do espectro ÷ votos válidos do porte × 100." detail="Agrupamento por porte populacional: <20 mil, 20–100 mil e >100 mil habitantes." />
              <FormulaCard number="04" title="Fluxo da terceira via" formula="(Votos do vencedor no 2ºT − votos no 1ºT) ÷ votos dos demais candidatos no 1ºT × 100." detail="Estimativa agregada territorial; não representa a trajetória individual de eleitores." />
            </div>
          </section>
          <section className="schema-section">
            <h3>Star Schema · modelo analítico</h3>
            <div className="schema-list">
              <SchemaItem name="ft_VotacaoCandidato" detail="Fato de votos nominais por candidato, município, ano e turno." />
              <SchemaItem name="ft_DetalheVotacao" detail="Fato de comparecimento: aptos, abstenções, votos brancos e nulos." />
              <SchemaItem name="dim_Municipio" detail="Dimensão territorial e demográfica: município, UF, região e população." />
              <SchemaItem name="dim_Candidato" detail="Dimensão de candidatos, identificadores e classificação por espectro." />
            </div>
          </section>
          <aside className="methodology-warning"><CircleHelp size={15} /><div><strong>Nota sobre inferência territorial</strong><p>{abstentionNote}</p><p>{flowNote}</p></div></aside>
        </div>
        <footer className="modal-footer"><span><Check size={14} /> Fonte: dados oficiais do Tribunal Superior Eleitoral</span><strong>BACKSTAGE</strong></footer>
      </section>
    </div>
  );
}

function FormulaCard({ number: index, title, formula, detail }: { number: string; title: string; formula: string; detail: string }) {
  return <article className="formula-card"><span>{index}</span><h4>{title}</h4><code>{formula}</code><p>{detail}</p></article>;
}

function SchemaItem({ name, detail }: { name: string; detail: string }) {
  return <div className="schema-item"><Database size={15} /><div><strong>{name}</strong><span>{detail}</span></div></div>;
}

export default App;
