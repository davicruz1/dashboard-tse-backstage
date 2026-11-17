#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
etl/inspecionar.py
TAREFA 1 - Inspeção rápida dos 5 arquivos brutos em ./dadoss

Regras:
- Não usar comandos Linux.
- Arquivos TSE: encoding latin1, separador ';'.
- municipiospop.csv: detectar encoding/separador automaticamente.
- Imprime apenas nomes das colunas e as 3 primeiras linhas de cada arquivo.
- Salva o resultado em inspecao.txt na raiz em UTF-8.
"""

import os
import sys
import chardet

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
DADOSS_DIR = os.path.join(ROOT_DIR, "dadoss")


def detect_encoding(filepath):
    """Detecta encoding do arquivo usando chardet."""
    with open(filepath, "rb") as f:
        raw = f.read(50000)
        result = chardet.detect(raw)
        return result["encoding"] if result["encoding"] else "utf-8"


def detect_separator(filepath, encoding):
    """Detecta separador mais provável: ; ou ,"""
    with open(filepath, "r", encoding=encoding, errors="replace") as f:
        first_line = f.readline()
        return ";" if first_line.count(";") > first_line.count(",") else ","


def inspect_file(filepath, label, encoding=None, sep=None):
    """Retorna a string de inspeção para um CSV."""
    if encoding is None:
        encoding = detect_encoding(filepath)
    if sep is None:
        sep = detect_separator(filepath, encoding)

    out = []
    out.append("=" * 60)
    out.append(f"ARQUIVO: {label}")
    out.append(f"Encoding: {encoding} | Separador: '{sep}'")
    out.append("-" * 60)

    with open(filepath, "r", encoding=encoding, errors="replace") as f:
        for i, line in enumerate(f):
            if i >= 4:  # header + 3 linhas
                break
            cols = line.rstrip("\n\r").split(sep)
            if i == 0:
                out.append(f"Colunas ({len(cols)}):")
                for idx, c in enumerate(cols, 1):
                    out.append(f"  [{idx}] {c.strip()}")
                out.append("3 primeiras linhas:")
            else:
                display = " | ".join(cols[:12])
                if len(cols) > 12:
                    display += f" ... (+{len(cols) - 12} colunas)"
                out.append(f"  Linha {i}: {display[:400]}")
    out.append("")
    return "\n".join(out)


def main():
    files = [
        ("votacao_candidato_munzona_2018_BR.csv", "votacao_candidato_munzona_2018_BR.csv", "latin1", ";"),
        ("votacao_candidato_munzona_2022_BR.csv", "votacao_candidato_munzona_2022_BR.csv", "latin1", ";"),
        ("detalhe_votacao_munzona_2018_BR.csv", "detalhe_votacao_munzona_2018_BR.csv", "latin1", ";"),
        ("detalhe_votacao_munzona_2022_BR.csv", "detalhe_votacao_munzona_2022_BR.csv", "latin1", ";"),
        ("municipiospop.csv", "municipiospop.csv", None, None),
    ]

    all_output = []
    for filename, label, enc, sep in files:
        filepath = os.path.join(DADOSS_DIR, filename)
        if not os.path.exists(filepath):
            all_output.append(f"ARQUIVO NAO ENCONTRADO: {filepath}\n")
            continue
        text = inspect_file(filepath, label, encoding=enc, sep=sep)
        all_output.append(text)

    final_text = "\n".join(all_output)
    print(final_text)

    output_path = os.path.join(ROOT_DIR, "inspecao.txt")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(final_text)
    print(f"\nResultado salvo em {output_path}")


if __name__ == "__main__":
    main()
