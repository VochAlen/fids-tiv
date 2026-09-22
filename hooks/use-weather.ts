// hooks/use-weather.ts
// v4.2: 24/7/365 weather + 429 rate limit prevention
//
// FIXES vs user's provided version:
// 1. Uklonjena isWithinOperatingHours() — weather radi 24/7 (ne vraća 0°C noću)
// 2. 429 prevention: dedup concurrent requests + stagger + retry + localStorage
// 3. Dodani missing European airports (Memmingen, Innsbruck, Bratislava, itd.)
// 4. Wind speed/direction zadržan (combined page Tivat weather card koristi)

import { useState, useEffect } from 'react';

interface WeatherData {
  temperature: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  loading: boolean;
  error?: string;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

// Mapa aerodroma i koordinata
const AIRPORT_COORDINATES: Record<string, Coordinates> = {
  // ── TURSKA ──
  'IST': { latitude: 41.2753, longitude: 28.7519 },
  'SAW': { latitude: 40.8986, longitude: 29.3092 },
  'ESB': { latitude: 40.1281, longitude: 32.9950 },
  'ADB': { latitude: 38.2924, longitude: 27.1569 },
  'AYT': { latitude: 36.9003, longitude: 30.7928 },
  'BJV': { latitude: 37.2506, longitude: 27.6643 },  // Bodrum, Turkey
  'DLM': { latitude: 36.7131, longitude: 28.7925 },  // Dalaman, Turkey

  // ── NJEMAČKA ──
  'FRA': { latitude: 50.0333, longitude: 8.5706 },
  'MUC': { latitude: 48.3538, longitude: 11.7861 },
  'STR': { latitude: 48.6899, longitude: 9.2219 },
  'DUS': { latitude: 51.2895, longitude: 6.7668 },
  'CGN': { latitude: 50.8659, longitude: 7.1427 },
  'HAM': { latitude: 53.6304, longitude: 9.9882 },
  'BER': { latitude: 52.3667, longitude: 13.5033 },
  'LEJ': { latitude: 51.4239, longitude: 12.2364 },
  'FKB': { latitude: 48.7794, longitude: 8.0805 },
  'MHG': { latitude: 49.4731, longitude: 8.5143 },
  'DTM': { latitude: 51.5183, longitude: 7.6123 },
  'NRN': { latitude: 51.6024, longitude: 6.1422 },
  'SCN': { latitude: 49.2148, longitude: 7.1095 },
  'ERF': { latitude: 50.9798, longitude: 10.9581 },
  'HAJ': { latitude: 52.4611, longitude: 9.6851 },
  'NUE': { latitude: 49.4987, longitude: 11.0781 },
  'BRE': { latitude: 53.0475, longitude: 8.7867 },
  'FMO': { latitude: 52.1346, longitude: 7.6848 },
  'PAD': { latitude: 51.6141, longitude: 8.6163 },
  'FMM': { latitude: 47.9883, longitude: 10.2395 },  // Memmingen, Germany
  'FDH': { latitude: 47.6711, longitude: 9.5106 },   // Friedrichshafen, Germany
  'DRS': { latitude: 51.1328, longitude: 13.7672 },  // Dresden, Germany
  'ZQW': { latitude: 49.2033, longitude: 7.4014 },   // Zweibrücken, Germany

  // ── AUSTRIJA ──
  'VIE': { latitude: 48.1103, longitude: 16.5697 },
  'SZG': { latitude: 47.7933, longitude: 13.0043 },
  'INN': { latitude: 47.2603, longitude: 11.3439 },  // Innsbruck, Austria
  'LNZ': { latitude: 48.2336, longitude: 14.1886 },  // Linz, Austria
  'GRZ': { latitude: 46.9911, longitude: 15.4396 },  // Graz, Austria
  'KLU': { latitude: 46.6422, longitude: 14.3372 },  // Klagenfurt, Austria

  // ── ŠVAJCARSKA ──
  'ZRH': { latitude: 47.4647, longitude: 8.5492 },
  'GVA': { latitude: 46.2381, longitude: 6.1089 },
  'BSL': { latitude: 47.5896, longitude: 7.5299 },
  'BRN': { latitude: 46.9141, longitude: 7.4972 },  // Bern, Switzerland
  'LUG': { latitude: 46.0043, longitude: 8.9105 },  // Lugano, Switzerland
  'SIR': { latitude: 46.1397, longitude: 7.1083 },  // Sion, Switzerland

  // ── FRANCUSKA ──
  'CDG': { latitude: 49.0097, longitude: 2.5479 },
  'ORY': { latitude: 48.7253, longitude: 2.3594 },
  'BVA': { latitude: 49.4544, longitude: 2.1128 },
  'XCR': { latitude: 48.7729, longitude: 4.1889 },
  'MRS': { latitude: 43.4393, longitude: 5.2214 },
  'NCE': { latitude: 43.6584, longitude: 7.2159 },
  'LYS': { latitude: 45.7256, longitude: 5.0811 },
  'TLS': { latitude: 43.6291, longitude: 1.3638 },
  'BOD': { latitude: 44.8283, longitude: -0.7156 },
  'NTE': { latitude: 47.1532, longitude: -1.6107 },
  'BVE': { latitude: 45.1508, longitude: 1.4698 },
  'LDE': { latitude: 43.1784, longitude: -0.0064 },
  'PUF': { latitude: 43.3807, longitude: -0.4186 },
  'CFE': { latitude: 45.7867, longitude: 3.1692 },
  'DNR': { latitude: 48.5833, longitude: -2.0769 },
  'BIA': { latitude: 42.5528, longitude: 9.4840 },
  'AJA': { latitude: 41.9236, longitude: 8.8029 },
  'RNS': { latitude: 48.0695, longitude: -1.7348 },
  'BES': { latitude: 48.4478, longitude: -4.4185 },
  'LIL': { latitude: 50.5633, longitude: 3.0869 },
  'SXB': { latitude: 48.5383, longitude: 7.6282 },  // Strasbourg, France
  'ETZ': { latitude: 48.9810, longitude: 6.2497 },  // Metz, France
  'BIQ': { latitude: 43.4683, longitude: -1.5311 },  // Biarritz, France
  'MPL': { latitude: 43.5762, longitude: 3.9630 },  // Montpellier, France
  'PGF': { latitude: 42.7428, longitude: 2.8722 },  // Perpignan, France

  // ── UK ──
  'LHR': { latitude: 51.4700, longitude: -0.4543 },
  'LGW': { latitude: 51.1481, longitude: -0.1903 },
  'LTN': { latitude: 51.8747, longitude: -0.3683 },
  'STN': { latitude: 51.8850, longitude: 0.2350 },
  'LCY': { latitude: 51.5053, longitude: 0.0553 },
  'SEN': { latitude: 51.5714, longitude: 0.6956 },
  'MAN': { latitude: 53.3537, longitude: -2.2750 },
  'EMA': { latitude: 52.8311, longitude: -1.3281 },
  'DSA': { latitude: 53.4805, longitude: -1.0107 },
  'LPL': { latitude: 53.3336, longitude: -2.8497 },
  'MME': { latitude: 54.5092, longitude: -1.4294 },
  'HUY': { latitude: 53.5744, longitude: -0.3508 },
  'NQY': { latitude: 50.4406, longitude: -4.9954 },
  'LBA': { latitude: 53.8659, longitude: -1.6607 },
  'BRS': { latitude: 51.3827, longitude: -2.7191 },
  'BHM': { latitude: 52.4539, longitude: -1.7480 },
  'NCL': { latitude: 55.0375, longitude: -1.6917 },
  'GLA': { latitude: 55.8719, longitude: -4.4330 },
  'ABZ': { latitude: 57.2019, longitude: -2.1978 },
  'BFS': { latitude: 54.6575, longitude: -6.2158 },
  'CWL': { latitude: 51.3967, longitude: -3.3433 },
  'EXT': { latitude: 50.7344, longitude: -3.4139 },
  'SOU': { latitude: 50.9503, longitude: -1.3567 },

  // ── IRLSKA ──
  'DUB': { latitude: 53.4214, longitude: -6.2700 },
  'ORK': { latitude: 51.8413, longitude: -8.4919 },  // Cork, Ireland
  'SNN': { latitude: 52.7019, longitude: -8.9248 },  // Shannon, Ireland
  'NOC': { latitude: 53.9103, longitude: -8.8181 },  // Knock, Ireland
  'KIR': { latitude: 52.1886, longitude: -9.5153 },  // Kerry, Ireland

  // ── NIZOZEMSKA ──
  'AMS': { latitude: 52.3081, longitude: 4.7642 },
  'EIN': { latitude: 51.4583, longitude: 5.3917 },  // Eindhoven, Netherlands
  'RTM': { latitude: 51.9569, longitude: 4.4372 },  // Rotterdam, Netherlands
  'GRQ': { latitude: 53.1248, longitude: 6.5814 },  // Groningen, Netherlands
  'MST': { latitude: 50.9153, longitude: 5.7753 },  // Maastricht, Netherlands

  // ── BELGIJA ──
  'BRU': { latitude: 50.9014, longitude: 4.4844 },
  'ANR': { latitude: 51.1894, longitude: 4.4603 },  // Antwerp, Belgium
  'LGG': { latitude: 50.6411, longitude: 5.4522 },  // Liège, Belgium
  'OST': { latitude: 51.2008, longitude: 2.8578 },  // Ostend, Belgium
  'CRL': { latitude: 50.4592, longitude: 4.4538 },  // Charleroi, Belgium

  // ── LUKSEMBURG ──
  'LUX': { latitude: 49.6236, longitude: 6.2044 },

  // ── ITALIJA ──
  'FCO': { latitude: 41.8003, longitude: 12.2389 },
  'MXP': { latitude: 45.6306, longitude: 8.7281 },
  'LIN': { latitude: 45.4451, longitude: 9.2767 },
  'BGY': { latitude: 45.6739, longitude: 9.7042 },
  'TRN': { latitude: 45.2008, longitude: 7.6496 },
  'GOA': { latitude: 44.4135, longitude: 8.8375 },
  'OLB': { latitude: 40.8987, longitude: 9.5176 },
  'CAG': { latitude: 39.2515, longitude: 9.0543 },
  'LAME': { latitude: 38.9054, longitude: 16.2423 },
  'REG': { latitude: 38.0711, longitude: 15.6536 },
  'BRI': { latitude: 41.1389, longitude: 16.7606 },
  'BDS': { latitude: 40.6576, longitude: 17.9470 },
  'NAP': { latitude: 40.8780, longitude: 14.2828 },
  'VCE': { latitude: 45.5051, longitude: 12.3519 },
  'TSF': { latitude: 45.6486, longitude: 12.1944 },  // Venice Treviso, Italy
  'BLQ': { latitude: 44.5354, longitude: 11.2887 },
  'FLR': { latitude: 43.8100, longitude: 11.2051 },
  'PSA': { latitude: 43.6839, longitude: 10.3927 },
  'CTA': { latitude: 37.4668, longitude: 15.0664 },
  'PMO': { latitude: 38.1760, longitude: 13.0910 },
  'VRN': { latitude: 45.3956, longitude: 10.8885 },  // Verona, Italy
  'TRS': { latitude: 45.8275, longitude: 13.4722 },  // Trieste, Italy
  'PSR': { latitude: 42.4297, longitude: 14.1808 },  // Pescara, Italy
  'AOI': { latitude: 43.6172, longitude: 13.3614 },  // Ancona, Italy
  'CLY': { latitude: 40.6314, longitude: 8.2925 },  // Calvi, Corsica
  'FSC': { latitude: 41.9236, longitude: 8.8029 },  // Figari, Corsica

  // ── ŠPANIJA ──
  'MAD': { latitude: 40.4719, longitude: -3.5626 },
  'BCN': { latitude: 41.2971, longitude: 2.0785 },
  'LIS': { latitude: 38.7742, longitude: -9.1342 },
  'OPO': { latitude: 41.2481, longitude: -8.6814 },
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
  'LEI': { latitude: 36.8439, longitude: -2.3703 },
  'XRY': { latitude: 36.7446, longitude: -6.0603 },
  'VGO': { latitude: 42.2232, longitude: -8.6262 },
  'LCG': { latitude: 43.3021, longitude: -8.3777 },
  'OVD': { latitude: 43.5636, longitude: -6.0346 },
  'FUE': { latitude: 28.4527, longitude: -13.8638 },
  'ALC': { latitude: 38.2822, longitude: -0.5582 },
  'GRO': { latitude: 41.9000, longitude: 2.7606 },
  'REU': { latitude: 41.1474, longitude: 1.1672 },
  'IBZ': { latitude: 38.8729, longitude: 1.3731 },
  'MAH': { latitude: 39.8626, longitude: 4.2187 },
  'SDR': { latitude: 43.4281, longitude: -3.8197 },  // Santander, Spain
  'ZAZ': { latitude: 41.6661, longitude: -1.0619 },  // Zaragoza, Spain
  'GRX': { latitude: 37.1887, longitude: -3.7775 },  // Granada, Spain
  'MJV': { latitude: 37.7747, longitude: -0.8114 },  // Murcia, Spain
  'VLL': { latitude: 41.7061, longitude: -4.8492 },  // Valladolid, Spain

  // ── PORTUGAL ──
  'FNC': { latitude: 32.6942, longitude: -16.7746 },
  'PDL': { latitude: 37.7412, longitude: -25.6979 },

  // ── GRČKA ──
  'ATH': { latitude: 37.9364, longitude: 23.9445 },
  'SKG': { latitude: 40.5197, longitude: 22.9708 },
  'HER': { latitude: 35.3397, longitude: 25.1803 },
  'RHO': { latitude: 36.4054, longitude: 28.0862 },
  'JTR': { latitude: 36.3992, longitude: 25.4793 },
  'JMK': { latitude: 37.4351, longitude: 25.3411 },
  'CFU': { latitude: 39.6019, longitude: 19.9117 },
  'ZTH': { latitude: 37.7509, longitude: 20.8843 },
  'KGS': { latitude: 36.7933, longitude: 26.9405 },
  'CHQ': { latitude: 35.5317, longitude: 24.1497 },
  'EFL': { latitude: 38.1201, longitude: 20.5005 },
  'PVK': { latitude: 38.9254, longitude: 20.7658 },
  'VOL': { latitude: 39.2196, longitude: 22.7943 },
  'KVA': { latitude: 40.5167, longitude: 22.8167 },  // Kavala, Greece
  'MLO': { latitude: 36.7311, longitude: 24.5017 },  // Milos, Greece
  'JNX': { latitude: 37.0792, longitude: 25.1486 },  // Naxos, Greece
  'JKL': { latitude: 37.0842, longitude: 26.9497 },  // Leros, Greece
  'LRS': { latitude: 39.8822, longitude: 25.2314 },  // Lemnos, Greece
  'SMI': { latitude: 38.5256, longitude: 26.9108 },  // Samos, Greece

  // ── MALTA ──
  'MLA': { latitude: 35.8575, longitude: 14.4775 },

  // ── CIPAR ──
  'LCA': { latitude: 34.8751, longitude: 33.6249 },
  'PFO': { latitude: 34.7180, longitude: 32.4857 },

  // ── SKANDINAVIJA ──
  'CPH': { latitude: 55.6181, longitude: 12.6561 },
  'AAL': { latitude: 57.0928, longitude: 9.8492 },
  'BLL': { latitude: 55.7403, longitude: 9.1518 },
  'AAR': { latitude: 56.3000, longitude: 10.6200 },  // Aarhus, Denmark
  'EBJ': { latitude: 55.5306, longitude: 8.5522 },   // Esbjerg, Denmark
  'OSL': { latitude: 60.1939, longitude: 11.1004 },
  'TRD': { latitude: 63.4576, longitude: 10.9243 },
  'BGO': { latitude: 60.2934, longitude: 5.2181 },
  'SVG': { latitude: 58.8767, longitude: 5.6379 },
  'TOS': { latitude: 69.6833, longitude: 18.9189 },
  'TRF': { latitude: 59.1867, longitude: 10.2586 },
  'AES': { latitude: 62.5625, longitude: 6.1197 },
  'KSU': { latitude: 63.1118, longitude: 7.8245 },
  'MQN': { latitude: 66.3667, longitude: 14.3000 },
  'BOO': { latitude: 67.2692, longitude: 14.3653 },
  'ARN': { latitude: 59.6519, longitude: 17.9186 },
  'GOT': { latitude: 57.6628, longitude: 12.2798 },
  'MMA': { latitude: 55.5300, longitude: 13.3714 },
  'MMX': { latitude: 55.5363, longitude: 13.3762 },
  'NYO': { latitude: 58.7886, longitude: 16.9122 },
  'VST': { latitude: 59.6108, longitude: 16.6372 },  // Västerås, Sweden
  'KSD': { latitude: 59.4447, longitude: 13.3389 },  // Karlstad, Sweden
  'ORB': { latitude: 60.2592, longitude: 15.0414 },  // Örebro, Sweden
  'JKG': { latitude: 57.4572, longitude: 14.0689 },  // Jönköping, Sweden
  'BLE': { latitude: 60.4219, longitude: 15.5211 },  // Borlänge, Sweden
  'HEL': { latitude: 60.3172, longitude: 24.9633 },
  'TMP': { latitude: 61.4141, longitude: 23.6044 },  // Tampere, Finland
  'TKU': { latitude: 60.5141, longitude: 22.2628 },  // Turku, Finland
  'OUL': { latitude: 64.9301, longitude: 25.3547 },  // Oulu, Finland
  'KEF': { latitude: 63.9850, longitude: -22.6056 },
  'REK': { latitude: 64.1300, longitude: -21.9406 },

  // ── BALTIC ──
  'RIX': { latitude: 56.9236, longitude: 23.9711 },
  'TLL': { latitude: 59.4133, longitude: 24.8328 },
  'VNO': { latitude: 54.6341, longitude: 25.2858 },
  'KUN': { latitude: 54.9639, longitude: 24.0833 },  // Kaunas, Lithuania
  'PLQ': { latitude: 55.7242, longitude: 21.0778 },  // Palanga, Lithuania
  'TAY': { latitude: 58.3072, longitude: 26.6878 },  // Tartu, Estonia

  // ── POLJSKA ──
  'WAW': { latitude: 52.1657, longitude: 20.9671 },
  'WMI': { latitude: 52.4511, longitude: 20.6519 },  // Warsaw Modlin, Poland
  'KRK': { latitude: 50.0777, longitude: 19.7848 },
  'KTW': { latitude: 50.4743, longitude: 19.0800 },
  'RZE': { latitude: 50.1100, longitude: 22.0190 },
  'GDN': { latitude: 54.3776, longitude: 18.4662 },
  'POZ': { latitude: 52.4210, longitude: 16.8263 },
  'WRO': { latitude: 51.1027, longitude: 16.8858 },
  'SZZ': { latitude: 53.5847, longitude: 14.9022 },
  'LUZ': { latitude: 51.2402, longitude: 22.7147 },
  'BZG': { latitude: 53.0968, longitude: 17.9777 },
  'LCJ': { latitude: 51.7219, longitude: 19.3981 },
  'IEG': { latitude: 51.9822, longitude: 15.7778 },  // Zielona Góra, Poland

  // ── ČEŠKA I SLOVAČKA ──
  'PRG': { latitude: 50.1008, longitude: 14.2600 },
  'BRQ': { latitude: 49.1513, longitude: 16.6944 },
  'OSR': { latitude: 49.6961, longitude: 18.1158 },  // Ostrava, Czech Republic
  'KSC': { latitude: 48.6631, longitude: 21.2411 },
  'BTS': { latitude: 48.1703, longitude: 17.2122 },  // Bratislava, Slovakia
  'TAT': { latitude: 49.2636, longitude: 20.2417 },  // Poprad, Slovakia

  // ── MAĐARSKA ──
  'BUD': { latitude: 47.4395, longitude: 19.2618 },
  'DEB': { latitude: 47.4836, longitude: 21.5714 },  // Debrecen, Hungary

  // ── RUMUNIJA ──
  'OTP': { latitude: 44.5722, longitude: 26.1022 },
  'CLJ': { latitude: 46.7852, longitude: 23.6862 },
  'TSR': { latitude: 45.8100, longitude: 21.3379 },
  'IAS': { latitude: 47.1585, longitude: 27.6208 },
  'SBZ': { latitude: 45.7856, longitude: 24.1517 },  // Sibiu, Romania
  'CRA': { latitude: 44.3297, longitude: 23.8903 },  // Craiova, Romania

  // ── BUGARSKA ──
  'SOF': { latitude: 42.6950, longitude: 23.4067 },
  'VAR': { latitude: 43.2321, longitude: 27.8250 },  // Varna, Bulgaria
  'BOJ': { latitude: 42.5731, longitude: 27.5158 },  // Burgas, Bulgaria
  'PDV': { latitude: 43.6289, longitude: 24.8578 },  // Plovdiv, Bulgaria

  // ── BALKAN ──
  'BEG': { latitude: 44.8184, longitude: 20.3091 },
  'INI': { latitude: 43.3373, longitude: 21.8537 },
  'KVO': { latitude: 43.8188, longitude: 20.5958 },
  'ZAG': { latitude: 45.7429, longitude: 16.0688 },
  'ZAD': { latitude: 44.1083, longitude: 15.3467 },
  'PUY': { latitude: 44.8934, longitude: 13.9222 },
  'RJK': { latitude: 45.2169, longitude: 14.5703 },
  'OSI': { latitude: 45.4627, longitude: 18.8102 },
  'DBV': { latitude: 42.5614, longitude: 18.2683 },
  'SPU': { latitude: 43.5389, longitude: 16.2981 },
  'SJJ': { latitude: 43.8247, longitude: 18.3314 },
  'BNX': { latitude: 44.9414, longitude: 17.2975 },
  'TGD': { latitude: 42.3594, longitude: 19.2519 },
  'TIV': { latitude: 42.4047, longitude: 18.7233 },
  'PRN': { latitude: 42.5786, longitude: 21.0286 },  // Pristina, Kosovo

  // ── SLOVENIJA ──
  'LJU': { latitude: 46.2237, longitude: 14.4576 },
  'MBX': { latitude: 46.4797, longitude: 15.6869 },  // Maribor, Slovenia

  // ── ALBANIA I MAKEDONIJA ──
  'TIA': { latitude: 41.4147, longitude: 19.7206 },
  'SKP': { latitude: 41.9616, longitude: 21.6214 },
  'OHD': { latitude: 41.1731, longitude: 20.7403 },  // Ohrid, North Macedonia

  // ── MOLDOVA ──
  'KIV': { latitude: 47.0544, longitude: 28.8247 },

  // ── BLISKI ISTOK ──
  'TLV': { latitude: 32.0114, longitude: 34.8867 },
  'AMM': { latitude: 31.7226, longitude: 35.9932 },
  'BEY': { latitude: 33.8209, longitude: 35.4884 },
  'BAH': { latitude: 26.2708, longitude: 50.6336 },
  'MCT': { latitude: 23.5880, longitude: 58.2900 },
  'SHJ': { latitude: 25.3286, longitude: 55.5172 },
  'KWI': { latitude: 29.2266, longitude: 47.9689 },
  'RUH': { latitude: 24.9576, longitude: 46.6988 },
  'DXB': { latitude: 25.2528, longitude: 55.3644 },
  'AUH': { latitude: 24.4430, longitude: 54.6510 },
  'DOH': { latitude: 25.2609, longitude: 51.6138 },
  'JED': { latitude: 21.6796, longitude: 39.1565 },  // Jeddah, Saudi Arabia
  'MED': { latitude: 24.5533, longitude: 39.4733 },  // Medina, Saudi Arabia

  // ── KAVKAZ ──
  'EVN': { latitude: 40.1474, longitude: 44.3959 },
  'GYD': { latitude: 40.4675, longitude: 50.0467 },
  'TBS': { latitude: 41.6693, longitude: 44.9548 },

  // ── UZBEKISTAN ──
  'TAS': { latitude: 41.2579, longitude: 69.2812 },

  // ── RUSIJA ──
  'SVO': { latitude: 55.9726, longitude: 37.4146 },
  'DME': { latitude: 55.4086, longitude: 37.9061 },
  'VKO': { latitude: 55.5915, longitude: 37.2615 },
  'LED': { latitude: 59.8003, longitude: 30.2625 },
  'KGD': { latitude: 54.8901, longitude: 20.5926 },
  'GOJ': { latitude: 56.2301, longitude: 43.7840 },
  'KZN': { latitude: 55.6062, longitude: 49.2787 },
  'AER': { latitude: 43.4499, longitude: 39.9566 },
  'ROV': { latitude: 47.2582, longitude: 39.8181 },
  'KUF': { latitude: 53.5049, longitude: 50.1643 },
  'UFA': { latitude: 54.5577, longitude: 55.8744 },
  'OMS': { latitude: 54.9670, longitude: 73.3105 },
  'CEK': { latitude: 55.3050, longitude: 61.5033 },  // Chelyabinsk, Russia
};

// Mapa gradova za aerodrome
const CITY_TO_AIRPORT: Record<string, string> = {
  // ── TURSKA ──
  'Istanbul': 'IST',
  'Ankara': 'ESB',
  'Izmir': 'ADB',
  'Antalya': 'AYT',
  'Bodrum': 'BJV',
  'Dalaman': 'DLM',

  // ── NJEMAČKA ──
  'Frankfurt': 'FRA',
  'Munich': 'MUC',
  'Stuttgart': 'STR',
  'Dusseldorf': 'DUS',
  'Cologne': 'CGN',
  'Hamburg': 'HAM',
  'Berlin': 'BER',
  'Leipzig': 'LEJ',
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
  'Memmingen': 'FMM',
  'Friedrichshafen': 'FDH',
  'Dresden': 'DRS',
  'Zweibrücken': 'ZQW',

  // ── AUSTRIJA ──
  'Vienna': 'VIE',
  'Salzburg': 'SZG',
  'Innsbruck': 'INN',
  'Linz': 'LNZ',
  'Graz': 'GRZ',
  'Klagenfurt': 'KLU',

  // ── ŠVAJCARSKA ──
  'Zurich': 'ZRH',
  'Geneva': 'GVA',
  'Basel': 'BSL',
  'Bern': 'BRN',
  'Lugano': 'LUG',
  'Sion': 'SIR',

  // ── FRANCUSKA ──
  'Paris': 'CDG',
  'Paris Orly': 'ORY',
  'Paris Beauvais': 'BVA',
  'Paris Vatry': 'XCR',
  'Marseille': 'MRS',
  'Nice': 'NCE',
  'Lyon': 'LYS',
  'Toulouse': 'TLS',
  'Bordeaux': 'BOD',
  'Nantes': 'NTE',
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
  'Strasbourg': 'SXB',
  'Metz': 'ETZ',
  'Biarritz': 'BIQ',
  'Montpellier': 'MPL',
  'Perpignan': 'PGF',

  // ── UK ──
  'London': 'LHR',
  'London Luton': 'LTN',
  'London Gatwick': 'LGW',
  'London Stansted': 'STN',
  'London City': 'LCY',
  'London Southend': 'SEN',
  'Manchester': 'MAN',
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

  // ── IRLSKA ──
  'Dublin': 'DUB',
  'Cork': 'ORK',
  'Shannon': 'SNN',
  'Knock': 'NOC',
  'Kerry': 'KIR',

  // ── NIZOZEMSKA ──
  'Amsterdam': 'AMS',
  'Eindhoven': 'EIN',
  'Rotterdam': 'RTM',
  'Groningen': 'GRQ',
  'Maastricht': 'MST',

  // ── BELGIJA ──
  'Brussels': 'BRU',
  'Antwerp': 'ANR',
  'Liège': 'LGG',
  'Liege': 'LGG',
  'Ostend': 'OST',
  'Charleroi': 'CRL',

  // ── LUKSEMBURG ──
  'Luxembourg': 'LUX',

  // ── ITALIJA ──
  'Rome': 'FCO',
  'Milan': 'MXP',
  'Milan Bergamo': 'BGY',
  'Milan Linate': 'LIN',
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
  'Venice Treviso': 'TSF',
  'Treviso': 'TSF',
  'Bologna': 'BLQ',
  'Florence': 'FLR',
  'Firenze': 'FLR',
  'Pisa': 'PSA',
  'Catania': 'CTA',
  'Palermo': 'PMO',
  'Verona': 'VRN',
  'Trieste': 'TRS',
  'Pescara': 'PSR',
  'Ancona': 'AOI',
  'Calvi': 'CLY',
  'Figari': 'FSC',

  // ── ŠPANIJA ──
  'Madrid': 'MAD',
  'Barcelona': 'BCN',
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
  'Santander': 'SDR',
  'Zaragoza': 'ZAZ',
  'Granada': 'GRX',
  'Murcia': 'MJV',
  'Valladolid': 'VLL',

  // ── PORTUGAL ──
  'Lisbon': 'LIS',
  'Porto': 'OPO',
  'Funchal': 'FNC',
  'Madeira': 'FNC',
  'Ponta Delgada': 'PDL',
  'Azores': 'PDL',

  // ── GRČKA ──
  'Athens': 'ATH',
  'Thessaloniki': 'SKG',
  'Heraklion': 'HER',
  'Rhodes': 'RHO',
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
  'Kavala': 'KVA',
  'Milos': 'MLO',
  'Naxos': 'JNX',
  'Leros': 'JKL',
  'Lemnos': 'LRS',
  'Samos': 'SMI',

  // ── MALTA ──
  'Malta': 'MLA',

  // ── CIPAR ──
  'Larnaca': 'LCA',
  'Paphos': 'PFO',

  // ── SKANDINAVIJA ──
  'Copenhagen': 'CPH',
  'Aalborg': 'AAL',
  'Billund': 'BLL',
  'Aarhus': 'AAR',
  'Esbjerg': 'EBJ',
  'Oslo': 'OSL',
  'Trondheim': 'TRD',
  'Bergen': 'BGO',
  'Stavanger': 'SVG',
  'Tromso': 'TOS',
  'Sandefjord': 'TRF',
  'Alesund': 'AES',
  'Ålesund': 'AES',
  'Kristiansund': 'KSU',
  'Mo i Rana': 'MQN',
  'Bodo': 'BOO',
  'Bodø': 'BOO',
  'Stockholm': 'ARN',
  'Gothenburg': 'GOT',
  'Malmo': 'MMA',
  'Reykjavik': 'KEF',

  // ── BALTIC ──
  'Riga': 'RIX',
  'Tallinn': 'TLL',
  'Vilnius': 'VNO',
  'Kaunas': 'KUN',
  'Palanga': 'PLQ',
  'Tartu': 'TAY',

  // ── POLJSKA ──
  'Warsaw': 'WAW',
  'Warsaw Modlin': 'WMI',
  'Krakow': 'KRK',
  'Katowice': 'KTW',
  'Rzesow': 'RZE',
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
  'Zielona Góra': 'IEG',

  // ── ČEŠKA I SLOVAČKA ──
  'Prague': 'PRG',
  'Brno': 'BRQ',
  'Ostrava': 'OSR',
  'Kosice': 'KSC',
  'Košice': 'KSC',
  'Bratislava': 'BTS',
  'Poprad': 'TAT',

  // ── MAĐARSKA ──
  'Budapest': 'BUD',
  'Debrecen': 'DEB',

  // ── RUMUNIJA ──
  'Bucharest': 'OTP',
  'Cluj-Napoca': 'CLJ',
  'Timisoara': 'TSR',
  'Timișoara': 'TSR',
  'Iasi': 'IAS',
  'Iași': 'IAS',
  'Sibiu': 'SBZ',
  'Craiova': 'CRA',

  // ── BUGARSKA ──
  'Sofia': 'SOF',
  'Varna': 'VAR',
  'Burgas': 'BOJ',
  'Plovdiv': 'PDV',

  // ── BALKAN ──
  'Belgrade': 'BEG',
  'Nis': 'INI',
  'Niš': 'INI',
  'Kraljevo': 'KVO',
  'Zagreb': 'ZAG',
  'Zadar': 'ZAD',
  'Pula': 'PUY',
  'Rijeka': 'RJK',
  'Osijek': 'OSI',
  'Dubrovnik': 'DBV',
  'Split': 'SPU',
  'Sarajevo': 'SJJ',
  'Banja Luka': 'BNX',
  'Podgorica': 'TGD',
  'Tivat': 'TIV',
  'Pristina': 'PRN',

  // ── SLOVENIJA ──
  'Ljubljana': 'LJU',
  'Maribor': 'MBX',

  // ── ALBANIA I MAKEDONIJA ──
  'Tirana': 'TIA',
  'Skopje': 'SKP',
  'Ohrid': 'OHD',

  // ── MOLDOVA ──
  'Chisinau': 'KIV',
  'Chișinău': 'KIV',

  // ── BLISKI ISTOK ──
  'Tel Aviv': 'TLV',
  'Amman': 'AMM',
  'Beirut': 'BEY',
  'Bahrain': 'BAH',
  'Muscat': 'MCT',
  'Sharjah': 'SHJ',
  'Kuwait City': 'KWI',
  'Kuwait': 'KWI',
  'Riyadh': 'RUH',
  'Dubai': 'DXB',
  'Abu Dhabi': 'AUH',
  'Doha': 'DOH',
  'Jeddah': 'JED',
  'Medina': 'MED',

  // ── KAVKAZ ──
  'Yerevan': 'EVN',
  'Baku': 'GYD',
  'Tbilisi': 'TBS',

  // ── UZBEKISTAN ──
  'Tashkent': 'TAS',

  // ── RUSIJA ──
  'Moscow': 'SVO',
  'St Petersburg': 'LED',
  'Kaliningrad': 'KGD',
  'Nizhny Novgorod': 'GOJ',
  'Kazan': 'KZN',
  'Sochi': 'AER',
  'Сочи': 'AER',
  'Rostov-on-Don': 'ROV',
  'Samara': 'KUF',
  'Ufa': 'UFA',
  'Omsk': 'OMS',
  'Chelyabinsk': 'CEK',
};

// ─────────────────────────────────────────────────────────────
// v5.11: CENTRALIZOVAN PROXY — Open-Meteo se sad zove SAMO sa
// servera (app/api/weather/route.ts), koji drži Redis keš sa 3h
// TTL-om dijeljenim između svih 41 kioska. Ranija "429 rate limit
// prevention" strategija (client-side dedup, stagger, retry) je
// bila per-tab/localStorage zaštita — nedovoljna jer 41 FIZIČKI
// odvojenih uređaja nikad nije dijelilo isti keš. Sad, čak i sa
// hiljadu kioska, Open-Meteo dobija najviše 1 poziv na 3h PO
// LOKACIJI — server to garantuje, ne klijent.
//
// Client-side slojevi ispod (in-memory Map + localStorage) ostaju —
// više nisu zaštita OD Open-Meteo-a, nego zaštita OD nepotrebnih
// poziva ka NAŠOJ /api/weather ruti (jeftino, ali svejedno nema
// razloga zvati je češće nego što server ionako osvježava podatke).
// ─────────────────────────────────────────────────────────────

const CACHE_DURATION = 3 * 60 * 60 * 1000; // 3h — usklađeno sa server-side Redis TTL-om
const LOCAL_STORAGE_KEY = 'fids_weather_cache_v5_11';
const STAGGER_MAX_MS = 1500;

// ── In-memory cache (per-tab) ──
const weatherCache = new Map<string, { data: WeatherData; timestamp: number }>();

// ── In-flight request dedup (1 fetch per airport at a time) ──
const inflightRequests = new Map<string, Promise<WeatherData>>();

// ── Load localStorage cache on startup (shared across tabs) ──
function loadLocalStorageCache(): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { data: WeatherData; timestamp: number }>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && entry.timestamp && now - entry.timestamp < CACHE_DURATION) {
        weatherCache.set(key, entry);
      }
    }
  } catch { /* ignore */ }
}

function saveToLocalStorage(key: string, data: WeatherData): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[key] = { data, timestamp: Date.now() };
    // Limit to 200 entries to avoid quota issues
    const keys = Object.keys(parsed);
    if (keys.length > 200) {
      // Remove oldest entries
      keys.sort((a, b) => parsed[a].timestamp - parsed[b].timestamp);
      for (let i = 0; i < keys.length - 200; i++) {
        delete parsed[keys[i]];
      }
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
  } catch { /* quota exceeded — ignore */ }
}

// Load localStorage cache on module init
if (typeof window !== 'undefined') {
  loadLocalStorageCache();
}

// v4.2: 24/7/365 — uvijek dostupan (uklonjena isWithinOperatingHours restrikcija)
const getTimeUntilNextRefresh = (): number => {
  return CACHE_DURATION;
};

// Funkcija za dobivanje cache ključa
const getCacheKey = (destination: { cityName?: string; airportCode?: string; airportName?: string }): string => {
  return `${destination.airportCode || ''}-${destination.cityName || ''}-${destination.airportName || ''}`;
};

// ── Fetch preko NAŠE /api/weather rute (Redis-kešована, 3h TTL,
// dijeljena sa svih 41 kioska) — VIŠE NE zove Open-Meteo direktno.
// Retry-na-429 logika je sad SERVER-side (app/api/weather/route.ts) —
// server tamo interno pokušava ponovo ako Open-Meteo vrati 429; klijent
// samo čita rezultat (ili grešku) od našeg servera, bez svog retry-a
// (nema smisla da 41 klijent retry-uje ka NAMA kad server ionako
// kešira 3h — to bi samo dodalo nepotrebne Edge Requests).
async function fetchWeatherFromAPI(coordinates: Coordinates): Promise<WeatherData> {
  const params = new URLSearchParams({
    lat: coordinates.latitude.toString(),
    lon: coordinates.longitude.toString(),
  });

  const response = await fetch(`/api/weather?${params}`);

  if (!response.ok) {
    throw new Error(`Weather API request failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    temperature: data.temperature ?? 0,
    weatherCode: data.weatherCode ?? 0,
    windSpeed: data.windSpeed ?? 0,
    windDirection: data.windDirection ?? 0,
    loading: false,
  };
}

// ── Dedup-wrapped fetch — 1 request per airport at a time ──
async function fetchWeatherDedup(cacheKey: string, coordinates: Coordinates): Promise<WeatherData> {
  // Check if already in-flight
  const existing = inflightRequests.get(cacheKey);
  if (existing) {
    console.log(`[weather] Dedup: waiting for in-flight request ${cacheKey}`);
    return existing;
  }

  // Start new request
  const promise = fetchWeatherFromAPI(coordinates).catch(err => {
    // On error, return error state
    return {
      temperature: 0,
      weatherCode: 0,
      windSpeed: 0,
      windDirection: 0,
      loading: false,
      error: err instanceof Error ? err.message : 'Failed to fetch weather data',
    } as WeatherData;
  }).finally(() => {
    // Clear in-flight after completion (success or error)
    inflightRequests.delete(cacheKey);
  });

  inflightRequests.set(cacheKey, promise);
  return promise;
}

export const useWeather = (destination: {
  cityName?: string;
  airportCode?: string;
  airportName?: string;
}, _p0: number = 0) => {
  const [weatherData, setWeatherData] = useState<WeatherData>({
    temperature: 0,
    weatherCode: 0,
    windSpeed: 0,
    windDirection: 0,
    loading: true,
  });

  useEffect(() => {
    // ── MEMORY LEAK FIX (Chrome dugotrajan rad, 2026-08) ──────────────
    // 'cancelled' i 'timeoutId' su OVDJE, u tijelu efekta — ne unutar
    // scheduleNextRefresh() — jer moraju biti ISTA promjenljiva kroz sve
    // rekurzivne pozive, da bi cleanup funkcija ispod uvijek mogla
    // otkazati NAJNOVIJI zakazani timer, ne samo prvi.
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchWeather = async () => {
      const cacheKey = getCacheKey(destination);

      // 1. Check in-memory cache first (fast)
      const cached = weatherCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        if (!cancelled) setWeatherData(cached.data);
        return;
      }

      // 2. Find coordinates
      let coordinates: Coordinates | undefined;

      if (destination.airportCode && AIRPORT_COORDINATES[destination.airportCode]) {
        coordinates = AIRPORT_COORDINATES[destination.airportCode];
      } else if (destination.cityName) {
        const airportCodeFromCity = CITY_TO_AIRPORT[destination.cityName];
        if (airportCodeFromCity && AIRPORT_COORDINATES[airportCodeFromCity]) {
          coordinates = AIRPORT_COORDINATES[airportCodeFromCity];
        }
      }

      if (!coordinates && destination.airportName) {
        const airportMatch = Object.keys(AIRPORT_COORDINATES).find(code =>
          destination.airportName?.includes(code) ||
          destination.airportName?.toLowerCase().includes(code.toLowerCase())
        );
        if (airportMatch) {
          coordinates = AIRPORT_COORDINATES[airportMatch];
        }
      }

      if (!coordinates) {
        const errorData: WeatherData = {
          temperature: 0,
          weatherCode: 0,
          windSpeed: 0,
          windDirection: 0,
          loading: false,
          error: `Coordinates not found for ${destination.cityName || destination.airportName || destination.airportCode}`
        };
        weatherCache.set(cacheKey, { data: errorData, timestamp: Date.now() });
        if (!cancelled) setWeatherData(errorData);
        return;
      }

      // 3. v4.2: Stagger initial request to avoid burst of 9 concurrent
      // (random 0-1500ms delay — distributes load across kiosks)
      const staggerDelay = Math.random() * STAGGER_MAX_MS;
      await new Promise(resolve => setTimeout(resolve, staggerDelay));
      if (cancelled) return; // komponenta se ugasila dok smo čekali stagger

      // 4. Fetch with dedup + retry (1 request per airport at a time)
      const newWeatherData = await fetchWeatherDedup(cacheKey, coordinates);
      if (cancelled) return; // komponenta se ugasila dok je fetch bio u toku

      // 5. Cache result (in-memory + localStorage)
      weatherCache.set(cacheKey, { data: newWeatherData, timestamp: Date.now() });
      saveToLocalStorage(cacheKey, newWeatherData);
      setWeatherData(newWeatherData);
    };

    if (destination.cityName || destination.airportCode || destination.airportName) {
      fetchWeather();

      // ── FIX: prije je scheduleNextRefresh() vraćao cleanup koji je
      // hvatao SAMO PRVI timeoutId. Kad bi taj prvi timer okinuo (nakon
      // ~30 min), on je rekurzivno pozivao scheduleNextRefresh() OPET —
      // taj NOVI poziv je pravio NOVI lokalni timeoutId čiji cleanup
      // nikad nije vraćen niti sačuvan nigdje. React-ov effect cleanup je
      // i dalje znao samo za PRVI (već istekli) timeoutId, pa clearTimeout
      // pri unmount-u/remount-u nije radio ništa nakon prvog ciklusa —
      // lanac setTimeout-a je nastavljao da se sam zakazuje ZAUVIJEK, čak
      // i nakon što komponenta više ne postoji. Na 24/7 kiosku, svaki
      // remount (route promjena, error-boundary retry, gate reassignment)
      // je stvarao JOŠ JEDAN besmrtni lanac koji svakih ~30 min radi
      // fetch + setState na komponentu koja više ne postoji — klasičan
      // "zombie timer" memory leak koji se gomila danima/sedmicama i na
      // kraju uzrokuje Chrome "Aw, Snap!" (out of memory tab crash).
      //
      // Sad: 'timeoutId' je promjenljiva IZ SPOLJAŠNJEG scope-a efekta
      // (ne lokalna unutar scheduleNextRefresh), pa svaki rekurzivni poziv
      // PREPISUJE istu promjenljivu — cleanup ispod (koji je zatvara po
      // referenci) uvijek zna otkazati NAJNOVIJI zakazani timer, koliko
      // god se puta scheduleNextRefresh već rekurzivno pozvao. 'cancelled'
      // flag dodatno sprečava da fetchWeather() koji je već "u letu" (npr.
      // usred stagger delay-a ili mrežnog poziva) pozove setState ili
      // zakaže sljedeći ciklus nakon što je komponenta unmount-ovana.
      const scheduleNextRefresh = () => {
        const refreshInterval = getTimeUntilNextRefresh();
        timeoutId = setTimeout(() => {
          if (cancelled) return;
          fetchWeather().finally(() => {
            if (!cancelled) scheduleNextRefresh();
          });
        }, refreshInterval);
      };

      scheduleNextRefresh();
    } else {
      // ── Guard: ne pozivaj setState ako je stanje već identično —
      // druga linija odbrane pored dep-array fixa iznad, za slučaj da
      // efekat ipak bude okinut bez stvarne promjene (npr. StrictMode
      // dvostruki mount u dev-u). Sprečava nepotrebne re-rendere.
      setWeatherData(prev => {
        if (prev.error === 'No destination provided' && !prev.loading) return prev;
        return {
          temperature: 0,
          weatherCode: 0,
          windSpeed: 0,
          windDirection: 0,
          loading: false,
          error: 'No destination provided'
        };
      });
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // ── BUG FIX: 'destination' (cijeli objekat) UKLONJEN iz deps.
    // Pozivaoci (npr. GatePageClient) prosljeđuju inline object literal
    // ({ cityName: ..., airportCode: ... }) koji dobija NOVU referencu
    // svaki render. Sa objektom u dep-arrayu, efekat se okidao na SVAKI
    // render bez obzira da li su se cityName/airportCode/airportName
    // stvarno promijenili. Kad gate nema dodijeljen let (svi undefined),
    // else grana ispod bezuslovno zove setWeatherData() -> re-render ->
    // nova referenca objekta -> efekat opet -> "Maximum update depth
    // exceeded" (beskonačna petlja). Primitivi ispod su dovoljni i
    // stabilni (undefined === undefined kroz rendere kad nema leta).
  }, [destination.cityName, destination.airportCode, destination.airportName]);

  return weatherData;
};
