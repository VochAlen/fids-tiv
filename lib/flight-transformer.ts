// lib/flight-transformer.ts
import { NextResponse } from 'next/server';

// Your target interface (keep your existing interfaces)
interface Flight {
  FlightNumber: string;
  AirlineCode: string;
  AirlineICAO: string;
  AirlineName: string;
  DestinationAirportName: string;
  DestinationAirportCode: string;
  ScheduledDepartureTime: string;
  EstimatedDepartureTime: string;
  ActualDepartureTime: string;
  StatusEN: string;
  Terminal: string;
  GateNumber: string;
  CheckInDesk: string;
  BaggageReclaim: string;
  CodeShareFlights: string[];
  AirlineLogoURL: string;
  FlightType: 'departure' | 'arrival';
  DestinationCityName: string;
}

interface FlightData {
  departures: Flight[];
  arrivals: Flight[];
  lastUpdated: string;
}

// DeepSeek/OpenRouter configuration
const DEEPSEEK_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek/deepseek-chat';

/**
 * Transform any JSON flight data to your format using DeepSeek
 */
async function transformWithDeepSeek(inputData: any, apiKey: string): Promise<FlightData> {
  const systemPrompt = `You are a flight data transformation expert. Convert any flight data JSON to this exact format:

{
  "departures": [
    {
      "FlightNumber": "string (e.g., '4O150')",
      "AirlineCode": "string (2-letter IATA code)",
      "AirlineICAO": "string (3-letter ICAO code)", 
      "AirlineName": "string",
      "DestinationAirportName": "string",
      "DestinationAirportCode": "string (IATA code)",
      "ScheduledDepartureTime": "string (HH:MM format)",
      "EstimatedDepartureTime": "string (HH:MM format)",
      "ActualDepartureTime": "string (HH:MM format)",
      "StatusEN": "string",
      "Terminal": "string",
      "GateNumber": "string",
      "CheckInDesk": "string",
      "BaggageReclaim": "string",
      "CodeShareFlights": "string[]",
      "AirlineLogoURL": "string",
      "FlightType": "departure",
      "DestinationCityName": "string"
    }
  ],
  "arrivals": [
    // Same structure as departures but with FlightType: "arrival"
  ],
  "lastUpdated": "ISO string"
}

CRITICAL MAPPING RULES:
- FlightType: "O" = "departure", "I" = "arrival"
- Time fields: Convert to HH:MM format (e.g., "0730" → "07:30")
- FlightNumber: Combine airline code and flight number
- Use empty strings for missing data
- CodeShareFlights should be array of strings
- For logos, construct URL like: https://www.flightaware.com/images/airline_logos/180px/{ICAO}.png

Return ONLY valid JSON, no other text.`;

  const userPrompt = `Transform this flight data to the required format. Remember: "TipLeta":"O" = departure, "TipLeta":"I" = arrival:\n\n${JSON.stringify(inputData, null, 2)}`;

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yourdomain.com',
        'X-Title': 'Flight Data Transformer'
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const result = await response.json();
    const transformedJson = result.choices[0].message.content;
    
    // Parse the JSON response
    return JSON.parse(transformedJson);
  } catch (error) {
    console.error('DeepSeek transformation error:', error);
    throw new Error(`Transformation failed: ${error}`);
  }
}

/**
 * Manual transformation with correct flight type mapping
 */
function manualTransform(inputData: any): FlightData {
  const departures: Flight[] = [];
  const arrivals: Flight[] = [];

  if (Array.isArray(inputData)) {
    inputData.forEach((item: any) => {
      const flight = transformSingleFlight(item);
      if (flight.FlightType === 'departure') {
        departures.push(flight);
      } else {
        arrivals.push(flight);
      }
    });
  } else if (inputData.departures && inputData.arrivals) {
    // If data is already partially structured
    if (Array.isArray(inputData.departures)) {
      inputData.departures.forEach((item: any) => {
        departures.push(transformSingleFlight(item));
      });
    }
    if (Array.isArray(inputData.arrivals)) {
      inputData.arrivals.forEach((item: any) => {
        arrivals.push(transformSingleFlight(item));
      });
    }
  }

  return {
    departures,
    arrivals,
    lastUpdated: new Date().toISOString()
  };
}

function transformSingleFlight(item: any): Flight {
  // Determine flight type - "O" for departure, "I" for arrival
  const flightType = getFlightType(item);
  
  return {
    FlightNumber: `${item.Kompanija || item.airlineCode || item.carrierCode || ''}${item.BrojLeta || item.flightNumber || item.flightNum || ''}`,
    AirlineCode: item.Kompanija || item.airlineCode || item.carrierCode || '',
    AirlineICAO: item.KompanijaICAO || item.airlineICAO || item.icaoCode || '',
    AirlineName: item.KompanijaNaziv || item.airlineName || item.carrierName || '',
    DestinationAirportName: item.Aerodrom || item.airportName || item.destinationAirport || '',
    DestinationAirportCode: item.IATA || item.airportCode || item.destination || '',
    ScheduledDepartureTime: formatTime(item.Planirano || item.scheduledTime || item.scheduled),
    EstimatedDepartureTime: formatTime(item.Predvidjeno || item.estimatedTime || item.estimated),
    ActualDepartureTime: formatTime(item.Aktuelno || item.actualTime || item.actual),
    StatusEN: item.StatusEN || item.status || item.statusText || '',
    Terminal: item.Terminal || item.terminal || '',
    GateNumber: item.Gate || item.gate || item.gateNumber || '',
    CheckInDesk: item.CheckIn || item.checkIn || item.checkInDesk || '',
    BaggageReclaim: item.Karusel || item.baggage || item.baggageClaim || '',
    CodeShareFlights: parseCodeShare(item.CodeShare || item.codeShare || item.codeshare),
    AirlineLogoURL: getLogoUrl(item.KompanijaICAO || item.airlineICAO || item.icaoCode),
    FlightType: flightType,
    DestinationCityName: item.Grad || item.city || item.destinationCity || ''
  };
}

/**
 * Determine flight type based on various possible field names
 */
function getFlightType(item: any): 'departure' | 'arrival' {
  // Primary mapping for your specific format
  if (item.TipLeta === 'O') return 'departure';
  if (item.TipLeta === 'I') return 'arrival';
  
  // Fallback mappings for other APIs
  if (item.type === 'departure' || item.direction === 'outbound' || item.departure) return 'departure';
  if (item.type === 'arrival' || item.direction === 'inbound' || item.arrival) return 'arrival';
  
  // Default to departure if unknown
  return 'departure';
}

/**
 * Parse code share flights from various formats
 */
function parseCodeShare(codeShare: string): string[] {
  if (!codeShare) return [];
  
  return codeShare
    .split(',')
    .map((flight: string) => flight.trim())
    .filter((flight: string) => flight !== '');
}

/**
 * Get airline logo URL
 */
function getLogoUrl(icaoCode: string): string {
  if (!icaoCode) return 'https://via.placeholder.com/180x120?text=No+Logo';
  return `https://www.flightaware.com/images/airline_logos/180px/${icaoCode}.png`;
}

/**
 * Format time from various formats to HH:MM
 */
function formatTime(time: string): string {
  if (!time) return '';
  
  // Remove any non-digit characters
  const cleanTime = time.replace(/[^0-9]/g, '');
  
  // Handle HHMM format (like "0730")
  if (cleanTime.length === 4) {
    return `${cleanTime.substring(0, 2)}:${cleanTime.substring(2, 4)}`;
  }
  
  // Handle HH:MM format (already correct)
  if (cleanTime.length === 5 && time.includes(':')) {
    return time;
  }
  
  // Return original if format is unknown
  return time;
}

export { transformWithDeepSeek, manualTransform };
export type { Flight, FlightData };