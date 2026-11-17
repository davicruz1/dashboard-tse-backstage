# Power BI — Equipe Backstage

Este diretório é reservado para o arquivo `.pbix` e seus artefatos de BI. O
arquivo Power BI ainda não faz parte deste repositório; salve aqui o relatório
quando ele estiver pronto. O `.gitignore` não exclui arquivos `.pbix`.

## Opção A — Conectar ao SQL Server

Os scripts T-SQL criam o modelo dimensional e views analíticas:

1. Abra uma conexão com o banco SQL Server já carregado.
2. No Power BI Desktop, selecione **Obter dados → SQL Server**.
3. Informe o servidor e o banco. Selecione **Importar** para uma cópia local
   ou **DirectQuery** quando a infraestrutura suportar consultas interativas.
4. No navegador, escolha as views `dbo.vw_KPI_*` e `dbo.vw_Pergunta*` definidas
   em `../sql/02_kpis_analiticos_views.sql`.
5. Selecione **Transformar dados** para conferir tipos, chaves e filtros antes
   de carregar o modelo.

O arquivo `01_star_schema_ddl.sql` cria tabelas e `02_kpis_analiticos_views.sql`
cria views, mas **não há atualmente uma rotina de carga para popular as tabelas
do SQL Server**. O ETL Python deste projeto lê os CSVs e escreve os quatro
JSONs para o dashboard; ele não insere registros no banco. Portanto, as views
T-SQL só produzirão resultados depois que os fatos e dimensões forem carregados
por um processo de ingestão próprio.

## Opção B — Usar os dados tratados versionados

Para criar um relatório sem configurar SQL Server:

1. No Power BI Desktop, selecione **Obter dados → JSON**.
2. Importe os arquivos em `../dashboard/public/data/`:
   - `resumo_nacional.json`
   - `estados_kpis.json`
   - `municipios_kpis.json`
   - `terceira_via_fluxo.json`
3. No Power Query, expanda os objetos e listas (`totais_nacionais_por_turno`,
   `estados`, `municipios`, `distribuicao_demografica_do_voto`,
   `swing_cities_2018_vs_2022` e `municipios_margem_inferior_3_pct`) e defina os
   tipos numéricos e de data/ano.
4. Relacione as tabelas por ano, turno e geografia quando necessário. Evite
   relacionar diretamente fatos em granularidades distintas sem dimensões
   conformadas, pois isso pode duplicar totais.

Os JSONs tratados estão versionados intencionalmente: o relatório pode ser
construído e o dashboard web iniciado após um clone, sem os CSVs brutos.

## Modelo T-SQL que existe hoje

Os nomes físicos definidos nos scripts são:

| Papel no modelo | Objeto T-SQL |
|---|---|
| Votos por candidato/espectro | `dbo.FatoVotos` |
| Comparecimento municipal | `dbo.FatoApuracaoMunicipio` |
| Município, UF, região e população | `dbo.DimGeografia` |
| Ano e turno | `dbo.DimEleicao` |
| Classificação política | `dbo.DimEspectro` |

Os nomes conceituais `ft_VotacaoCandidato`, `ft_DetalheVotacao` e
`dim_Municipio` correspondem aproximadamente aos três primeiros papéis da
tabela acima. **`dim_Candidato` ainda não existe como dimensão física**: o
número do candidato está armazenado em `FatoVotos` e a classificação agregada
fica em `DimEspectro`. Consulte os DDLs antes de criar relacionamentos no
Power BI; este README não presume uma dimensão ainda não implementada.

## Cuidados analíticos

- A abstenção mede comparecimento agregado no município; não identifica o voto
  ou a motivação de uma pessoa.
- A taxa de transferência da terceira via é uma razão ecológica entre o ganho
  do candidato vencedor no segundo turno e os votos dos candidatos fora dos
  dois finalistas no primeiro. Não rastreia eleitores individuais.
- Mantenha o filtro de UF `ZZ` (exterior) fora dos recortes de municípios
  brasileiros.
