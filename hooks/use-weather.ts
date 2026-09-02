import { useState, useEffect } from 'react';

interface WeatherData {
  temperature: number;
  weatherCode: number;
  loading: boolean;
  error?: string;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

// Mapa aerodroma i koordinata
const AIRPORT_COORDINATES: Record<string, Coordinates> = {
  // ── POSTOJEĆE ──
  'IST': { latitude: 41.2753, longitude: 28.7519 },
  'SAW': { latitude: 40.8986, longitude: 29.3092 },
  'ESB': { latitude: 40.1281, longitude: 32.9950 },
  'ADB': { latitude: 38.2924, longitude: 27.1569 },
  'AYT': { latitude: 36.9003, longitude: 30.7928 },
  'FRA': { latitude: 50.0333, longitude: 8.5706 },
  'MUC': { latitude: 48.3538, longitude: 11.7861 },
  'VIE': { latitude: 48.1103, longitude: 16.5697 },
  'ZRH': { latitude: 47.4647, longitude: 8.5492 },
  'GVA': { latitude: 46.2381, longitude: 6.1089 },
  'CDG': { latitude: 49.0097, longitude: 2.5479 },
  'ORY': { latitude: 48.7253, longitude: 2.3594 },
  'LHR': { latitude: 51.4700, longitude: -0.4543 },
  'LGW': { latitude: 51.1481, longitude: -0.1903 },
  'LTN': { latitude: 51.8747, longitude: -0.3683 },
  'STN': { latitude: 51.8850, longitude: 0.2350 },
  'AMS': { latitude: 52.3081, longitude: 4.7642 },
  'BRU': { latitude: 50.9014, longitude: 4.4844 },
  'CPH': { latitude: 55.6181, longitude: 12.6561 },
  'OSL': { latitude: 60.1939, longitude: 11.1004 },
  'ARN': { latitude: 59.6519, longitude: 17.9186 },
  'HEL': { latitude: 60.3172, longitude: 24.9633 },
  'WAW': { latitude: 52.1657, longitude: 20.9671 },
  'KRK': { latitude: 50.0777, longitude: 19.7848 },
  'KTW': { latitude: 50.4743, longitude: 19.0800 },
  'RZE': { latitude: 50.1100, longitude: 22.0190 },
  'BUD': { latitude: 47.4395, longitude: 19.2618 },
  'PRG': { latitude: 50.1008, longitude: 14.2600 },
  'DUB': { latitude: 53.4214, longitude: -6.2700 },
  'MAN': { latitude: 53.3537, longitude: -2.2750 },
  'EDI': { latitude: 55.9500, longitude: -3.3725 },
  'MAD': { latitude: 40.4719, longitude: -3.5626 },
  'BCN': { latitude: 41.2971, longitude: 2.0785 },
  'LIS': { latitude: 38.7742, longitude: -9.1342 },
  'OPO': { latitude: 41.2481, longitude: -8.6814 },
  'FCO': { latitude: 41.8003, longitude: 12.2389 },
  'MXP': { latitude: 45.6306, longitude: 8.7281 },
  'ATH': { latitude: 37.9364, longitude: 23.9445 },
  'SKG': { latitude: 40.5197, longitude: 22.9708 },
  'SOF': { latitude: 42.6950, longitude: 23.4067 },
  'OTP': { latitude: 44.5722, longitude: 26.1022 },
  'BEG': { latitude: 44.8184, longitude: 20.3091 },
  'ZAG': { latitude: 45.7429, longitude: 16.0688 },
  'SJJ': { latitude: 43.8247, longitude: 18.3314 },
  'TGD': { latitude: 42.3594, longitude: 19.2519 },
  'TIV': { latitude: 42.4047, longitude: 18.7233 },
  'DBV': { latitude: 42.5614, longitude: 18.2683 },
  'SPU': { latitude: 43.5389, longitude: 16.2981 },
  'VNO': { latitude: 54.6341, longitude: 25.2858 },
  'TLV': { latitude: 32.0114, longitude: 34.8867 },
  'KWI': { latitude: 29.2266, longitude: 47.9689 },
  'RUH': { latitude: 24.9576, longitude: 46.6988 },
  'DXB': { latitude: 25.2528, longitude: 55.3644 },
  'AUH': { latitude: 24.4430, longitude: 54.6510 },
  'DOH': { latitude: 25.2609, longitude: 51.6138 },
  'MRS': { latitude: 43.4393, longitude: 5.2214 },
  'NCE': { latitude: 43.6584, longitude: 7.2159 },
  'LYS': { latitude: 45.7256, longitude: 5.0811 },
  'TLS': { latitude: 43.6291, longitude: 1.3638 },
  'BOD': { latitude: 44.8283, longitude: -0.7156 },
  'NTE': { latitude: 47.1532, longitude: -1.6107 },
  'STR': { latitude: 48.6899, longitude: 9.2219 },
  'DUS': { latitude: 51.2895, longitude: 6.7668 },
  'CGN': { latitude: 50.8659, longitude: 7.1427 },
  'HAM': { latitude: 53.6304, longitude: 9.9882 },
  'BER': { latitude: 52.3667, longitude: 13.5033 },
  'LEJ': { latitude: 51.4239, longitude: 12.2364 },
  'BSL': { latitude: 47.5896, longitude: 7.5299 },
  'MLA': { latitude: 35.8575, longitude: 14.4775 },
  'LCA': { latitude: 34.8751, longitude: 33.6249 },
  'PFO': { latitude: 34.7180, longitude: 32.4857 },
  'HER': { latitude: 35.3397, longitude: 25.1803 },
  'RHO': { latitude: 36.4054, longitude: 28.0862 },
  'FAO': { latitude: 37.0144, longitude: -7.9659 },
  'LPA': { latitude: 27.9319, longitude: -15.3866 },
  'TFS': { latitude: 28.0445, longitude: -16.5725 },
  'ACE': { latitude: 28.9455, longitude: -13.6052 },
  'PMI': { latitude: 39.5536, longitude: 2.7278 },
  'AGP': { latitude: 36.6749, longitude: -4.4991 },
  'SVQ': { latitude: 37.4180, longitude: -5.8931 },
  'VLC': { latitude: 39.4893, longitude: -0.4816 },
  'BIO': { latitude: 43.3011, longitude: -2.9106 },
  'SCQ': { latitude: 42.8963, longitude: -8.4151 },
  'GOJ': { latitude: 56.2301, longitude: 43.7840 },
  'KZN': { latitude: 55.6062, longitude: 49.2787 },
  'SVO': { latitude: 55.9726, longitude: 37.4146 },
  'DME': { latitude: 55.4086, longitude: 37.9061 },
  'VKO': { latitude: 55.5915, longitude: 37.2615 },
  'LED': { latitude: 59.8003, longitude: 30.2625 },
  'KGD': { latitude: 54.8901, longitude: 20.5926 },
  'RIX': { latitude: 56.9236, longitude: 23.9711 },
  'TLL': { latitude: 59.4133, longitude: 24.8328 },
  'TRD': { latitude: 63.4576, longitude: 10.9243 },
  'BGO': { latitude: 60.2934, longitude: 5.2181 },
  'SVG': { latitude: 58.8767, longitude: 5.6379 },
  'TOS': { latitude: 69.6833, longitude: 18.9189 },
  'AAL': { latitude: 57.0928, longitude: 9.8492 },
  'BLL': { latitude: 55.7403, longitude: 9.1518 },
  'GOT': { latitude: 57.6628, longitude: 12.2798 },
  'MMA': { latitude: 55.5300, longitude: 13.3714 },
  'MMX': { latitude: 55.5363, longitude: 13.3762 },
  'NYO': { latitude: 58.7886, longitude: 16.9122 },
  'KEF': { latitude: 63.9850, longitude: -22.6056 },
  'REK': { latitude: 64.1300, longitude: -21.9406 },

  // ── BALKAN ──
  'BNX': { latitude: 44.9414, longitude: 17.2975 },  // Banja Luka, BiH
  'ZAD': { latitude: 44.1083, longitude: 15.3467 },  // Zadar, Croatia
  'PUY': { latitude: 44.8934, longitude: 13.9222 },  // Pula, Croatia
  'RJK': { latitude: 45.2169, longitude: 14.5703 },  // Rijeka, Croatia
  'OSI': { latitude: 45.4627, longitude: 18.8102 },  // Osijek, Croatia

  // ── SRBIJA ──
  'INI': { latitude: 43.3373, longitude: 21.8537 },  // Niš, Serbia
  'KVO': { latitude: 43.8188, longitude: 20.5958 },  // Kraljevo, Serbia

  // ── POLJSKA ──
  'GDN': { latitude: 54.3776, longitude: 18.4662 },  // Gdansk, Poland
  'POZ': { latitude: 52.4210, longitude: 16.8263 },  // Poznan, Poland
  'WRO': { latitude: 51.1027, longitude: 16.8858 },  // Wroclaw, Poland
  'SZZ': { latitude: 53.5847, longitude: 14.9022 },  // Szczecin, Poland
  'LUZ': { latitude: 51.2402, longitude: 22.7147 },  // Lublin, Poland
  'BZG': { latitude: 53.0968, longitude: 17.9777 },  // Bydgoszcz, Poland
  'LCJ': { latitude: 51.7219, longitude: 19.3981 },  // Lodz, Poland

  // ── NJEMAČKA - DODATNI ──
  'FKB': { latitude: 48.7794, longitude: 8.0805 },   // Karlsruhe/Baden-Baden, Germany
  'MHG': { latitude: 49.4731, longitude: 8.5143 },   // Mannheim, Germany
  'DTM': { latitude: 51.5183, longitude: 7.6123 },   // Dortmund, Germany
  'NRN': { latitude: 51.6024, longitude: 6.1422 },   // Weeze (Niederrhein), Germany
  'SCN': { latitude: 49.2148, longitude: 7.1095 },   // Saarbrücken, Germany
  'ERF': { latitude: 50.9798, longitude: 10.9581 },  // Erfurt, Germany

  // ── ITALIJA - DODATNI ──
  'TRN': { latitude: 45.2008, longitude: 7.6496 },   // Turin, Italy
  'GOA': { latitude: 44.4135, longitude: 8.8375 },   // Genoa, Italy
  'OLB': { latitude: 40.8987, longitude: 9.5176 },   // Olbia, Sardinia
  'CAG': { latitude: 39.2515, longitude: 9.0543 },   // Cagliari, Sardinia
  'LAME': { latitude: 38.9054, longitude: 16.2423 }, // Lamezia Terme, Italy
  'REG': { latitude: 38.0711, longitude: 15.6536 },  // Reggio Calabria, Italy

  // ── FRANCUSKA - DODATNI ──
  'BVE': { latitude: 45.1508, longitude: 1.4698 },   // Brive-la-Gaillarde, France
  'LDE': { latitude: 43.1784, longitude: -0.0064 },  // Tarbes-Lourdes, France
  'PUF': { latitude: 43.3807, longitude: -0.4186 },  // Pau, France
  'CFE': { latitude: 45.7867, longitude: 3.1692 },   // Clermont-Ferrand, France
  'DNR': { latitude: 48.5833, longitude: -2.0769 },  // Dinard, France
  'BIA': { latitude: 42.5528, longitude: 9.4840 },   // Bastia, Corsica
  'AJA': { latitude: 41.9236, longitude: 8.8029 },   // Ajaccio, Corsica

  // ── ŠPANIJA - DODATNI ──
  'LEI': { latitude: 36.8439, longitude: -2.3703 },  // Almeria, Spain
  'XRY': { latitude: 36.7446, longitude: -6.0603 },  // Jerez, Spain
  'VGO': { latitude: 42.2232, longitude: -8.6262 },  // Vigo, Spain
  'LCG': { latitude: 43.3021, longitude: -8.3777 },  // A Coruña, Spain
  'OVD': { latitude: 43.5636, longitude: -6.0346 },  // Asturias, Spain
  'FUE': { latitude: 28.4527, longitude: -13.8638 }, // Fuerteventura, Canary Islands

  // ── UK - DODATNI ──
  'EMA': { latitude: 52.8311, longitude: -1.3281 },  // East Midlands, UK
  'DSA': { latitude: 53.4805, longitude: -1.0107 },  // Doncaster Sheffield, UK
  'LPL': { latitude: 53.3336, longitude: -2.8497 },  // Liverpool, UK
  'MME': { latitude: 54.5092, longitude: -1.4294 },  // Durham Tees Valley, UK
  'HUY': { latitude: 53.5744, longitude: -0.3508 },  // Humberside, UK
  'NQY': { latitude: 50.4406, longitude: -4.9954 },  // Newquay Cornwall, UK

  // ── SKANDINAVIJA - DODATNI ──
  'KSU': { latitude: 63.1118, longitude: 7.8245 },   // Kristiansund, Norway
  'MQN': { latitude: 66.3667, longitude: 14.3000 },  // Mo i Rana, Norway
  'BOO': { latitude: 67.2692, longitude: 14.3653 },  // Bodø, Norway

  // ── ISTOČNA EVROPA ──
  'KIV': { latitude: 47.0544, longitude: 28.8247 },  // Chisinau, Moldova
  'IAS': { latitude: 47.1585, longitude: 27.6208 },  // Iasi, Romania
  'CLJ': { latitude: 46.7852, longitude: 23.6862 },  // Cluj-Napoca, Romania
  'TSR': { latitude: 45.8100, longitude: 21.3379 },  // Timisoara, Romania
  'BRQ': { latitude: 49.1513, longitude: 16.6944 },  // Brno, Czech Republic
  'KSC': { latitude: 48.6631, longitude: 21.2411 },  // Kosice, Slovakia

  // ── BLISKI ISTOK - DODATNI ──
  'AMM': { latitude: 31.7226, longitude: 35.9932 },  // Amman, Jordan
  'BEY': { latitude: 33.8209, longitude: 35.4884 },  // Beirut, Lebanon
  'BAH': { latitude: 26.2708, longitude: 50.6336 },  // Bahrain
  'MCT': { latitude: 23.5880, longitude: 58.2900 },  // Muscat, Oman
  'SHJ': { latitude: 25.3286, longitude: 55.5172 },  // Sharjah, UAE

  // ── RUSIJA - DODATNI ──
  'AER': { latitude: 43.4499, longitude: 39.9566 },  // Sochi, Russia
  'ROV': { latitude: 47.2582, longitude: 39.8181 },  // Rostov-on-Don, Russia
  'KUF': { latitude: 53.5049, longitude: 50.1643 },  // Samara, Russia
  'UFA': { latitude: 54.5577, longitude: 55.8744 },  // Ufa, Russia
  'OMS': { latitude: 54.9670, longitude: 73.3105 },  // Omsk, Russia

  // ── KAVKAZ ──
  'EVN': { latitude: 40.1474, longitude: 44.3959 },  // Yerevan, Armenia
  'GYD': { latitude: 40.4675, longitude: 50.0467 },  // Baku, Azerbaijan
  'TBS': { latitude: 41.6693, longitude: 44.9548 },  // Tbilisi, Georgia

  // ── ITALIJA (dodatni) ──
  'BRI': { latitude: 41.1389, longitude: 16.7606 },  // Bari, Italy
  'BDS': { latitude: 40.6576, longitude: 17.9470 },  // Brindisi, Italy
  'NAP': { latitude: 40.8780, longitude: 14.2828 },  // Naples, Italy
  'LIN': { latitude: 45.4451, longitude: 9.2767 },   // Milan Linate, Italy
  'BGY': { latitude: 45.6739, longitude: 9.7042 },   // Milan Bergamo, Italy
  'VCE': { latitude: 45.5051, longitude: 12.3519 },  // Venice, Italy
  'BLQ': { latitude: 44.5354, longitude: 11.2887 },  // Bologna, Italy
  'FLR': { latitude: 43.8100, longitude: 11.2051 },  // Florence, Italy
  'PSA': { latitude: 43.6839, longitude: 10.3927 },  // Pisa, Italy
  'CTA': { latitude: 37.4668, longitude: 15.0664 },  // Catania, Sicily
  'PMO': { latitude: 38.1760, longitude: 13.0910 },  // Palermo, Sicily

  // ── UK (dodatni) ──
  'LBA': { latitude: 53.8659, longitude: -1.6607 },  // Leeds Bradford, UK
  'BRS': { latitude: 51.3827, longitude: -2.7191 },  // Bristol, UK
  'BHM': { latitude: 52.4539, longitude: -1.7480 },  // Birmingham, UK
  'NCL': { latitude: 55.0375, longitude: -1.6917 },  // Newcastle, UK
  'GLA': { latitude: 55.8719, longitude: -4.4330 },  // Glasgow, UK
  'ABZ': { latitude: 57.2019, longitude: -2.1978 },  // Aberdeen, UK
  'BFS': { latitude: 54.6575, longitude: -6.2158 },  // Belfast, UK
  'CWL': { latitude: 51.3967, longitude: -3.3433 },  // Cardiff, UK
  'EXT': { latitude: 50.7344, longitude: -3.4139 },  // Exeter, UK
  'SOU': { latitude: 50.9503, longitude: -1.3567 },  // Southampton, UK
  'LCY': { latitude: 51.5053, longitude: 0.0553 },   // London City, UK
  'SEN': { latitude: 51.5714, longitude: 0.6956 },   // London Southend, UK

  // ── NJEMAČKA (dodatni) ──
  'HAJ': { latitude: 52.4611, longitude: 9.6851 },   // Hanover, Germany
  'NUE': { latitude: 49.4987, longitude: 11.0781 },  // Nuremberg, Germany
  'BRE': { latitude: 53.0475, longitude: 8.7867 },   // Bremen, Germany
  'FMO': { latitude: 52.1346, longitude: 7.6848 },   // Münster Osnabrück, Germany
  'PAD': { latitude: 51.6141, longitude: 8.6163 },   // Paderborn, Germany

  // ── FRANCUSKA (dodatni) ──
  'BVA': { latitude: 49.4544, longitude: 2.1128 },   // Paris Beauvais, France
  'XCR': { latitude: 48.7729, longitude: 4.1889 },   // Paris Vatry, France
  'RNS': { latitude: 48.0695, longitude: -1.7348 },  // Rennes, France
  'BES': { latitude: 48.4478, longitude: -4.4185 },  // Brest, France
  'LIL': { latitude: 50.5633, longitude: 3.0869 },   // Lille, France

  // ── ŠPANIJA (dodatni) ──
  'ALC': { latitude: 38.2822, longitude: -0.5582 },  // Alicante, Spain
  'GRO': { latitude: 41.9000, longitude: 2.7606 },   // Girona, Spain
  'REU': { latitude: 41.1474, longitude: 1.1672 },   // Reus, Spain
  'IBZ': { latitude: 38.8729, longitude: 1.3731 },   // Ibiza, Spain
  'MAH': { latitude: 39.8626, longitude: 4.2187 },   // Menorca, Spain

  // ── PORTUGAL (dodatni) ──
  'FNC': { latitude: 32.6942, longitude: -16.7746 }, // Funchal, Madeira
  'PDL': { latitude: 37.7412, longitude: -25.6979 }, // Ponta Delgada, Azores

  // ── GRČKA (dodatni) ──
  'JTR': { latitude: 36.3992, longitude: 25.4793 },  // Santorini, Greece
  'JMK': { latitude: 37.4351, longitude: 25.3411 },  // Mykonos, Greece
  'CFU': { latitude: 39.6019, longitude: 19.9117 },  // Corfu, Greece
  'ZTH': { latitude: 37.7509, longitude: 20.8843 },  // Zakynthos, Greece
  'KGS': { latitude: 36.7933, longitude: 26.9405 },  // Kos, Greece
  'CHQ': { latitude: 35.5317, longitude: 24.1497 },  // Chania, Crete
  'EFL': { latitude: 38.1201, longitude: 20.5005 },  // Kefalonia, Greece
  'PVK': { latitude: 38.9254, longitude: 20.7658 },  // Preveza, Greece
  'VOL': { latitude: 39.2196, longitude: 22.7943 },  // Volos, Greece

  // ── SKANDINAVIJA (dodatni) ──
  'TRF': { latitude: 59.1867, longitude: 10.2586 },  // Sandefjord, Norway
  'AES': { latitude: 62.5625, longitude: 6.1197 },   // Ålesund, Norway

  // ── EVROPA - OSTALI ──
  'LJU': { latitude: 46.2237, longitude: 14.4576 },  // Ljubljana, Slovenia
  'SKP': { latitude: 41.9616, longitude: 21.6214 },  // Skopje, North Macedonia
  'TIA': { latitude: 41.4147, longitude: 19.7206 },  // Tirana, Albania

  // ═══════════════════════════════════════════════════════════
  // ── NOVO DODANO ──
  // ═══════════════════════════════════════════════════════════

  // ── LUKSEMBURG ──
  'LUX': { latitude: 49.6236, longitude: 6.2044 },   // Luxembourg Airport

  // ── AUSTRIJA ──
  'SZG': { latitude: 47.7933, longitude: 13.0043 },  // Salzburg, Austria

  // ── UZBEKISTAN ──
  'TAS': { latitude: 41.2579, longitude: 69.2812 },  // Tashkent, Uzbekistan
};

// Mapa gradova za aerodrome
const CITY_TO_AIRPORT: Record<string, string> = {
  // ── POSTOJEĆE ──
  'Istanbul': 'IST',
  'Ankara': 'ESB',
  'Izmir': 'ADB',
  'Antalya': 'AYT',
  'Frankfurt': 'FRA',
  'Munich': 'MUC',
  'Vienna': 'VIE',
  'Zurich': 'ZRH',
  'Geneva': 'GVA',
  'Paris': 'CDG',
  'Paris Orly': 'ORY',
  'Paris Beauvais': 'BVA',
  'Paris Vatry': 'XCR',
  'London': 'LHR',
  'London Luton': 'LTN',
  'London Gatwick': 'LGW',
  'London Stansted': 'STN',
  'London City': 'LCY',
  'London Southend': 'SEN',
  'Amsterdam': 'AMS',
  'Brussels': 'BRU',
  'Copenhagen': 'CPH',
  'Oslo': 'OSL',
  'Stockholm': 'ARN',
  'Helsinki': 'HEL',
  'Warsaw': 'WAW',
  'Krakow': 'KRK',
  'Katowice': 'KTW',
  'Rzesow': 'RZE',
  'Budapest': 'BUD',
  'Prague': 'PRG',
  'Dublin': 'DUB',
  'Manchester': 'MAN',
  'Edinburgh': 'EDI',
  'Madrid': 'MAD',
  'Barcelona': 'BCN',
  'Lisbon': 'LIS',
  'Porto': 'OPO',
  'Rome': 'FCO',
  'Milan': 'MXP',
  'Milan Bergamo': 'BGY',
  'Milan Linate': 'LIN',
  'Athens': 'ATH',
  'Thessaloniki': 'SKG',
  'Sofia': 'SOF',
  'Bucharest': 'OTP',
  'Belgrade': 'BEG',
  'Zagreb': 'ZAG',
  'Sarajevo': 'SJJ',
  'Podgorica': 'TGD',
  'Tivat': 'TIV',
  'Dubrovnik': 'DBV',
  'Split': 'SPU',
  'Vilnius': 'VNO',
  'Tel Aviv': 'TLV',
  'Kuwait City': 'KWI',
  'Kuwait': 'KWI',
  'Riyadh': 'RUH',
  'Dubai': 'DXB',
  'Abu Dhabi': 'AUH',
  'Doha': 'DOH',
  'Marseille': 'MRS',
  'Nice': 'NCE',
  'Lyon': 'LYS',
  'Toulouse': 'TLS',
  'Bordeaux': 'BOD',
  'Nantes': 'NTE',
  'Stuttgart': 'STR',
  'Dusseldorf': 'DUS',
  'Cologne': 'CGN',
  'Hamburg': 'HAM',
  'Berlin': 'BER',
  'Leipzig': 'LEJ',
  'Basel': 'BSL',
  'Malta': 'MLA',
  'Larnaca': 'LCA',
  'Paphos': 'PFO',
  'Heraklion': 'HER',
  'Rhodes': 'RHO',
  'Faro': 'FAO',
  'Gran Canaria': 'LPA',
  'Tenerife': 'TFS',
  'Lanzarote': 'ACE',
  'Palma de Mallorca': 'PMI',
  'Malaga': 'AGP',
  'Seville': 'SVQ',
  'Valencia': 'VLC',
  'Bilbao': 'BIO',
  'Santiago de Compostela': 'SCQ',
  'Nizhny Novgorod': 'GOJ',
  'Kazan': 'KZN',
  'Moscow': 'SVO',
  'St Petersburg': 'LED',
  'Kaliningrad': 'KGD',
  'Riga': 'RIX',
  'Tallinn': 'TLL',
  'Trondheim': 'TRD',
  'Bergen': 'BGO',
  'Stavanger': 'SVG',
  'Tromso': 'TOS',
  'Aalborg': 'AAL',
  'Billund': 'BLL',
  'Gothenburg': 'GOT',
  'Malmo': 'MMA',
  'Reykjavik': 'KEF',

  // ── BALKAN ──
  'Banja Luka': 'BNX',
  'Zadar': 'ZAD',
  'Pula': 'PUY',
  'Rijeka': 'RJK',
  'Osijek': 'OSI',

  // ── SRBIJA ──
  'Nis': 'INI',
  'Niš': 'INI',
  'Kraljevo': 'KVO',

  // ── POLJSKA ──
  'Gdansk': 'GDN',
  'Gdańsk': 'GDN',
  'Poznan': 'POZ',
  'Poznań': 'POZ',
  'Wroclaw': 'WRO',
  'Wrocław': 'WRO',
  'Szczecin': 'SZZ',
  'Lublin': 'LUZ',
  'Bydgoszcz': 'BZG',
  'Lodz': 'LCJ',
  'Łódź': 'LCJ',

  // ── NJEMAČKA ──
  'Karlsruhe': 'FKB',
  'Baden-Baden': 'FKB',
  'Mannheim': 'MHG',
  'Dortmund': 'DTM',
  'Weeze': 'NRN',
  'Saarbrücken': 'SCN',
  'Erfurt': 'ERF',
  'Hanover': 'HAJ',
  'Hannover': 'HAJ',
  'Nuremberg': 'NUE',
  'Nürnberg': 'NUE',
  'Bremen': 'BRE',
  'Munster': 'FMO',
  'Münster': 'FMO',
  'Paderborn': 'PAD',

  // ── ITALIJA ──
  'Turin': 'TRN',
  'Torino': 'TRN',
  'Genoa': 'GOA',
  'Genova': 'GOA',
  'Olbia': 'OLB',
  'Cagliari': 'CAG',
  'Lamezia Terme': 'LAME',
  'Reggio Calabria': 'REG',
  'Bari': 'BRI',
  'Brindisi': 'BDS',
  'Naples': 'NAP',
  'Napoli': 'NAP',
  'Venice': 'VCE',
  'Venezia': 'VCE',
  'Bologna': 'BLQ',
  'Florence': 'FLR',
  'Firenze': 'FLR',
  'Pisa': 'PSA',
  'Catania': 'CTA',
  'Palermo': 'PMO',

  // ── FRANCUSKA ──
  'Brive-la-Gaillarde': 'BVE',
  'Tarbes': 'LDE',
  'Lourdes': 'LDE',
  'Pau': 'PUF',
  'Clermont-Ferrand': 'CFE',
  'Dinard': 'DNR',
  'Bastia': 'BIA',
  'Ajaccio': 'AJA',
  'Rennes': 'RNS',
  'Brest': 'BES',
  'Lille': 'LIL',

  // ── ŠPANIJA ──
  'Almeria': 'LEI',
  'Almería': 'LEI',
  'Jerez': 'XRY',
  'Vigo': 'VGO',
  'A Coruña': 'LCG',
  'Asturias': 'OVD',
  'Fuerteventura': 'FUE',
  'Alicante': 'ALC',
  'Girona': 'GRO',
  'Reus': 'REU',
  'Ibiza': 'IBZ',
  'Menorca': 'MAH',

  // ── UK ──
  'East Midlands': 'EMA',
  'Doncaster': 'DSA',
  'Sheffield': 'DSA',
  'Liverpool': 'LPL',
  'Durham Tees Valley': 'MME',
  'Humberside': 'HUY',
  'Newquay': 'NQY',
  'Leeds': 'LBA',
  'Leeds Bradford': 'LBA',
  'Bristol': 'BRS',
  'Birmingham': 'BHM',
  'Newcastle': 'NCL',
  'Glasgow': 'GLA',
  'Aberdeen': 'ABZ',
  'Belfast': 'BFS',
  'Cardiff': 'CWL',
  'Exeter': 'EXT',
  'Southampton': 'SOU',

  // ── PORTUGAL ──
  'Funchal': 'FNC',
  'Madeira': 'FNC',
  'Ponta Delgada': 'PDL',
  'Azores': 'PDL',

  // ── GRČKA ──
  'Santorini': 'JTR',
  'Mykonos': 'JMK',
  'Corfu': 'CFU',
  'Kerkyra': 'CFU',
  'Zakynthos': 'ZTH',
  'Kos': 'KGS',
  'Chania': 'CHQ',
  'Kefalonia': 'EFL',
  'Preveza': 'PVK',
  'Volos': 'VOL',

  // ── SKANDINAVIJA ──
  'Sandefjord': 'TRF',
  'Alesund': 'AES',
  'Ålesund': 'AES',
  'Kristiansund': 'KSU',
  'Mo i Rana': 'MQN',
  'Bodo': 'BOO',
  'Bodø': 'BOO',

  // ── ISTOČNA EVROPA ──
  'Chisinau': 'KIV',
  'Chișinău': 'KIV',
  'Iasi': 'IAS',
  'Iași': 'IAS',
  'Cluj-Napoca': 'CLJ',
  'Timisoara': 'TSR',
  'Timișoara': 'TSR',
  'Brno': 'BRQ',
  'Kosice': 'KSC',
  'Košice': 'KSC',

  // ── BLISKI ISTOK ──
  'Amman': 'AMM',
  'Beirut': 'BEY',
  'Bahrain': 'BAH',
  'Muscat': 'MCT',
  'Sharjah': 'SHJ',

  // ── RUSIJA ──
  'Sochi': 'AER',
  'Сочи': 'AER',
  'Rostov-on-Don': 'ROV',
  'Samara': 'KUF',
  'Ufa': 'UFA',
  'Omsk': 'OMS',

  // ── KAVKAZ ──
  'Yerevan': 'EVN',
  'Baku': 'GYD',
  'Tbilisi': 'TBS',

  // ── EVROPA - OSTALI ──
  'Ljubljana': 'LJU',
  'Skopje': 'SKP',
  'Tirana': 'TIA',

  // ═══════════════════════════════════════════════════════════
  // ── NOVO DODANO ──
  // ═══════════════════════════════════════════════════════════

  // ── LUKSEMBURG ──
  'Luxembourg': 'LUX',

  // ── AUSTRIJA ──
  'Salzburg': 'SZG',

  // ── UZBEKISTAN ──
  'Tashkent': 'TAS',
};

// Cache za weather podatke
const weatherCache = new Map<string, { data: WeatherData; timestamp: number }>();
const CACHE_DURATION = 180 * 60 * 1000; // 10 minuta cache

// Helper funkcija za provjeru vremena
const isWithinOperatingHours = (): boolean => {
  const now = new Date();
  const currentHour = now.getHours();
  return currentHour >= 5 && currentHour < 19;
};

// Helper funkcija za izračun vremena do sljedećeg osvježavanja
const getTimeUntilNextRefresh = (): number => {
  const now = new Date();
  const currentHour = now.getHours();
  
  if (currentHour >= 19) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(5, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
  }
  
  if (currentHour < 5) {
    const today = new Date(now);
    today.setHours(5, 0, 0, 0);
    return today.getTime() - now.getTime();
  }
  
  return 180 * 60 * 1000; // 10 minuta
};

// Funkcija za dobivanje cache ključa
const getCacheKey = (destination: { cityName?: string; airportCode?: string; airportName?: string }): string => {
  return `${destination.airportCode || ''}-${destination.cityName || ''}-${destination.airportName || ''}`;
};

export const useWeather = (destination: {
  cityName?: string;
  airportCode?: string;
  airportName?: string;
}, p0: number) => {
  const [weatherData, setWeatherData] = useState<WeatherData>({
    temperature: 0,
    weatherCode: 0,
    loading: true,
  });

  useEffect(() => {
    // FIX (memory leak — Chrome "Aw, Snap!" nakon dana/sedmica rada):
    // ranije je scheduleNextRefresh() vraćala cleanup funkciju koja je
    // znala SAMO za PRVI zakazani setTimeout. Rekurzivni poziv unutar
    // samog setTimeout callback-a (fetchWeather(); scheduleNextRefresh();)
    // je pravio NOVI timeoutId čiji cleanup nigdje nije bio sačuvan —
    // useEffect je i dalje držao cleanup samo za prvi (već istekao) timer.
    // Lanac se nastavljao ZAUVIJEK, čak i nakon unmount-a komponente, jer
    // ništa nije moglo otkazati bilo koji timer OSIM prvog.
    //
    // Na 24/7 kiosku (weather se koristi na combined/departures za svaku
    // destinaciju) svaki remount — promjena rute, ponovni render sa novim
    // `destination` objektom (dependency niz ispod uključuje CIJELI
    // `destination` objekat, ne samo njegova polja — ako pozivalac šalje
    // inline objekat, on ima nov identitet na SVAKOM render-u, gaseći i
    // paleći ovaj efekat mnogo češće nego što se čini) — stvarao je JOŠ
    // JEDAN besmrtan lanac koji svakih do 10 minuta radi fetch + setState
    // na potencijalno nepostojeću komponentu. To je klasičan uzrok
    // postepenog rasta memorije koji na kraju obori Chrome tab.
    //
    // FIX: `timeoutId` i `cancelled` su sad u SPOLJAŠNJEM scope-u efekta.
    // scheduleNextRefresh() prepisuje ISTU spoljašnju `timeoutId`
    // promjenljivu pri svakom pozivu (umjesto da vraća novu, lokalnu
    // cleanup funkciju) — pa cleanup funkcija efekta UVIJEK zna otkazati
    // NAJNOVIJI zakazani timer, bez obzira koliko puta se lanac
    // rekurzivno produžio. `cancelled` flag dodatno sprečava (a) setState
    // na odjavljenoj komponenti ako fetchWeather() promise razriješi
    // nakon unmount-a, i (b) zakazivanje BILO KOG narednog timera nakon
    // cleanup-a.
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchWeather = async () => {
      const cacheKey = getCacheKey(destination);
      const cached = weatherCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`Using cached weather data for: ${cacheKey}`);
        if (!cancelled) setWeatherData(cached.data);
        return;
      }

      if (!isWithinOperatingHours()) {
        console.log('Outside operating hours, skipping weather fetch');
        if (!cancelled) setWeatherData({
          temperature: 0,
          weatherCode: 0,
          loading: false,
          error: 'Outside operating hours'
        });
        return;
      }

      let coordinates: Coordinates | undefined;
      
      if (destination.airportCode && AIRPORT_COORDINATES[destination.airportCode]) {
        coordinates = AIRPORT_COORDINATES[destination.airportCode];
        console.log(`Found coordinates for airport code: ${destination.airportCode}`, coordinates);
      } 
      else if (destination.cityName) {
        const airportCodeFromCity = CITY_TO_AIRPORT[destination.cityName];
        if (airportCodeFromCity && AIRPORT_COORDINATES[airportCodeFromCity]) {
          coordinates = AIRPORT_COORDINATES[airportCodeFromCity];
          console.log(`Found coordinates for city: ${destination.cityName} -> ${airportCodeFromCity}`, coordinates);
        }
      }
      
      if (!coordinates && destination.airportName) {
        const airportMatch = Object.keys(AIRPORT_COORDINATES).find(code => 
          destination.airportName?.includes(code) || 
          destination.airportName?.toLowerCase().includes(code.toLowerCase())
        );
        
        if (airportMatch) {
          coordinates = AIRPORT_COORDINATES[airportMatch];
          console.log(`Found coordinates for airport name: ${destination.airportName} -> ${airportMatch}`, coordinates);
        }
      }

      if (!coordinates) {
        console.log(`No coordinates found for:`, destination);
        const errorData = {
          temperature: 0,
          weatherCode: 0,
          loading: false,
          error: `Coordinates not found for ${destination.cityName || destination.airportName || destination.airportCode}`
        };
        weatherCache.set(cacheKey, { data: errorData, timestamp: Date.now() });
        if (!cancelled) setWeatherData(errorData);
        return;
      }

      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (cancelled) return;

        const params = {
          latitude: coordinates.latitude.toString(),
          longitude: coordinates.longitude.toString(),
          current: 'temperature_2m,weather_code',
          timezone: 'auto',
        };

        const url = 'https://api.open-meteo.com/v1/forecast';
        const response = await fetch(
          `${url}?${new URLSearchParams(params)}`
        );
        if (cancelled) return;

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error('Rate limit exceeded - too many requests');
          }
          throw new Error(`Weather API request failed: ${response.status}`);
        }

        const data = await response.json();
        if (cancelled) return;
        
        console.log(`Weather data for ${destination.cityName || destination.airportName}:`, {
          temperature: data.current.temperature_2m,
          weatherCode: data.current.weather_code
        });
        
        const newWeatherData = {
          temperature: data.current.temperature_2m,
          weatherCode: data.current.weather_code,
          loading: false,
        };

        weatherCache.set(cacheKey, { data: newWeatherData, timestamp: Date.now() });
        setWeatherData(newWeatherData);
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching weather:', error);
        const errorData = {
          temperature: 0,
          weatherCode: 0,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch weather data'
        };
        
        weatherCache.set(cacheKey, { data: errorData, timestamp: Date.now() });
        setWeatherData(errorData);
      }
    };

    const scheduleNextRefresh = () => {
      if (cancelled) return;
      const refreshInterval = getTimeUntilNextRefresh();
      console.log(`Scheduling next weather refresh in ${refreshInterval / (60 * 1000)} minutes`);
      
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        fetchWeather();
        scheduleNextRefresh();
      }, refreshInterval);
    };

    if (destination.cityName || destination.airportCode || destination.airportName) {
      console.log(`Fetching weather for:`, destination);
      fetchWeather();
      scheduleNextRefresh();
    } else {
      setWeatherData({
        temperature: 0,
        weatherCode: 0,
        loading: false,
        error: 'No destination provided'
      });
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [destination.cityName, destination.airportCode, destination.airportName, destination]);

  return weatherData;
};