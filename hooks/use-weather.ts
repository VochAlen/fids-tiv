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
  'MAN': { latitude: 53.3537, longitude: -2.2750 }, // Manchester, UK
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
  'TLV': { latitude: 32.0114, longitude: 34.8867 }, // Tel Aviv, Israel
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
};

// Mapa gradova za aerodrome
const CITY_TO_AIRPORT: Record<string, string> = {
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
  'London': 'LHR',
  'London Luton': 'LTN',
  'London Gatwick': 'LGW',
  'London Stansted': 'STN',
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
  'Manchester': 'MAN', // Manchester, UK
  'Edinburgh': 'EDI',
  'Madrid': 'MAD',
  'Barcelona': 'BCN',
  'Lisbon': 'LIS',
  'Rome': 'FCO',
  'Milan': 'MXP',
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
  'Tel Aviv': 'TLV', // Tel Aviv, Israel
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
  'Porto': 'OPO',
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
};

// Cache za weather podatke
const weatherCache = new Map<string, { data: WeatherData; timestamp: number }>();
const CACHE_DURATION = 180 * 60 * 1000; // 10 minuta cache

// Helper funkcija za provjeru vremena
const isWithinOperatingHours = (): boolean => {
  const now = new Date();
  const currentHour = now.getHours();
  // Radno vrijeme od 05:00 do 19:00
  return currentHour >= 5 && currentHour < 19;
};

// Helper funkcija za izračun vremena do sljedećeg osvježavanja
const getTimeUntilNextRefresh = (): number => {
  const now = new Date();
  const currentHour = now.getHours();
  
  // Ako je izvan radnog vremena, vrati vrijeme do 05:00 sljedeći dan
  if (currentHour >= 19) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(5, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
  }
  
  // Ako je prije 05:00, vrati vrijeme do 05:00
  if (currentHour < 5) {
    const today = new Date(now);
    today.setHours(5, 0, 0, 0);
    return today.getTime() - now.getTime();
  }
  
  // U radnom vremenu - osvježi svakih 30 minuta (umjesto 60)
  return 180 * 60 * 1000; // 30 minuta
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
    const fetchWeather = async () => {
      // Provjeri cache prvo
      const cacheKey = getCacheKey(destination);
      const cached = weatherCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`Using cached weather data for: ${cacheKey}`);
        setWeatherData(cached.data);
        return;
      }

      // Ako je izvan radnog vremena, ne dohvaćaj podatke
      if (!isWithinOperatingHours()) {
        console.log('Outside operating hours, skipping weather fetch');
        setWeatherData({
          temperature: 0,
          weatherCode: 0,
          loading: false,
          error: 'Outside operating hours'
        });
        return;
      }

      // Prvo pokušaj pronaći koordinate preko IATA koda
      let coordinates: Coordinates | undefined;
      
      if (destination.airportCode && AIRPORT_COORDINATES[destination.airportCode]) {
        coordinates = AIRPORT_COORDINATES[destination.airportCode];
        console.log(`Found coordinates for airport code: ${destination.airportCode}`, coordinates);
      } 
      // Ako nema IATA koda, pokušaj preko naziva grada
      else if (destination.cityName) {
        const airportCodeFromCity = CITY_TO_AIRPORT[destination.cityName];
        if (airportCodeFromCity && AIRPORT_COORDINATES[airportCodeFromCity]) {
          coordinates = AIRPORT_COORDINATES[airportCodeFromCity];
          console.log(`Found coordinates for city: ${destination.cityName} -> ${airportCodeFromCity}`, coordinates);
        }
      }
      
      // Ako još uvijek nema koordinata, pokušaj preko naziva aerodroma
      if (!coordinates && destination.airportName) {
        // Pokušaj pronaći IATA kod u nazivu aerodroma
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
        setWeatherData(errorData);
        return;
      }

      try {
        // Dodaj delay između zahtjeva da izbjegneš rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));

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

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error('Rate limit exceeded - too many requests');
          }
          throw new Error(`Weather API request failed: ${response.status}`);
        }

        const data = await response.json();
        
        console.log(`Weather data for ${destination.cityName || destination.airportName}:`, {
          temperature: data.current.temperature_2m,
          weatherCode: data.current.weather_code
        });
        
        const newWeatherData = {
          temperature: data.current.temperature_2m,
          weatherCode: data.current.weather_code,
          loading: false,
        };

        // Spremi u cache
        weatherCache.set(cacheKey, { data: newWeatherData, timestamp: Date.now() });
        
        setWeatherData(newWeatherData);
      } catch (error) {
        console.error('Error fetching weather:', error);
        const errorData = {
          temperature: 0,
          weatherCode: 0,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch weather data'
        };
        
        // Spremi error u cache na kraće vrijeme (1 minuta)
        weatherCache.set(cacheKey, { data: errorData, timestamp: Date.now() });
        setWeatherData(errorData);
      }
    };

    if (destination.cityName || destination.airportCode || destination.airportName) {
      console.log(`Fetching weather for:`, destination);
      fetchWeather();
      
      const scheduleNextRefresh = () => {
        const refreshInterval = getTimeUntilNextRefresh();
        console.log(`Scheduling next weather refresh in ${refreshInterval / (180 * 1000)} minutes`);
        
        const timeoutId = setTimeout(() => {
          fetchWeather();
          scheduleNextRefresh(); // Re-schedule next refresh
        }, refreshInterval);
        
        return () => clearTimeout(timeoutId);
      };
      
      // Pokreni scheduling
      const cleanup = scheduleNextRefresh();
      return cleanup;
    } else {
      setWeatherData({
        temperature: 0,
        weatherCode: 0,
        loading: false,
        error: 'No destination provided'
      });
    }
  }, [destination.cityName, destination.airportCode, destination.airportName]);

  return weatherData;
};