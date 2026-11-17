export type Turn = 1 | 2;
export type BallotRow = {
  municipio: string;
  uf: string | null;
  regiao: string;
  populacao: number | null;
  faixa_populacao: string | null;
  porte_municipio: string | null;
  ano: number;
  turno: Turn;
  aptos: number;
  abstencoes: number;
  taxa_abstencao_pct: number;
  brancos: number;
  nulos: number;
  votos_validos: number;
  votos_esquerda: number;
  votos_direita: number;
  votos_terceira_via: number;
  share_esquerda_pct: number;
  share_direita_pct: number;
  share_terceira_via_pct: number;
  swing_rate_pp: number;
  swing_city: boolean;
  margem_pct: number;
  candidato_vencedor: number;
  candidato_segundo: number;
};
export type SwingCity = {
  municipio: string;
  uf: string | null;
  regiao: string;
  populacao: number | null;
  faixa_populacao: string | null;
  porte_municipio: string | null;
  share_esquerda_pct_2018: number;
  share_esquerda_pct_2022: number;
  swing_rate_pp: number;
  espectro_vencedor_2018: string;
  espectro_vencedor_2022: string;
};
export type CloseRace = {
  municipio: string;
  uf: string | null;
  ano: number;
  regiao: string;
  populacao: number | null;
  faixa_populacao: string | null;
  porte_municipio: string | null;
  margem_pct: number;
  candidato_vencedor: number;
  votos_vencedor: number;
  candidato_segundo: number;
  votos_segundo: number;
};
export type FlowRow = {
  ano: number;
  uf: string | null;
  municipio: string;
  populacao: number | null;
  faixa_populacao: string | null;
  porte_municipio: string | null;
  votos_vencedor_turno_1: number;
  votos_vencedor_turno_2: number;
  votos_terceira_via_turno_1: number;
  ganho_vencedor: number;
  taxa_transferencia_pct: number;
};
export type StateRow = {
  ano: number;
  turno: Turn;
  uf: string;
  aptos: number;
  abstencoes: number;
  brancos: number;
  nulos: number;
  taxa_abstencao_pct: number;
};
export type NationalTotal = {
  ano: number;
  turno: Turn;
  aptos: number;
  abstencoes: number;
  brancos: number;
  nulos: number;
  votos_esquerda: number;
  votos_direita: number;
  votos_terceira_via: number;
  votos_validos: number;
  taxa_abstencao_pct: number;
  share_esquerda_pct: number;
  share_direita_pct: number;
  share_terceira_via_pct: number;
};
export type DemographicRow = {
  ano: number;
  turno: Turn;
  dimensao: string;
  categoria: string;
  espectro: "Esquerda" | "Direita" | "Terceira Via";
  votos: number;
  votos_validos_categoria: number;
  share_categoria_pct: number;
};
export type DashboardData = {
  municipios: BallotRow[];
  swingCities: SwingCity[];
  closeRaces: CloseRace[];
  states: StateRow[];
  totals: NationalTotal[];
  demographics: DemographicRow[];
  flow: FlowRow[];
  abstentionNote: string;
  flowNote: string;
};

type NationalFile = {
  totais_nacionais_por_turno: NationalTotal[];
  swing_cities_2018_vs_2022: SwingCity[];
  distribuicao_demografica_do_voto: DemographicRow[];
  metadata: { observacao_abstencao_por_espectro: string };
};
type StateFile = { estados: StateRow[] };
type MunicipalityFile = {
  municipios: BallotRow[];
  municipios_margem_inferior_3_pct: CloseRace[];
};
type FlowFile = {
  municipios: FlowRow[];
  metadata: { observacao_transferencia?: string };
};

export async function loadDashboardData(): Promise<DashboardData> {
  const [national, states, municipalities, flow] = await Promise.all([
    fetch("/data/resumo_nacional.json").then(readJson<NationalFile>),
    fetch("/data/estados_kpis.json").then(readJson<StateFile>),
    fetch("/data/municipios_kpis.json").then(readJson<MunicipalityFile>),
    fetch("/data/terceira_via_fluxo.json").then(readJson<FlowFile>),
  ]);
  return {
    municipios: municipalities.municipios,
    swingCities: national.swing_cities_2018_vs_2022,
    closeRaces: municipalities.municipios_margem_inferior_3_pct,
    states: states.estados,
    totals: national.totais_nacionais_por_turno,
    demographics: national.distribuicao_demografica_do_voto,
    flow: flow.municipios,
    abstentionNote: national.metadata.observacao_abstencao_por_espectro,
    flowNote:
      flow.metadata.observacao_transferencia ??
      "Estimativa ecológica do ganho do vencedor frente aos votos da terceira via; não identifica transferências individuais.",
  };
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Falha ao carregar dados eleitorais: ${response.url} (${response.status})`);
  }
  return response.json() as Promise<T>;
}
