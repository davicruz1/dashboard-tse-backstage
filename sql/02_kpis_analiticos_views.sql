/*
    Requer dbo.DimEleicao, dbo.DimGeografia, dbo.DimEspectro,
    dbo.FatoVotos e dbo.FatoApuracaoMunicipio de 01_star_schema_ddl.sql.

    Espectro majoritario no KPI de abstencao e um recorte territorial
    (maior bloco de votos em 2018), nao uma atribuicao individual de voto
    a eleitores ausentes.
*/

CREATE OR ALTER VIEW dbo.vw_KPI_SwingRateMunicipio
AS
WITH Votos AS
(
    SELECT
        G.GeografiaKey,
        G.Municipio,
        G.UF,
        G.Regiao,
        G.PopulacaoReferencia,
        G.FaixaPopulacao,
        G.PorteMunicipio,
        E.AnoEleicao,
        SUM(CASE WHEN S.NomeEspectro = N'Esquerda'
                 THEN F.VotosNominaisValidos ELSE 0 END) AS VotosEsquerda,
        SUM(CASE WHEN S.NomeEspectro = N'Direita'
                 THEN F.VotosNominaisValidos ELSE 0 END) AS VotosDireita,
        SUM(F.VotosNominaisValidos) AS VotosValidos
    FROM dbo.FatoVotos AS F
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = F.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = F.GeografiaKey
    INNER JOIN dbo.DimEspectro AS S ON S.EspectroKey = F.EspectroKey
    WHERE E.NumeroTurno = 2
      AND E.AnoEleicao IN (2018, 2022)
    GROUP BY
        G.GeografiaKey, G.Municipio, G.UF, G.Regiao,
        G.PopulacaoReferencia, G.FaixaPopulacao, G.PorteMunicipio,
        E.AnoEleicao
),
Comparacao AS
(
    SELECT
        GeografiaKey,
        Municipio,
        UF,
        Regiao,
        PopulacaoReferencia,
        FaixaPopulacao,
        PorteMunicipio,
        MAX(CASE WHEN AnoEleicao = 2018 THEN VotosEsquerda END) AS VotosEsquerda2018,
        MAX(CASE WHEN AnoEleicao = 2018 THEN VotosDireita END) AS VotosDireita2018,
        MAX(CASE WHEN AnoEleicao = 2018 THEN VotosValidos END) AS VotosValidos2018,
        MAX(CASE WHEN AnoEleicao = 2022 THEN VotosEsquerda END) AS VotosEsquerda2022,
        MAX(CASE WHEN AnoEleicao = 2022 THEN VotosDireita END) AS VotosDireita2022,
        MAX(CASE WHEN AnoEleicao = 2022 THEN VotosValidos END) AS VotosValidos2022
    FROM Votos
    GROUP BY
        GeografiaKey, Municipio, UF, Regiao,
        PopulacaoReferencia, FaixaPopulacao, PorteMunicipio
)
SELECT
    *,
    CAST(100.0 * VotosEsquerda2018 / NULLIF(VotosValidos2018, 0) AS DECIMAL(9,4))
        AS ShareEsquerda2018Pct,
    CAST(100.0 * VotosEsquerda2022 / NULLIF(VotosValidos2022, 0) AS DECIMAL(9,4))
        AS ShareEsquerda2022Pct,
    CAST(
        100.0 * VotosEsquerda2022 / NULLIF(VotosValidos2022, 0)
        - 100.0 * VotosEsquerda2018 / NULLIF(VotosValidos2018, 0)
        AS DECIMAL(9,4)
    ) AS SwingRatePP,
    CASE
        WHEN VotosEsquerda2018 > VotosDireita2018
         AND VotosDireita2022 > VotosEsquerda2022 THEN N'Esquerda para Direita'
        WHEN VotosDireita2018 > VotosEsquerda2018
         AND VotosEsquerda2022 > VotosDireita2022 THEN N'Direita para Esquerda'
        ELSE NULL
    END AS MudancaEspectroVencedor
FROM Comparacao
WHERE VotosValidos2018 > 0
  AND VotosValidos2022 > 0;
GO

CREATE OR ALTER VIEW dbo.vw_KPI_DeltaAbstencao
AS
WITH Abstencao AS
(
    SELECT
        G.GeografiaKey,
        G.Municipio,
        G.UF,
        E.AnoEleicao,
        E.NumeroTurno,
        SUM(A.EleitoresAptos) AS EleitoresAptos,
        SUM(A.Abstencoes) AS Abstencoes
    FROM dbo.FatoApuracaoMunicipio AS A
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = A.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = A.GeografiaKey
    WHERE E.AnoEleicao IN (2018, 2022)
    GROUP BY G.GeografiaKey, G.Municipio, G.UF, E.AnoEleicao, E.NumeroTurno
),
Votos2018 AS
(
    SELECT
        G.GeografiaKey,
        E.NumeroTurno,
        SUM(CASE WHEN S.NomeEspectro = N'Esquerda'
                 THEN F.VotosNominaisValidos ELSE 0 END) AS VotosEsquerda,
        SUM(CASE WHEN S.NomeEspectro = N'Direita'
                 THEN F.VotosNominaisValidos ELSE 0 END) AS VotosDireita,
        SUM(CASE WHEN S.NomeEspectro = N'Terceira Via/Outros'
                 THEN F.VotosNominaisValidos ELSE 0 END) AS VotosTerceiraVia
    FROM dbo.FatoVotos AS F
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = F.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = F.GeografiaKey
    INNER JOIN dbo.DimEspectro AS S ON S.EspectroKey = F.EspectroKey
    WHERE E.AnoEleicao = 2018
    GROUP BY G.GeografiaKey, E.NumeroTurno
),
EspectroBase AS
(
    SELECT
        GeografiaKey,
        NumeroTurno,
        CASE
            WHEN VotosEsquerda >= VotosDireita
             AND VotosEsquerda >= VotosTerceiraVia THEN N'Esquerda'
            WHEN VotosDireita >= VotosTerceiraVia THEN N'Direita'
            ELSE N'Terceira Via/Outros'
        END AS EspectroMajoritario2018
    FROM Votos2018
),
Taxas AS
(
    SELECT
        S.NumeroTurno,
        S.EspectroMajoritario2018,
        A.AnoEleicao,
        SUM(A.EleitoresAptos) AS EleitoresAptos,
        SUM(A.Abstencoes) AS Abstencoes
    FROM Abstencao AS A
    INNER JOIN EspectroBase AS S
        ON S.GeografiaKey = A.GeografiaKey
       AND S.NumeroTurno = A.NumeroTurno
    GROUP BY S.NumeroTurno, S.EspectroMajoritario2018, A.AnoEleicao
),
Comparacao AS
(
    SELECT
        NumeroTurno,
        EspectroMajoritario2018,
        MAX(CASE WHEN AnoEleicao = 2018 THEN EleitoresAptos END) AS Aptos2018,
        MAX(CASE WHEN AnoEleicao = 2018 THEN Abstencoes END) AS Abstencoes2018,
        MAX(CASE WHEN AnoEleicao = 2022 THEN EleitoresAptos END) AS Aptos2022,
        MAX(CASE WHEN AnoEleicao = 2022 THEN Abstencoes END) AS Abstencoes2022
    FROM Taxas
    GROUP BY NumeroTurno, EspectroMajoritario2018
)
SELECT
    NumeroTurno,
    EspectroMajoritario2018,
    CAST(100.0 * Abstencoes2018 / NULLIF(Aptos2018, 0) AS DECIMAL(9,4))
        AS TaxaAbstencao2018Pct,
    CAST(100.0 * Abstencoes2022 / NULLIF(Aptos2022, 0) AS DECIMAL(9,4))
        AS TaxaAbstencao2022Pct,
    CAST(
        100.0 * Abstencoes2022 / NULLIF(Aptos2022, 0)
        - 100.0 * Abstencoes2018 / NULLIF(Aptos2018, 0)
        AS DECIMAL(9,4)
    ) AS DeltaAbstencaoPP
FROM Comparacao
WHERE Aptos2018 > 0 AND Aptos2022 > 0;
GO

CREATE OR ALTER VIEW dbo.vw_KPI_DistribuicaoDemografica
AS
WITH Distribuicao AS
(
    SELECT
        E.AnoEleicao,
        E.NumeroTurno,
        G.FaixaPopulacao,
        G.PorteMunicipio,
        S.NomeEspectro,
        SUM(F.VotosNominaisValidos) AS Votos
    FROM dbo.FatoVotos AS F
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = F.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = F.GeografiaKey
    INNER JOIN dbo.DimEspectro AS S ON S.EspectroKey = F.EspectroKey
    GROUP BY
        E.AnoEleicao, E.NumeroTurno,
        G.FaixaPopulacao, G.PorteMunicipio, S.NomeEspectro
)
SELECT
    AnoEleicao,
    NumeroTurno,
    FaixaPopulacao,
    PorteMunicipio,
    NomeEspectro,
    Votos,
    SUM(Votos) OVER
        (PARTITION BY AnoEleicao, NumeroTurno, FaixaPopulacao, PorteMunicipio)
        AS VotosValidosCategoria,
    CAST(
        100.0 * Votos
        / NULLIF(SUM(Votos) OVER
            (PARTITION BY AnoEleicao, NumeroTurno, FaixaPopulacao, PorteMunicipio), 0)
        AS DECIMAL(9,4)
    ) AS ShareEspectroNaCategoriaPct
FROM Distribuicao;
GO

CREATE OR ALTER VIEW dbo.vw_KPI_TaxaTransferenciaTerceiraVia
AS
WITH VotosMunicipio AS
(
    SELECT
        G.GeografiaKey,
        G.Municipio,
        G.UF,
        E.AnoEleicao,
        SUM(CASE WHEN E.NumeroTurno = 1
                  AND F.NumeroCandidato =
                      CASE E.AnoEleicao WHEN 2018 THEN 17 ELSE 13 END
                 THEN F.VotosNominais ELSE 0 END) AS VotosVencedorTurno1,
        SUM(CASE WHEN E.NumeroTurno = 2
                  AND F.NumeroCandidato =
                      CASE E.AnoEleicao WHEN 2018 THEN 17 ELSE 13 END
                 THEN F.VotosNominais ELSE 0 END) AS VotosVencedorTurno2,
        SUM(CASE WHEN E.NumeroTurno = 1
                  AND F.NumeroCandidato NOT IN
                      (CASE E.AnoEleicao WHEN 2018 THEN 17 ELSE 13 END,
                       CASE E.AnoEleicao WHEN 2018 THEN 13 ELSE 22 END)
                 THEN F.VotosNominais ELSE 0 END) AS VotosTerceiraViaTurno1
    FROM dbo.FatoVotos AS F
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = F.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = F.GeografiaKey
    WHERE E.AnoEleicao IN (2018, 2022)
    GROUP BY G.GeografiaKey, G.Municipio, G.UF, E.AnoEleicao
)
SELECT
    GeografiaKey,
    Municipio,
    UF,
    AnoEleicao,
    CASE AnoEleicao WHEN 2018 THEN 17 ELSE 13 END AS NumeroCandidatoVencedor,
    VotosVencedorTurno1,
    VotosVencedorTurno2,
    VotosVencedorTurno2 - VotosVencedorTurno1 AS GanhoVencedor,
    VotosTerceiraViaTurno1,
    CAST(
        100.0 * (VotosVencedorTurno2 - VotosVencedorTurno1)
        / NULLIF(VotosTerceiraViaTurno1, 0)
        AS DECIMAL(9,4)
    ) AS TaxaTransferenciaPct
FROM VotosMunicipio;
GO

CREATE OR ALTER VIEW dbo.vw_KPI_TaxaTransferenciaTerceiraViaNacional
AS
SELECT
    AnoEleicao,
    SUM(VotosVencedorTurno1) AS VotosVencedorTurno1,
    SUM(VotosVencedorTurno2) AS VotosVencedorTurno2,
    SUM(GanhoVencedor) AS GanhoVencedor,
    SUM(VotosTerceiraViaTurno1) AS VotosTerceiraViaTurno1,
    CAST(
        100.0 * SUM(GanhoVencedor)
        / NULLIF(SUM(VotosTerceiraViaTurno1), 0)
        AS DECIMAL(9,4)
    ) AS TaxaTransferenciaPct
FROM dbo.vw_KPI_TaxaTransferenciaTerceiraVia
GROUP BY AnoEleicao;
GO

/* Pergunta 1: municipios que trocaram o espectro vencedor no 2º turno. */
CREATE OR ALTER VIEW dbo.vw_Pergunta1_SwingCities
AS
SELECT
    GeografiaKey,
    Municipio,
    UF,
    Regiao,
    PopulacaoReferencia,
    SwingRatePP,
    MudancaEspectroVencedor
FROM dbo.vw_KPI_SwingRateMunicipio
WHERE MudancaEspectroVencedor IS NOT NULL;
GO

/* Pergunta 2: mudanca de abstencao por turno e espectro territorial de 2018. */
CREATE OR ALTER VIEW dbo.vw_Pergunta2_AbstencaoPorEspectro
AS
SELECT
    NumeroTurno,
    EspectroMajoritario2018,
    TaxaAbstencao2018Pct,
    TaxaAbstencao2022Pct,
    DeltaAbstencaoPP
FROM dbo.vw_KPI_DeltaAbstencao;
GO

/* Pergunta 3: votos por espectro, turno, faixa populacional e porte. */
CREATE OR ALTER VIEW dbo.vw_Pergunta3_DistribuicaoDemografica
AS
SELECT
    AnoEleicao,
    NumeroTurno,
    FaixaPopulacao,
    PorteMunicipio,
    NomeEspectro,
    Votos,
    VotosValidosCategoria,
    ShareEspectroNaCategoriaPct
FROM dbo.vw_KPI_DistribuicaoDemografica;
GO

/* Pergunta 4: rankings estaduais de abstencao, brancos e nulos por turno. */
CREATE OR ALTER VIEW dbo.vw_Pergunta4_RankingEstadualAbstencaoBrancosNulos
AS
WITH Estado AS
(
    SELECT
        E.AnoEleicao,
        E.NumeroTurno,
        G.UF,
        G.Regiao,
        SUM(A.EleitoresAptos) AS EleitoresAptos,
        SUM(A.Abstencoes) AS Abstencoes,
        SUM(A.VotosBrancos) AS VotosBrancos,
        SUM(A.VotosNulos) AS VotosNulos
    FROM dbo.FatoApuracaoMunicipio AS A
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = A.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = A.GeografiaKey
    GROUP BY E.AnoEleicao, E.NumeroTurno, G.UF, G.Regiao
)
SELECT
    AnoEleicao,
    NumeroTurno,
    UF,
    Regiao,
    EleitoresAptos,
    Abstencoes,
    CAST(100.0 * Abstencoes / NULLIF(EleitoresAptos, 0) AS DECIMAL(9,4))
        AS TaxaAbstencaoPct,
    VotosBrancos,
    VotosNulos,
    RANK() OVER
        (PARTITION BY AnoEleicao, NumeroTurno ORDER BY
         1.0 * Abstencoes / NULLIF(EleitoresAptos, 0) DESC) AS RankAbstencao,
    RANK() OVER
        (PARTITION BY AnoEleicao, NumeroTurno ORDER BY VotosBrancos DESC)
        AS RankBrancos,
    RANK() OVER
        (PARTITION BY AnoEleicao, NumeroTurno ORDER BY VotosNulos DESC)
        AS RankNulos
FROM Estado;
GO

/* Pergunta 5a: municipios com margem de segundo turno inferior a 3%. */
CREATE OR ALTER VIEW dbo.vw_Pergunta5_MargensApertadasMunicipio
AS
WITH Candidato AS
(
    SELECT
        E.AnoEleicao,
        G.GeografiaKey,
        G.Municipio,
        G.UF,
        G.Regiao,
        F.NumeroCandidato,
        SUM(F.VotosNominaisValidos) AS VotosCandidato
    FROM dbo.FatoVotos AS F
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = F.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = F.GeografiaKey
    WHERE E.NumeroTurno = 2
    GROUP BY
        E.AnoEleicao, G.GeografiaKey, G.Municipio, G.UF, G.Regiao,
        F.NumeroCandidato
),
Ordenado AS
(
    SELECT *,
        ROW_NUMBER() OVER
            (PARTITION BY AnoEleicao, GeografiaKey
             ORDER BY VotosCandidato DESC, NumeroCandidato) AS Posicao,
        SUM(VotosCandidato) OVER
            (PARTITION BY AnoEleicao, GeografiaKey) AS VotosValidos
    FROM Candidato
),
Margem AS
(
    SELECT
        AnoEleicao,
        GeografiaKey,
        Municipio,
        UF,
        Regiao,
        MAX(CASE WHEN Posicao = 1 THEN NumeroCandidato END) AS CandidatoVencedor,
        MAX(CASE WHEN Posicao = 1 THEN VotosCandidato END) AS VotosVencedor,
        MAX(CASE WHEN Posicao = 2 THEN NumeroCandidato END) AS CandidatoSegundo,
        MAX(CASE WHEN Posicao = 2 THEN VotosCandidato END) AS VotosSegundo,
        MAX(VotosValidos) AS VotosValidos
    FROM Ordenado
    WHERE Posicao <= 2
    GROUP BY AnoEleicao, GeografiaKey, Municipio, UF, Regiao
)
SELECT
    AnoEleicao,
    GeografiaKey,
    Municipio,
    UF,
    Regiao,
    CandidatoVencedor,
    VotosVencedor,
    CandidatoSegundo,
    VotosSegundo,
    CAST(
        100.0 * (VotosVencedor - VotosSegundo) / NULLIF(VotosValidos, 0)
        AS DECIMAL(9,4)
    ) AS MargemVitoriaPct
FROM Margem
WHERE VotosSegundo IS NOT NULL
  AND 100.0 * (VotosVencedor - VotosSegundo) / NULLIF(VotosValidos, 0) < 3;
GO

/* Pergunta 5b: margem estadual por ano e sua media historica 2018/2022. */
CREATE OR ALTER VIEW dbo.vw_Pergunta5_MargensApertadasEstado
AS
WITH CandidatoEstado AS
(
    SELECT
        E.AnoEleicao,
        G.UF,
        G.Regiao,
        F.NumeroCandidato,
        SUM(F.VotosNominaisValidos) AS VotosCandidato
    FROM dbo.FatoVotos AS F
    INNER JOIN dbo.DimEleicao AS E ON E.EleicaoKey = F.EleicaoKey
    INNER JOIN dbo.DimGeografia AS G ON G.GeografiaKey = F.GeografiaKey
    WHERE E.NumeroTurno = 2
    GROUP BY E.AnoEleicao, G.UF, G.Regiao, F.NumeroCandidato
),
Ordenado AS
(
    SELECT *,
        ROW_NUMBER() OVER
            (PARTITION BY AnoEleicao, UF
             ORDER BY VotosCandidato DESC, NumeroCandidato) AS Posicao,
        SUM(VotosCandidato) OVER
            (PARTITION BY AnoEleicao, UF) AS VotosValidos
    FROM CandidatoEstado
),
Margem AS
(
    SELECT
        AnoEleicao,
        UF,
        Regiao,
        MAX(CASE WHEN Posicao = 1 THEN NumeroCandidato END) AS CandidatoVencedor,
        MAX(CASE WHEN Posicao = 1 THEN VotosCandidato END) AS VotosVencedor,
        MAX(CASE WHEN Posicao = 2 THEN NumeroCandidato END) AS CandidatoSegundo,
        MAX(CASE WHEN Posicao = 2 THEN VotosCandidato END) AS VotosSegundo,
        MAX(VotosValidos) AS VotosValidos
    FROM Ordenado
    WHERE Posicao <= 2
    GROUP BY AnoEleicao, UF, Regiao
),
ComMargem AS
(
    SELECT
        *,
        CAST(
            100.0 * (VotosVencedor - VotosSegundo) / NULLIF(VotosValidos, 0)
            AS DECIMAL(9,4)
        ) AS MargemVitoriaPct
    FROM Margem
),
ComMediaHistorica AS
(
    SELECT
        *,
        CAST(AVG(MargemVitoriaPct) OVER (PARTITION BY UF) AS DECIMAL(9,4))
            AS MargemMediaHistoricaPct
    FROM ComMargem
)
SELECT
    AnoEleicao,
    UF,
    Regiao,
    CandidatoVencedor,
    VotosVencedor,
    CandidatoSegundo,
    VotosSegundo,
    MargemVitoriaPct,
    MargemMediaHistoricaPct
FROM ComMediaHistorica
WHERE VotosSegundo IS NOT NULL
  AND MargemVitoriaPct < 3;
GO
