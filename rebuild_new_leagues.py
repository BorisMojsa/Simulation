#!/usr/bin/env python3
"""Rebuild league-data.js + badges/ for the approved 26-league set (2026 / 2026–27)."""
from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import apply_user_leagues_and_badges as helper

ROOT = Path(__file__).resolve().parent
LEAGUE_DATA_FILE = ROOT / "league-data.js"
REPORT_FILE = ROOT / "badge-import-report.json"
BADGES_ROOT = ROOT / "badges"

SECONDARY_SOURCE_PATTERN = re.compile(
    r"\b(?:u(?:23|21|19|18|17|16)|ii|jong|reserve|reserves|women|feminine|femenino)\b",
    re.I,
)

# name, displayName, nation, tier, financialPower, clubs
# Club entries are display names used for badges/search; optional aliases help SportsDB.
LEAGUES: List[dict] = [
    {
        "name": "England - Premier League",
        "displayName": "Premier League",
        "nation": "England",
        "tier": 5,
        "financialPower": 5,
        "clubs": [
            "Arsenal",
            "Aston Villa",
            "AFC Bournemouth",
            "Brentford",
            "Brighton & Hove Albion",
            "Chelsea",
            "Coventry City",
            "Crystal Palace",
            "Everton",
            "Fulham",
            "Hull City",
            "Ipswich Town",
            "Leeds United",
            "Liverpool",
            "Manchester City",
            "Manchester United",
            "Newcastle United",
            "Nottingham Forest",
            "Sunderland",
            "Tottenham Hotspur",
        ],
    },
    {
        "name": "England - Championship",
        "displayName": "Championship",
        "nation": "England",
        "tier": 4,
        "financialPower": 4,
        "clubs": [
            "Birmingham City",
            "Blackburn Rovers",
            "Bolton Wanderers",
            "Bristol City",
            "Burnley",
            "Cardiff City",
            "Charlton Athletic",
            "Derby County",
            "Lincoln City",
            "Middlesbrough",
            "Millwall",
            "Norwich City",
            "Portsmouth",
            "Preston North End",
            "Queens Park Rangers",
            "Sheffield United",
            "Southampton",
            "Stoke City",
            "Swansea City",
            "Watford",
            "West Bromwich Albion",
            "West Ham United",
            "Wolverhampton Wanderers",
            "Wrexham",
        ],
    },
    {
        "name": "Germany - Bundesliga",
        "displayName": "Bundesliga",
        "nation": "Germany",
        "tier": 5,
        "financialPower": 5,
        "clubs": [
            "FC Augsburg",
            "Union Berlin",
            "Werder Bremen",
            "Borussia Dortmund",
            "SV Elversberg",
            "Eintracht Frankfurt",
            "SC Freiburg",
            "Hamburger SV",
            "TSG Hoffenheim",
            "1. FC Köln",
            "RB Leipzig",
            "Bayer Leverkusen",
            "Mainz 05",
            "Borussia Mönchengladbach",
            "Bayern Munich",
            "SC Paderborn",
            "Schalke 04",
            "VfB Stuttgart",
        ],
    },
    {
        "name": "Germany - 2. Bundesliga",
        "displayName": "2. Bundesliga",
        "nation": "Germany",
        "tier": 4,
        "financialPower": 3,
        "clubs": [
            "Hertha BSC",
            "Arminia Bielefeld",
            "VfL Bochum",
            "Eintracht Braunschweig",
            "Energie Cottbus",
            "Darmstadt 98",
            "Dynamo Dresden",
            "Greuther Fürth",
            "Hannover 96",
            "1. FC Heidenheim",
            "1. FC Kaiserslautern",
            "Karlsruher SC",
            "Holstein Kiel",
            "1. FC Magdeburg",
            "1. FC Nürnberg",
            "VfL Osnabrück",
            "FC St. Pauli",
            "VfL Wolfsburg",
        ],
    },
    {
        "name": "Spain - La Liga",
        "displayName": "La Liga",
        "nation": "Spain",
        "tier": 5,
        "financialPower": 5,
        "clubs": [
            "Deportivo Alavés",
            "Athletic Bilbao",
            "Atlético Madrid",
            "FC Barcelona",
            "Celta Vigo",
            "Deportivo de La Coruña",
            "Elche",
            "Espanyol",
            "Getafe",
            "Levante",
            "Málaga",
            "Osasuna",
            "Racing Santander",
            "Rayo Vallecano",
            "Real Betis",
            "Real Madrid",
            "Real Sociedad",
            "Sevilla",
            "Valencia",
            "Villarreal",
        ],
    },
    {
        "name": "Spain - LaLiga 2",
        "displayName": "LaLiga 2",
        "nation": "Spain",
        "tier": 4,
        "financialPower": 3,
        "clubs": [
            "Albacete",
            "Almería",
            "FC Andorra",
            "Burgos",
            "Cádiz",
            "Castellón",
            "Celta Fortuna",
            "AD Ceuta",
            "Córdoba",
            "Eibar",
            "Eldense",
            "Girona",
            "Granada",
            "Las Palmas",
            "Leganés",
            "Mallorca",
            "Real Oviedo",
            "Real Sociedad B",
            "Sabadell",
            "Sporting Gijón",
            "Tenerife",
            "Real Valladolid",
        ],
    },
    {
        "name": "Italy - Serie A",
        "displayName": "Serie A",
        "nation": "Italy",
        "tier": 5,
        "financialPower": 5,
        "clubs": [
            "Atalanta",
            "Bologna",
            "Cagliari",
            "Como",
            "Fiorentina",
            "Frosinone",
            "Genoa",
            "Inter Milan",
            "Juventus",
            "Lazio",
            "Lecce",
            "AC Milan",
            "Monza",
            "Napoli",
            "Parma",
            "Roma",
            "Sassuolo",
            "Torino",
            "Udinese",
            "Venezia",
        ],
    },
    {
        "name": "Italy - Serie B",
        "displayName": "Serie B",
        "nation": "Italy",
        "tier": 4,
        "financialPower": 3,
        "clubs": [
            "Arezzo",
            "Ascoli",
            "Avellino",
            "Benevento",
            "Carrarese",
            "Catanzaro",
            "Cesena",
            "Cremonese",
            "Empoli",
            "Hellas Verona",
            "Juve Stabia",
            "Mantova",
            "Modena",
            "Padova",
            "Palermo",
            "Pisa",
            "Reggiana",
            "Sampdoria",
            "Spezia",
            "Südtirol",
        ],
    },
    {
        "name": "France - Ligue 1",
        "displayName": "Ligue 1",
        "nation": "France",
        "tier": 4,
        "financialPower": 4,
        "clubs": [
            "Angers",
            "Auxerre",
            "Brest",
            "Le Havre",
            "Le Mans",
            "Lens",
            "Lille",
            "Lorient",
            "Lyon",
            "Marseille",
            "Monaco",
            "Nice",
            "Paris FC",
            "Paris Saint-Germain",
            "Rennes",
            "Strasbourg",
            "Toulouse",
            "Troyes",
        ],
    },
    {
        "name": "France - Ligue 2",
        "displayName": "Ligue 2",
        "nation": "France",
        "tier": 3,
        "financialPower": 2,
        "clubs": [
            "Annecy",
            "Boulogne",
            "Clermont",
            "Dijon",
            "Dunkerque",
            "Grenoble",
            "Guingamp",
            "Laval",
            "Metz",
            "Montpellier",
            "Nancy",
            "Nantes",
            "Pau",
            "Red Star",
            "Reims",
            "Rodez",
            "Saint-Étienne",
            "Sochaux",
        ],
    },
    {
        "name": "Brazil - Brasileirão Série A",
        "displayName": "Brasileirão Série A",
        "nation": "Brazil",
        "tier": 4,
        "financialPower": 4,
        "clubs": [
            "Athletico Paranaense",
            "Atlético Mineiro",
            "Bahia",
            "Botafogo",
            "Red Bull Bragantino",
            "Chapecoense",
            "Corinthians",
            "Coritiba",
            "Cruzeiro",
            "Flamengo",
            "Fluminense",
            "Grêmio",
            "Internacional",
            "Mirassol",
            "Palmeiras",
            "Remo",
            "Santos",
            "São Paulo",
            "Vasco da Gama",
            "Vitória",
        ],
    },
    {
        "name": "Belgium - Belgian Pro League",
        "displayName": "Belgian Pro League",
        "nation": "Belgium",
        "tier": 3,
        "financialPower": 3,
        "clubs": [
            "Anderlecht",
            "Antwerp",
            "Cercle Brugge",
            "Charleroi",
            "Club Brugge",
            "Genk",
            "Gent",
            "Mechelen",
            "OH Leuven",
            "Sint-Truiden",
            "Standard Liège",
            "Union Saint-Gilloise",
            "Westerlo",
            "Zulte Waregem",
            "Dender",
            "RAAL La Louvière",
        ],
    },
    {
        "name": "Argentina - Liga Profesional",
        "displayName": "Liga Profesional",
        "nation": "Argentina",
        "tier": 4,
        "financialPower": 3,
        "clubs": [
            "Aldosivi",
            "Argentinos Juniors",
            "Atlético Tucumán",
            "Banfield",
            "Barracas Central",
            "Belgrano",
            "Boca Juniors",
            "Central Córdoba",
            "Defensa y Justicia",
            "Deportivo Riestra",
            "Estudiantes",
            "Estudiantes Río Cuarto",
            "Gimnasia La Plata",
            "Gimnasia Mendoza",
            "Huracán",
            "Independiente",
            "Independiente Rivadavia",
            "Instituto",
            "Lanús",
            "Newell's Old Boys",
            "Platense",
            "Racing Club",
            "River Plate",
            "Rosario Central",
            "San Lorenzo",
            "Sarmiento",
            "Talleres",
            "Tigre",
            "Unión",
            "Vélez Sarsfield",
        ],
    },
    {
        "name": "Portugal - Primeira Liga",
        "displayName": "Primeira Liga",
        "nation": "Portugal",
        "tier": 4,
        "financialPower": 3,
        "clubs": [
            "Alverca",
            "Arouca",
            "AVS",
            "Benfica",
            "Braga",
            "Casa Pia",
            "Estoril",
            "Estrela Amadora",
            "Famalicão",
            "Gil Vicente",
            "Moreirense",
            "Nacional",
            "Porto",
            "Rio Ave",
            "Santa Clara",
            "Sporting CP",
            "Tondela",
            "Vitória Guimarães",
        ],
    },
    {
        "name": "Poland - Ekstraklasa",
        "displayName": "Ekstraklasa",
        "nation": "Poland",
        "tier": 3,
        "financialPower": 2,
        "clubs": [
            "Cracovia",
            "GKS Katowice",
            "Górnik Zabrze",
            "Jagiellonia Białystok",
            "Korona Kielce",
            "Lech Poznań",
            "Legia Warsaw",
            "Motor Lublin",
            "Piast Gliwice",
            "Pogoń Szczecin",
            "Radomiak Radom",
            "Raków Częstochowa",
            "Widzew Łódź",
            "Wisła Płock",
            "Zagłębie Lubin",
            "Arka Gdynia",
            "Lechia Gdańsk",
            "Nieciecza",
        ],
    },
    {
        "name": "Denmark - Superliga",
        "displayName": "Danish Superliga",
        "nation": "Denmark",
        "tier": 3,
        "financialPower": 2,
        "clubs": [
            "AGF",
            "Brøndby",
            "FC Copenhagen",
            "FC Midtjylland",
            "Nordsjælland",
            "OB",
            "Randers",
            "Silkeborg",
            "Sønderjyske",
            "Vejle",
            "Viborg",
            "Fredericia",
        ],
    },
    {
        "name": "Norway - Eliteserien",
        "displayName": "Eliteserien",
        "nation": "Norway",
        "tier": 3,
        "financialPower": 2,
        "clubs": [
            "Bodø/Glimt",
            "Brann",
            "Fredrikstad",
            "HamKam",
            "KFUM Oslo",
            "Kristiansund",
            "Molde",
            "Rosenborg",
            "Sarpsborg 08",
            "Strømsgodset",
            "Tromsø",
            "Viking",
            "Vålerenga",
            "Bryne",
            "Haugesund",
            "Sandefjord",
        ],
    },
    {
        "name": "Mexico - Liga MX",
        "displayName": "Liga MX",
        "nation": "Mexico",
        "tier": 4,
        "financialPower": 3,
        "clubs": [
            "América",
            "Atlas",
            "Atlético San Luis",
            "Cruz Azul",
            "Guadalajara",
            "Juárez",
            "León",
            "Mazatlán",
            "Monterrey",
            "Necaxa",
            "Pachuca",
            "Puebla",
            "Querétaro",
            "Santos Laguna",
            "Tijuana",
            "Toluca",
            "Tigres UANL",
            "UNAM",
        ],
    },
    {
        "name": "Colombia - Categoría Primera A",
        "displayName": "Categoría Primera A",
        "nation": "Colombia",
        "tier": 3,
        "financialPower": 2,
        "clubs": [
            "Águilas Doradas",
            "Alianza",
            "América de Cali",
            "Atlético Bucaramanga",
            "Atlético Nacional",
            "Boyacá Chicó",
            "Cúcuta Deportivo",
            "Deportes Tolima",
            "Deportivo Cali",
            "Deportivo Pasto",
            "Deportivo Pereira",
            "Fortaleza CEIF",
            "Independiente Medellín",
            "Internacional de Bogotá",
            "Jaguares",
            "Junior",
            "Llaneros",
            "Millonarios",
            "Once Caldas",
            "Santa Fe",
        ],
    },
    {
        "name": "Netherlands - Eredivisie",
        "displayName": "Eredivisie",
        "nation": "Netherlands",
        "tier": 3,
        "financialPower": 3,
        "clubs": [
            "Ajax",
            "AZ",
            "Excelsior",
            "Feyenoord",
            "Fortuna Sittard",
            "Go Ahead Eagles",
            "Groningen",
            "Heerenveen",
            "Heracles Almelo",
            "NAC Breda",
            "NEC",
            "PEC Zwolle",
            "PSV",
            "Sparta Rotterdam",
            "Telstar",
            "Twente",
            "Utrecht",
            "Volendam",
        ],
    },
    {
        "name": "Ecuador - LigaPro Serie A",
        "displayName": "LigaPro Serie A",
        "nation": "Ecuador",
        "tier": 2,
        "financialPower": 2,
        "clubs": [
            "Aucas",
            "Barcelona SC",
            "Delfín",
            "Deportivo Cuenca",
            "Emelec",
            "Guayaquil City",
            "Independiente del Valle",
            "LDU Quito",
            "Leones",
            "Libertad",
            "Macará",
            "Manta",
            "Mushuc Runa",
            "Orense",
            "Técnico Universitario",
            "Universidad Católica",
        ],
    },
    {
        "name": "Türkiye - Süper Lig",
        "displayName": "Süper Lig",
        "nation": "Turkey",
        "tier": 3,
        "financialPower": 3,
        "clubs": [
            "Alanyaspor",
            "Antalyaspor",
            "Beşiktaş",
            "Eyüpspor",
            "Fenerbahçe",
            "Galatasaray",
            "Gaziantep",
            "Göztepe",
            "Başakşehir",
            "Kasımpaşa",
            "Kayserispor",
            "Konyaspor",
            "Rizespor",
            "Samsunspor",
            "Trabzonspor",
            "Kocaelispor",
            "Gençlerbirliği",
            "Fatih Karagümrük",
        ],
    },
    {
        "name": "United States - MLS",
        "displayName": "Major League Soccer",
        "nation": "United States",
        "tier": 3,
        "financialPower": 3,
        "clubs": [
            "Atlanta United",
            "Austin FC",
            "Charlotte FC",
            "Chicago Fire",
            "FC Cincinnati",
            "Colorado Rapids",
            "Columbus Crew",
            "DC United",
            "FC Dallas",
            "Houston Dynamo",
            "Sporting Kansas City",
            "LA Galaxy",
            "Los Angeles FC",
            "Inter Miami",
            "Minnesota United",
            "CF Montréal",
            "Nashville SC",
            "New England Revolution",
            "New York Red Bulls",
            "New York City FC",
            "Orlando City",
            "Philadelphia Union",
            "Portland Timbers",
            "Real Salt Lake",
            "San Diego FC",
            "San Jose Earthquakes",
            "Seattle Sounders",
            "St. Louis City",
            "Toronto FC",
            "Vancouver Whitecaps",
        ],
    },
    {
        "name": "Czechia - Czech First League",
        "displayName": "Czech First League",
        "nation": "Czech Republic",
        "tier": 2,
        "financialPower": 2,
        "clubs": [
            "Artis Brno",
            "Bohemians 1905",
            "Hradec Králové",
            "Jablonec",
            "Slovan Liberec",
            "Mladá Boleslav",
            "Sigma Olomouc",
            "Baník Ostrava",
            "Pardubice",
            "Viktoria Plzeň",
            "Slavia Prague",
            "Slovácko",
            "Sparta Prague",
            "Teplice",
            "Zlín",
            "Dukla Prague",
        ],
    },
    {
        "name": "Croatia - HNL",
        "displayName": "Croatian HNL",
        "nation": "Croatia",
        "tier": 2,
        "financialPower": 2,
        "clubs": [
            "Dinamo Zagreb",
            "Gorica",
            "Hajduk Split",
            "Istra 1961",
            "Lokomotiva Zagreb",
            "Osijek",
            "Rijeka",
            "Rudeš",
            "Slaven Belupo",
            "Varaždin",
        ],
    },
    {
        "name": "Serbia - SuperLiga",
        "displayName": "Serbian SuperLiga",
        "nation": "Serbia",
        "tier": 2,
        "financialPower": 2,
        "clubs": [
            "Red Star Belgrade",
            "Čukarički",
            "IMT",
            "Mačva Šabac",
            "Mladost Lučani",
            "Novi Pazar",
            "OFK Beograd",
            "Partizan",
            "Radnički 1923",
            "Radnički Niš",
            "Radnik Surdulica",
            "Vojvodina",
            "Zemun",
            "Železničar Pančevo",
            "TSC Bačka Topola",
            "Napredak Kruševac",
        ],
    },
]

# Extra search aliases for SportsDB badge matching
CLUB_SEARCH_ALIASES: Dict[str, List[str]] = {
    "AFC Bournemouth": ["Bournemouth"],
    "Brighton & Hove Albion": ["Brighton"],
    "Manchester United": ["Man United"],
    "Manchester City": ["Man City"],
    "Tottenham Hotspur": ["Tottenham"],
    "Wolverhampton Wanderers": ["Wolves"],
    "West Ham United": ["West Ham"],
    "Queens Park Rangers": ["QPR"],
    "1. FC Köln": ["FC Koln", "Cologne"],
    "Bayer Leverkusen": ["Bayer 04 Leverkusen"],
    "Bayern Munich": ["Bayern München", "FC Bayern Munich"],
    "Mainz 05": ["FSV Mainz 05", "1. FSV Mainz 05"],
    "Union Berlin": ["1. FC Union Berlin"],
    "Werder Bremen": ["SV Werder Bremen"],
    "SC Paderborn": ["Paderborn 07", "SC Paderborn 07"],
    "Atlético Madrid": ["Atletico Madrid"],
    "Deportivo de La Coruña": ["Deportivo La Coruna", "Deportivo"],
    "Racing Santander": ["Racing de Santander"],
    "Inter Milan": ["Inter", "FC Internazionale"],
    "AC Milan": ["Milan"],
    "Paris Saint-Germain": ["PSG", "Paris SG"],
    "Saint-Étienne": ["Saint Etienne", "AS Saint-Etienne"],
    "Red Bull Bragantino": ["Bragantino", "RB Bragantino"],
    "São Paulo": ["Sao Paulo"],
    "Vasco da Gama": ["Vasco"],
    "Vitória": ["EC Vitoria", "Vitoria"],
    "Union Saint-Gilloise": ["Union SG", "Royale Union Saint-Gilloise"],
    "Standard Liège": ["Standard Liege"],
    "RAAL La Louvière": ["La Louviere", "RAAL La Louviere"],
    "Estudiantes": ["Estudiantes de La Plata"],
    "Newell's Old Boys": ["Newells Old Boys"],
    "Racing Club": ["Racing Club Avellaneda", "Racing Avellaneda"],
    "Vélez Sarsfield": ["Velez Sarsfield"],
    "Sporting CP": ["Sporting Lisbon", "Sporting"],
    "Vitória Guimarães": ["Vitoria Guimaraes", "Guimaraes"],
    "FC Copenhagen": ["Kobenhavn", "FC København"],
    "Bodø/Glimt": ["Bodo Glimt", "Bodo/Glimt"],
    "CF Montréal": ["CF Montreal", "Montreal Impact"],
    "DC United": ["D.C. United"],
    "Los Angeles FC": ["LAFC"],
    "St. Louis City": ["St. Louis CITY SC", "St Louis City"],
    "Red Star Belgrade": ["Crvena zvezda", "FK Crvena zvezda"],
    "Partizan": ["FK Partizan", "Partizan Belgrade"],
    "TSC Bačka Topola": ["TSC Backa Topola", "FK TSC"],
    "UNAM": ["Pumas UNAM", "Club Universidad Nacional"],
    "América": ["Club America", "CF America"],
    "Guadalajara": ["Chivas", "CD Guadalajara"],
    "Tigres UANL": ["Tigres", "UANL"],
    "Junior": ["Atletico Junior", "Junior Barranquilla"],
    "Barcelona SC": ["Barcelona Guayaquil"],
    "LDU Quito": ["LDU", "Liga de Quito"],
    "Independiente del Valle": ["IDV"],
    "Slavia Prague": ["SK Slavia Praha"],
    "Sparta Prague": ["AC Sparta Praha"],
    "Dinamo Zagreb": ["GNK Dinamo Zagreb"],
    "Hajduk Split": ["HNK Hajduk Split"],
}


def clear_badges_root() -> None:
    BADGES_ROOT.mkdir(parents=True, exist_ok=True)
    for child in BADGES_ROOT.iterdir():
        if child.name == ".DS_Store":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def fetch_badge_for_club(club_name: str, nation: str, target_dir: Path) -> Tuple[Optional[str], str, str]:
    # Temporarily extend aliases used by helper scoring
    old_aliases = helper.CLUB_ALIASES.get(club_name)
    helper.CLUB_ALIASES[club_name] = CLUB_SEARCH_ALIASES.get(club_name, [])

    try:
        queries = [club_name, *CLUB_SEARCH_ALIASES.get(club_name, [])]
        fallback: Optional[Tuple[bytes, str, str, str, str]] = None

        for query in queries:
            for fetcher_name, fetcher in (
                ("sportsdb", helper.fetch_logo_via_sportsdb),
                ("sofascore", helper.fetch_logo_via_sofascore),
            ):
                try:
                    fetched = fetcher(query, nation)
                except Exception:
                    fetched = None
                if not fetched:
                    continue
                data, ctype, final_url, src_info = fetched
                if SECONDARY_SOURCE_PATTERN.search(src_info):
                    if fallback is None:
                        fallback = (data, ctype, final_url, fetcher_name, src_info)
                    continue
                ext = helper.ext_from_content_type(ctype, final_url)
                dst = target_dir / f"{helper.safe_filename(club_name)}{ext}"
                dst.write_bytes(data)
                return helper.to_rel(dst), fetcher_name, src_info

        if fallback:
            data, ctype, final_url, fetcher_name, src_info = fallback
            ext = helper.ext_from_content_type(ctype, final_url)
            dst = target_dir / f"{helper.safe_filename(club_name)}{ext}"
            dst.write_bytes(data)
            return helper.to_rel(dst), fetcher_name, src_info

        return None, "missing", "No online image source resolved"
    finally:
        if old_aliases is None:
            helper.CLUB_ALIASES.pop(club_name, None)
        else:
            helper.CLUB_ALIASES[club_name] = old_aliases


def build_definitions_and_badges(only_league: Optional[str] = None) -> Tuple[List[dict], dict]:
    if only_league is None:
        clear_badges_root()

    definitions: List[dict] = []
    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "selectedLeagues": [league["displayName"] for league in LEAGUES],
        "leagues": {},
        "missing": [],
        "validation": {},
    }

    total_clubs = 0
    for league_meta in LEAGUES:
        if only_league and only_league not in (league_meta["name"], league_meta["displayName"]):
            continue

        badge_folder = f"badges/{league_meta['name']}"
        target_dir = ROOT / badge_folder
        if only_league:
            if target_dir.exists():
                shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        clubs_out: List[dict] = []
        league_report = {"clubs": [], "sources": {}}
        print(f"\n[{league_meta['displayName']}] {len(league_meta['clubs'])} clubs", flush=True)

        for idx, club_name in enumerate(league_meta["clubs"], start=1):
            print(f"  - {idx:02d}/{len(league_meta['clubs'])} {club_name}", flush=True)
            badge_path, source, details = fetch_badge_for_club(club_name, league_meta["nation"], target_dir)
            club = {"name": club_name, "badge": badge_path or ""}
            clubs_out.append(club)
            league_report["clubs"].append(
                {
                    "club": club_name,
                    "badge": club["badge"],
                    "source": source,
                    "details": details,
                }
            )
            league_report["sources"][source] = league_report["sources"].get(source, 0) + 1
            if not badge_path:
                report["missing"].append({"league": league_meta["name"], "club": club_name})
            time.sleep(0.35)

        total_clubs += len(clubs_out)
        definitions.append(
            {
                "name": league_meta["name"],
                "displayName": league_meta["displayName"],
                "nation": league_meta["nation"],
                "tier": league_meta["tier"],
                "financialPower": league_meta["financialPower"],
                "badgeFolder": badge_folder,
                "clubs": clubs_out,
            }
        )
        report["leagues"][league_meta["displayName"]] = league_report

    # If only one league was refreshed, merge into existing league-data.js
    if only_league and LEAGUE_DATA_FILE.exists():
        existing = parse_existing()
        by_name = {d["name"]: d for d in existing}
        for d in definitions:
            by_name[d["name"]] = d
        order = [league["name"] for league in LEAGUES]
        definitions = [by_name[name] for name in order if name in by_name]

    missing_badges = [
        f"{league['name']} :: {club['name']}"
        for league in definitions
        for club in league["clubs"]
        if not club.get("badge")
    ]
    report["validation"] = {
        "leagueCount": len(definitions),
        "clubCount": sum(len(l["clubs"]) for l in definitions),
        "missingBadgePaths": missing_badges,
    }
    return definitions, report


def parse_existing() -> List[dict]:
    text = LEAGUE_DATA_FILE.read_text(encoding="utf-8")
    match = re.search(
        r"export const LEAGUE_DEFINITIONS = (\[.*\]);\s*export default LEAGUE_DEFINITIONS;\s*$",
        text,
        re.S,
    )
    if not match:
        return []
    return json.loads(match.group(1))


def write_league_data(definitions: List[dict]) -> None:
    payload = json.dumps(definitions, ensure_ascii=False, indent=2)
    content = (
        "// Auto-generated by rebuild_new_leagues.py\n"
        "// 26-league runtime dataset with online-fetched badges\n\n"
        f"export const LEAGUE_DEFINITIONS = {payload};\n\n"
        "export default LEAGUE_DEFINITIONS;\n"
    )
    LEAGUE_DATA_FILE.write_text(content, encoding="utf-8")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--league", help="Rebuild only one league (name or displayName)")
    args = parser.parse_args()

    definitions, report = build_definitions_and_badges(only_league=args.league)
    write_league_data(definitions)
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\nDone", flush=True)
    print(f"Leagues: {report['validation']['leagueCount']}", flush=True)
    print(f"Clubs: {report['validation']['clubCount']}", flush=True)
    print(f"Missing badges: {len(report['validation']['missingBadgePaths'])}", flush=True)
    if report["validation"]["missingBadgePaths"]:
        for item in report["validation"]["missingBadgePaths"][:40]:
            print(f"  MISSING {item}", flush=True)
    print(f"Report: {REPORT_FILE.name}", flush=True)


if __name__ == "__main__":
    main()
