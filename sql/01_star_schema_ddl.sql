/*
    Modelo dimensional para os dados presidenciais do TSE (2018 e 2022).
    Grain:
      FatoVotos: municipio, eleicao/turno, candidato.
      FatoApuracaoMunicipio: municipio, eleicao/turno.
    As dimensoes geograficas devem armazenar MunicipioNormalizado em caixa alta,
    sem acentos, e PopulacaoReferencia conforme a carga IBGE.
*/

IF OBJECT_ID(N'dbo.DimEleicao', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DimEleicao
    (
        EleicaoKey       INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_DimEleicao PRIMARY KEY,
        AnoEleicao       SMALLINT NOT NULL,
        NumeroTurno      TINYINT NOT NULL,
        DataEleicao      DATE NULL,
        CONSTRAINT UQ_DimEleicao_Ano_Turno UNIQUE (AnoEleicao, NumeroTurno),
        CONSTRAINT CK_DimEleicao_Ano CHECK (AnoEleicao IN (2018, 2022)),
        CONSTRAINT CK_DimEleicao_Turno CHECK (NumeroTurno IN (1, 2))
    );
END;
GO

IF OBJECT_ID(N'dbo.DimGeografia', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DimGeografia
    (
        GeografiaKey       INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_DimGeografia PRIMARY KEY,
        CodigoMunicipio    INT NULL,
        Municipio          NVARCHAR(120) NOT NULL,
        MunicipioNormalizado NVARCHAR(120) NOT NULL,
        UF                 CHAR(2) NOT NULL,
        Regiao             NVARCHAR(20) NOT NULL,
        PopulacaoReferencia INT NULL,
        FaixaPopulacao     NVARCHAR(20) NULL,
        PorteMunicipio     NVARCHAR(20) NULL,
        CONSTRAINT UQ_DimGeografia_Municipio_UF
            UNIQUE (MunicipioNormalizado, UF),
        CONSTRAINT CK_DimGeografia_UF
            CHECK (UF IN (
                'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
                'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
                'SP','SE','TO'
            )),
        CONSTRAINT CK_DimGeografia_Populacao
            CHECK (PopulacaoReferencia IS NULL OR PopulacaoReferencia >= 0),
        CONSTRAINT CK_DimGeografia_Faixa
            CHECK (FaixaPopulacao IS NULL OR FaixaPopulacao IN
                ('<20k hab', '20k-100k hab', '>100k hab')),
        CONSTRAINT CK_DimGeografia_Porte
            CHECK (PorteMunicipio IS NULL OR PorteMunicipio IN
                ('Micro', 'Pequeno', 'Médio', 'Grande'))
    );
END;
GO

IF OBJECT_ID(N'dbo.DimEspectro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DimEspectro
    (
        EspectroKey  TINYINT NOT NULL
            CONSTRAINT PK_DimEspectro PRIMARY KEY,
        NomeEspectro NVARCHAR(30) NOT NULL
            CONSTRAINT UQ_DimEspectro_Nome UNIQUE,
        CONSTRAINT CK_DimEspectro_Nome
            CHECK (NomeEspectro IN
                ('Esquerda', 'Direita', 'Terceira Via/Outros'))
    );
END;
GO

IF OBJECT_ID(N'dbo.FatoVotos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FatoVotos
    (
        EleicaoKey             INT NOT NULL,
        GeografiaKey           INT NOT NULL,
        EspectroKey            TINYINT NOT NULL,
        NumeroCandidato        SMALLINT NOT NULL,
        VotosNominais          BIGINT NOT NULL,
        VotosNominaisValidos   BIGINT NOT NULL,
        CONSTRAINT PK_FatoVotos PRIMARY KEY
            (EleicaoKey, GeografiaKey, NumeroCandidato),
        CONSTRAINT FK_FatoVotos_Eleicao FOREIGN KEY (EleicaoKey)
            REFERENCES dbo.DimEleicao (EleicaoKey),
        CONSTRAINT FK_FatoVotos_Geografia FOREIGN KEY (GeografiaKey)
            REFERENCES dbo.DimGeografia (GeografiaKey),
        CONSTRAINT FK_FatoVotos_Espectro FOREIGN KEY (EspectroKey)
            REFERENCES dbo.DimEspectro (EspectroKey),
        CONSTRAINT CK_FatoVotos_Valores CHECK
            (VotosNominais >= 0 AND VotosNominaisValidos >= 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.FatoApuracaoMunicipio', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FatoApuracaoMunicipio
    (
        EleicaoKey       INT NOT NULL,
        GeografiaKey     INT NOT NULL,
        EleitoresAptos   BIGINT NOT NULL,
        Abstencoes         BIGINT NOT NULL,
        VotosBrancos     BIGINT NOT NULL,
        VotosNulos       BIGINT NOT NULL,
        CONSTRAINT PK_FatoApuracaoMunicipio
            PRIMARY KEY (EleicaoKey, GeografiaKey),
        CONSTRAINT FK_FatoApuracao_Eleicao FOREIGN KEY (EleicaoKey)
            REFERENCES dbo.DimEleicao (EleicaoKey),
        CONSTRAINT FK_FatoApuracao_Geografia FOREIGN KEY (GeografiaKey)
            REFERENCES dbo.DimGeografia (GeografiaKey),
        CONSTRAINT CK_FatoApuracao_Valores CHECK
            (EleitoresAptos >= 0 AND Abstencoes >= 0
             AND VotosBrancos >= 0 AND VotosNulos >= 0)
    );
END;
GO

/* Valores recomendados para carga inicial da dimensao de espectro. */
IF NOT EXISTS (SELECT 1 FROM dbo.DimEspectro WHERE EspectroKey = 1)
    INSERT INTO dbo.DimEspectro (EspectroKey, NomeEspectro)
    VALUES (1, N'Esquerda');
IF NOT EXISTS (SELECT 1 FROM dbo.DimEspectro WHERE EspectroKey = 2)
    INSERT INTO dbo.DimEspectro (EspectroKey, NomeEspectro)
    VALUES (2, N'Direita');
IF NOT EXISTS (SELECT 1 FROM dbo.DimEspectro WHERE EspectroKey = 3)
    INSERT INTO dbo.DimEspectro (EspectroKey, NomeEspectro)
    VALUES (3, N'Terceira Via/Outros');
GO
