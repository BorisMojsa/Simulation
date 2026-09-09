#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

UA = "SimulationBadgeImporter/1.0 (desktop script)"
ROOT = Path(__file__).resolve().parent
BADGES_ROOT = ROOT / "badges"
LEAGUE_DATA_FILE = ROOT / "league-data.js"
REPORT_FILE = ROOT / "badge-import-report.json"
ARCHIVE_ZIP = ROOT / "football-logos.zip"

RAW_LEAGUE_INPUT = """
Premier League : Arsenal, Manchester City, Aston Villa, Manchester United, Chelsea, Liverpool, Brentford, Bournemouth, Everton, Fulham, Newcastle United, Sunderland, Crystal Palace, Brighton & Hove Albion, Leeds United, Tottenham Hotspur, Nottingham Forest, West Ham United, Burnley, Wolverhampton Wanderers.

Championship: Birmingham City
Blackburn Rovers
Bristol City
Charlton Athletic
Coventry City
Derby County
Hull City
Ipswich Town
Leicester City
Middlesbrough
Millwall
Norwich City
Oxford United
Portsmouth
Preston North End
Queens Park Rangers
Sheffield United
Sheffield Wednesday
Southampton
Stoke City
Swansea City
Watford
West Bromwich Albion
Wrexham


Seria A :
Atalanta
Bologna
Cagliari
Como
Cremonese
Fiorentina
Genoa
Hellas Verona
Inter Milan
Juventus
Lazio
Lecce
AC Milan
Napoli
Parma
Pisa
Roma
Sassuolo
Torino
Udinese



Seria B:
Avellino
Bari
Carrarese
Catanzaro
Cesena
Empoli
Frosinone
Juve Stabia
Mantova
Modena
Monza
Padova
Palermo
Pescara
Reggiana
Sampdoria
Spezia
Südtirol
Venezia
Virtus Entella


 La Liga:
Athletic Club
Atlético de Madrid
CA Osasuna
Celta Vigo
Deportivo Alavés
Elche CF
FC Barcelona
Getafe CF
Girona FC
Levante UD
RCD Espanyol
RCD Mallorca
Real Betis
Real Madrid
Real Oviedo
Real Sociedad
Sevilla FC
Valencia CF
Villarreal CF
Rayo Vallecano


La Liga 2:
AD Ceuta FC
Albacete BP
Burgos CF
Cádiz CF
CD Castellón
CD Leganés
CD Mirandés
Córdoba CF
Cultural y Deportiva Leonesa
FC Andorra
Granada CF
Málaga CF
R. Racing Club
R. Sociedad B
RC Deportivo
Real Sporting
Real Valladolid CF
Real Zaragoza
SD Eibar
SD Huesca
UD Almería
UD Las Palmas


Bundesliga:
FC Heidenheim
FC Köln
FSV Mainz 05
Bayer 04 Leverkusen
Bayern Munich
Borussia Dortmund
Borussia Mönchengladbach
Eintracht Frankfurt
FC Augsburg
Hamburger SV
RB Leipzig
SC Freiburg
FC St. Pauli
TSG Hoffenheim
Union Berlin
VfB Stuttgart
VfL Wolfsburg
Werder Bremen


Bundesliga 2:
FC Kaiserslautern
FC Magdeburg
FC Nürnberg
Arminia Bielefeld
Darmstadt 98
Eintracht Braunschweig
Fortuna Düsseldorf
Greuther Fürth
Hannover 96
Hertha BSC
Holstein Kiel
Karlsruher SC
Preußen Münster
SC Paderborn
Schalke 04
SV Elversberg
Ulm 1846
VfL Bochum


Ligue 1:
Angers
Auxerre
Brest
Le Havre
Lens
Lille
Lorient
Lyon
Marseille
Metz
Monaco
Nantes
Nice
Paris FC
Paris Saint-Germain
Rennes
Strasbourg
Toulouse


Ligue 2:
Amiens
Annecy
Bastia
Boulogne
Clermont
Dunkerque
Grenoble
Guingamp
Laval
Le Mans
Montpellier
Nancy
Pau
Red Star
Reims
Rodez
Saint-Étienne
Troyes


SuperLiga:
Crvena zvezda
Čukarički
IMT
Javor-Matis
Mladost Lučani
Napredak Kruševac
Novi Pazar
OFK Beograd
Partizan
Radnički 1923
Radnički Niš
Radnik Surdulica
Spartak ŽK
TSC Bačka Topola
Vojvodina
Železničar Pančevo


Prva Liga Srbije:
Borac 1926
Dubočica
FAP
Jedinstvo Ub
Kabel
Loznica
Mačva
OFK Vršac
RFK Grafičar
FK Smederevo
SU Dinamo Jug
Tekstilac
Trayal
Ušće Novi Beograd
Voždovac
Zemun


Primeira Liga:
Alverca
Arouca
AVS
Benfica
Braga
Casa Pia
Estoril Praia
Estrela da Amadora
Famalicão
Gil Vicente
Moreirense
Nacional
Porto
Rio Ave
Santa Clara
Sporting CP
Tondela
Vitória de Guimarães


Liga Portugal 2:
Académico de Viseu
Benfica B
Chaves
Farense
Feirense
Felgueiras
Leixões
Lusitânia Lourosa
Marítimo
Oliveirense
Paços de Ferreira
Penafiel
Portimonense
Porto B
Sporting CP B
Torreense
União de Leiria
Vizela


Eredivisie:
Ajax
AZ
Excelsior
Feyenoord
Fortuna Sittard
Go Ahead Eagles
Groningen
Heerenveen
Heracles Almelo
NAC Breda
NEC
PEC Zwolle
PSV Eindhoven
Sparta Rotterdam
Telstar
Twente
Utrecht
Volendam


Eerste Divisie:
ADO Den Haag
Almere City
Cambuur
De Graafschap
Den Bosch
Dordrecht
Eindhoven
Emmen
Helmond Sport
Jong Ajax
Jong AZ
Jong PSV
Jong FC Utrecht
MVV Maastricht
RKC Waalwijk
Roda JC Kerkrade
TOP Oss
Vitesse
VVV-Venlo
Willem II



MLS:
Atlanta United
Austin FC
Charlotte FC
Chicago Fire FC
FC Cincinnati
Colorado Rapids
Columbus Crew
D.C. United
FC Dallas
Houston Dynamo FC
Sporting Kansas City
LA Galaxy
Los Angeles Football Club
Inter Miami CF
Minnesota United FC
CF Montréal
Nashville SC
New England Revolution
Red Bull New York
New York City Football Club
Orlando City
Philadelphia Union
Portland Timbers
Real Salt Lake
San Diego FC
San Jose Earthquakes
Seattle Sounders FC
St. Louis CITY SC
Toronto FC
Vancouver Whitecaps FC




Saudi Pro League:
Al Ahli
Al Ettifaq
Al Fateh
Al Fayha
Al Hazem
Al Hilal
Al Ittihad
Al Khaleej
Al Kholood
Al Najmah
Al Nassr
Al Okhdood
Al Qadsiah
Al Riyadh
Al Shabab
Al Taawoun
Damac
Neom S.C.
"""


LEAGUE_META = {
    "Premier League": {
        "name": "England - Premier League",
        "displayName": "Premier League",
        "nation": "England",
        "tier": 5,
        "financialPower": 5,
    },
    "Championship": {
        "name": "England - Championship",
        "displayName": "Championship",
        "nation": "England",
        "tier": 4,
        "financialPower": 4,
    },
    "Serie A": {
        "name": "Italy - Serie A",
        "displayName": "Serie A",
        "nation": "Italy",
        "tier": 5,
        "financialPower": 5,
    },
    "Serie B": {
        "name": "Italy - Serie B",
        "displayName": "Serie B",
        "nation": "Italy",
        "tier": 4,
        "financialPower": 3,
    },
    "La Liga": {
        "name": "Spain - LaLiga",
        "displayName": "La Liga",
        "nation": "Spain",
        "tier": 5,
        "financialPower": 5,
    },
    "La Liga 2": {
        "name": "Spain - LaLiga 2",
        "displayName": "La Liga 2",
        "nation": "Spain",
        "tier": 4,
        "financialPower": 3,
    },
    "Bundesliga": {
        "name": "Germany - Bundesliga",
        "displayName": "Bundesliga",
        "nation": "Germany",
        "tier": 5,
        "financialPower": 5,
    },
    "Bundesliga 2": {
        "name": "Germany - Bundesliga 2",
        "displayName": "Bundesliga 2",
        "nation": "Germany",
        "tier": 4,
        "financialPower": 3,
    },
    "Ligue 1": {
        "name": "France - Ligue 1",
        "displayName": "Ligue 1",
        "nation": "France",
        "tier": 4,
        "financialPower": 4,
    },
    "Ligue 2": {
        "name": "France - Ligue 2",
        "displayName": "Ligue 2",
        "nation": "France",
        "tier": 3,
        "financialPower": 2,
    },
    "SuperLiga": {
        "name": "Serbia - SuperLiga",
        "displayName": "SuperLiga",
        "nation": "Serbia",
        "tier": 2,
        "financialPower": 2,
    },
    "Prva Liga Srbije": {
        "name": "Serbia - Prva Liga Srbije",
        "displayName": "Prva Liga Srbije",
        "nation": "Serbia",
        "tier": 1,
        "financialPower": 1,
    },
    "Primeira Liga": {
        "name": "Portugal - Liga Portugal",
        "displayName": "Primeira Liga",
        "nation": "Portugal",
        "tier": 4,
        "financialPower": 3,
    },
    "Liga Portugal 2": {
        "name": "Portugal - Liga Portugal 2",
        "displayName": "Liga Portugal 2",
        "nation": "Portugal",
        "tier": 3,
        "financialPower": 2,
    },
    "Eredivisie": {
        "name": "Netherlands - Eredivisie",
        "displayName": "Eredivisie",
        "nation": "Netherlands",
        "tier": 3,
        "financialPower": 3,
    },
    "Eerste Divisie": {
        "name": "Netherlands - Eerste Divisie",
        "displayName": "Eerste Divisie",
        "nation": "Netherlands",
        "tier": 2,
        "financialPower": 2,
    },
    "MLS": {
        "name": "United States - MLS",
        "displayName": "MLS",
        "nation": "United States",
        "tier": 3,
        "financialPower": 3,
    },
    "Saudi Pro League": {
        "name": "Saudi Arabia - Saudi Pro League",
        "displayName": "Saudi Pro League",
        "nation": "Saudi Arabia",
        "tier": 4,
        "financialPower": 4,
    },
}

COUNTRY_WIKI_ORDER = {
    "England": ["enwiki"],
    "Italy": ["itwiki", "enwiki"],
    "Spain": ["eswiki", "enwiki"],
    "Germany": ["dewiki", "enwiki"],
    "France": ["frwiki", "enwiki"],
    "Serbia": ["srwiki", "enwiki"],
    "Portugal": ["ptwiki", "enwiki"],
    "Netherlands": ["nlwiki", "enwiki"],
    "United States": ["enwiki"],
    "Saudi Arabia": ["enwiki", "arwiki"],
}

CLUB_ALIASES = {
    "Albacete BP": ["Albacete Balompié", "Albacete"],
    "R. Racing Club": ["Racing de Santander"],
    "R. Sociedad B": ["Real Sociedad B"],
    "RC Deportivo": ["Deportivo de La Coruña", "Deportivo La Coruna"],
    "Real Sporting": ["Sporting de Gijón", "Real Sporting de Gijón"],
    "CD Mirandés": ["Mirandes"],
    "Córdoba CF": ["Cordoba"],
    "Málaga CF": ["Malaga"],
    "SD Eibar": ["Eibar"],
    "SD Huesca": ["Huesca"],
    "FC Heidenheim": ["1. FC Heidenheim"],
    "FC Köln": ["1. FC Köln"],
    "FSV Mainz 05": ["1. FSV Mainz 05"],
    "Werder Bremen": ["SV Werder Bremen"],
    "FC Kaiserslautern": ["1. FC Kaiserslautern", "Kaiserslautern"],
    "FC Nürnberg": ["1. FC Nürnberg"],
    "Eintracht Braunschweig": ["Braunschweig"],
    "Fortuna Düsseldorf": ["Fortuna Dusseldorf"],
    "Hannover 96": ["Hannover"],
    "Karlsruher SC": ["Karlsruhe"],
    "SC Paderborn": ["Paderborn", "Paderborn 07"],
    "SV Elversberg": ["Elversberg"],
    "Ulm 1846": ["SSV Ulm 1846"],
    "Dunkerque": ["USL Dunkerque"],
    "Pau": ["Pau FC"],
    "Rodez": ["Rodez AF"],
    "Crvena zvezda": ["Red Star Belgrade", "FK Crvena zvezda"],
    "Čukarički": ["FK Čukarički"],
    "IMT": ["FK IMT Beograd", "FK IMT Belgrad", "FK IMT"],
    "Javor-Matis": ["FK Javor-Matis Ivanjica", "FK Javor Ivanjica", "Javor Ivanjica"],
    "Partizan": ["FK Partizan Belgrade", "Partizan Belgrade", "FK Partizan"],
    "Spartak ŽK": ["FK Spartak Subotica", "Spartak Subotica"],
    "Železničar Pančevo": ["FK Železničar Pančevo"],
    "FAP": ["FK FAP Priboj", "FK FAP"],
    "Kabel": ["FK Kabel Novi Sad"],
    "Mačva": ["FK Mačva Šabac", "FK Macva Sabac"],
    "OFK Vršac": ["OFK Vrsac"],
    "RFK Grafičar": ["RFK Grafičar Beograd", "RFK Graficar Beograd"],
    "FK Smederevo": ["FK Smederevo 1924", "FK Smederevo"],
    "SU Dinamo Jug": ["SU Dinamo Jug", "FK Dinamo Jug"],
    "Tekstilac": ["FK Tekstilac Odžaci", "FK Tekstilac Odzaci"],
    "Trayal": ["FK Trayal Kruševac"],
    "Ušće Novi Beograd": ["FK Ušće Novi Beograd"],
    "Voždovac": ["FK Voždovac"],
    "AVS": ["AVS Futebol SAD", "AVS"],
    "Estrela da Amadora": ["C.F. Estrela da Amadora"],
    "Académico de Viseu": ["Académico de Viseu F.C."],
    "Benfica B": ["S.L. Benfica B"],
    "Porto B": ["FC Porto B"],
    "Sporting CP B": ["Sporting CP B"],
    "NAC Breda": ["NAC Breda"],
    "NEC": ["NEC Nijmegen"],
    "AZ": ["AZ Alkmaar"],
    "Twente": ["FC Twente"],
    "Dordrecht": ["FC Dordrecht"],
    "Eindhoven": ["FC Eindhoven"],
    "Jong FC Utrecht": ["Jong Utrecht"],
    "Roda JC Kerkrade": ["Roda JC"],
    "Red Bull New York": ["New York Red Bulls"],
    "Los Angeles Football Club": ["LAFC", "Los Angeles FC"],
    "New York City Football Club": ["New York City FC"],
    "CF Montréal": ["CF Montréal", "CF Montreal", "Montreal", "Montreal Impact"],
    "Chicago Fire FC": ["Chicago Fire"],
    "Houston Dynamo FC": ["Houston Dynamo"],
    "Inter Miami CF": ["Inter Miami"],
    "Minnesota United FC": ["Minnesota United"],
    "Nashville SC": ["Nashville"],
    "New England Revolution": ["New England"],
    "Vancouver Whitecaps FC": ["Vancouver Whitecaps"],
    "St. Louis CITY SC": ["St. Louis City SC"],
    "Neom S.C.": ["Neom SC", "Neom"],
    "Al Ahli": ["Al Ahli Saudi FC"],
    "Al Ettifaq": ["Al-Ettifaq", "Al Ettifaq Club"],
    "Al Fateh": ["Al-Fateh", "Al Fateh SC"],
    "Al Fayha": ["Al-Fayha", "Al Fayha FC"],
    "Al Hazem": ["Al-Hazem"],
    "Al Khaleej": ["Al-Khaleej", "Al Khaleej Club"],
    "Al Kholood": ["Al-Kholood", "Al Kholood Club"],
    "Al Najmah": ["Al-Najmah", "Al Najmah Club"],
    "Al Ittihad": ["Al-Ittihad Club"],
    "Al Hilal": ["Al Hilal SFC", "Al-Hilal"],
    "Al Nassr": ["Al Nassr FC", "Al-Nassr"],
    "Al Okhdood": ["Al-Okhdood", "Al Okhdood Club"],
    "Al Shabab": ["Al Shabab FC", "Al-Shabab"],
    "Al Riyadh": ["Al-Riyadh", "Al-Riyadh SC"],
    "Al Qadsiah": ["Al-Qadsiah", "Al-Qadsiah FC"],
    "Al Taawoun": ["Al Taawoun FC", "Al-Taawoun"],
    "Genclerbirligi Ankara": ["Gençlerbirliği", "Genclerbirligi"],
    "FK BodøGlimt": ["Bodø/Glimt", "Bodo/Glimt", "Bodo Glimt"],
    "Valerenga Fotball Elite": ["Vålerenga", "Vålerenga IF", "Valerenga"],
    "AFK Csikszereda Miercurea Ciuc": ["FK Csíkszereda Miercurea Ciuc", "Csikszereda", "Miercurea Ciuc"],
    "Ihud Bnei Sakhnin": ["Bnei Sakhnin"],
    "FC Kudrivka": ["Kudrivka"],
    "Sporting CP B": ["Sporting CP"],
}

# Additional names for local badge matching.
LOCAL_NAME_ALIASES = {
    "Brighton & Hove Albion": ["Brighton & Hove Albion", "Brighton"],
    "Bournemouth": ["AFC Bournemouth", "Bournemouth"],
    "Wolverhampton Wanderers": ["Wolverhampton Wanderers", "Wolves"],
    "RCD Espanyol": ["RCD Espanyol Barcelona", "RCD Espanyol"],
    "Celta Vigo": ["Celta de Vigo", "RC Celta de Vigo", "Celta Vigo"],
    "Real Betis": ["Real Betis Balompié", "Real Betis"],
    "Athletic Club": ["Athletic Bilbao", "Athletic Club"],
    "FC Heidenheim": ["1.FC Heidenheim 1846", "FC Heidenheim"],
    "FC Köln": ["1.FC Köln", "FC Köln"],
    "FSV Mainz 05": ["1.FSV Mainz 05", "FSV Mainz 05"],
    "Werder Bremen": ["SV Werder Bremen", "Werder Bremen"],
    "Bayer 04 Leverkusen": ["Bayer 04 Leverkusen", "Bayer Leverkusen"],
    "Bologna": ["Bologna FC 1909", "Bologna"],
    "Cagliari": ["Cagliari Calcio", "Cagliari"],
    "Fiorentina": ["ACF Fiorentina", "Fiorentina"],
    "Genoa": ["Genoa CFC", "Genoa"],
    "Juventus": ["Juventus FC", "Juventus"],
    "Lazio": ["SS Lazio", "Lazio"],
    "Lecce": ["US Lecce", "Lecce"],
    "Napoli": ["SSC Napoli", "Napoli"],
    "Roma": ["AS Roma", "Roma"],
    "Sassuolo": ["US Sassuolo", "Sassuolo"],
    "Torino": ["Torino FC", "Torino"],
    "Udinese": ["Udinese Calcio", "Udinese"],
    "Paris Saint-Germain": ["Paris Saint-Germain", "Paris Saint-Germain FC"],
    "Rennes": ["Stade Rennais FC", "Rennes"],
    "Strasbourg": ["RC Strasbourg Alsace", "Strasbourg"],
    "Estrela da Amadora": ["CF Estrela Amadora", "Estrela da Amadora"],
    "Famalicão": ["FC Famalicão", "Famalicao"],
    "Vitória de Guimarães": ["Vitória Guimarães SC", "Vitoria Guimaraes"],
    "AZ": ["AZ Alkmaar", "AZ"],
    "Twente": ["Twente Enschede FC", "FC Twente", "Twente"],
    "Groningen": ["FC Groningen", "Groningen"],
    "Heerenveen": ["SC Heerenveen", "Heerenveen"],
    "NEC": ["NEC Nijmegen", "NEC"],
    "Utrecht": ["FC Utrecht", "Utrecht"],
    "Volendam": ["FC Volendam", "Volendam"],
    "D.C. United": ["D.C. United", "DC United"],
    "Los Angeles Football Club": ["Los Angeles FC", "LAFC"],
    "New York City Football Club": ["New York City FC", "New York City Football Club"],
    "Red Bull New York": ["New York Red Bulls", "Red Bull New York"],
    "St. Louis CITY SC": ["St. Louis CITY SC", "St Louis City", "St. Louis City SC"],
}

MANUAL_BADGE_URLS = {
    "Coventry City": "https://en.wikipedia.org/wiki/Special:FilePath/Coventry_City_FC_crest.svg?width=512",
    "Leicester City": "https://en.wikipedia.org/wiki/Special:FilePath/Leicester_City_crest.svg?width=512",
}

SEARCH_CACHE: Dict[str, dict] = {}
BYTES_CACHE: Dict[str, Tuple[bytes, str, str]] = {}
WIKI_SEARCH_CACHE: Dict[str, List[str]] = {}
ENTITY_CACHE: Dict[str, dict] = {}
INFOBOX_CACHE: Dict[str, Optional[str]] = {}
SPORTSDB_CACHE: Dict[str, List[dict]] = {}
SPORTSDB_LAST_REQUEST_TS = 0.0
SOFASCORE_CACHE: Dict[str, List[dict]] = {}
SOFASCORE_LAST_REQUEST_TS = 0.0

LEADING_CLUB_TOKENS = {
    "fc",
    "sc",
    "fk",
    "if",
    "ac",
    "as",
    "rc",
    "rcd",
    "cd",
    "sd",
    "ud",
    "ad",
    "losc",
    "sco",
    "ofk",
    "rfk",
    "nk",
    "gnk",
    "hnk",
    "mfk",
    "sv",
    "tsg",
    "vfb",
    "vfl",
    "ssv",
    "usc",
    "ks",
    "kv",
    "mvv",
    "top",
    "r",
}


@dataclass
class ClubBadgeResult:
    club: str
    badge_path: Optional[str]
    source: str
    details: str


def normalize_text(value: str) -> str:
    norm = unicodedata.normalize("NFKD", value)
    norm = "".join(ch for ch in norm if not unicodedata.combining(ch))
    norm = norm.lower()
    norm = re.sub(r"[^a-z0-9]+", "", norm)
    return norm


def strip_suffix_tokens(name: str) -> str:
    suffixes = {"fc", "cf", "sc", "afc", "cfc", "club", "footballclub", "futebolclube", "futbolclub"}
    parts = re.split(r"\s+", name.strip())
    while parts:
        token = normalize_text(parts[-1])
        if token in suffixes:
            parts.pop()
            continue
        break
    return " ".join(parts).strip() or name.strip()


def core_name_key(name: str) -> str:
    parts = [normalize_text(part) for part in re.split(r"\W+", name) if normalize_text(part)]
    if not parts:
        return normalize_text(name)

    while len(parts) > 1 and (parts[0] in LEADING_CLUB_TOKENS or parts[0].isdigit()):
        parts.pop(0)

    while len(parts) > 1 and (
        parts[-1].isdigit()
        or re.fullmatch(r"(?:18|19|20)\d{2}", parts[-1]) is not None
        or parts[-1] in {"club", "fc", "cf", "sc"}
    ):
        parts.pop()

    key = "".join(parts)
    return key or normalize_text(name)


def parse_user_leagues(raw: str) -> Dict[str, List[str]]:
    leagues: Dict[str, List[str]] = {}
    current: Optional[str] = None

    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = re.match(r"^([^:]+)\s*:\s*(.*)$", line)
        if m:
            header = re.sub(r"\s+", " ", m.group(1).strip())
            header = header.replace("Seria A", "Serie A").replace("Seria B", "Serie B")
            rest = m.group(2).strip()
            if header not in LEAGUE_META:
                raise ValueError(f"Unknown league header in input: {header}")
            current = header
            leagues[current] = []
            if rest:
                leagues[current].extend(split_clubs(rest))
            continue

        if current is None:
            continue
        leagues[current].extend(split_clubs(line))

    # Dedupe while preserving order and clean trailing punctuation.
    for league_name, clubs in leagues.items():
        seen = set()
        out: List[str] = []
        for club in clubs:
            name = clean_club_name(club)
            if not name:
                continue
            if name not in seen:
                seen.add(name)
                out.append(name)
        leagues[league_name] = out

    missing = [key for key in LEAGUE_META if key not in leagues]
    if missing:
        raise ValueError(f"Missing leagues from parsed input: {missing}")

    return leagues


def split_clubs(text: str) -> List[str]:
    if "," in text:
        return [chunk.strip() for chunk in text.split(",") if chunk.strip()]
    return [text.strip()]


def clean_club_name(name: str) -> str:
    n = name.strip()
    # Keep club abbreviations with multiple periods (e.g. Neom S.C.)
    if n.endswith(".") and n.count(".") <= 1:
        n = n[:-1].strip()
    return n


def request_json(url: str, timeout: int = 12) -> dict:
    cached = SEARCH_CACHE.get(url)
    if cached is not None:
        return cached
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                SEARCH_CACHE[url] = payload
                return payload
        except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout, TimeoutError) as err:
            last_err = err
            if isinstance(err, urllib.error.HTTPError) and err.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(1.2 * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError("Unhandled request failure")


def request_bytes(url: str, timeout: int = 15) -> Tuple[bytes, str, str]:
    cached = BYTES_CACHE.get(url)
    if cached is not None:
        return cached
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "").lower()
                payload = (data, ctype, resp.geturl())
                BYTES_CACHE[url] = payload
                return payload
        except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout, TimeoutError) as err:
            last_err = err
            if isinstance(err, urllib.error.HTTPError) and err.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(1.2 * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError("Unhandled byte request failure")


def build_existing_badge_index() -> Dict[str, List[Path]]:
    idx: Dict[str, List[Path]] = {}
    for p in BADGES_ROOT.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
            continue
        full_key = normalize_text(p.stem)
        stripped_key = normalize_text(strip_suffix_tokens(p.stem))
        core_key = core_name_key(p.stem)
        idx.setdefault(full_key, []).append(p)
        idx.setdefault(stripped_key, []).append(p)
        idx.setdefault(core_key, []).append(p)
    return idx


def build_archive_badge_index() -> Dict[str, List[str]]:
    idx: Dict[str, List[str]] = {}
    if not ARCHIVE_ZIP.exists():
        return idx

    with zipfile.ZipFile(ARCHIVE_ZIP) as zf:
        for name in zf.namelist():
            lower = name.lower()
            if not lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".svg")):
                continue
            stem = Path(name).stem
            full_key = normalize_text(stem)
            stripped_key = normalize_text(strip_suffix_tokens(stem))
            core_key = core_name_key(stem)
            idx.setdefault(full_key, []).append(name)
            idx.setdefault(stripped_key, []).append(name)
            idx.setdefault(core_key, []).append(name)
    return idx


def safe_filename(name: str) -> str:
    # Keep readable names but avoid illegal path chars.
    out = name.replace("/", "-").replace("\\", "-").replace(":", "-")
    out = re.sub(r"\s+", " ", out).strip()
    return out


def ext_from_content_type(content_type: str, final_url: str) -> str:
    if "image/png" in content_type:
        return ".png"
    if "image/jpeg" in content_type:
        return ".jpg"
    if "image/webp" in content_type:
        return ".webp"
    if "image/svg" in content_type:
        return ".svg"
    parsed = urllib.parse.urlparse(final_url)
    ext = Path(parsed.path).suffix.lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
        return ".jpg" if ext == ".jpeg" else ext
    return ".png"


def wikipedia_search_titles(query: str, lang: str = "en") -> List[str]:
    cache_key = f"{lang}:{query}"
    if cache_key in WIKI_SEARCH_CACHE:
        return WIKI_SEARCH_CACHE[cache_key]
    api_url = (
        f"https://{lang}.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode(
            {
                "action": "query",
                "list": "search",
                "format": "json",
                "srlimit": 6,
                "srsearch": query,
            }
        )
    )
    js = request_json(api_url)
    rows = js.get("query", {}).get("search", [])
    titles = [row.get("title", "") for row in rows if row.get("title")]
    WIKI_SEARCH_CACHE[cache_key] = titles
    return titles


def sportsdb_search_teams(query: str) -> List[dict]:
    global SPORTSDB_LAST_REQUEST_TS
    if query in SPORTSDB_CACHE:
        return SPORTSDB_CACHE[query]
    api_url = (
        "https://www.thesportsdb.com/api/v1/json/3/searchteams.php?"
        + urllib.parse.urlencode({"t": query})
    )
    last_err: Optional[Exception] = None
    for attempt in range(3):
        wait = 0.9 - (time.time() - SPORTSDB_LAST_REQUEST_TS)
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(api_url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=12) as resp:
                js = json.loads(resp.read().decode("utf-8"))
                SPORTSDB_LAST_REQUEST_TS = time.time()
                teams = js.get("teams") or []
                SPORTSDB_CACHE[query] = teams
                return teams
        except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout, TimeoutError) as err:
            last_err = err
            SPORTSDB_LAST_REQUEST_TS = time.time()
            if isinstance(err, urllib.error.HTTPError) and err.code == 429:
                time.sleep(2.5 * (attempt + 1))
                continue
            if isinstance(err, urllib.error.HTTPError) and err.code not in (500, 502, 503, 504):
                raise
            time.sleep(1.5 * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError("Unhandled SportsDB request failure")


def club_lookup_keys(club_name: str) -> set[str]:
    keys = {
        normalize_text(club_name),
        core_name_key(club_name),
    }
    for alias in CLUB_ALIASES.get(club_name, []):
        keys.add(normalize_text(alias))
        keys.add(core_name_key(alias))
    for alias in LOCAL_NAME_ALIASES.get(club_name, []):
        keys.add(normalize_text(alias))
        keys.add(core_name_key(alias))
    return {key for key in keys if key}


def is_secondary_side(name: str) -> bool:
    lowered = name.lower()
    return any(
        re.search(pattern, lowered) is not None
        for pattern in (
            r"\bjong\b",
            r"\bu(?:23|21|19|18|17|16|15|14)\b",
            r"\breserves?\b",
            r"\bii\b",
            r"\bb\b",
        )
    )


def score_team_name(team_name: str, term: str, club_keys: set[str]) -> int:
    score = 0
    normalized_team = normalize_text(team_name)
    core_team = core_name_key(team_name)

    if normalized_team in club_keys:
        score += 120
    if core_team in club_keys:
        score += 90

    normalized_term = normalize_text(term)
    if normalized_term and normalized_term == normalized_team:
        score += 20

    if is_secondary_side(team_name) and not is_secondary_side(term):
        score -= 35

    # Allow close matches such as Al-Najmah U21 or FK Smederevo 1924.
    if normalized_team.startswith(normalized_term) or normalized_term.startswith(normalized_team):
        score += 30
    if core_team.startswith(normalized_term) or normalized_term.startswith(core_team):
        score += 20

    return score


def fetch_logo_via_sportsdb(club_name: str, nation: str) -> Optional[Tuple[bytes, str, str, str]]:
    terms: List[str] = [club_name]
    terms.extend(CLUB_ALIASES.get(club_name, []))
    terms.extend(LOCAL_NAME_ALIASES.get(club_name, []))

    seen_terms = set()
    best: Optional[Tuple[int, str, str]] = None
    club_keys = club_lookup_keys(club_name)

    for term in terms:
        if not term or term in seen_terms:
            continue
        seen_terms.add(term)
        if len(seen_terms) > 3:
            break
        try:
            teams = sportsdb_search_teams(term)
        except Exception:
            continue
        for team in teams[:6]:
            badge_url = team.get("strBadge") or team.get("strLogo")
            if not badge_url:
                continue
            team_name = team.get("strTeam") or ""
            team_country = team.get("strCountry") or ""
            score = score_team_name(team_name, term, club_keys)
            if nation and team_country and nation.lower() == team_country.lower():
                score += 20
            if best is None or score > best[0]:
                best = (score, badge_url, team_name)
        if best and best[0] >= 120:
            break

    if not best:
        return None

    badge_url = best[1]
    data, ctype, final_url = request_bytes(badge_url)
    if not ctype.startswith("image/"):
        return None
    return data, ctype, final_url, f"sportsdb:{best[2]}"


def sofascore_search_teams(query: str) -> List[dict]:
    global SOFASCORE_LAST_REQUEST_TS
    if query in SOFASCORE_CACHE:
        return SOFASCORE_CACHE[query]

    api_url = (
        "https://www.sofascore.com/api/v1/search/teams/?"
        + urllib.parse.urlencode({"q": query, "page": 0})
    )
    last_err: Optional[Exception] = None
    for attempt in range(3):
        wait = 0.25 - (time.time() - SOFASCORE_LAST_REQUEST_TS)
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                js = json.loads(resp.read().decode("utf-8"))
                SOFASCORE_LAST_REQUEST_TS = time.time()
                teams = js.get("results") or []
                SOFASCORE_CACHE[query] = teams
                return teams
        except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout, TimeoutError) as err:
            last_err = err
            SOFASCORE_LAST_REQUEST_TS = time.time()
            if isinstance(err, urllib.error.HTTPError) and err.code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            if isinstance(err, urllib.error.HTTPError) and err.code not in (500, 502, 503, 504):
                raise
            time.sleep(1.0 * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError("Unhandled SofaScore request failure")


def fetch_logo_via_sofascore(club_name: str, nation: str) -> Optional[Tuple[bytes, str, str, str]]:
    terms: List[str] = [club_name]
    terms.extend(CLUB_ALIASES.get(club_name, []))
    terms.extend(LOCAL_NAME_ALIASES.get(club_name, []))

    club_keys = club_lookup_keys(club_name)
    seen_terms = set()
    best: Optional[Tuple[int, int, str]] = None

    for term in terms:
        if not term or term in seen_terms:
            continue
        seen_terms.add(term)
        if len(seen_terms) > 4:
            break
        try:
            results = sofascore_search_teams(term)
        except Exception:
            continue
        for result in results[:8]:
            team = result.get("entity") or {}
            team_name = team.get("name") or ""
            team_id = team.get("id")
            if not team_name or not team_id:
                continue
            score = score_team_name(team_name, term, club_keys)
            team_country = (team.get("country") or {}).get("name") or ""
            if nation and team_country and nation.lower() == team_country.lower():
                score += 20
            if best is None or score > best[0]:
                best = (score, int(team_id), team_name)
        if best and best[0] >= 120:
            break

    if not best:
        return None

    badge_url = f"https://img.sofascore.com/api/v1/team/{best[1]}/image"
    data, ctype, final_url = request_bytes(badge_url)
    if not ctype.startswith("image/"):
        return None
    return data, ctype, final_url, f"sofascore:{best[2]}"


def extract_infobox_image_url(lang: str, title: str) -> Optional[str]:
    cache_key = f"{lang}:{title}"
    if cache_key in INFOBOX_CACHE:
        return INFOBOX_CACHE[cache_key]
    title_path = urllib.parse.quote(title.replace(" ", "_"), safe="()_%-")
    url = f"https://{lang}.wikipedia.org/wiki/{title_path}"
    data, _, _ = request_bytes(url, timeout=30)
    html = data.decode("utf-8", "ignore")

    table_match = re.search(r"<table[^>]*class=\"[^\"]*infobox[^\"]*\"[^>]*>(.*?)</table>", html, re.S | re.I)
    if not table_match:
        INFOBOX_CACHE[cache_key] = None
        return None

    table_html = table_match.group(1)
    imgs = re.findall(r"<img[^>]+src=\"([^\"]+)\"", table_html, re.I)
    for src in imgs:
        lower = src.lower()
        # Skip tiny decorative icons where possible.
        if "wikimedia-button" in lower or "commons-logo" in lower:
            continue
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = f"https://{lang}.wikipedia.org" + src
        # Prefer larger thumb for better visual quality.
        src = re.sub(r"/\d+px-", "/512px-", src)
        INFOBOX_CACHE[cache_key] = src
        return src
    INFOBOX_CACHE[cache_key] = None
    return None


def wikidata_search_entities(term: str) -> List[dict]:
    api_url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "wbsearchentities",
            "format": "json",
            "language": "en",
            "limit": 8,
            "search": term,
        }
    )
    js = request_json(api_url)
    return js.get("search", [])


def wikidata_get_entity(qid: str) -> dict:
    if qid in ENTITY_CACHE:
        return ENTITY_CACHE[qid]
    api_url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "wbgetentities",
            "format": "json",
            "ids": qid,
            "props": "claims|sitelinks|labels|descriptions",
        }
    )
    js = request_json(api_url)
    entity = js.get("entities", {}).get(qid, {})
    ENTITY_CACHE[qid] = entity
    return entity


def pick_candidates(club: str, nation: str) -> List[Tuple[int, str, dict]]:
    terms = [club] + CLUB_ALIASES.get(club, [])
    terms.append(f"{club} football club")
    terms.append(f"{club} {nation}")

    seen = set()
    candidates: List[Tuple[int, str, dict]] = []

    for term in terms:
        for hit in wikidata_search_entities(term):
            qid = hit.get("id")
            if not qid or qid in seen:
                continue
            seen.add(qid)
            label = hit.get("label", "")
            desc = (hit.get("description") or "").lower()
            score = 0
            if "football club" in desc or "association football club" in desc or "soccer club" in desc:
                score += 120
            if "football" in desc or "soccer" in desc:
                score += 60
            if "season" in desc or "match" in desc or "league" in desc:
                score -= 80
            if normalize_text(label) == normalize_text(club):
                score += 30
            if nation.lower() in desc:
                score += 15
            candidates.append((score, qid, hit))

    candidates.sort(key=lambda row: row[0], reverse=True)
    return candidates


def get_claim_file(entity: dict, prop: str) -> Optional[str]:
    for claim in entity.get("claims", {}).get(prop, []):
        mainsnak = claim.get("mainsnak", {})
        dv = mainsnak.get("datavalue", {})
        value = dv.get("value")
        if isinstance(value, str) and value:
            return value
    return None


def fetch_logo_from_p154(entity: dict) -> Optional[Tuple[bytes, str, str]]:
    filename = get_claim_file(entity, "P154")
    if not filename:
        return None
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(filename) + "?width=512"
    data, ctype, final_url = request_bytes(url)
    if not ctype.startswith("image/"):
        return None
    return data, ctype, final_url


def preferred_wikis(nation: str) -> List[str]:
    order = COUNTRY_WIKI_ORDER.get(nation, ["enwiki"])
    # Ensure enwiki is always available fallback.
    if "enwiki" not in order:
        order = order + ["enwiki"]
    return order


def fetch_logo_via_sitelinks(entity: dict, nation: str) -> Optional[Tuple[bytes, str, str, str]]:
    sitelinks = entity.get("sitelinks", {})
    for wiki_key in preferred_wikis(nation):
        entry = sitelinks.get(wiki_key)
        if not entry:
            continue
        title = entry.get("title")
        if not title:
            continue
        lang = wiki_key.replace("wiki", "")
        try:
            img_url = extract_infobox_image_url(lang, title)
        except Exception:
            continue
        if not img_url:
            continue
        try:
            data, ctype, final_url = request_bytes(img_url)
        except Exception:
            continue
        if not ctype.startswith("image/"):
            continue
        return data, ctype, final_url, f"{wiki_key}:{title}"
    return None


def fetch_logo_via_wikipedia_search(club_name: str, nation: str) -> Optional[Tuple[bytes, str, str, str]]:
    langs = [wk.replace("wiki", "") for wk in preferred_wikis(nation)]
    seen_titles = set()
    terms = [f"{club_name} football club", club_name]
    if CLUB_ALIASES.get(club_name):
        terms.insert(0, CLUB_ALIASES[club_name][0])

    # Try direct page-title patterns first to avoid search misses.
    direct_titles = [club_name]
    if CLUB_ALIASES.get(club_name):
        direct_titles.append(CLUB_ALIASES[club_name][0])
    direct_titles.extend(
        [
            f"{club_name} F.C.",
            f"{club_name} FC",
            f"{club_name} A.F.C.",
            f"{club_name} AFC",
        ]
    )
    for lang in langs[:2]:
        for title in direct_titles:
            key = f"{lang}:{title}"
            if key in seen_titles:
                continue
            seen_titles.add(key)
            try:
                img_url = extract_infobox_image_url(lang, title)
            except Exception:
                continue
            if not img_url:
                continue
            try:
                data, ctype, final_url = request_bytes(img_url)
            except Exception:
                continue
            if not ctype.startswith("image/"):
                continue
            return data, ctype, final_url, key

    for lang in langs[:2]:
        for term in terms:
            try:
                titles = wikipedia_search_titles(term, lang=lang)
            except Exception:
                continue
            for title in titles[:1]:
                key = f"{lang}:{title}"
                if key in seen_titles:
                    continue
                seen_titles.add(key)
                try:
                    img_url = extract_infobox_image_url(lang, title)
                except Exception:
                    continue
                if not img_url:
                    continue
                try:
                    data, ctype, final_url = request_bytes(img_url)
                except Exception:
                    continue
                if not ctype.startswith("image/"):
                    continue
                return data, ctype, final_url, key
    return None


def copy_from_existing(
    club_name: str,
    target_dir: Path,
    existing_index: Dict[str, List[Path]],
    preferred_league_folder: str,
) -> Optional[Path]:
    keys = [normalize_text(club_name), normalize_text(strip_suffix_tokens(club_name))]
    keys.append(core_name_key(club_name))
    for alias in LOCAL_NAME_ALIASES.get(club_name, []):
        keys.append(normalize_text(alias))
        keys.append(core_name_key(alias))
    for alias in CLUB_ALIASES.get(club_name, []):
        keys.append(normalize_text(alias))
        keys.append(core_name_key(alias))

    for key in keys:
        paths = existing_index.get(key, [])
        if not paths:
            continue
        # Prefer same league folder first.
        paths_sorted = sorted(
            paths,
            key=lambda p: (preferred_league_folder not in str(p.parent), len(str(p))),
        )
        src = paths_sorted[0]
        base = safe_filename(club_name)
        dst = target_dir / f"{base}{src.suffix.lower()}"
        if src.resolve() != dst.resolve():
            shutil.copy2(src, dst)
        return dst
    return None


def copy_from_archive(
    club_name: str,
    target_dir: Path,
    archive_index: Dict[str, List[str]],
    preferred_league_folder: str,
) -> Optional[Path]:
    if not archive_index or not ARCHIVE_ZIP.exists():
        return None

    keys = [normalize_text(club_name), normalize_text(strip_suffix_tokens(club_name))]
    keys.append(core_name_key(club_name))
    for alias in LOCAL_NAME_ALIASES.get(club_name, []):
        keys.append(normalize_text(alias))
        keys.append(core_name_key(alias))
    for alias in CLUB_ALIASES.get(club_name, []):
        keys.append(normalize_text(alias))
        keys.append(core_name_key(alias))

    for key in keys:
        members = archive_index.get(key, [])
        if not members:
            continue

        members_sorted = sorted(
            members,
            key=lambda member: (preferred_league_folder not in member, len(member)),
        )
        member = members_sorted[0]
        ext = Path(member).suffix.lower()
        ext = ".jpg" if ext == ".jpeg" else ext
        dst = target_dir / f"{safe_filename(club_name)}{ext}"

        with zipfile.ZipFile(ARCHIVE_ZIP) as zf:
            data = zf.read(member)
        dst.write_bytes(data)
        return dst
    return None


def ensure_badge_for_club(
    club_name: str,
    nation: str,
    league_folder: str,
    target_dir: Path,
    existing_index: Dict[str, List[Path]],
    archive_index: Dict[str, List[str]],
    allow_web_lookup: bool = True,
) -> ClubBadgeResult:
    target_dir.mkdir(parents=True, exist_ok=True)

    # Fast path: reuse an already available local crest first.
    copied = copy_from_existing(club_name, target_dir, existing_index, league_folder)
    if copied:
        return ClubBadgeResult(club_name, to_rel(copied), "local-fallback", str(copied))

    archived = copy_from_archive(club_name, target_dir, archive_index, league_folder)
    if archived:
        return ClubBadgeResult(club_name, to_rel(archived), "archive-fallback", str(ARCHIVE_ZIP))

    if not allow_web_lookup:
        return ClubBadgeResult(club_name, None, "missing", "No local image source resolved")

    try:
        sofascore_data = fetch_logo_via_sofascore(club_name, nation)
    except Exception:
        sofascore_data = None
    if sofascore_data:
        data, ctype, final_url, src_info = sofascore_data
        ext = ext_from_content_type(ctype, final_url)
        dst = target_dir / f"{safe_filename(club_name)}{ext}"
        dst.write_bytes(data)
        return ClubBadgeResult(club_name, to_rel(dst), "sofascore", src_info)

    try:
        sportsdb_data = fetch_logo_via_sportsdb(club_name, nation)
    except Exception:
        sportsdb_data = None
    if sportsdb_data:
        data, ctype, final_url, src_info = sportsdb_data
        ext = ext_from_content_type(ctype, final_url)
        dst = target_dir / f"{safe_filename(club_name)}{ext}"
        dst.write_bytes(data)
        return ClubBadgeResult(club_name, to_rel(dst), "sportsdb", src_info)

    # Wikimedia image delivery is currently blocked by robot-policy 429s in this environment,
    # so stop here instead of spending minutes on failing fallback requests.
    return ClubBadgeResult(club_name, None, "missing", "No local, SofaScore, or SportsDB image source resolved")

    # Prefer structured Wikidata matches before falling back to fuzzy search.
    for _score, qid, _hit in pick_candidates(club_name, nation)[:5]:
        try:
            entity = wikidata_get_entity(qid)
        except Exception:
            continue

        try:
            p154 = fetch_logo_from_p154(entity)
        except Exception:
            p154 = None
        if p154:
            data, ctype, final_url = p154
            ext = ext_from_content_type(ctype, final_url)
            dst = target_dir / f"{safe_filename(club_name)}{ext}"
            dst.write_bytes(data)
            return ClubBadgeResult(club_name, to_rel(dst), "wikidata:p154", qid)

        try:
            sitelink_data = fetch_logo_via_sitelinks(entity, nation)
        except Exception:
            sitelink_data = None
        if sitelink_data:
            data, ctype, final_url, src_info = sitelink_data
            ext = ext_from_content_type(ctype, final_url)
            dst = target_dir / f"{safe_filename(club_name)}{ext}"
            dst.write_bytes(data)
            return ClubBadgeResult(club_name, to_rel(dst), "wikidata:sitelink", src_info)

    manual_url = MANUAL_BADGE_URLS.get(club_name)
    if manual_url:
        try:
            data, ctype, final_url = request_bytes(manual_url)
            if ctype.startswith("image/"):
                ext = ext_from_content_type(ctype, final_url)
                dst = target_dir / f"{safe_filename(club_name)}{ext}"
                dst.write_bytes(data)
                return ClubBadgeResult(club_name, to_rel(dst), "manual-url", manual_url)
        except Exception:
            pass

    # Fast web path: direct Wikipedia search by club name.
    try:
        wiki_data = fetch_logo_via_wikipedia_search(club_name, nation)
    except Exception:
        wiki_data = None
    if wiki_data:
        data, ctype, final_url, src_info = wiki_data
        ext = ext_from_content_type(ctype, final_url)
        dst = target_dir / f"{safe_filename(club_name)}{ext}"
        dst.write_bytes(data)
        return ClubBadgeResult(club_name, to_rel(dst), "wikipedia:search", src_info)

    # Last fallback: no badge found.
    return ClubBadgeResult(club_name, None, "missing", "No image source resolved")


def to_rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def build_league_definitions(
    parsed: Dict[str, List[str]],
    league_keys: Optional[List[str]] = None,
    allow_web_lookup: bool = True,
) -> Tuple[List[dict], dict]:
    selected = league_keys or list(LEAGUE_META.keys())
    existing_index = build_existing_badge_index()
    archive_index = build_archive_badge_index()
    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "selectedLeagues": selected,
        "leagues": {},
        "missing": [],
    }

    definitions: List[dict] = []

    for league_key in selected:
        meta = LEAGUE_META[league_key]
        clubs = parsed[league_key]
        folder = meta["name"]
        target_dir = BADGES_ROOT / folder

        league_report = {"clubs": [], "sources": {}}
        club_defs = []

        print(f"[{league_key}] {len(clubs)} clubs", flush=True)
        for idx, club in enumerate(clubs, start=1):
            print(f"  - {idx:02d}/{len(clubs)} {club}", flush=True)
            result = ensure_badge_for_club(
                club_name=club,
                nation=meta["nation"],
                league_folder=folder,
                target_dir=target_dir,
                existing_index=existing_index,
                archive_index=archive_index,
                allow_web_lookup=allow_web_lookup,
            )
            if result.badge_path is None:
                report["missing"].append({"league": league_key, "club": club})
                badge_path = ""
            else:
                badge_path = result.badge_path

            league_report["clubs"].append(
                {
                    "club": club,
                    "badge": badge_path,
                    "source": result.source,
                    "details": result.details,
                }
            )
            league_report["sources"][result.source] = league_report["sources"].get(result.source, 0) + 1

            club_defs.append(
                {
                    "name": club,
                    "badge": badge_path,
                }
            )

            time.sleep(0.02)

        report["leagues"][league_key] = league_report

        definitions.append(
            {
                "name": meta["name"],
                "displayName": meta["displayName"],
                "nation": meta["nation"],
                "tier": meta["tier"],
                "financialPower": meta["financialPower"],
                "badgeFolder": f"badges/{folder}",
                "clubs": club_defs,
            }
        )

    return definitions, report


def write_league_data(definitions: List[dict]) -> None:
    payload = json.dumps(definitions, ensure_ascii=False, indent=2)
    content = (
        "// Auto-generated by apply_user_leagues_and_badges.py\n"
        "// User-curated playable leagues and clubs\n\n"
        f"export const LEAGUE_DEFINITIONS = {payload};\n\n"
        "export default LEAGUE_DEFINITIONS;\n"
    )
    LEAGUE_DATA_FILE.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply user-provided leagues and badges")
    parser.add_argument(
        "--league",
        action="append",
        help="Process only this league key (repeatable). Example: --league 'Premier League'",
    )
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Rebuild league data using only local badge files; skip remote badge lookups.",
    )
    args = parser.parse_args()

    parsed = parse_user_leagues(RAW_LEAGUE_INPUT)
    if args.league:
        unknown = [name for name in args.league if name not in LEAGUE_META]
        if unknown:
            raise ValueError(f"Unknown league key(s): {unknown}")
        league_keys = args.league
    else:
        league_keys = list(LEAGUE_META.keys())

    definitions, report = build_league_definitions(
        parsed,
        league_keys=league_keys,
        allow_web_lookup=not args.local_only,
    )
    write_league_data(definitions)
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total = sum(len(parsed[k]) for k in league_keys)
    missing = len(report["missing"])
    print("\nDone")
    print(f"Leagues: {len(definitions)}")
    print(f"Clubs: {total}")
    print(f"Missing badges: {missing}")
    print(f"Report: {REPORT_FILE.name}")


if __name__ == "__main__":
    main()
