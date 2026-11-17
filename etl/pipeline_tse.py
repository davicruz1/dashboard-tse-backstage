#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gera os indicadores eleitorais TSE 2018/2022 para o dashboard."""

from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import chardet
import duckdb
import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "dadoss"
OUTPUT_DIR = ROOT_DIR / "dashboard" / "public" / "data"

VOTE_FILES = {
    2018: "votacao_candidato_munzona_2018_BR.csv",
    2022: "votacao_candidato_munzona_2022_BR.csv",
}
DETAIL_FILES = {
    2018: "detalhe_votacao_munzona_2018_BR.csv",
    2022: "detalhe_votacao_munzona_2022_BR.csv",
}
LEFT_CANDIDATE = 13
RIGHT_CANDIDATE = {2018: 17, 2022: 22}
RUNOFF_WINNER = {2018: 17, 2022: 13}
RUNOFF_RUNNER_UP = {2018: 13, 2022: 22}
POPULATION_BANDS = ("<20k hab", "20k-100k hab", ">100k hab")
CITY_SIZES = ("Micro", "Pequeno", "Médio", "Grande")
UF_CODES = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
    "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
    "RR", "SC", "SP", "SE", "TO",
}
REGIONS = {
    "AC": "Norte", "AP": "Norte", "AM": "Norte", "PA": "Norte",
    "RO": "Norte", "RR": "Norte", "TO": "Norte",
    "AL": "Nordeste", "BA": "Nordeste", "CE": "Nordeste", "MA": "Nordeste",
    "PB": "Nordeste", "PE": "Nordeste", "PI": "Nordeste", "RN": "Nordeste",
    "SE": "Nordeste",
    "DF": "Centro-Oeste", "GO": "Centro-Oeste", "MT": "Centro-Oeste",
    "MS": "Centro-Oeste",
    "ES": "Sudeste", "MG": "Sudeste", "RJ": "Sudeste", "SP": "Sudeste",
    "PR": "Sul", "RS": "Sul", "SC": "Sul",
}
CITY_KEYS = ["ano", "turno", "mun_key", "uf"]


def normalize_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(value))
    without_accents = "".join(
        char for char in decomposed if not unicodedata.combining(char)
    )
    return re.sub(r"[^A-Z0-9]", "", without_accents.upper())


def population_key(value: str) -> tuple[str, str] | None:
    match = re.search(r"\(([A-Za-z]{2})\)\s*$", str(value).strip())
    if not match:
        return None
    uf = match.group(1).upper()
    if uf not in UF_CODES:
        return None
    municipality = str(value).strip()[: match.start()].strip()
    return normalize_name(municipality), uf


def detect_population_csv(path: Path) -> tuple[list[dict[str, Any]], str, str]:
    raw = path.read_bytes()
    detected = chardet.detect(raw[:100_000]).get("encoding")
    encodings = list(dict.fromkeys([detected, "utf-8-sig", "cp1252", "latin-1"]))
    text = None
    encoding = None
    for candidate in encodings:
        if not candidate:
            continue
        try:
            text = raw.decode(candidate)
            encoding = candidate
            break
        except UnicodeDecodeError:
            continue
    if text is None or encoding is None:
        raise UnicodeError(f"Não foi possível detectar o encoding de {path}.")

    lines = text.splitlines()
    if len(lines) < 4:
        raise ValueError(f"Arquivo de população sem linhas suficientes: {path}.")

    candidates = (";", ",", "\t")
    scores = {
        separator: sum(
            1 for line in lines[2:15] if line.count(separator) >= 1
        )
        for separator in candidates
    }
    separator = max(scores, key=scores.get)
    rows = list(csv.reader(lines, delimiter=separator))

    header_index = None
    for index, row in enumerate(rows):
        if len(row) < 2:
            continue
        first = normalize_name(row[0])
        second = row[1].strip().strip('"')
        if "MUNICIPIO" in first and second.isdigit() and len(second) == 4:
            header_index = index
            break
    if header_index is None:
        raise ValueError(
            "Não foi possível identificar a linha de cabeçalho de municípios "
            f"em {path} (encoding detectado: {encoding})."
        )

    records: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows[header_index + 1 :]:
        if len(row) < 2:
            continue
        key = population_key(row[0])
        digits = re.sub(r"\D", "", row[1])
        if key is None or not digits:
            continue
        if key in seen:
            raise ValueError(
                f"Município duplicado na base de população: chave {key!r}."
            )
        seen.add(key)
        records.append(
            {"mun_key": key[0], "uf": key[1], "populacao": int(digits)}
        )
    if not records:
        raise ValueError(f"Nenhum município válido encontrado em {path}.")
    return records, encoding, separator


def geography_aliases(
    details: pd.DataFrame, population: pd.DataFrame
) -> tuple[dict[tuple[str, str], tuple[str, str]], int, int]:
    population_keys = set(
        population[["uf", "mun_key"]].itertuples(index=False, name=None)
    )
    locations_by_year = {
        int(year): set(
            group.loc[group["uf"] != "ZZ", ["uf", "mun_key"]].itertuples(
                index=False, name=None
            )
        )
        for year, group in details.groupby("ano")
    }
    old_only = locations_by_year[2018] - locations_by_year[2022]
    new_only = locations_by_year[2022] - locations_by_year[2018]
    aliases: dict[tuple[str, str], tuple[str, str]] = {}

    # When one election's label is an exact IBGE match and the other election
    # has the only unmatched label in that UF, use the exact label as canonical.
    for uf in sorted({state for state, _ in old_only | new_only}):
        old_names = [name for state, name in old_only if state == uf]
        new_names = [name for state, name in new_only if state == uf]
        if len(old_names) != 1 or len(new_names) != 1:
            continue
        old_key = (uf, old_names[0])
        new_key = (uf, new_names[0])
        if old_key in population_keys and new_key not in population_keys:
            aliases[new_key] = old_key
        elif new_key in population_keys and old_key not in population_keys:
            aliases[old_key] = new_key

    all_source_keys = locations_by_year[2018] | locations_by_year[2022]
    reserved_targets = (
        population_keys.intersection(all_source_keys) | set(aliases.values())
    )
    paired_alias_count = len(aliases)
    proposals: list[
        tuple[float, float, tuple[str, str], tuple[str, str]]
    ] = []
    for source in sorted(all_source_keys - population_keys - aliases.keys()):
        candidates = sorted(
            (
                SequenceMatcher(None, source[1], target[1]).ratio(),
                target,
            )
            for target in population_keys
            if target[0] == source[0] and target not in reserved_targets
        )
        candidates.reverse()
        if not candidates:
            continue
        best_score, best_target = candidates[0]
        second_score = candidates[1][0] if len(candidates) > 1 else 0.0
        margin = best_score - second_score
        if best_score >= 0.90 and margin >= 0.08:
            proposals.append((best_score, margin, source, best_target))

    claimed_targets = set(reserved_targets)
    fuzzy_alias_count = 0
    for _, _, source, target in sorted(
        proposals, key=lambda proposal: (-proposal[0], -proposal[1], proposal[2])
    ):
        if target in claimed_targets:
            continue
        aliases[source] = target
        claimed_targets.add(target)
        fuzzy_alias_count += 1
    return aliases, paired_alias_count, fuzzy_alias_count


def sql_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "''")


def read_election_file(
    connection: duckdb.DuckDBPyConnection, path: Path, year: int, kind: str
) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Arquivo obrigatório não encontrado: {path}")
    source = f"read_csv_auto('{sql_path(path)}', delim=';', encoding='latin-1', all_varchar=true, header=true)"
    if kind == "votes":
        query = f"""
            SELECT
                TRY_CAST(ANO_ELEICAO AS INTEGER) AS ano,
                TRY_CAST(NR_TURNO AS INTEGER) AS turno,
                UPPER(TRIM(SG_UF)) AS uf,
                TRIM(NM_MUNICIPIO) AS municipio,
                TRY_CAST(NR_CANDIDATO AS INTEGER) AS candidato,
                COALESCE(
                    TRY_CAST(NULLIF(TRIM(QT_VOTOS_NOMINAIS), '') AS BIGINT), 0
                ) AS votos_nominais,
                COALESCE(
                    TRY_CAST(NULLIF(TRIM(QT_VOTOS_NOMINAIS_VALIDOS), '') AS BIGINT),
                    TRY_CAST(NULLIF(TRIM(QT_VOTOS_NOMINAIS), '') AS BIGINT),
                    0
                ) AS votos_validos
            FROM {source}
            WHERE TRY_CAST(CD_CARGO AS INTEGER) = 1
              AND TRY_CAST(NR_TURNO AS INTEGER) IN (1, 2)
              AND TRY_CAST(ANO_ELEICAO AS INTEGER) = {year}
              AND TRY_CAST(NR_CANDIDATO AS INTEGER) IS NOT NULL
        """
    else:
        query = f"""
            SELECT
                TRY_CAST(ANO_ELEICAO AS INTEGER) AS ano,
                TRY_CAST(NR_TURNO AS INTEGER) AS turno,
                UPPER(TRIM(SG_UF)) AS uf,
                TRIM(NM_MUNICIPIO) AS municipio,
                COALESCE(TRY_CAST(NULLIF(TRIM(QT_APTOS), '') AS BIGINT), 0) AS aptos,
                COALESCE(TRY_CAST(NULLIF(TRIM(QT_ABSTENCOES), '') AS BIGINT), 0) AS abstencoes,
                COALESCE(TRY_CAST(NULLIF(TRIM(QT_VOTOS_BRANCOS), '') AS BIGINT), 0) AS brancos,
                COALESCE(
                    TRY_CAST(NULLIF(TRIM(QT_TOTAL_VOTOS_NULOS), '') AS BIGINT),
                    TRY_CAST(NULLIF(TRIM(QT_VOTOS_NULOS), '') AS BIGINT),
                    0
                ) AS nulos
            FROM {source}
            WHERE TRY_CAST(CD_CARGO AS INTEGER) = 1
              AND TRY_CAST(NR_TURNO AS INTEGER) IN (1, 2)
              AND TRY_CAST(ANO_ELEICAO AS INTEGER) = {year}
        """
    frame = connection.execute(query).df()
    if frame.empty:
        raise ValueError(f"Nenhum registro de presidente/turnos 1 e 2: {path}")
    frame["mun_key"] = frame["municipio"].map(normalize_name)
    frame["uf"] = frame["uf"].astype(str).str.upper().str.strip()
    if kind == "votes":
        grouped = frame.groupby(
            ["ano", "turno", "mun_key", "uf", "candidato"], as_index=False
        ).agg(
            municipio=("municipio", "first"),
            votos_nominais=("votos_nominais", "sum"),
            votos_validos=("votos_validos", "sum"),
        )
    else:
        grouped = frame.groupby(
            ["ano", "turno", "mun_key", "uf"], as_index=False
        ).agg(
            municipio=("municipio", "first"),
            aptos=("aptos", "sum"),
            abstencoes=("abstencoes", "sum"),
            brancos=("brancos", "sum"),
            nulos=("nulos", "sum"),
        )
    return grouped


def population_band(population: int) -> str:
    if population < 20_000:
        return POPULATION_BANDS[0]
    if population <= 100_000:
        return POPULATION_BANDS[1]
    return POPULATION_BANDS[2]


def city_size(population: int) -> str:
    if population < 20_000:
        return CITY_SIZES[0]
    if population < 50_000:
        return CITY_SIZES[1]
    if population <= 100_000:
        return CITY_SIZES[2]
    return CITY_SIZES[3]


def spectrum_for(candidate: int, year: int) -> str:
    if candidate == LEFT_CANDIDATE:
        return "Esquerda"
    if candidate == RIGHT_CANDIDATE[year]:
        return "Direita"
    return "Terceira Via/Outros"


def pct(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return numerator / denominator * 100


def safe_value(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if pd.isna(value):
        return None
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return round(value, 4)
    return value


def records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [
        {column: safe_value(value) for column, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def top_two(
    candidates: pd.DataFrame, group_columns: list[str]
) -> pd.DataFrame:
    ordered = candidates.sort_values(
        group_columns + ["votos_validos", "candidato"],
        ascending=[True] * len(group_columns) + [False, True],
    ).copy()
    ordered["posicao"] = ordered.groupby(group_columns).cumcount() + 1
    top = ordered[ordered["posicao"] <= 2]
    votes = top.pivot(
        index=group_columns, columns="posicao", values="votos_validos"
    ).rename(columns={1: "votos_vencedor", 2: "votos_segundo"})
    numbers = top.pivot(
        index=group_columns, columns="posicao", values="candidato"
    ).rename(columns={1: "candidato_vencedor", 2: "candidato_segundo"})
    total = candidates.groupby(group_columns)["votos_validos"].sum().rename(
        "votos_validos_total"
    )
    result = pd.concat([votes, numbers, total], axis=1).reset_index()
    result["margem_pct"] = (
        (result["votos_vencedor"] - result["votos_segundo"])
        / result["votos_validos_total"].replace(0, pd.NA)
        * 100
    )
    return result


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    required = [
        DATA_DIR / filename
        for filename in (
            *VOTE_FILES.values(),
            *DETAIL_FILES.values(),
            "municipiospop.csv",
        )
    ]
    missing = [path for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            "Arquivos obrigatórios ausentes: " + ", ".join(map(str, missing))
        )

    population_rows, population_encoding, population_separator = (
        detect_population_csv(DATA_DIR / "municipiospop.csv")
    )
    population = pd.DataFrame(population_rows)
    population["faixa_populacao"] = population["populacao"].map(population_band)
    population["porte_municipio"] = population["populacao"].map(city_size)

    connection = duckdb.connect(database=":memory:")
    votes = pd.concat(
        [
            read_election_file(
                connection, DATA_DIR / filename, year, "votes"
            )
            for year, filename in VOTE_FILES.items()
        ],
        ignore_index=True,
    )
    details = pd.concat(
        [
            read_election_file(
                connection, DATA_DIR / filename, year, "details"
            )
            for year, filename in DETAIL_FILES.items()
        ],
        ignore_index=True,
    )
    connection.close()

    aliases, paired_alias_count, fuzzy_alias_count = geography_aliases(
        details, population
    )
    for frame in (details, votes):
        keys = zip(frame["uf"], frame["mun_key"])
        frame["mun_key"] = [
            aliases.get(key, key)[1] for key in keys
        ]

    population_keys = population[["mun_key", "uf", "populacao", "faixa_populacao", "porte_municipio"]]
    detail_rows = details.merge(
        population_keys, on=["mun_key", "uf"], how="left", validate="many_to_one"
    )
    vote_rows = votes.merge(
        population_keys, on=["mun_key", "uf"], how="left", validate="many_to_one"
    )
    unmatched_details = int(detail_rows["populacao"].isna().sum())
    unmatched_votes = int(vote_rows["populacao"].isna().sum())
    def unmatched_by_uf(frame: pd.DataFrame) -> list[dict[str, Any]]:
        unmatched = frame[frame["populacao"].isna()]
        if unmatched.empty:
            return []
        grouped = unmatched.groupby(["ano", "uf"], as_index=False).agg(
            registros_agregados=("mun_key", "size"),
            localidades=("mun_key", "nunique"),
        )
        return records(grouped)

    unmatched_details_by_uf = unmatched_by_uf(detail_rows)
    unmatched_votes_by_uf = unmatched_by_uf(vote_rows)
    detail_rows = detail_rows[detail_rows["uf"] != "ZZ"].copy()
    vote_rows = vote_rows[vote_rows["uf"] != "ZZ"].copy()
    if detail_rows.empty or vote_rows.empty:
        raise ValueError(
            "Não há registros eleitorais de municípios brasileiros após "
            "excluir localidades no exterior (UF ZZ)."
        )
    detail_rows["populacao"] = detail_rows["populacao"].astype("Int64")
    vote_rows["populacao"] = vote_rows["populacao"].astype("Int64")
    unknown_population = (
        detail_rows[detail_rows["populacao"].isna()]
        .groupby("ano")["mun_key"]
        .nunique()
        .to_dict()
    )
    vote_rows["espectro"] = vote_rows.apply(
        lambda row: spectrum_for(int(row["candidato"]), int(row["ano"])), axis=1
    )

    city_votes = vote_rows.groupby(
        ["ano", "turno", "mun_key", "uf", "espectro"], as_index=False
    ).agg(
        votos_nominais=("votos_nominais", "sum"),
        votos_validos=("votos_validos", "sum"),
    )
    wide_votes = city_votes.pivot_table(
        index=CITY_KEYS,
        columns="espectro",
        values="votos_validos",
        aggfunc="sum",
        fill_value=0,
    ).reset_index()
    wide_votes.columns.name = None
    for spectrum, column in (
        ("Esquerda", "votos_esquerda"),
        ("Direita", "votos_direita"),
        ("Terceira Via/Outros", "votos_terceira_via"),
    ):
        if spectrum not in wide_votes:
            wide_votes[spectrum] = 0
        wide_votes = wide_votes.rename(columns={spectrum: column})

    city_rows = detail_rows.merge(
        wide_votes, on=CITY_KEYS, how="left", validate="one_to_one"
    )
    for column in ("votos_esquerda", "votos_direita", "votos_terceira_via"):
        city_rows[column] = city_rows[column].fillna(0).astype("int64")
    city_rows["votos_validos"] = city_rows[
        ["votos_esquerda", "votos_direita", "votos_terceira_via"]
    ].sum(axis=1)
    city_rows["taxa_abstencao_pct"] = (
        city_rows["abstencoes"] / city_rows["aptos"].replace(0, pd.NA) * 100
    )
    city_rows["regiao"] = city_rows["uf"].map(REGIONS)
    if city_rows["regiao"].isna().any():
        raise ValueError("Há município com UF sem região geográfica definida.")

    candidate_rows = vote_rows.groupby(
        ["ano", "turno", "mun_key", "uf", "candidato"], as_index=False
    ).agg(
        municipio=("municipio", "first"),
        votos_nominais=("votos_nominais", "sum"),
        votos_validos=("votos_validos", "sum"),
    )
    city_dim = detail_rows.groupby(["mun_key", "uf"], as_index=False).agg(
        municipio=("municipio", "first"),
        populacao=("populacao", "first"),
        faixa_populacao=("faixa_populacao", "first"),
        porte_municipio=("porte_municipio", "first"),
        regiao=("uf", lambda values: REGIONS[values.iloc[0]]),
    )

    # Swing uses valid-vote shares in each municipality's second round.
    runoff = city_rows[city_rows["turno"] == 2].copy()
    runoff["share_esquerda_pct"] = (
        runoff["votos_esquerda"]
        / runoff["votos_validos"].replace(0, pd.NA)
        * 100
    )
    runoff["espectro_vencedor"] = runoff.apply(
        lambda row: "Esquerda"
        if row["votos_esquerda"] >= row["votos_direita"]
        else "Direita",
        axis=1,
    )
    swing_fields = runoff.pivot(
        index=["mun_key", "uf"], columns="ano",
        values=["share_esquerda_pct", "espectro_vencedor"],
    )
    swing_fields.columns = [
        f"{field}_{year}" for field, year in swing_fields.columns
    ]
    swing_fields = swing_fields.reset_index().merge(
        city_dim, on=["mun_key", "uf"], how="left", validate="one_to_one"
    )
    swing_fields["swing_rate_pp"] = (
        swing_fields["share_esquerda_pct_2022"]
        - swing_fields["share_esquerda_pct_2018"]
    )
    swing_fields["swing_city"] = (
        swing_fields["espectro_vencedor_2018"]
        != swing_fields["espectro_vencedor_2022"]
    )

    national_rows: list[dict[str, Any]] = []
    for (year, turn), group in city_rows.groupby(["ano", "turno"]):
        totals = group[[
            "aptos", "abstencoes", "brancos", "nulos", "votos_esquerda",
            "votos_direita", "votos_terceira_via", "votos_validos",
        ]].sum()
        national_rows.append({
            "ano": int(year),
            "turno": int(turn),
            **{name: int(value) for name, value in totals.items()},
            "taxa_abstencao_pct": pct(totals["abstencoes"], totals["aptos"]),
            "share_esquerda_pct": pct(totals["votos_esquerda"], totals["votos_validos"]),
            "share_direita_pct": pct(totals["votos_direita"], totals["votos_validos"]),
            "share_terceira_via_pct": pct(totals["votos_terceira_via"], totals["votos_validos"]),
        })
    national_frame = pd.DataFrame(national_rows)
    national_delta: list[dict[str, Any]] = []
    for turn in (1, 2):
        period = national_frame[national_frame["turno"] == turn].set_index("ano")
        rate_2018 = period.loc[2018, "taxa_abstencao_pct"]
        rate_2022 = period.loc[2022, "taxa_abstencao_pct"]
        national_delta.append({
            "turno": turn,
            "abstencao_2018_pct": safe_value(rate_2018),
            "abstencao_2022_pct": safe_value(rate_2022),
            "delta_abstencao_pp": safe_value(rate_2022 - rate_2018),
        })

    # This is an ecological proxy: municipalities are grouped by their 2018
    # leading spectrum; aggregate data cannot identify an absent voter's choice.
    city_rows["espectro_majoritario"] = city_rows.apply(
        lambda row: max(
            ("Esquerda", "Direita", "Terceira Via/Outros"),
            key=lambda key: row[{
                "Esquerda": "votos_esquerda",
                "Direita": "votos_direita",
                "Terceira Via/Outros": "votos_terceira_via",
            }[key]],
        ),
        axis=1,
    )
    baseline_leader = city_rows[city_rows["ano"] == 2018][
        ["turno", "mun_key", "uf", "espectro_majoritario"]
    ].rename(columns={"espectro_majoritario": "espectro_majoritario_2018"})
    spectrum_deltas: list[dict[str, Any]] = []
    for turn in (1, 2):
        by_city = city_rows[city_rows["turno"] == turn].merge(
            baseline_leader[baseline_leader["turno"] == turn],
            on=["turno", "mun_key", "uf"],
            how="inner",
            validate="many_to_one",
        )
        for spectrum, group in by_city.groupby("espectro_majoritario_2018"):
            yearly = group.groupby("ano").agg(
                aptos=("aptos", "sum"), abstencoes=("abstencoes", "sum")
            )
            if 2018 not in yearly.index or 2022 not in yearly.index:
                continue
            rate_2018 = pct(yearly.loc[2018, "abstencoes"], yearly.loc[2018, "aptos"])
            rate_2022 = pct(yearly.loc[2022, "abstencoes"], yearly.loc[2022, "aptos"])
            spectrum_deltas.append({
                "turno": int(turn),
                "espectro_majoritario_2018": spectrum,
                "abstencao_2018_pct": rate_2018,
                "abstencao_2022_pct": rate_2022,
                "delta_abstencao_pp": (
                    rate_2022 - rate_2018
                    if rate_2018 is not None and rate_2022 is not None
                    else None
                ),
                "municipios": int(group["mun_key"].nunique()),
            })

    demographic_rows: list[dict[str, Any]] = []
    for dimension in ("faixa_populacao", "porte_municipio"):
        grouped = city_rows.groupby(
            ["ano", "turno", dimension], as_index=False
        ).agg(
            votos_esquerda=("votos_esquerda", "sum"),
            votos_direita=("votos_direita", "sum"),
            votos_terceira_via=("votos_terceira_via", "sum"),
            votos_validos=("votos_validos", "sum"),
        )
        for row in grouped.to_dict(orient="records"):
            for spectrum, column in (
                ("Esquerda", "votos_esquerda"),
                ("Direita", "votos_direita"),
                ("Terceira Via/Outros", "votos_terceira_via"),
            ):
                demographic_rows.append({
                    "ano": int(row["ano"]),
                    "turno": int(row["turno"]),
                    "dimensao": dimension,
                    "categoria": row[dimension],
                    "espectro": spectrum,
                    "votos": int(row[column]),
                    "votos_validos_categoria": int(row["votos_validos"]),
                    "share_categoria_pct": pct(row[column], row["votos_validos"]),
                })

    state_rows = city_rows.groupby(
        ["ano", "turno", "uf", "regiao"], as_index=False
    ).agg(
        aptos=("aptos", "sum"),
        abstencoes=("abstencoes", "sum"),
        brancos=("brancos", "sum"),
        nulos=("nulos", "sum"),
        votos_esquerda=("votos_esquerda", "sum"),
        votos_direita=("votos_direita", "sum"),
        votos_terceira_via=("votos_terceira_via", "sum"),
        votos_validos=("votos_validos", "sum"),
    )
    state_rows["taxa_abstencao_pct"] = (
        state_rows["abstencoes"] / state_rows["aptos"].replace(0, pd.NA) * 100
    )
    state_candidates = candidate_rows[candidate_rows["turno"] == 2].groupby(
        ["ano", "uf", "candidato"], as_index=False
    ).agg(votos_validos=("votos_validos", "sum"))
    state_margins = top_two(state_candidates, ["ano", "uf"])
    state_second = state_rows[state_rows["turno"] == 2].merge(
        state_margins, on=["ano", "uf"], how="left", validate="one_to_one"
    )
    state_second["margem_media_historica_pct"] = state_second.groupby("uf")[
        "margem_pct"
    ].transform("mean")
    state_second["margem_inferior_3_pct"] = state_second["margem_pct"] < 3

    rankings: dict[str, list[dict[str, Any]]] = {}
    for year, turn in sorted(
        state_rows[["ano", "turno"]].drop_duplicates().itertuples(index=False, name=None)
    ):
        subset = state_rows[
            (state_rows["ano"] == year) & (state_rows["turno"] == turn)
        ].copy()
        for key, column, order in (
            ("abstencao", "taxa_abstencao_pct", False),
            ("brancos", "brancos", False),
            ("nulos", "nulos", False),
        ):
            ranked = subset.sort_values(column, ascending=order).copy()
            ranked.insert(0, "ranking", range(1, len(ranked) + 1))
            rankings[f"{year}_turno_{turn}_{key}"] = records(
                ranked[["ranking", "uf", "regiao", column]]
            )

    # Narrow-margin cities and states are based on second-round valid votes.
    city_second_candidates = candidate_rows[candidate_rows["turno"] == 2]
    city_margins = top_two(city_second_candidates, ["ano", "mun_key", "uf"])
    city_margins = city_margins.merge(
        city_dim, on=["mun_key", "uf"], how="left", validate="many_to_one"
    )
    close_city_rows = city_margins[city_margins["margem_pct"] < 3].copy()
    close_state_rows = state_second[state_second["margem_pct"] < 3].copy()

    # Third-party transfer proxy: the eventual national winner's runoff gain
    # divided by first-round votes for candidates outside the two finalists.
    transfer_rows: list[dict[str, Any]] = []
    for year in (2018, 2022):
        winner = RUNOFF_WINNER[year]
        runner_up = RUNOFF_RUNNER_UP[year]
        year_votes = candidate_rows[candidate_rows["ano"] == year]
        first = year_votes[year_votes["turno"] == 1].copy()
        second = year_votes[
            (year_votes["turno"] == 2) & (year_votes["candidato"] == winner)
        ][["mun_key", "uf", "votos_nominais"]].rename(
            columns={"votos_nominais": "votos_vencedor_turno_2"}
        )
        winner_first = first[first["candidato"] == winner][
            ["mun_key", "uf", "votos_nominais"]
        ].rename(columns={"votos_nominais": "votos_vencedor_turno_1"})
        orphan_votes = first[
            ~first["candidato"].isin([winner, runner_up])
        ].groupby(["mun_key", "uf"], as_index=False).agg(
            votos_terceira_via_turno_1=("votos_nominais", "sum")
        )
        transfer = winner_first.merge(
            second, on=["mun_key", "uf"], how="outer", validate="one_to_one"
        ).merge(
            orphan_votes, on=["mun_key", "uf"], how="left", validate="one_to_one"
        ).merge(
            city_dim, on=["mun_key", "uf"], how="left", validate="one_to_one"
        )
        transfer = transfer.dropna(subset=["municipio"])
        for column in (
            "votos_vencedor_turno_1", "votos_vencedor_turno_2",
            "votos_terceira_via_turno_1",
        ):
            transfer[column] = transfer[column].fillna(0).astype("int64")
        transfer["ganho_vencedor"] = (
            transfer["votos_vencedor_turno_2"]
            - transfer["votos_vencedor_turno_1"]
        )
        transfer["taxa_transferencia_pct"] = (
            transfer["ganho_vencedor"]
            / transfer["votos_terceira_via_turno_1"].replace(0, pd.NA)
            * 100
        )
        transfer.insert(0, "ano", year)
        transfer.insert(1, "candidato_vencedor", winner)
        transfer.insert(2, "espectro_vencedor", spectrum_for(winner, year))
        transfer_rows.extend(records(transfer))
    transfer_frame = pd.DataFrame(transfer_rows)
    transfer_national: list[dict[str, Any]] = []
    for year, group in transfer_frame.groupby("ano"):
        gain = int(group["ganho_vencedor"].sum())
        orphan = int(group["votos_terceira_via_turno_1"].sum())
        transfer_national.append({
            "ano": int(year),
            "candidato_vencedor": RUNOFF_WINNER[int(year)],
            "espectro_vencedor": spectrum_for(
                RUNOFF_WINNER[int(year)], int(year)
            ),
            "votos_vencedor_turno_1": int(group["votos_vencedor_turno_1"].sum()),
            "votos_vencedor_turno_2": int(group["votos_vencedor_turno_2"].sum()),
            "ganho_vencedor": gain,
            "votos_terceira_via_turno_1": orphan,
            "taxa_transferencia_pct": pct(gain, orphan),
        })

    swing_city_records = records(
        swing_fields[swing_fields["swing_city"]].sort_values(
            "swing_rate_pp", key=lambda series: series.abs(), ascending=False
        )[
            [
                "municipio", "uf", "regiao", "populacao", "faixa_populacao",
                "porte_municipio", "share_esquerda_pct_2018",
                "share_esquerda_pct_2022", "swing_rate_pp",
                "espectro_vencedor_2018", "espectro_vencedor_2022",
            ]
        ]
    )
    national_2018 = national_frame[
        (national_frame["ano"] == 2018) & (national_frame["turno"] == 2)
    ].iloc[0]
    national_2022 = national_frame[
        (national_frame["ano"] == 2022) & (national_frame["turno"] == 2)
    ].iloc[0]
    national_share_2018 = pct(
        national_2018["votos_esquerda"], national_2018["votos_validos"]
    )
    national_share_2022 = pct(
        national_2022["votos_esquerda"], national_2022["votos_validos"]
    )
    national_swing = {
        "share_esquerda_2018_pct": national_share_2018,
        "share_esquerda_2022_pct": national_share_2022,
        "swing_rate_pp": (
            national_share_2022 - national_share_2018
            if national_share_2018 is not None and national_share_2022 is not None
            else None
        ),
        "municipios_comparados": int(swing_fields["swing_rate_pp"].notna().sum()),
        "swing_cities": int(swing_fields["swing_city"].sum()),
        "swing_cities_detalhe": swing_city_records,
    }
    municipality_turns = city_rows.merge(
        city_dim[["mun_key", "uf", "municipio", "populacao", "faixa_populacao", "porte_municipio"]],
        on=["mun_key", "uf"],
        how="left",
        suffixes=("", "_dim"),
        validate="many_to_one",
    )
    municipality_turns["share_esquerda_pct"] = (
        municipality_turns["votos_esquerda"]
        / municipality_turns["votos_validos"].replace(0, pd.NA)
        * 100
    )
    municipality_turns["share_direita_pct"] = (
        municipality_turns["votos_direita"]
        / municipality_turns["votos_validos"].replace(0, pd.NA)
        * 100
    )
    municipality_turns["share_terceira_via_pct"] = (
        municipality_turns["votos_terceira_via"]
        / municipality_turns["votos_validos"].replace(0, pd.NA)
        * 100
    )
    municipality_turns = municipality_turns.merge(
        swing_fields[
            [
                "mun_key", "uf", "swing_rate_pp", "swing_city",
                "espectro_vencedor_2018", "espectro_vencedor_2022",
            ]
        ],
        on=["mun_key", "uf"],
        how="left",
        validate="many_to_one",
    )
    municipality_turns = municipality_turns.merge(
        city_margins[
            ["ano", "mun_key", "uf", "margem_pct", "candidato_vencedor", "candidato_segundo"]
        ],
        on=["ano", "mun_key", "uf"],
        how="left",
        validate="many_to_one",
    )
    municipality_columns = [
        "municipio", "uf", "regiao", "populacao", "faixa_populacao",
        "porte_municipio", "ano", "turno", "aptos", "abstencoes",
        "taxa_abstencao_pct", "brancos", "nulos", "votos_validos",
        "votos_esquerda", "votos_direita", "votos_terceira_via",
        "share_esquerda_pct", "share_direita_pct",
        "share_terceira_via_pct", "swing_rate_pp", "swing_city",
        "espectro_vencedor_2018", "espectro_vencedor_2022", "margem_pct",
        "candidato_vencedor", "candidato_segundo",
    ]
    municipality_turns = municipality_turns[municipality_columns]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    metadata = {
        "eleicoes": [2018, 2022],
        "cargo": "Presidente",
        "populacao_fonte": "municipiospop.csv",
        "populacao_encoding_detectado": population_encoding,
        "populacao_separador_detectado": population_separator,
        "municipios_ibge_com_populacao": int(len(population)),
        "registros_agregados_tse_sem_match_ibge": {
            "detalhe": unmatched_details,
            "votacao_nominal": unmatched_votes,
        },
        "localidades_sem_match_ibge_por_uf": {
            "detalhe": unmatched_details_by_uf,
            "votacao_nominal": unmatched_votes_by_uf,
        },
        "municipios_comparaveis_swing": int(
            swing_fields["swing_rate_pp"].notna().sum()
        ),
        "aliases_geograficos_aplicados": {
            "divergencia_entre_eleicoes_com_match_ibge": paired_alias_count,
            "match_fuzzy_unico_alta_confianca": fuzzy_alias_count,
        },
        "municipios_sem_classificacao_populacional_por_ano": {
            str(year): int(count) for year, count in unknown_population.items()
        },
        "politica_cruzamento_geografico": (
            "Chave Município + UF normalizada (sem acentos, em caixa alta), "
            "com alias entre anos quando há correspondência IBGE exata e fuzzy "
            "somente quando a melhor similaridade e a margem para a segunda opção "
            "são >=0,90 e >=0,08. "
            "Registros sem população IBGE continuam nos totais eleitorais, "
            "rankings e margens, mas ficam fora dos recortes demográficos. "
            "UF ZZ corresponde a localidades no exterior e fica fora do escopo."
        ),
        "criterios_porte": {
            "Micro": "<20.000 habitantes",
            "Pequeno": "20.000 a 49.999 habitantes",
            "Médio": "50.000 a 100.000 habitantes",
            "Grande": ">100.000 habitantes",
        },
        "criterios_faixa_populacional": {
            "<20k hab": "<20.000 habitantes",
            "20k-100k hab": "20.000 a 100.000 habitantes",
            ">100k hab": ">100.000 habitantes",
        },
        "observacao_abstencao_por_espectro": (
            "A taxa de abstenção é do município, não de eleitores individuais. "
            "O recorte por espectro agrupa municípios pelo espectro majoritário "
            "em 2018 e não permite inferência causal individual."
        ),
        "observacao_transferencia": (
            "Taxa = (votos do vencedor no 2º turno - votos do vencedor no 1º turno) "
            "/ votos de candidatos fora dos dois finalistas no 1º turno. "
            "Vencedor considerado: candidato 17 em 2018 e 13 em 2022."
        ),
        "unidade_percentual": "Campos *_pct são percentuais; *_pp são pontos percentuais.",
    }
    national_payload = {
        "metadata": metadata,
        "totais_nacionais_por_turno": records(national_frame),
        "swing_rate": national_swing,
        "swing_cities_2018_vs_2022": swing_city_records,
        "delta_abstencao_historica_por_turno": national_delta,
        "delta_abstencao_por_turno_e_espectro_majoritario_2018": spectrum_deltas,
        "distribuicao_demografica_do_voto": demographic_rows,
        "municipios_margem_inferior_3_pct": records(
            close_city_rows.sort_values("margem_pct")[
                [
                    "municipio", "uf", "ano", "regiao", "populacao",
                    "margem_pct", "candidato_vencedor", "votos_vencedor",
                    "candidato_segundo", "votos_segundo",
                ]
            ]
        ),
        "estados_margem_inferior_3_pct": records(
            close_state_rows.sort_values("margem_pct")[
                [
                    "uf", "regiao", "ano", "margem_pct",
                    "margem_media_historica_pct", "candidato_vencedor",
                    "votos_vencedor", "candidato_segundo", "votos_segundo",
                ]
            ]
        ),
    }
    states_payload = {
        "metadata": metadata,
        "estados": records(state_second.sort_values(["ano", "uf"])),
        "rankings_por_ano_e_turno": rankings,
        "estados_margem_inferior_3_pct": records(
            close_state_rows.sort_values(["margem_pct", "uf"])[
                [
                    "uf", "regiao", "ano", "margem_pct",
                    "margem_media_historica_pct", "candidato_vencedor",
                    "votos_vencedor", "candidato_segundo", "votos_segundo",
                ]
            ]
        ),
    }
    municipalities_payload = {
        "metadata": metadata,
        "municipios": records(
            municipality_turns.sort_values(["uf", "municipio", "ano", "turno"])
        ),
        "swing_cities_2018_vs_2022": swing_city_records,
        "municipios_margem_inferior_3_pct": records(
            close_city_rows.sort_values(["margem_pct", "uf", "municipio"])[
                [
                    "municipio", "uf", "regiao", "ano", "populacao",
                    "faixa_populacao", "porte_municipio", "margem_pct",
                    "candidato_vencedor", "votos_vencedor",
                    "candidato_segundo", "votos_segundo",
                ]
            ]
        ),
    }
    transfer_payload = {
        "metadata": metadata,
        "formula": (
            "(votos do candidato vencedor no 2º turno - votos do vencedor no 1º turno) "
            "/ votos dos candidatos fora dos dois finalistas no 1º turno * 100"
        ),
        "resultado_nacional": transfer_national,
        "municipios": transfer_rows,
    }

    write_json(OUTPUT_DIR / "resumo_nacional.json", national_payload)
    write_json(OUTPUT_DIR / "estados_kpis.json", states_payload)
    write_json(OUTPUT_DIR / "municipios_kpis.json", municipalities_payload)
    write_json(OUTPUT_DIR / "terceira_via_fluxo.json", transfer_payload)

    print(
        "ETL concluído: "
        f"{len(population):,} municípios IBGE; "
        f"{len(city_rows):,} combinações município/eleição/turno; "
        f"{len(swing_city_records):,} swing cities; "
        f"{len(close_city_rows):,} municípios com margem <3%; "
        f"{len(close_state_rows):,} estados com margem <3%."
    )
    print(f"JSONs gravados em: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
